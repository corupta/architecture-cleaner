// K3c resolution identity under the runtime (plan §3.4; research 04b A1, hole #1). Every runtime site (value
// imports and exports, side-effect imports, require, import =, import(), require.resolve, URL references) of every
// source file f resolves, under each runtime that loads the package and with that runtime's own alias mechanism,
// in head map(f) to map(what it resolved to in base). Ground truth is Node itself with the target's own hooks
// (runtime-probe.ts), so a relative→alias rewrite that tsc and the test runner accept but production Node can't load
// fails here, and so does any site that reaches TypeScript through tsconfig paths/baseUrl when the runtime has no
// alias mechanism at all ("unknown runtime alias mechanism", plan §2.5).
//
// Strict identity holds for the files an identified runtime loads (its program under the package root). Elsewhere
// (tests, other packages, or every file when nothing in the tree says how the package runs and plain Node stands in)
// the runtime isn't known to be the file's consumer, so a site that this Node can't resolve but TypeScript can (a
// bundler's, a test runner's or an unknown alias layer's specifier) is left to K3a and K3b: it may stay unresolved or
// reach map(TypeScript's target), nothing else. What Node does resolve must still resolve to map(base) everywhere.
import path from 'node:path';
import ts from 'typescript';
import { createSiteResolver, isSourceFile, moduleFormat, type SiteResolver, stripBom } from '../analyzer/analyze.js';
import type { RepoFs } from '../analyzer/repo-fs.js';
import { loadScopes } from '../analyzer/tsconfig-scopes.js';
import type { ModuleFormat, ReferenceSite, Resolution } from '../analyzer/types.js';
import type { CommitTree } from './git-tree.js';
import { detectRuntimes, hasAliasLayer, type Runtime, type RuntimeDetection } from './runtime-mechanism.js';
import { buildSkeleton, installedPackage, type Layout, type Mode, type ProbeFile, type ProbeOutput, type ProbeToken, runProbe, type Skeleton } from './runtime-probe.js';
import { type CertifyContext, type Check, type Finding, result, type Side, type Violation } from './types.js';

const title = 'Resolution identity under the runtime';
const sides: Side[] = ['base', 'head'];
const runtimeKinds = new Set<ReferenceSite['kind']>(['import', 'export', 'import-equals', 'dynamic-import', 'require', 'require-resolve', 'url-reference']);
/** Sites the runtime loads: not `import type`/`export type`/all-type named imports, `typeof import`, triple-slash, augmentations or mocks. */
export const isRuntimeSite = (site: ReferenceSite) => runtimeKinds.has(site.kind) && !site.typeOnly;
/** The text before an `import { type A } from '` specifier; verbatimModuleSyntax emits it as `import {} from`, which loads the module. */
const inlineTypeImport = /(?<![@\w$.])import\s*\{[^}]*\}\s*from\s*['"]$/;
const declarationPattern = /\.d(\.[^./]+)?\.[cm]?ts$/;
const isTypeScript = (file: string) => /\.(c|m)?tsx?$/.test(file) && !declarationPattern.test(file);
const isRelative = (specifier: string) => /^\.\.?(\/|$)/.test(specifier);
const maxViolations = 300;
const maxFindings = 100;
const emitModel = 'in place: each source at its own path with the runtime extension (.ts->.js, .mts->.mjs, .cts->.cjs), as with a fixed rootDir';

type Token =
  | { type: 'file'; files: string[]; suffix: string }
  | { type: 'external'; path: string; suffix: string }
  | { type: 'builtin'; name: string }
  | { type: 'path'; path: string }
  | { type: 'other'; url: string }
  | { type: 'unresolved'; code: string };

interface Resolved {
  token: Token;
  /** How the runtime loads the site (a moved file whose module format flips loads its imports differently). */
  mode: Mode;
  /** The specifier after the build rewrote it (Nest's hook, rewriteRelativeImportExtensions). */
  emitted?: string;
}

function toToken(raw: ProbeToken, skeleton: Skeleton, tree: CommitTree): Token {
  switch (raw.t) {
    case 's': {
      const owners = skeleton.owners.get(raw.p);
      return owners ? { type: 'file', files: owners, suffix: raw.x ?? '' } : { type: 'path', path: raw.p };
    }
    case 'w':
      return tree.entries.has(raw.p) ? { type: 'file', files: [raw.p], suffix: raw.x ?? '' } : { type: 'external', path: `<environment>/${raw.p}`, suffix: raw.x ?? '' };
    case 'e':
      return { type: 'external', path: raw.p, suffix: raw.x ?? '' };
    case 'b':
      return { type: 'builtin', name: raw.n };
    case 'o':
      return { type: 'other', url: raw.u };
    case 'u':
      return { type: 'unresolved', code: raw.c };
  }
}

function describe(token: Token): string {
  switch (token.type) {
    case 'file':
      return `${token.files.join(' | ')}${token.suffix}`;
    case 'external':
      return `${token.path}${token.suffix}`;
    case 'builtin':
      return `node:${token.name}`;
    case 'path':
      return `${token.path} (not a tracked file)`;
    case 'other':
      return token.url;
    case 'unresolved':
      return `unresolved (${token.code})`;
  }
}

/** The base token with the pathMap applied to repo files; unresolved tokens are compared by specifier instead. */
function mapToken(token: Token, map: (file: string) => string): Token {
  return token.type === 'file' ? { ...token, files: token.files.map(map).sort() } : token;
}

function sameToken(expected: Token, actual: Token): boolean {
  if (expected.type !== actual.type) return false;
  switch (expected.type) {
    case 'file':
      return actual.type === 'file' && expected.suffix === actual.suffix && expected.files.join('\0') === [...actual.files].sort().join('\0');
    case 'external':
      return actual.type === 'external' && expected.path === actual.path && expected.suffix === actual.suffix;
    case 'builtin':
      return actual.type === 'builtin' && expected.name === actual.name;
    case 'path':
      return actual.type === 'path' && expected.path === actual.path;
    case 'other':
      return actual.type === 'other' && expected.url === actual.url;
    case 'unresolved':
      return true;
  }
}

/** The file Node loads for a declaration TypeScript resolved (`x.d.ts` -> `x.js`). */
const implementationOf = (file: string) => file.replace(/\.d\.ts$/, '.js').replace(/\.d\.mts$/, '.mjs').replace(/\.d\.cts$/, '.cjs');
const reaches = (token: Token, file: string) => token.type === 'file' && (token.files.includes(file) || token.files.includes(implementationOf(file)));

/** A specifier TypeScript may resolve through `paths` or `baseUrl` (the aliases Node knows nothing about). */
function throughAlias(specifier: string, options: ts.CompilerOptions): boolean {
  if (isRelative(specifier) || specifier.startsWith('#') || specifier.startsWith('/') || /^[a-z]+:/i.test(specifier)) return false;
  if (options.baseUrl !== undefined) return true;
  return Object.keys(options.paths ?? {}).some((key) => {
    const star = key.indexOf('*');
    if (star === -1) return specifier === key;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    return specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix);
  });
}

/** A compiler option as a tsconfig and its relative `extends` set it (the analyzer's scopes force `noEmit`). */
function configuredOption(tree: CommitTree, config: string, name: string, seen = new Set<string>()): unknown {
  const text = seen.has(config) ? undefined : tree.text(config);
  seen.add(config);
  if (text === undefined) return undefined;
  const parsed = ts.parseConfigFileTextToJson(config, stripBom(text)).config as { extends?: unknown; compilerOptions?: Record<string, unknown> } | undefined;
  if (parsed?.compilerOptions && name in parsed.compilerOptions) return parsed.compilerOptions[name];
  // With several bases, the later ones win.
  for (const base of [parsed?.extends ?? []].flat().reverse()) {
    if (typeof base !== 'string' || !base.startsWith('.')) continue;
    const value = configuredOption(tree, path.posix.normalize(path.posix.join(path.posix.dirname(config), base.endsWith('.json') ? base : `${base}.json`)), name, seen);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Whether the nearest package.json sets `type` (without it, Node detects ESM syntax in `.js` files). */
function declaresType(repo: RepoFs, file: string): boolean {
  for (let directory = path.posix.dirname(file); ; directory = path.posix.dirname(directory)) {
    const manifest = repo.read(directory === '.' ? 'package.json' : `${directory}/package.json`);
    if (manifest !== undefined) {
      try {
        return (JSON.parse(stripBom(manifest)) as { type?: unknown }).type !== undefined;
      } catch {
        return true;
      }
    }
    if (directory === '.') return false;
  }
}

/** How the code Node runs loads static imports (`esm` or `cjs` syntax), and whether `import()` became `require`. */
function loadingOf(runtime: Runtime, file: string, options: ts.CompilerOptions, nodeFormat: ModuleFormat): { format: ModuleFormat; dynamicImportAsRequire: boolean } {
  // tsx and type stripping run the file in the format Node gives it; tsc and ts-node compile with `module`.
  if (!isTypeScript(file) || runtime.loader === 'tsx' || (runtime.loads === 'source' && runtime.loader === 'node')) return { format: nodeFormat, dynamicImportAsRequire: false };
  const module = options.module;
  if (module === undefined || (module >= ts.ModuleKind.Node16 && module <= ts.ModuleKind.NodeNext)) return { format: nodeFormat, dynamicImportAsRequire: false };
  if (module === ts.ModuleKind.CommonJS || module === ts.ModuleKind.AMD || module === ts.ModuleKind.UMD || module === ts.ModuleKind.System) return { format: 'cjs', dynamicImportAsRequire: true };
  return { format: 'esm', dynamicImportAsRequire: false };
}

function modeOf(kind: ReferenceSite['kind'], format: ModuleFormat, dynamicImportAsRequire: boolean): Mode {
  if (kind === 'url-reference') return 'url';
  if (kind === 'require' || kind === 'require-resolve' || kind === 'import-equals') return 'require';
  if (kind === 'dynamic-import') return dynamicImportAsRequire ? 'require' : 'import';
  return format === 'esm' ? 'import' : 'require';
}

/** The packages a runtime's probe loads from the environment: its loader, its hooks, Nest's build. */
function toolsOf(runtime: Runtime): string[] {
  return [
    ...(runtime.loader === 'tsx' ? ['tsx'] : runtime.loader === 'ts-node' ? ['ts-node', 'typescript'] : []),
    ...runtime.hooks,
    ...(runtime.build === 'nest-cli' && runtime.loads === 'emit' ? ['@nestjs/cli', 'typescript'] : []),
  ];
}

const describeDetection = (detection: RuntimeDetection) => `${detection.runtimes.map((runtime) => runtime.id).join(', ')}${detection.unsupported.length ? `; not modeled: ${[...new Set(detection.unsupported.map((entry) => entry.mechanism))].join(', ')}` : ''}`;

interface RuntimeSite {
  site: ReferenceSite;
  index: number;
}

export async function checkRuntimeResolution(context: CertifyContext) {
  const { base, head, pathMap, views, options } = context;
  const trees: Record<Side, CommitTree> = { base, head };
  const packageRoot = options.packageRoot;
  const underRoot = (file: string) => packageRoot === '' || file.startsWith(`${packageRoot}/`);
  const violations: Violation[] = [];
  const findings: Finding[] = [];
  // Only JS/TS files and extensionless scripts can carry sites; read them in one batch per tree.
  const candidate = (file: string) => !declarationPattern.test(file) && (isSourceFile(file) || (!path.posix.basename(file).includes('.') && !file.split('/').includes('node_modules')));
  for (const side of sides) trees[side].prefetch([...trees[side].entries.keys()].filter(candidate));
  const scopes = { base: loadScopes(context.fs.base), head: loadScopes(context.fs.head) };
  const emits = (side: Side) => (tsconfig: string) => ['noEmit', 'emitDeclarationOnly'].every((name) => configuredOption(trees[side], path.posix.join(packageRoot, tsconfig), name) !== true);
  const detection = { base: detectRuntimes(base, packageRoot, views.base, emits('base')), head: detectRuntimes(head, packageRoot, views.head, emits('head')) };
  if (describeDetection(detection.base) !== describeDetection(detection.head)) {
    violations.push({ detail: `the runtime mechanism changed: base ${describeDetection(detection.base)}; head ${describeDetection(detection.head)}` });
  }
  const runtimes = detection.base.runtimes;

  const isRuntimeSource = (side: Side, file: string) => candidate(file) && views[side](file)?.source === true;
  const pairs = [...pathMap.forward].filter(([from, to]) => isRuntimeSource('base', from) && isRuntimeSource('head', to)).sort(([a], [b]) => a.localeCompare(b));
  const filesOf = (side: Side) => pairs.map(([from, to]) => (side === 'base' ? from : to));
  // Added files have nothing to be identical to (K1 rejects them); their unresolvable sites are reported as findings.
  const added = pathMap.added.map((entry) => entry.path).filter((file) => isRuntimeSource('head', file)).sort();
  const probedFiles = (side: Side) => (side === 'base' ? filesOf('base') : [...filesOf('head'), ...added]);
  const siteLists: Record<Side, Map<string, RuntimeSite[]>> = { base: new Map(), head: new Map() };
  const sitesOf = (side: Side, file: string): RuntimeSite[] => {
    const cached = siteLists[side].get(file);
    if (cached) return cached;
    const view = views[side](file);
    const verbatim = isTypeScript(file) && scopes[side](file).options.verbatimModuleSyntax === true;
    const sites = (view?.sites ?? []).flatMap((site, index) => (isRuntimeSite(site) || (verbatim && site.kind === 'import' && inlineTypeImport.test(view!.chunks[index]!)) ? [{ site, index }] : []));
    siteLists[side].set(file, sites);
    return sites;
  };
  /**
   * How each runtime loads each file: the syntax it runs (from `module` for compiled TypeScript) and the format Node
   * gives it (extension, package.json `type`, and without a `type` the syntax Node detects).
   */
  const loadings = new Map<string, { format: ModuleFormat; dynamicImportAsRequire: boolean; nodeFormat: ModuleFormat }>();
  const loadingIn = (runtime: Runtime, side: Side, file: string) => {
    const key = `${runtime.id}\0${side}\0${file}`;
    const cached = loadings.get(key);
    if (cached) return cached;
    const declared = moduleFormat(context.fs[side], file);
    const detects = declared === 'cjs' && !/\.c[jt]s$/.test(file) && !declaresType(context.fs[side], file);
    const runsAsWritten = !isTypeScript(file) || (runtime.loader === 'node' && runtime.loads === 'source');
    const writtenAsEsm = sitesOf(side, file).some(({ site }) => site.kind === 'import' || site.kind === 'export');
    const loading = loadingOf(runtime, file, scopes[side](file).options, detects && runsAsWritten && writtenAsEsm ? 'esm' : declared);
    const result = { ...loading, nodeFormat: detects && loading.format === 'esm' ? 'esm' as const : declared };
    loadings.set(key, result);
    return result;
  };
  const describeLoading = ({ format, nodeFormat }: { format: ModuleFormat; nodeFormat: ModuleFormat }) => (format === nodeFormat ? format.toUpperCase() : `${format.toUpperCase()} code in a ${nodeFormat.toUpperCase()} scope`);

  const skeletonStarted = performance.now();
  const layouts = new Set<Layout>(runtimes.flatMap((runtime): Layout[] => (runtime.loads === 'source' ? ['source'] : runtime.build === 'nest-cli' ? ['emit', 'source'] : ['emit'])));
  const workDir = path.resolve(options.workDir, 'k3c');
  const skeletons = { base: {}, head: {} } as Record<Side, Partial<Record<Layout, Skeleton>>>;
  for (const side of sides) for (const layout of layouts) skeletons[side][layout] = buildSkeleton(trees[side], path.join(workDir, side, layout), layout, context.environment);
  const skeletonMs = Math.round(performance.now() - skeletonStarted);

  const probeStarted = performance.now();
  const resolved = new Map<string, Record<Side, Map<string, Resolved[]>>>();
  const failures: string[] = [];
  const notInstalled: string[] = [];
  const probeOutputs: ProbeOutput[] = [];
  const nodeVersion = options.profile?.node ?? 'system';
  const cwdOf = (side: Side, runtime: Runtime) => {
    const nest = runtime.build === 'nest-cli' && runtime.loads === 'emit';
    return path.join((nest || runtime.loads === 'source' ? skeletons[side].source! : skeletons[side][runtime.loads]!).root, packageRoot);
  };
  const probed = runtimes.filter((runtime) => {
    const missing = toolsOf(runtime).find((name) => !installedPackage(cwdOf('base', runtime), name));
    if (missing) notInstalled.push(`${runtime.id}: ${missing} is not installed in the environment`);
    return !missing;
  });
  await Promise.all(probed.flatMap((runtime) => sides.map(async (side) => {
    const resolutionSkeleton = skeletons[side][runtime.loads]!;
    const sourceSkeleton = skeletons[side].source;
    const nest = runtime.build === 'nest-cli' && runtime.loads === 'emit';
    const cwd = cwdOf(side, runtime);
    const files = probedFiles(side);
    const probeFiles: ProbeFile[] = files.map((file) => {
      const fileOptions = scopes[side](file).options;
      const { format, dynamicImportAsRequire } = loadingIn(runtime, side, file);
      const hooked = nest && isTypeScript(file) && underRoot(file);
      const extension = runtime.loads === 'emit' && isTypeScript(file) && fileOptions.rewriteRelativeImportExtensions ? (fileOptions.jsx === ts.JsxEmit.Preserve ? '.jsx' : '.js') : undefined;
      return {
        importer: path.join(resolutionSkeleton.root, resolutionSkeleton.stubOf(file)!),
        ...(hooked ? { source: path.join(sourceSkeleton!.root, file) } : {}),
        sites: sitesOf(side, file).map(({ site }) => ({
          m: modeOf(site.kind, format, dynamicImportAsRequire),
          s: site.specifier,
          ...(hooked && (site.kind === 'import' || site.kind === 'export') ? { r: 1 as const } : {}),
          ...(extension && ['import', 'export', 'dynamic-import'].includes(site.kind) ? { t: extension } : {}),
        })),
      };
    });
    try {
      const output = await runProbe({
        directory: path.join(workDir, side, `probe-${runtime.id.replace(/[^\w.-]+/g, '_')}`),
        cwd,
        node: nodeVersion,
        nodeArguments: [
          ...runtime.conditions.map((condition) => `--conditions=${condition}`),
          ...(runtime.loader === 'ts-node' ? ['--require', 'ts-node/register'] : []),
          ...(runtime.hooks.includes('tsconfig-paths') ? ['--require', 'tsconfig-paths/register'] : []),
        ],
        ...(runtime.loader === 'tsx' ? { tsx: true } : {}),
        ...(options.profile?.env ? { extraEnvironment: options.profile.env } : {}),
        offline: options.profile?.offline ?? true,
        input: { skeleton: resolutionSkeleton.root, environment: context.environment.checkout, moduleAlias: runtime.hooks.includes('module-alias'), ...(nest ? { nestTsconfig: runtime.tsconfig } : {}), files: probeFiles },
        timeoutMs: 10 * 60_000,
      });
      probeOutputs.push(output);
      const byFile = new Map<string, Resolved[]>();
      files.forEach((file, index) => byFile.set(file, output.results[index]!.map((raw, position) => ({
        token: toToken(raw, resolutionSkeleton, trees[side]),
        mode: probeFiles[index]!.sites[position]!.m,
        ...(raw.w !== undefined ? { emitted: raw.w } : {}),
      }))));
      const entry = resolved.get(runtime.id) ?? ({} as Record<Side, Map<string, Resolved[]>>);
      entry[side] = byFile;
      resolved.set(runtime.id, entry);
    } catch (error) {
      failures.push(`${runtime.id} on ${side}: ${(error as Error).message}`);
    }
  })));
  const probeMs = Math.round(performance.now() - probeStarted);
  for (const failure of failures) violations.push({ detail: `could not model the runtime ${failure}` });
  for (const reason of notInstalled) findings.push({ kind: 'runtime-not-modeled', detail: reason });
  const modeled = probed.filter((runtime) => resolved.get(runtime.id)?.base && resolved.get(runtime.id)?.head);

  // TypeScript's own answer, asked only for the sites where the runtime's needs comparing with it.
  const resolvers: Partial<Record<Side, SiteResolver>> = {};
  const typescriptCache = new Map<string, Resolution>();
  const typescriptOf = (side: Side, file: string, entry: RuntimeSite): Resolution => {
    const key = `${side}\0${file}\0${entry.index}`;
    let resolution = typescriptCache.get(key);
    if (!resolution) typescriptCache.set(key, (resolution = (resolvers[side] ??= createSiteResolver(context.fs[side]))(file, entry.site)));
    return resolution;
  };
  /** A site TypeScript resolves to a repo file through tsconfig `paths`/`baseUrl`: its target, else undefined. */
  const aliasTarget = (side: Side, file: string, entry: RuntimeSite): string | undefined => {
    if (!throughAlias(entry.site.specifier, scopes[side](file).options)) return undefined;
    const resolution = typescriptOf(side, file, entry);
    return resolution.type === 'file' ? resolution.path : undefined;
  };
  const programOf = (side: Side, runtime: Runtime) => scopes[side].programs.get(path.posix.join(packageRoot, runtime.tsconfig))?.files;
  /** An identified runtime loads the file: under the package root and in the program it builds or runs. */
  const loads = (side: Side, runtime: Runtime, file: string) => !runtime.assumed && underRoot(file) && (programOf(side, runtime)?.has(file) ?? true);

  // Identity: head map(f) site i resolves to map(base f site i) under every runtime.
  let comparedSites = 0;
  let unresolvedInBase = 0;
  let rewrittenByBuild = 0;
  let deferredSites = 0;
  let disagreements = 0;
  const aliasSites: Record<Side, number> = { base: 0, head: 0 };
  const unidentifiedAliases = new Set<string>();
  const aliasTargets: Record<Side, Map<string, (string | undefined)[]>> = { base: new Map(), head: new Map() };
  const aliasTargetsOf = (side: Side, file: string) => {
    let targets = aliasTargets[side].get(file);
    if (!targets) aliasTargets[side].set(file, (targets = sitesOf(side, file).map((entry) => (underRoot(file) ? aliasTarget(side, file, entry) : undefined))));
    return targets;
  };
  // Counted in the files some runtime's program holds (not a frontend or tooling elsewhere in the package).
  for (const side of sides) {
    for (const file of filesOf(side)) {
      if (runtimes.some((runtime) => underRoot(file) && (programOf(side, runtime)?.has(file) ?? true))) aliasSites[side] += aliasTargetsOf(side, file).filter((target) => target !== undefined).length;
    }
  }

  for (const runtime of modeled) {
    const { base: before, head: after } = resolved.get(runtime.id)!;
    for (const [from, to] of pairs) {
      const baseSites = sitesOf('base', from);
      const headSites = sitesOf('head', to);
      const baseResolved = before.get(from)!;
      const headResolved = after.get(to)!;
      if (baseSites.length !== headSites.length) {
        violations.push({ file: to, detail: `${baseSites.length} runtime sites in base ${from}, ${headSites.length} in head` });
        continue;
      }
      const loadedBefore = loadingIn(runtime, 'base', from);
      const loadedAfter = loadingIn(runtime, 'head', to);
      if (loadedBefore.format !== loadedAfter.format || loadedBefore.nodeFormat !== loadedAfter.nodeFormat) {
        violations.push({ file: to, detail: `${runtime.id}: loaded as ${describeLoading(loadedAfter)}, as ${describeLoading(loadedBefore)} in base ${from} (its module format changed)` });
        continue;
      }
      const strict = loads('base', runtime, from);
      const program = runtime.loads === 'emit' && !runtime.assumed && isTypeScript(from) ? { base: programOf('base', runtime), head: programOf('head', runtime) } : undefined;
      if (program?.base?.has(from) && underRoot(from) && !program.head?.has(to)) {
        violations.push({ file: to, detail: `${runtime.id}: no longer in ${runtime.tsconfig}'s program, so the build doesn't emit it; base ${from} was` });
      }
      const baseAliases = aliasTargetsOf('base', from);
      const headAliases = aliasTargetsOf('head', to);
      baseSites.forEach((baseEntry, position) => {
        const headEntry = headSites[position]!;
        const baseSite = baseEntry.site;
        const headSite = headEntry.site;
        const was = baseResolved[position]!;
        const now = headResolved[position]!;
        comparedSites++;
        if (was.emitted !== undefined) rewrittenByBuild++;
        if (was.token.type === 'unresolved') unresolvedInBase++;
        const expected = mapToken(was.token, pathMap.map);
        let problem: string | undefined;
        if (was.mode !== now.mode) problem = `is loaded with ${now.mode} semantics, with ${was.mode} in base (its module format changed)`;
        else if (!sameToken(expected, now.token)) problem = `resolves to ${describe(now.token)}, expected ${describe(expected)}`;
        else if (expected.type === 'unresolved') {
          // Unresolved stays unresolved with the same text; a relative one must also stay in its directory.
          if (baseSite.specifier !== headSite.specifier) problem = `stays unresolved (${describe(now.token)}) but its text changed from '${baseSite.specifier}'`;
          else if (isRelative(baseSite.specifier) && path.posix.dirname(from) !== path.posix.dirname(to)) problem = `is unresolved and relative, and its file moved from ${from}`;
        }
        // Outside what an identified runtime loads, a site this Node can't resolve but TypeScript can is K3a's and
        // K3b's: it may stay unresolved or reach map(TypeScript's target).
        if (problem && !strict && was.mode === now.mode && was.token.type === 'unresolved') {
          const target = typescriptOf('base', from, baseEntry);
          if (target.type === 'file' && (now.token.type === 'unresolved' || reaches(now.token, pathMap.map(target.path)))) {
            deferredSites++;
            problem = undefined;
          }
        }
        if (problem) {
          const emitted = now.emitted !== undefined ? ` (emitted as '${now.emitted}')` : '';
          violations.push({ file: to, detail: `${runtime.id}: ${headSite.kind} '${headSite.specifier}'${emitted} ${problem}; base ${from} '${baseSite.specifier}'` });
        }
        // What TypeScript resolves through tsconfig paths/baseUrl must reach the same module at runtime. A runtime
        // with no alias layer can't (an unknown mechanism); with no runtime identified, only a new alias site is
        // judged, since base's aliases show some unidentified layer that K3c can't model.
        const headAlias = headAliases[position];
        const unknownMechanism = runtime.assumed ? headAlias !== undefined && baseAliases[position] === undefined : !hasAliasLayer(runtime) && loads('head', runtime, to);
        if (headAlias !== undefined && unknownMechanism && !reaches(now.token, headAlias)) {
          violations.push({ file: to, detail: `unknown runtime alias mechanism (head): '${headSite.specifier}' reaches ${headAlias} through tsconfig paths/baseUrl, but ${runtime.id} has no alias layer and resolves it to ${describe(now.token)}` });
        }
        if (runtime.assumed && headAlias !== undefined && baseAliases[position] !== undefined) unidentifiedAliases.add(`${to}\0${position}`);
      });
    }
  }

  // Base, the files a runtime loads: an alias the runtime can't follow is an unknown mechanism; a site it can't
  // resolve but TypeScript can (a latent crash, or an import tsc elides) and an alias it maps elsewhere are findings.
  for (const runtime of modeled) {
    for (const file of filesOf('base')) {
      if (!loads('base', runtime, file)) continue;
      const aliases = aliasTargetsOf('base', file);
      sitesOf('base', file).forEach((entry, position) => {
        const { token } = resolved.get(runtime.id)!.base.get(file)![position]!;
        const alias = aliases[position];
        if (alias !== undefined && !hasAliasLayer(runtime)) {
          if (!reaches(token, alias)) violations.push({ file, detail: `unknown runtime alias mechanism (base): '${entry.site.specifier}' reaches ${alias} through tsconfig paths/baseUrl, but ${runtime.id} has no alias layer and resolves it to ${describe(token)}` });
          return;
        }
        if (alias === undefined && token.type !== 'unresolved') return;
        const resolution = typescriptOf('base', file, entry);
        if (resolution.type !== 'file' || reaches(token, resolution.path)) return;
        disagreements++;
        if (disagreements > maxFindings) return;
        if (token.type === 'unresolved') findings.push({ kind: 'runtime-unresolved', file, detail: `${runtime.id}: ${entry.site.kind} '${entry.site.specifier}' doesn't resolve at runtime (${token.code}); TypeScript resolves it to ${resolution.path}` });
        else findings.push({ kind: 'runtime-typescript-disagreement', file, detail: `${runtime.id}: ${entry.site.kind} '${entry.site.specifier}' resolves to ${describe(token)} at runtime, ${resolution.path} for TypeScript` });
      });
    }
  }
  if (disagreements > maxFindings) findings.push({ kind: 'runtime-typescript-disagreement', detail: `${disagreements - maxFindings} more sites where the runtime and TypeScript disagree in base` });
  if (unidentifiedAliases.size) {
    findings.push({ kind: 'runtime-alias-mechanism-unknown', detail: `${unidentifiedAliases.size} sites resolve through tsconfig paths/baseUrl in base and head, and nothing in the tree identifies the runtime that loads them or its alias layer: K3c holds them to what plain Node resolves (TypeScript identity is K3a's)` });
  }

  let unresolvedInAdded = 0;
  for (const runtime of modeled) {
    for (const file of added) {
      const sites = sitesOf('head', file);
      resolved.get(runtime.id)!.head.get(file)!.forEach(({ token }, position) => {
        if (token.type !== 'unresolved') return;
        unresolvedInAdded++;
        if (unresolvedInAdded <= 20) findings.push({ kind: 'added-file-unresolved', file, detail: `${runtime.id}: ${sites[position]!.site.kind} '${sites[position]!.site.specifier}' doesn't resolve (${token.code}) in a file with no base counterpart` });
      });
    }
  }
  if (unresolvedInAdded > 20) findings.push({ kind: 'added-file-unresolved', detail: `${unresolvedInAdded - 20} more unresolved runtime sites in ${added.length} added files` });
  for (const mechanism of new Set(detection.base.unsupported.map((entry) => entry.mechanism))) {
    const evidence = detection.base.unsupported.filter((entry) => entry.mechanism === mechanism).map((entry) => entry.evidence);
    if (aliasSites.base + aliasSites.head > 0) violations.push({ detail: `runtime alias mechanism not modeled: ${mechanism} (${evidence[0]}), and ${aliasSites.base + aliasSites.head} sites resolve through tsconfig paths/baseUrl` });
    else findings.push({ kind: 'runtime-mechanism-not-modeled', detail: `${mechanism} (${evidence.join('; ')}); no site resolves through tsconfig paths/baseUrl` });
  }

  const total = violations.length;
  const reported = total > maxViolations ? [...violations.slice(0, maxViolations), { detail: `${total - maxViolations} more violations` }] : violations;
  const nestCli = probeOutputs.find((output) => output.nestCli)?.nestCli;
  const metrics: Record<string, number | string | boolean> = {
    runtimes: runtimes.map((runtime) => runtime.id).join(', '),
    runtimeEvidence: runtimes.map((runtime) => `${runtime.id}: ${runtime.evidence.slice(0, 3).join('; ')}`).join(' || '),
    modeled: modeled.map((runtime) => runtime.id).join(', '),
    notModeled: [...new Set(detection.base.unsupported.map((entry) => entry.mechanism)), ...notInstalled].join(', '),
    subpathImports: detection.base.subpathImports,
    emitModel,
    node: probeOutputs[0]?.node ?? nodeVersion,
    ...(nestCli ? { nestCli } : {}),
    files: pairs.length,
    addedFiles: added.length,
    unresolvedInAdded,
    comparedSites,
    rewrittenByBuild,
    unresolvedInBase,
    deferredSites,
    aliasSitesBase: aliasSites.base,
    aliasSitesHead: aliasSites.head,
    disagreements,
    violations: total,
    skeletonMs,
    probeMs,
  };
  return { violations: reported, findings, metrics, modeled: modeled.length, failures, notInstalled };
}

export const runtimeResolution: Check = {
  id: 'K3c',
  title,
  async run(context) {
    const { violations, findings, metrics, modeled, failures, notInstalled } = await checkRuntimeResolution(context);
    if (modeled === 0 && failures.length === 0 && notInstalled.length && violations.length === 0) {
      const reason = `no runtime could be modeled: ${notInstalled.join('; ')}`;
      return result('K3c', title, { status: 'skip', summary: `skipped: ${reason}`, skipReason: reason, metrics, findings });
    }
    const summary = violations.length
      ? `${metrics.violations} violations under ${metrics.runtimes}`
      : `${metrics.comparedSites} runtime sites resolve to map(base) under ${metrics.modeled}${metrics.rewrittenByBuild ? ` (${metrics.rewrittenByBuild} rewritten by the build)` : ''}`;
    return result('K3c', title, { summary, violations, findings, metrics });
  },
};

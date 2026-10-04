// K3c's ground truth: Node itself, with the target's own runtime hooks, resolving every runtime site of a tree.
// Each tree becomes a skeleton in the work dir: an empty stub at the path the runtime loads for each tracked file
// (emit layout: `.ts` -> `.js`, `.mts` -> `.mjs`, `.cts` -> `.cjs`, declarations dropped; source layout: the
// paths as committed), package.json and tsconfig files verbatim, other JSON as `{}`, node_modules linked from the
// environment. A probe script, generated here and run with the target's Node, resolves the sites in one process.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { stripBom } from '../analyzer/analyze.js';
import type { Environment } from './commit-fs.js';
import type { CommitTree } from './git-tree.js';
import { blockNetPreload, nodeBinary, targetEnvironment } from './toolchain.js';

export type Layout = 'emit' | 'source';

export interface Skeleton {
  root: string;
  layout: Layout;
  /** Skeleton-relative stub path -> the repo files it stands for (two when `x.ts` and `x.js` emit to one path). */
  owners: ReadonlyMap<string, string[]>;
  /** Repo file -> its skeleton-relative stub path (undefined for declarations in the emit layout). */
  stubOf(file: string): string | undefined;
}

const declarationPattern = /\.d(\.[^./]+)?\.[cm]?ts$/;
const configPattern = /(^|\/)(tsconfig|jsconfig)[^/]*\.json$/;

/** The file Node loads for a tracked file once tsc emitted it in place (relative structure preserved). */
export function emittedPath(file: string): string | undefined {
  if (declarationPattern.test(file)) return undefined;
  return file.replace(/\.tsx?$/, '.js').replace(/\.mts$/, '.mjs').replace(/\.cts$/, '.cjs');
}

/** tsconfig files and the files they extend (relative `extends`), which the runtimes and the Nest build read. */
function verbatimConfigs(tree: CommitTree): Set<string> {
  const verbatim = new Set<string>();
  const pending = [...tree.entries.keys()].filter((file) => configPattern.test(file) && !file.split('/').includes('node_modules'));
  while (pending.length) {
    const file = pending.pop()!;
    if (verbatim.has(file) || !tree.entries.has(file)) continue;
    verbatim.add(file);
    const parsed = ts.parseConfigFileTextToJson(file, stripBom(tree.text(file) ?? '')).config as { extends?: string | string[] } | undefined;
    for (const base of [parsed?.extends ?? []].flat()) {
      if (typeof base !== 'string' || !base.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), base));
      pending.push(target, `${target}.json`);
    }
  }
  return verbatim;
}

export function buildSkeleton(tree: CommitTree, root: string, layout: Layout, environment: Environment): Skeleton {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const verbatim = verbatimConfigs(tree);
  const owners = new Map<string, string[]>();
  const stubs = new Map<string, string>();
  const created = new Set<string>(['.']);
  const ensureDirectory = (directory: string) => {
    if (created.has(directory)) return;
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    for (let parent = directory; parent !== '.'; parent = path.posix.dirname(parent)) created.add(parent);
  };
  for (const [file, entry] of tree.entries) {
    if (entry.mode === '160000') continue;
    const stub = layout === 'emit' ? emittedPath(file) : file;
    if (stub === undefined) continue;
    stubs.set(file, stub);
    const existing = owners.get(stub);
    if (existing) {
      existing.push(file);
      continue;
    }
    owners.set(stub, [file]);
    ensureDirectory(path.posix.dirname(stub));
    const target = path.join(root, stub);
    if (entry.mode === '120000') {
      fs.symlinkSync(tree.text(file) ?? '', target);
      continue;
    }
    const keep = path.posix.basename(file) === 'package.json' || verbatim.has(file);
    fs.writeFileSync(target, keep ? (tree.bytes(file) ?? '') : file.endsWith('.json') ? '{}' : '');
  }
  const checkout = fs.realpathSync(environment.checkout);
  for (const linked of environment.linked) linkInstalled(path.join(environment.checkout, linked, 'node_modules'), path.join(root, linked, 'node_modules'), root, checkout);
  return { root, layout, owners, stubOf: (file) => stubs.get(file) };
}

/**
 * Links an installed node_modules into the skeleton entry by entry: tracked files there stay, and a workspace link
 * (back into the repository, outside any node_modules) points at the skeleton's copy of the commit, never at the
 * checkout's working tree (as commit-fs.ts does for the analyzer).
 */
function linkInstalled(installed: string, target: string, root: string, checkout: string) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(installed, { withFileTypes: true })) {
    const source = path.join(installed, entry.name);
    const destination = path.join(target, entry.name);
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      linkInstalled(source, destination, root, checkout);
      continue;
    }
    if (fs.lstatSync(destination, { throwIfNoEntry: false })) continue;
    let linkTarget = source;
    if (entry.isSymbolicLink()) {
      let real: string | undefined;
      try {
        real = fs.realpathSync(source);
      } catch {
        real = undefined;
      }
      const relative = real === undefined ? undefined : path.relative(checkout, real);
      if (relative !== undefined && relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) && !relative.split(path.sep).includes('node_modules')) linkTarget = path.join(root, relative);
    }
    fs.symlinkSync(linkTarget, destination);
  }
}

/** How the runtime loads a site: `require` (CommonJS), `import` (ESM) or `url` (`new URL(x, import.meta.url)`). */
export type Mode = 'require' | 'import' | 'url';

export interface ProbeSite {
  /** Mode. */
  m: Mode;
  /** Specifier as written. */
  s: string;
  /** 1: Nest's tsconfig-paths hook may rewrite it (import/export declarations of the Nest program). */
  r?: 1;
  /** tsc's rewriteRelativeImportExtensions applies (the extension a `.tsx` specifier gets). */
  t?: '.js' | '.jsx';
}

export interface ProbeFile {
  /** Absolute path of the importer the runtime loads, inside the resolution skeleton. */
  importer: string;
  /** Absolute path of the importer's source stub (the file name Nest's hook sees). */
  source?: string;
  sites: ProbeSite[];
}

export interface ProbeInput {
  /** Root of the skeleton the sites resolve in. */
  skeleton: string;
  environment: string;
  /** Run module-alias's init with the package root as its base. */
  moduleAlias: boolean;
  /** Apply Nest's tsconfig-paths hook, parsing this tsconfig (relative to the cwd) the way `nest build` does. */
  nestTsconfig?: string;
  files: ProbeFile[];
}

/**
 * s: a skeleton path; w: a tracked-looking path of the environment checkout (a workspace link); e: anything else on
 * disk; b: a builtin; o: a non-file URL; u: unresolved with Node's error code. `x` is an ESM URL's query and
 * fragment (they make a distinct module instance); `w` the specifier after the build rewrote it.
 */
export type ProbeToken =
  | { t: 's' | 'w' | 'e'; p: string; x?: string; w?: string }
  | { t: 'b'; n: string; w?: string }
  | { t: 'o'; u: string; w?: string }
  | { t: 'u'; c: string; w?: string };

export interface ProbeOutput {
  node: string;
  nestCli?: string;
  results: ProbeToken[][];
}

// Runs under the target's Node; plain JavaScript, no dependency on this package.
const probeSource = String.raw`
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Without --experimental-import-meta-resolve, Node ignores the parent argument and resolves against this script.
if (import.meta.resolve('./x.js', 'file:///probe-self-test/a.js') !== 'file:///probe-self-test/x.js') throw new Error('import.meta.resolve ignores its parent URL');
const [inputPath, outputPath] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const skeleton = fs.realpathSync(input.skeleton);
const environment = fs.realpathSync(input.environment);
const fromCwd = createRequire(path.join(process.cwd(), '__probe__.cjs'));
if (input.moduleAlias) fromCwd('module-alias')({ base: process.cwd() });

async function nestHook(tsconfig) {
  // As @nestjs/cli: TypeScript from the cwd, the tsconfig parsed with ts.sys, the hook built from its options.
  const typescript = fromCwd(fromCwd.resolve('typescript', { paths: [process.cwd()] }));
  const parsed = typescript.getParsedCommandLineOfConfigFile(path.join(process.cwd(), tsconfig), undefined, { ...typescript.sys, onUnRecoverableConfigFileDiagnostic() {} });
  if (!parsed) throw new Error('nest build: ' + tsconfig + ' does not parse');
  let cli;
  for (let directory = process.cwd(); ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'node_modules', '@nestjs', 'cli');
    if (fs.existsSync(path.join(candidate, 'lib', 'compiler', 'hooks', 'tsconfig-paths.hook.js'))) { cli = candidate; break; }
    if (path.dirname(directory) === directory) throw new Error('@nestjs/cli (lib/compiler/hooks/tsconfig-paths.hook.js) is not installed');
  }
  const hookModule = await import(pathToFileURL(path.join(cli, 'lib', 'compiler', 'hooks', 'tsconfig-paths.hook.js')).href);
  const factory = hookModule.tsconfigPathsBeforeHookFactory ?? hookModule.default?.tsconfigPathsBeforeHookFactory;
  const before = factory(parsed.options);
  const version = JSON.parse(fs.readFileSync(path.join(cli, 'package.json'), 'utf8')).version;
  return {
    version,
    rewrite(fileName, specifiers) {
      if (!before || specifiers.length === 0) return specifiers;
      // The hook only reads import/export declarations' specifier text and the file name.
      const text = specifiers.map((specifier) => 'import ' + JSON.stringify(specifier) + ';\n').join('');
      const sourceFile = typescript.createSourceFile(fileName, text, typescript.ScriptTarget.Latest, true);
      const transformed = typescript.transform(sourceFile, [before], parsed.options);
      const rewritten = transformed.transformed[0].statements.map((statement) => statement.moduleSpecifier.text);
      transformed.dispose();
      return rewritten;
    },
  };
}
const nest = input.nestTsconfig ? await nestHook(input.nestTsconfig) : undefined;

const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative.startsWith('..') || path.isAbsolute(relative) ? undefined : relative.split(path.sep).join('/');
};
function locate(file, suffix) {
  let real;
  try { real = fs.realpathSync(file); } catch { return { t: 'u', c: 'ENOENT' }; }
  const extra = suffix ? { x: suffix } : {};
  const inSkeleton = inside(skeleton, real);
  if (inSkeleton !== undefined) return { t: 's', p: inSkeleton, ...extra };
  const inEnvironment = inside(environment, real);
  if (inEnvironment !== undefined && !inEnvironment.split('/').includes('node_modules')) return { t: 'w', p: inEnvironment, ...extra };
  return { t: 'e', p: real, ...extra };
}
const requires = new Map();
function resolve(mode, specifier, importer) {
  try {
    if (mode === 'require') {
      let require = requires.get(importer);
      if (!require) requires.set(importer, (require = createRequire(importer)));
      const resolved = require.resolve(specifier);
      return path.isAbsolute(resolved) ? locate(resolved, '') : { t: 'b', n: resolved.replace(/^node:/, '') };
    }
    const parent = pathToFileURL(importer).href;
    const url = new URL(mode === 'import' ? import.meta.resolve(specifier, parent) : specifier, parent);
    if (url.protocol === 'node:') return { t: 'b', n: url.pathname };
    if (url.protocol !== 'file:') return { t: 'o', u: url.href };
    const file = fileURLToPath(url);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    // import.meta.resolve answers a URL for a missing file or a directory; loading it would throw these.
    if (!stat) return { t: 'u', c: 'ERR_MODULE_NOT_FOUND' };
    if (mode === 'import' && !stat.isFile()) return { t: 'u', c: 'ERR_UNSUPPORTED_DIR_IMPORT' };
    return locate(file, url.search + url.hash);
  } catch (error) {
    return { t: 'u', c: String(error?.code ?? error?.message ?? error).slice(0, 120) };
  }
}
const tsExtension = /\.(m|c)?tsx?$/;
const results = input.files.map((file) => {
  const emitted = file.sites.map((site) => site.s);
  if (nest && file.source) {
    const indices = file.sites.flatMap((site, index) => (site.r ? [index] : []));
    const rewritten = nest.rewrite(file.source, indices.map((index) => emitted[index]));
    indices.forEach((index, position) => { emitted[index] = rewritten[position]; });
  }
  return file.sites.map((site, index) => {
    let specifier = emitted[index];
    if (site.t && /^\.\.?\//.test(specifier) && tsExtension.test(specifier) && !/\.d(\.[^./]+)?\.[cm]?ts$/.test(specifier)) {
      specifier = specifier.replace(tsExtension, (extension) => (extension === '.mts' ? '.mjs' : extension === '.cts' ? '.cjs' : extension === '.tsx' ? site.t : '.js'));
    }
    const token = resolve(site.m, specifier, file.importer);
    if (specifier !== site.s) token.w = specifier;
    return token;
  });
});
fs.writeFileSync(outputPath, JSON.stringify({ node: process.version, nestCli: nest?.version, results }));
`;

/** The directory of a package installed for `cwd` (the node_modules lookup Node does), or undefined. */
export function installedPackage(cwd: string, name: string): string | undefined {
  for (let directory = cwd; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(directory) === directory) return undefined;
  }
}

/** The tsx CLI (`tsx src/app.ts` is `node <tsx>/dist/cli.mjs src/app.ts`). */
function tsxCli(cwd: string): string {
  const directory = installedPackage(cwd, 'tsx');
  const bin = directory && (JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> }).bin;
  const relative = typeof bin === 'string' ? bin : bin?.tsx;
  if (!directory || !relative) throw new Error('tsx is not installed in the environment');
  return path.join(directory, relative);
}

export interface ProbeRun {
  directory: string;
  /** Working directory (the package root inside a skeleton): tsx, tsconfig-paths and Nest read their tsconfig there. */
  cwd: string;
  node: string;
  nodeArguments: string[];
  /** Run through the tsx CLI installed for the cwd, as `tsx src/app.ts` would. */
  tsx?: boolean;
  extraEnvironment?: Record<string, string>;
  offline: boolean;
  input: ProbeInput;
  timeoutMs: number;
}

export async function runProbe(run: ProbeRun): Promise<ProbeOutput> {
  fs.mkdirSync(run.directory, { recursive: true });
  const script = path.join(run.directory, 'probe.mjs');
  const inputPath = path.join(run.directory, 'input.json');
  const outputPath = path.join(run.directory, 'output.json');
  fs.writeFileSync(script, probeSource);
  fs.writeFileSync(inputPath, JSON.stringify(run.input));
  fs.rmSync(outputPath, { force: true });
  let offlineLog: string | undefined;
  if (run.offline) {
    try {
      blockNetPreload();
      offlineLog = path.join(run.directory, 'network.log');
    } catch {
      offlineLog = undefined;
    }
  }
  const env = targetEnvironment({ node: run.node, ...(offlineLog ? { offlineLog } : {}), ...(run.extraEnvironment ? { extra: run.extraEnvironment } : {}) });
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --experimental-import-meta-resolve --no-warnings`.trim();
  const argv = [...run.nodeArguments, ...(run.tsx ? [tsxCli(run.cwd)] : []), script, inputPath, outputPath];
  const { code, stderr } = await new Promise<{ code: number | null; stderr: string }>((done, fail) => {
    const child = spawn(nodeBinary(run.node), argv, { cwd: run.cwd, env, stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => {
      if (errors.length < 20_000) errors += chunk.toString('utf8');
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), run.timeoutMs);
    child.on('error', fail);
    child.on('close', (exit) => {
      clearTimeout(timer);
      done({ code: exit, stderr: errors });
    });
  });
  if (code !== 0 || !fs.existsSync(outputPath)) throw new Error(`probe exited ${code}: ${stderr.trim().split('\n').slice(-6).join(' | ')}`);
  return JSON.parse(fs.readFileSync(outputPath, 'utf8')) as ProbeOutput;
}

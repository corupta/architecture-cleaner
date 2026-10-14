// R3's filename-observability guard (plan §2.3): a rename is declined when anything could observe the file's name, not
// just import it. The executor rewrites import specifiers; it can't rewrite a name computed at runtime, a loader that
// registers by file name, a snapshot keyed by the spec's name, a string that spells the old name, or a tool keyed on
// the suffix (Nest compiler plugins on `.dto.ts` / `.controller.ts`, test and tsconfig globs, coverage and lint globs,
// Jest regex path settings).
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { isSourceFile } from '../analyzer/analyze.js';
import { describePluginChange, nestPlugins, pluginChange } from '../analyzer/nest-plugins.js';
import { scriptKindOf } from '../analyzer/reference-sites.js';
import { overlayRepoFs, type RepoFs, toAbsolute } from '../analyzer/repo-fs.js';
import type { RunnerConfig } from '../analyzer/runner-config.js';
import { loadScopes, type ScopeLookup } from '../analyzer/tsconfig-scopes.js';
import type { Analysis } from '../analyzer/types.js';
import type { Profile } from '../certificate/profile.js';
import { configFilePattern, configHits, emittedPaths, hitLocation, textSyntax } from '../executor/config-references.js';
import { testScopeChanges } from '../executor/declines.js';
import { globToRegExp } from '../executor/glob.js';

export interface GuardContext {
  repo: RepoFs;
  packageRoot: string;
  analysis: Analysis;
  runner: RunnerConfig;
  scopes: ScopeLookup;
  profile: Profile | null;
}

export interface GuardDecline {
  /** Repo-relative old path. */
  file: string;
  reason: string;
  detail: string;
}

// Hazards that expose the file's own name (directory-only ones such as __dirname don't change with a rename; the
// executor still declines them, as the certifier's K4 does).
const nameExposing = /^(__filename|import\.meta\.(url|filename|resolve)|import\.meta \(computed\))$/;
const documentation = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
const lockfiles = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?)$/;
const loaderCall = /(^|\.)(readdirSync|readdir|opendirSync|opendir)$/;
const globCharacters = /[*?[{]/;
const codeLoaderHint = /__dirname|import\.meta|process\.cwd\(\)|['"`](\.{1,2}\/)?(src|dist|lib|build)\//;

const ancestorsOf = (directory: string): string[] => {
  const result: string[] = [];
  for (let current = directory; ; current = path.posix.dirname(current)) {
    result.push(current === '.' ? '' : current);
    if (current === '.' || current === '') return result;
  }
};
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length;

/** `__filename`, `import.meta.url` in the file; `require.resolve` / `new URL(…, import.meta.url)` of it in any file. */
function filenameObserved(context: GuardContext, renames: ReadonlyMap<string, string>, add: (decline: GuardDecline) => void): void {
  for (const from of renames.keys()) {
    for (const hazard of context.analysis.files.get(from)?.hazards ?? []) {
      if (nameExposing.test(hazard.detail)) add({ file: from, reason: 'filename-observed', detail: `${from} uses ${hazard.detail}, which carries its file name` });
    }
  }
  for (const file of context.analysis.files.values()) {
    for (const site of file.sites) {
      if ((site.kind === 'require-resolve' || site.kind === 'url-reference') && site.resolution.type === 'file' && renames.has(site.resolution.path)) {
        add({ file: site.resolution.path, reason: 'filename-observed', detail: `${file.path} takes its path as a value ('${site.specifier}', ${site.kind})` });
      }
    }
  }
}

/** A path expression's directory: literals (from the package root, the cwd), `__dirname`, `import.meta.dirname`, join/resolve of those. */
function evaluateDirectory(node: ts.Expression, fileDirectory: string, packageRoot: string, sourceFile: ts.SourceFile): string | null {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return evaluateDirectory(node.expression, fileDirectory, packageRoot, sourceFile);
  if (ts.isStringLiteralLike(node)) return node.text.startsWith('/') ? null : path.posix.join(packageRoot, node.text);
  const text = node.getText(sourceFile);
  if (text === '__dirname' || text === 'import.meta.dirname') return fileDirectory;
  if (ts.isCallExpression(node) && /(^|\.)(join|resolve)$/.test(node.expression.getText(sourceFile)) && node.arguments.length > 0) {
    const [first, ...rest] = node.arguments;
    const base = evaluateDirectory(first!, fileDirectory, packageRoot, sourceFile);
    if (base === null || !rest.every(ts.isStringLiteralLike)) return null;
    return path.posix.join(base, ...rest.map((argument) => (argument as ts.StringLiteralLike).text));
  }
  return null;
}

/**
 * Loaders that take files by name: string globs in code (awilix loadModules, entity and controller globs,
 * import.meta.glob) that match the old or new path or its emitted path, readdir of the file's directory, and loaders
 * whose input can't be read (a non-literal loadModules, a readdir of a computed source path) for every rename.
 */
function nameFromFileLoaders(context: GuardContext, renames: ReadonlyMap<string, string>, add: (decline: GuardDecline) => void): void {
  const { repo, packageRoot, scopes } = context;
  // Old and new paths, and both emitted paths (the new one sits beside the old: a rename keeps the directory).
  const paths = [...renames].map(([from, to]) => {
    const emitted = emittedPaths(repo, scopes, from).map((output) => output.path);
    return { from, forms: [from, to, ...emitted, ...emitted.map((output) => path.posix.join(path.posix.dirname(output), path.posix.basename(to).replace(/\.[cm]?tsx?$/, '.js')))] };
  });
  const everyRename = (detail: string) => {
    for (const from of renames.keys()) add({ file: from, reason: 'name-from-file-loader', detail });
  };
  // Runner, compiler and lint configs key on globs too, but their match sets are the suffix-tooling check's.
  for (const file of [...context.analysis.files.keys()].filter((candidate) => !configFilePattern.test(candidate))) {
    const text = repo.read(file) ?? '';
    if (!/loadModules|readdir|opendir|require\.context|['"`][^'"`\n]*[*?{[][^'"`\n]*['"`]/.test(text)) continue;
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
    const fileDirectory = path.posix.dirname(file).replace(/^\.$/, '');
    const bases = ancestorsOf(fileDirectory);
    const where = (node: ts.Node) => `${file} line ${lineOf(text, node.getStart(sourceFile))}`;
    const visit = (node: ts.Node): void => {
      // A glob that names a directory (`dist/**/*.entity.js`, `./handlers/*.ts`); `**/*.ts` names no place of its own.
      const staticPart = ts.isStringLiteralLike(node) ? node.text.slice(0, node.text.search(globCharacters)) : '';
      if (ts.isStringLiteralLike(node) && globCharacters.test(node.text) && /[^/.!]\//.test(staticPart)) {
        const pattern = node.text.replace(/^!/, '');
        for (const base of pattern.startsWith('.') ? [fileDirectory] : bases) {
          const anchored = path.posix.normalize(path.posix.join(base, pattern.replace(/^\//, '')));
          if (anchored.startsWith('..')) continue;
          const regex = globToRegExp(anchored);
          for (const { from, forms } of paths) {
            const matched = forms.find((form) => regex.test(form));
            if (matched) add({ file: from, reason: 'name-from-file-loader', detail: `${where(node)}: the glob '${node.text}' (${anchored}) matches ${matched}` });
          }
        }
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sourceFile).replace(/\s/g, '');
        const [first] = node.arguments;
        if (/(^|\.)loadModules$/.test(callee)) {
          const literal = first && (ts.isStringLiteralLike(first) || (ts.isArrayLiteralExpression(first) && first.elements.every((element) => ts.isStringLiteralLike(element)
            || (ts.isArrayLiteralExpression(element) && element.elements[0] !== undefined && ts.isStringLiteralLike(element.elements[0])))));
          if (!literal) everyRename(`${where(node)}: ${callee}() registers modules by file name from patterns it can't read`);
        } else if (callee === 'require.context' && first) {
          const directory = evaluateDirectory(first, fileDirectory, fileDirectory, sourceFile);
          for (const from of renames.keys()) {
            if (directory === null || from.startsWith(`${directory}/`)) add({ file: from, reason: 'name-from-file-loader', detail: `${where(node)}: require.context(${first.getText(sourceFile)}) loads by file name` });
          }
        } else if (loaderCall.test(callee) && first) {
          const directory = evaluateDirectory(first, fileDirectory, packageRoot, sourceFile);
          const recursive = /recursive\s*:\s*true/.test(node.arguments[1]?.getText(sourceFile) ?? '');
          if (directory === null) {
            if (codeLoaderHint.test(first.getText(sourceFile))) everyRename(`${where(node)}: ${callee}(${first.getText(sourceFile).slice(0, 80)}) lists a computed source directory`);
          } else {
            for (const from of renames.keys()) {
              const parent = path.posix.dirname(from);
              if (parent === directory || (recursive && from.startsWith(`${directory}/`))) add({ file: from, reason: 'name-from-file-loader', detail: `${where(node)}: ${callee}() lists ${directory}, the file's directory` });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
}

/** A renamed spec whose snapshot file is keyed by its name. */
function snapshotPairs(context: GuardContext, renames: ReadonlyMap<string, string>, add: (decline: GuardDecline) => void): void {
  const tracked = new Set(context.repo.tracked());
  for (const from of renames.keys()) {
    const snapshot = path.posix.join(path.posix.dirname(from), '__snapshots__', `${path.posix.basename(from)}.snap`);
    if (tracked.has(snapshot)) add({ file: from, reason: 'snapshot-pair', detail: `${snapshot} pairs with it by name` });
  }
}

/**
 * The old name spelled in a tracked text file: the basename (or its .js spelling), or the extensionless name as a path
 * segment (`modules/view/view-repository`). Import specifiers that reach the file are the executor's to rewrite, and
 * comments in code, documentation and lockfiles describe rather than load (the certifier records those as findings).
 */
function nameInText(context: GuardContext, renames: ReadonlyMap<string, string>, add: (decline: GuardDecline) => void): void {
  const { repo, analysis } = context;
  const byNeedle = new Map<string, string[]>();
  const basenames: string[] = [];
  const names: string[] = [];
  for (const from of renames.keys()) {
    const basename = path.posix.basename(from);
    const name = basename.replace(/\.[cm]?[jt]sx?$/, '');
    basenames.push(basename, `${name}.js`);
    names.push(name);
    for (const needle of [basename, `${name}.js`, `/${name}`]) byNeedle.set(needle, [...(byNeedle.get(needle) ?? []), from]);
  }
  const alternation = (list: string[]) => [...new Set(list)].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  const pattern = new RegExp(`(?<![\\w-])(?:${alternation(basenames)})(?![\\w-])|/(?:${alternation(names)})(?![\\w.-])`, 'g');
  const rewritten = new Map<string, { start: number; end: number }[]>();
  for (const file of analysis.files.values()) {
    const spans = file.sites.filter((site) => site.resolution.type === 'file' && renames.has(site.resolution.path)).map((site) => ({ start: site.start, end: site.end }));
    if (spans.length) rewritten.set(file.path, spans);
  }
  for (const file of repo.tracked()) {
    if (documentation.test(file) || lockfiles.test(file) || file.split('/').some((segment) => segment === 'node_modules' || /^(docs?|documentation)$/i.test(segment))) continue;
    const absolute = toAbsolute(repo, file);
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > 4_000_000) continue;
    const bytes = fs.readFileSync(absolute);
    if (bytes.subarray(0, 8000).includes(0)) continue;
    const text = bytes.toString('utf8');
    const hits = [...text.matchAll(pattern)];
    if (hits.length === 0) continue;
    const spans = rewritten.get(file) ?? [];
    const syntax = isSourceFile(file) ? textSyntax(file, text) : null;
    for (const hit of hits) {
      const offset = hit.index!;
      if (spans.some((span) => offset >= span.start - 1 && offset < span.end)) continue;
      if (syntax?.inComment(offset)) continue;
      for (const from of byNeedle.get(hit[0])!) add({ file: from, reason: 'name-in-text', detail: `${file} line ${lineOf(text, offset)} spells '${hit[0]}'` });
    }
  }
}

/** Tools keyed on names or suffixes: Nest compiler plugins, test-runner sets, tsconfig programs, config globs and regexes. */
function suffixKeyedTools(context: GuardContext, renames: ReadonlyMap<string, string>, add: (decline: GuardDecline) => void): void {
  const { repo, runner, scopes, profile } = context;
  const plugins = nestPlugins(repo);
  for (const [from, to] of renames) {
    for (const plugin of plugins) {
      const change = pluginChange(plugin, from, to);
      if (change) add({ file: from, reason: 'suffix-tooling', detail: describePluginChange(plugin, change) });
    }
    for (const detail of testScopeChanges(runner, from, to)) add({ file: from, reason: 'suffix-tooling', detail });
    // A runner given its files as CLI globs (mocha) keys on them like a config does.
    if (profile?.runner?.args?.length) {
      const relative = (file: string) => (profile.runner!.cwd ? path.posix.relative(profile.runner!.cwd, file) : file);
      for (const glob of profile.runner.args.filter((argument) => globCharacters.test(argument))) {
        const regex = globToRegExp(glob.replace(/^\.\//, ''));
        if (regex.test(relative(from)) !== regex.test(relative(to))) add({ file: from, reason: 'suffix-tooling', detail: `profile runner glob '${glob}' would ${regex.test(relative(to)) ? 'start' : 'stop'} matching it` });
      }
    }
  }
  const after = loadScopes(overlayRepoFs(repo, renames, new Map()));
  for (const [from, to] of renames) {
    const programsBefore = scopes(from).programs.join(', ');
    const programsAfter = after(to).programs.join(', ');
    if (programsBefore !== programsAfter) add({ file: from, reason: 'suffix-tooling', detail: `tsconfig programs [${programsBefore}] -> [${programsAfter}]` });
  }
  for (const hit of configHits(repo, context.analysis, renames, scopes, runner)) {
    if (hit.comment) continue;
    for (const needle of hit.needles) {
      add({ file: needle.from, reason: 'suffix-tooling', detail: `${hitLocation(hit)}: '${hit.token}' is the ${needle.form}${hit.coverage ? ` (a coverage setting${hit.gate ? `, gated by ${hit.gate}` : ''})` : ''}` });
    }
  }
}

/** Every reason to keep a file's name, per old path. */
export function guardRenames(context: GuardContext, renames: ReadonlyMap<string, string>): GuardDecline[] {
  const declines: GuardDecline[] = [];
  const seen = new Set<string>();
  const add = (decline: GuardDecline) => {
    const key = `${decline.file}\0${decline.reason}\0${decline.detail}`;
    if (!seen.has(key)) declines.push(decline);
    seen.add(key);
  };
  if (renames.size === 0) return declines;
  filenameObserved(context, renames, add);
  nameFromFileLoaders(context, renames, add);
  snapshotPairs(context, renames, add);
  nameInText(context, renames, add);
  suffixKeyedTools(context, renames, add);
  return declines;
}

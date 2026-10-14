// Config files that name a moved file (test/fixtures/README.md, "config-reference"). The executor never edits a
// config, so it reads every path-like token the way the certifier's K4 does: anchored at the config's directory, at each
// ancestor (the package root among them) and at the runner root the config sets (Vitest `root`, Jest `rootDir`). A plain
// path names a moved file (its path, extensionless or emitted spelling, its directory if it is an index file), a
// directory a move enters or leaves, or a path inside a directory the moves empty; a glob names a move when the move
// changes whether it matches. Coverage settings follow the certifier's S4 rule: they only change behavior when a
// threshold or check-coverage gates them, so an ungated coverage glob is a finding and every other hit a decline.
// Hits in comments are findings; hits inside the config's own import specifiers are the executor's to rewrite.
import path from 'node:path';
import ts from 'typescript';
import { scriptKindOf } from '../analyzer/reference-sites.js';
import type { RepoFs } from '../analyzer/repo-fs.js';
import type { RunnerConfig } from '../analyzer/runner-config.js';
import type { ScopeLookup } from '../analyzer/tsconfig-scopes.js';
import type { Analysis } from '../analyzer/types.js';
import type { Decline, MoveFinding } from './declines.js';
import { globToRegExp } from './glob.js';

export const configFilePattern = new RegExp('(^|/)(package\\.json|[tj]sconfig[^/]*\\.json|nest-cli\\.json'
  + '|jest([.-][^/]*)?\\.config([.-][^/]*)?\\.[cm]?[jt]s|jest([.-][^/]*)?\\.json'
  + '|(vitest|vite)([.-][^/]*)?\\.config([.-][^/]*)?\\.[cm]?[jt]s'
  + '|\\.nycrc(\\.(json|ya?ml))?|\\.c8rc(\\.json)?|eslint\\.config\\.[cm]?[jt]s|\\.eslintrc(\\.(json|[cm]?js))?)$');
const coverageConfig = /(^|\/)(\.nycrc(\.(json|ya?ml))?|\.c8rc(\.json)?)$/;
const coverageKey = /coverage/i;
// Values under these keys are substitution patterns (`*` spans directories) the resolver models, not globs.
const substitutionKeys = new Set(['paths', 'exports', 'imports', 'moduleNameMapper', 'alias', 'aliases']);
const tokenPattern = /(?:[\w@$~+\-./*?]|\[[\w@$~+\-./*?!^,]*\]|\{[\w@$~+\-./*?,]*\})+/g;
const globCharacters = /[*?[{]/;
const moduleExtension = /(\.d)?\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/;
const emittedExtension: Record<string, string> = { '.ts': '.js', '.tsx': '.js', '.mts': '.mjs', '.cts': '.cjs' };

export interface ConfigNeedle {
  from: string;
  to: string;
  /** How the token names the move: `old path`, `glob server/src/services/**, whose matches change`, ... */
  form: string;
}

/**
 * Whether a config gates on coverage (the certifier's rule): Jest `coverageThreshold` / Vitest `coverage.thresholds`
 * holding a nonzero number or `100: true`, or nyc/c8 `check-coverage`. Text-level, erring toward "gated".
 */
export function coverageGated(text: string): boolean {
  if (/["']?check-?coverage["']?\s*[:=]\s*true/i.test(text)) return true;
  for (const match of text.matchAll(/["']?(coverageThreshold|thresholds)["']?\s*:\s*\{/g)) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++;
      else if (text[end] === '}' && --depth === 0) break;
    }
    const body = text.slice(match.index + match[0].length, end).replace(/["'][^"']*["']\s*:/g, ':');
    if (/(?<![\w.])(?:[1-9]\d*(?:\.\d+)?|0?\.\d*[1-9]\d*)(?![\w.])/.test(body) || /\b100\s*:\s*true/.test(body)) return true;
  }
  return false;
}

function ancestors(directory: string): string[] {
  const result: string[] = [];
  for (let current = directory; ; current = path.posix.dirname(current)) {
    result.push(current === '.' ? '' : current);
    if (current === '.' || current === '') break;
  }
  return result;
}

/** Longest common directory of a program's non-declaration files: TS 5's default rootDir. */
function commonSourceDirectory(files: ReadonlySet<string>): string {
  const directories = [...files].filter((file) => !/\.d\.[cm]?ts$/.test(file)).map((file) => path.posix.dirname(file).split('/'));
  if (directories.length === 0) return '';
  const first = directories[0]!;
  let length = first.length;
  for (const parts of directories) {
    let shared = 0;
    while (shared < length && parts[shared] === first[shared]) shared++;
    length = shared;
  }
  return first.slice(0, length).join('/').replace(/^\.$/, '');
}

/**
 * Where tsc writes a source file, under every program that compiles it (rootDir when set, else TS 6's and TS 5's
 * defaults): the emitted file and the layout that produced it, e.g. `server/dist/services/x.js` from `server/src`.
 */
export function emittedPaths(repo: RepoFs, scopes: ScopeLookup, file: string): { path: string; layout: string }[] {
  const sourceExtension = /\.[cm]?tsx?$/.exec(file)?.[0];
  if (!sourceExtension || /\.d\.[cm]?ts$/.test(file)) return [];
  const relative = (absolute: string) => path.relative(repo.root, absolute).split(path.sep).join('/');
  const results = new Map<string, string>();
  for (const [config, program] of scopes.programs) {
    if (!program.files.has(file) || !program.options.outDir) continue;
    const outDirectory = relative(program.options.outDir);
    const roots = program.options.rootDir ? [relative(program.options.rootDir)] : [path.posix.dirname(config).replace(/^\.$/, ''), commonSourceDirectory(program.files)];
    for (const root of new Set(roots)) {
      const inside = root === '' ? file : path.posix.relative(root, file);
      if (inside.startsWith('..') || outDirectory.startsWith('..')) continue;
      const emitted = path.posix.join(outDirectory, inside).slice(0, -sourceExtension.length) + (emittedExtension[sourceExtension] ?? '.js');
      if (!results.has(emitted)) results.set(emitted, `${outDirectory} from ${root || '.'}`);
    }
  }
  return [...results].map(([emitted, layout]) => ({ path: emitted, layout }));
}

/** Every repo path that names a moved file: its path, stem, specifier spelling, index directory and emitted paths. */
function fileNeedles(repo: RepoFs, moves: ReadonlyMap<string, string>, scopes: ScopeLookup): Map<string, ConfigNeedle> {
  const needles = new Map<string, ConfigNeedle>();
  const add = (key: string, needle: ConfigNeedle) => {
    if (key && key !== '.' && !needles.has(key)) needles.set(key, needle);
  };
  for (const [from, to] of moves) {
    add(from, { from, to, form: 'old path' });
    const extension = moduleExtension.exec(from)?.[0];
    if (extension) {
      const stem = from.slice(0, -extension.length);
      add(stem, { from, to, form: 'old path without extension' });
      const emitted = emittedExtension[extension];
      if (emitted) add(stem + emitted, { from, to, form: 'old specifier spelling' });
      if (path.posix.basename(stem) === 'index') add(path.posix.dirname(stem).replace(/^\.$/, ''), { from, to, form: 'old directory of an index file' });
    }
    for (const emitted of emittedPaths(repo, scopes, from)) {
      const emittedStem = emitted.path.replace(/\.[cm]?js$/, '');
      add(emitted.path, { from, to, form: `emitted path (${emitted.layout})` });
      add(emittedStem, { from, to, form: 'emitted path without extension' });
      if (path.posix.basename(emittedStem) === 'index') add(path.posix.dirname(emittedStem), { from, to, form: 'emitted directory of an index file' });
    }
  }
  return needles;
}

/** Directories a move enters or leaves (a config naming one means everything below it), and the ones the moves empty. */
function directoryNeedles(repo: RepoFs, moves: ReadonlyMap<string, string>): { crossed: Map<string, ConfigNeedle>; emptied: Map<string, ConfigNeedle> } {
  const crossed = new Map<string, ConfigNeedle>();
  for (const [from, to] of moves) {
    const fromAncestors = ancestors(path.posix.dirname(from));
    const toAncestors = ancestors(path.posix.dirname(to));
    for (const directory of [...fromAncestors.filter((ancestor) => !toAncestors.includes(ancestor)), ...toAncestors.filter((ancestor) => !fromAncestors.includes(ancestor))]) {
      if (directory && !crossed.has(directory)) crossed.set(directory, { from, to, form: `directory ${directory}, whose contents change with the move` });
    }
  }
  const remaining = new Set<string>();
  for (const file of repo.tracked()) if (!moves.has(file)) for (const directory of ancestors(path.posix.dirname(file))) remaining.add(directory);
  for (const to of moves.values()) for (const directory of ancestors(path.posix.dirname(to))) remaining.add(directory);
  const emptied = new Map<string, ConfigNeedle>();
  for (const [from, to] of moves) {
    for (const directory of ancestors(path.posix.dirname(from))) {
      if (directory && !remaining.has(directory) && !emptied.has(directory)) emptied.set(directory, { from, to, form: `directory ${directory}, which the moves empty` });
    }
  }
  return { crossed, emptied };
}

/** Comment ranges and enclosing property names of a JS/TS/JSON file; YAML and rc files fall back to `#` lines. */
export function textSyntax(file: string, text: string): { inComment(offset: number): boolean; keys(offset: number): string[] } {
  if (!/\.(json|[cm]?[jt]sx?)$/.test(file)) {
    return { inComment: (offset) => /^\s*#/.test(text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset + 1)), keys: () => [] };
  }
  const sourceFile = file.endsWith('.json') ? ts.parseJsonText(file, text) : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const chain = (offset: number): ts.Node[] => {
    const nodes: ts.Node[] = [sourceFile];
    for (;;) {
      const child = nodes[nodes.length - 1]!.getChildren(sourceFile).find((candidate) => candidate.pos <= offset && offset < candidate.end);
      if (!child) return nodes;
      nodes.push(child);
    }
  };
  return {
    inComment(offset) {
      const node = chain(offset).at(-1)!;
      return offset < node.getStart(sourceFile, false) || node.kind === ts.SyntaxKind.EndOfFileToken;
    },
    keys: (offset) => chain(offset).filter(ts.isPropertyAssignment)
      .map((property) => (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : property.name.getText(sourceFile))),
  };
}

interface Hit {
  offset: number;
  token: string;
  /** The anchored glob, for glob hits. */
  glob?: string;
  needles: ConfigNeedle[];
}

/** Repo-relative readings of a plain path token (the certifier's K4 rules), with `<rootDir>/x` read at the Jest rootDir. */
function readings(token: string, anchors: readonly string[], rootDirectory: string | null): string[] {
  if (token.startsWith('//')) return [];
  if (rootDirectory !== null) return [path.posix.join(rootDirectory, token.slice(1))];
  // An absolute path (a container's /app/dist/main.js) names whatever repo path it ends with.
  if (token.startsWith('/')) {
    const suffixes: string[] = [];
    for (let slash = token.indexOf('/'); slash !== -1; slash = token.indexOf('/', slash + 1)) if (token.slice(slash + 1)) suffixes.push(token.slice(slash + 1));
    return suffixes;
  }
  // A bare word is a key or a name (`types`, `src`), not a path; a bare file name is relative to the config only.
  if (!token.includes('/') && !/\.[A-Za-z0-9]+$/.test(token)) return [];
  const bases = token.includes('/') ? anchors : anchors.slice(0, 1);
  return [...new Set(bases)].map((base) => path.posix.normalize(path.posix.join(base, token)).replace(/\/+$/, '')).filter((joined) => !joined.startsWith('..') && joined !== '.');
}

/** A config token that names a moved file, read in context: where, under which keys, and whether it can matter. */
export interface ConfigHit {
  config: string;
  line: number;
  /** Enclosing property names, outermost first (`test.coverage.include`). */
  keys: string[];
  token: string;
  /** The anchored glob, for a glob token. */
  glob?: string;
  needles: ConfigNeedle[];
  comment: boolean;
  /** A coverage setting (a coverage key or an nyc/c8 config), and whether a threshold in the config gates it. */
  coverage: boolean;
  gated: boolean;
}

/** Every config token that names a move, except globs under substitution keys (the resolver models those). */
export function configHits(repo: RepoFs, analysis: Analysis, moves: ReadonlyMap<string, string>, scopes: ScopeLookup, runner: RunnerConfig): ConfigHit[] {
  const results: ConfigHit[] = [];
  if (moves.size === 0) return results;
  const needles = fileNeedles(repo, moves, scopes);
  const { crossed, emptied } = directoryNeedles(repo, moves);
  const insideEmptied = (candidate: string): ConfigNeedle | undefined => {
    for (let directory = candidate; directory && directory !== '.'; directory = path.posix.dirname(directory)) {
      const needle = emptied.get(directory);
      if (needle) return { ...needle, form: directory === candidate ? needle.form : `path inside the ${needle.form}` };
    }
    return undefined;
  };
  const globChanges = new Map<string, ConfigNeedle[]>();
  const changesOf = (glob: string): ConfigNeedle[] => {
    let changed = globChanges.get(glob);
    if (!changed) {
      const pattern = globToRegExp(glob);
      changed = [...moves].filter(([from, to]) => pattern.test(from) !== pattern.test(to)).map(([from, to]) => ({ from, to, form: `glob ${glob}, whose matches change` }));
      globChanges.set(glob, changed);
    }
    return changed;
  };

  for (const config of repo.tracked().filter((file) => configFilePattern.test(file) && !file.split('/').includes('node_modules'))) {
    const text = repo.read(config) ?? '';
    const configDirectory = path.posix.dirname(config).replace(/^\.$/, '');
    const jestRoot = runner.jest.find((entry) => entry.config === config)?.rootDir ?? null;
    const vitestRoot = runner.vitest.find((entry) => entry.config === config)?.directory ?? null;
    const anchors = [...new Set([configDirectory, ...[jestRoot, vitestRoot].filter((root): root is string => root !== null), ...ancestors(configDirectory)])];
    const ownSites = analysis.files.get(config)?.sites ?? [];
    const hits: Hit[] = [];
    for (const match of text.matchAll(tokenPattern)) {
      const token = match[0].replace(/[.]+$/, '');
      const offset = match.index!;
      if (token.length < 3 || ownSites.some((site) => offset < site.end && offset + token.length > site.start)) continue;
      const rootDirectory = token.startsWith('/') && text.slice(offset - '<rootDir>'.length, offset) === '<rootDir>' ? (jestRoot ?? configDirectory) : null;
      if (globCharacters.test(token)) {
        if (!token.includes('/') || token.startsWith('//') || !/[A-Za-z0-9]/.test(token.replace(/\{[^}]*\}|\[[^\]]*\]/g, ''))) continue;
        const pattern = token.replace(/^!/, '').replace(/^\.?\//, '');
        for (const base of rootDirectory !== null ? [rootDirectory] : anchors) {
          const anchored = path.posix.normalize(path.posix.join(base, pattern));
          if (anchored.startsWith('..') || anchored.startsWith('/')) continue;
          const changed = changesOf(anchored);
          const staticPart = anchored.slice(0, anchored.search(globCharacters));
          const emptiedNeedle = changed.length ? undefined : insideEmptied(path.posix.dirname(`${staticPart}x`));
          if (changed.length || emptiedNeedle) {
            hits.push({ offset, token, glob: anchored, needles: changed.length ? changed : [{ ...emptiedNeedle!, form: `glob ${anchored} inside the ${emptiedNeedle!.form}` }] });
            break;
          }
        }
        continue;
      }
      for (const candidate of readings(token, anchors, rootDirectory)) {
        const needle = needles.get(candidate) ?? crossed.get(candidate) ?? insideEmptied(candidate);
        if (needle) {
          hits.push({ offset, token, needles: [needle] });
          break;
        }
      }
    }
    if (hits.length === 0) continue;
    const syntax = textSyntax(config, text);
    const gated = coverageGated(text);
    for (const hit of hits) {
      const keys = syntax.keys(hit.offset);
      if (hit.glob && keys.some((key) => substitutionKeys.has(key))) continue;
      results.push({
        config, line: text.slice(0, hit.offset).split('\n').length, keys, token: hit.token, ...(hit.glob ? { glob: hit.glob } : {}), needles: hit.needles,
        comment: syntax.inComment(hit.offset), coverage: coverageConfig.test(config) || keys.some((key) => coverageKey.test(key)), gated,
      });
    }
  }
  return results;
}

/** Where a hit is, for details: `server/test/vitest.config.mjs line 19 [test.coverage.include]`. */
export const hitLocation = (hit: ConfigHit) => `${hit.config} line ${hit.line}${hit.keys.length ? ` [${hit.keys.join('.')}]` : ''}`;

export function configReferences(repo: RepoFs, analysis: Analysis, moves: ReadonlyMap<string, string>, scopes: ScopeLookup, runner: RunnerConfig): { declines: Decline[]; findings: MoveFinding[] } {
  const declines: Decline[] = [];
  const findings: MoveFinding[] = [];
  for (const hit of configHits(repo, analysis, moves, scopes, runner)) {
    const where = hitLocation(hit);
    const named = hit.needles.map((needle) => `${needle.from} (moving to ${needle.to})`).join(', ');
    if (hit.comment) {
      findings.push({ kind: 'old-path-in-comment', file: hit.config, detail: `${where}: a comment's '${hit.token}' is the ${hit.needles[0]!.form} of ${named}` });
    } else if (hit.coverage && !hit.gated) {
      findings.push({ kind: 'ungated-coverage-glob', file: hit.config, detail: `${where}: coverage glob '${hit.token}'${hit.glob ? ` (${hit.glob})` : ''} matches differently for ${named}; nothing in ${hit.config} gates coverage (no threshold or check-coverage), so coverage now measures a different file set and no gate changes` });
    } else {
      for (const needle of hit.needles) {
        declines.push({ code: 'config-reference', file: needle.from, detail: `${where}: '${hit.token}' is the ${needle.form} of ${needle.from}${hit.coverage ? '; a coverage setting gated by a threshold' : ''}` });
      }
    }
  }
  return { declines, findings };
}

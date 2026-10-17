// K4 part 3 (plan §3.4; research 04b A26–A28, M21): no tracked text file of head still names a moved file by its
// old path. Needles per move f → g: f with and without its extension, its specifier spelling (.ts → .js), its
// directory if f is an index file, its emitted path under every tsconfig outDir that compiles it, and every
// directory the move emptied (plus its emitted mirror). A path-like token is compared after anchoring it at the
// file's directory, each ancestor of it, and the package root, so `src/services/x.ts` in server/package.json and
// `../src/services/x.ts` in server/test/ both hit, as do a directory a move enters or leaves (`files: ["dist/x"]`)
// and a handler reference (`dist/handlers/create.handler`). Glob tokens in code and config are matched instead: a
// glob whose match set over the moved files changes is a hit, and in code also one whose sorted matches reorder.
// Hits inside K2 specifier spans are K3's business. Documentation files and comments only produce findings. Jest regex
// path settings (`coveragePathIgnorePatterns`) are evaluated on each move, `<rootDir>/…` tokens are read at the Jest
// rootDir, and coverage settings follow the rule the executor shares (analyzer/coverage-settings.ts): only a gated one
// is a violation. A rename into or out of a Nest compiler plugin's suffixes (`.dto.ts`) changes what it emits.
// A hit that would be a violation is read once more with what the syntax around it proves (string-flow.ts), and is a
// finding instead when it names nothing the move changed: a string in a type, a string only non-path consumers take
// (an HTTP route, a test title, a value an assertion compares, prose), a segment of a path built from the file's
// location whose value is elsewhere, an absolute glob in code read away from the repository and package root, a Nix
// input's directory, or a string in code that names nothing the move touched and does so only at a directory no
// process runs in and no code of the repository computes.
import path from 'node:path';
import ts from 'typescript';
import { coverageGates, isCoverageSetting } from '../analyzer/coverage-settings.js';
import { describePluginChange, nestPlugins, pluginChange } from '../analyzer/nest-plugins.js';
import { loadRunnerConfig } from '../analyzer/runner-config.js';
import { loadScopes } from '../analyzer/tsconfig-scopes.js';
import { scriptKindOf } from '../analyzer/reference-sites.js';
import { type CommitTree, isUtf8 } from './git-tree.js';
import { commonSourceDirectory, emittedFiles } from './emitted-files.js';
import { locate } from './path-expressions.js';
import { isScannedSource } from './spans.js';
import { followsSubstitution, isCommentAt, proseKeys, stringValueAt, type StringUse, stringUses } from './string-flow.js';
import type { CertifyContext, Finding, Violation } from './types.js';

/** One way a compiler program lays out output: files under `rootDir` are emitted under `outDir`. */
export interface EmittedLayout {
  outDir: string;
  rootDir: string;
  /** Repo-relative files the program compiles. */
  files: ReadonlySet<string>;
  declaration: boolean;
}

const binaryExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'jxl', 'dng', 'cr2', 'nef', 'arw',
  'raw', 'psd', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'm4a', 'mov', 'webm', 'wav', 'ogg', 'flac', 'avi', 'mkv', 'pdf', 'zip', 'gz', 'tgz',
  'bz2', 'xz', '7z', 'rar', 'jar', 'war', 'class', 'so', 'dylib', 'dll', 'exe', 'bin', 'dat', 'db', 'sqlite', 'wasm', 'node', 'keystore', 'jks', 'p12',
  'pfx', 'der', 'apk', 'ipa', 'aar', 'pyc', 'lockb', 'mobileprovision', 'icns', 'car', 'onnx', 'pt', 'npy']);
const documentationExtensions = /\.(md|mdx|markdown|txt|text|rst|adoc|asciidoc|org|textile)$/i;
const documentationNames = /^(readme|changelog|changes|history|news|contributing|authors|code_of_conduct|security|license|licence|notice|support|governance)([.\-_]|$)/i;
const ignoreFiles = new Set(['.gitignore', '.npmignore', '.dockerignore', '.prettierignore', '.eslintignore']);
const moduleExtension = /(\.d)?\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/;
const emittedExtension: Record<string, string> = { '.ts': '.js', '.tsx': '.js', '.mts': '.mjs', '.cts': '.cjs', '.js': '.js', '.jsx': '.jsx', '.mjs': '.mjs', '.cjs': '.cjs' };
const declarationExtension: Record<string, string> = { '.ts': '.d.ts', '.tsx': '.d.ts', '.mts': '.d.mts', '.cts': '.d.cts' };
// Values under these keys are substitution patterns (`*` spans directories) that K3 resolves through, not globs.
const substitutionKeys = new Set(['paths', 'exports', 'imports', 'moduleNameMapper', 'alias', 'aliases']);

export const isDocumentation = (file: string) => documentationExtensions.test(file) || documentationNames.test(path.posix.basename(file))
  || file.split('/').slice(0, -1).some((segment) => /^(docs?|documentation)$/i.test(segment));

/** Line-comment markers of non-JS formats: a hit on a line that starts with one is a comment. */
function commentMarkers(file: string): RegExp | null {
  const base = path.posix.basename(file).toLowerCase();
  const extension = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  if (/^(dockerfile|containerfile|procfile|makefile|gemfile|rakefile|caddyfile)/.test(base) || base.startsWith('.env') || base === '.gitattributes' || base.endsWith('ignore')
    || ['yml', 'yaml', 'sh', 'bash', 'zsh', 'toml', 'ini', 'cfg', 'conf', 'properties', 'py', 'rb', 'tf', 'mk', 'nix', 'r', 'pl'].includes(extension)) return /^\s*#/;
  if (['json', 'jsonc', 'json5', 'dart', 'kt', 'kts', 'swift', 'java', 'go', 'rs', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'scss', 'less', 'css', 'gradle', 'groovy', 'proto', 'graphql', 'prisma'].includes(extension)) return /^\s*(\/\/|\/\*|\*)/;
  if (['html', 'htm', 'xml', 'svg', 'vue', 'svelte', 'plist', 'xib', 'storyboard'].includes(extension)) return /^\s*(<!--|\/\/|\/\*|\*)/;
  if (extension === 'sql') return /^\s*--/;
  return null;
}

/** What a tracked file is to the scans: CI, infra, code or config. */
export function category(file: string): string {
  const base = path.posix.basename(file).toLowerCase();
  if (file.startsWith('.github/') || file.startsWith('.gitlab') || file.startsWith('.circleci/') || base === '.gitlab-ci.yml' || base === 'azure-pipelines.yml'
    || base === 'jenkinsfile' || file.startsWith('.buildkite/') || base === 'codeowners') return 'CI';
  if (/^(dockerfile|containerfile|procfile)/.test(base) || /compose.*\.ya?ml$/.test(base) || /^(serverless|app|fly|render|vercel|netlify|now)\.(ya?ml|json|toml)$/.test(base)
    || base.endsWith('.tf') || /^ecosystem\.config\./.test(base) || /^nodemon\.json$/.test(base) || file.split('/').some((segment) => ['k8s', 'kubernetes', 'helm', 'charts', 'deploy', 'infra'].includes(segment))) return 'infra';
  if (isScannedSource(file, '') && !/(^|\/)[^/]*\.config\.[cm]?[jt]s$|(^|\/)\.[^/]*rc\.[cm]?js$/.test(file)) return 'code';
  return 'config';
}

const isCharacterClass = (source: string) => {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
};

/** A glob (`**`, `*`, `?`, `[…]`, `{a,b}`) as an anchored regex over repo-relative paths. */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === '*' && pattern[index + 1] === '*') {
      index++;
      if (pattern[index + 1] === '/') {
        index++;
        source += '(?:.*/)?';
      } else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '[') {
      const close = pattern.indexOf(']', index + 1);
      const characterClass = close === -1 ? null : `[${pattern.slice(index + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
      // A bracket that isn't a valid class (`[tasks.playwright-install]`, a TOML table) matches itself, as in glob libraries.
      if (characterClass === null || !isCharacterClass(characterClass)) source += '\\[';
      else {
        source += characterClass;
        index = close;
      }
    } else if (char === '{') {
      const close = pattern.indexOf('}', index + 1);
      if (close === -1) source += '\\{';
      else {
        source += `(?:${pattern.slice(index + 1, close).split(',').map((part) => globToRegExp(part).source.slice(1, -1)).join('|')})`;
        index = close;
      }
    } else source += char.replace(/[.+^$()|\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

const codeUnitOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const localeOrder = (a: string, b: string) => a.localeCompare(b, 'en');

/**
 * For a glob whose match set the moves keep: the first position where the sorted match list differs (base mapped
 * through the pathMap vs head), under `.sort()`'s code-unit order or glob 7's locale order. A loader that registers
 * what it matches in that order (routes, middleware, handlers: first match wins) behaves differently.
 */
export function globOrderChange(pattern: RegExp, context: CertifyContext): string | null {
  const { base, head, pathMap } = context;
  if (![...pathMap.moves].some(([from]) => pattern.test(from))) return null;
  const baseMatches = [...base.entries.keys()].filter((file) => pattern.test(file));
  const headMatches = [...head.entries.keys()].filter((file) => pattern.test(file));
  for (const [name, order] of [['code-unit', codeUnitOrder], ['locale', localeOrder]] as const) {
    const before = [...baseMatches].sort(order).map((file) => pathMap.map(file));
    const after = [...headMatches].sort(order);
    const index = before.findIndex((file, position) => file !== after[position]);
    if (index === -1) continue;
    const was = pathMap.inverse.get(after[index]!) ?? after[index]!;
    return `in ${name} sorted order, match ${index + 1} is ${pathMap.inverse.get(before[index]!) ?? before[index]} in base (now ${before[index]}) but ${after[index]} in head (was ${was})`;
  }
  return null;
}

/** Every (outDir, rootDir) of the base's tsconfig programs: rootDir when set, else TS 6's and TS 5's defaults (read both ways). */
export function emittedLayouts(context: CertifyContext): EmittedLayout[] {
  const repo = context.fs.base;
  const relative = (absolute: string) => path.relative(repo.root, absolute).split(path.sep).join('/');
  const layouts = new Map<string, EmittedLayout>();
  const scopes = loadScopes(repo);
  for (const [config, program] of scopes.programs) {
    if (!program.options.outDir) continue;
    const outDir = relative(program.options.outDir);
    if (outDir.startsWith('..')) continue;
    // TS 5 roots the output at the common directory of every emitted file, which imports can widen past the root files.
    const roots = program.options.rootDir ? [relative(program.options.rootDir)]
      : [path.posix.dirname(config).replace(/^\.$/, ''), commonSourceDirectory(program.files), commonSourceDirectory(emittedFiles(repo, scopes, config))];
    for (const rootDir of new Set(roots)) {
      if (rootDir.startsWith('..')) continue;
      layouts.set(`${outDir}\0${rootDir}\0${config}`, { outDir, rootDir, files: program.files, declaration: Boolean(program.options.declaration) });
    }
  }
  return [...layouts.values()];
}

interface Needle {
  from: string;
  to: string;
  form: string;
  /** The token names a path or glob below a directory the move emptied, not the directory or a moved file itself. */
  inside?: boolean;
}

const under = (directory: string, file: string) => directory === '' || file.startsWith(`${directory}/`);
const relativeTo = (directory: string, file: string) => (directory === '' ? file : file.slice(directory.length + 1));

/**
 * Directories a process that reads `file`'s paths can run in: the repository root, the package root, the profile's
 * runner cwd, and the nearest directory above the file with a package.json (in `tree`).
 */
export function cwdBases(context: CertifyContext, file: string, tree: CommitTree): string[] {
  const bases = new Set<string>(['', context.options.packageRoot]);
  if (context.options.profile?.runner?.cwd !== undefined) bases.add(context.options.profile.runner.cwd);
  for (let directory = path.posix.dirname(file); ; directory = path.posix.dirname(directory)) {
    const relative = directory === '.' ? '' : directory;
    if (tree.entries.has(relative ? `${relative}/package.json` : 'package.json')) {
      bases.add(relative);
      break;
    }
    if (directory === '.') break;
  }
  return [...bases];
}

function buildNeedles(context: CertifyContext, layouts: readonly EmittedLayout[]): { needles: Map<string, Needle[]>; emptied: Map<string, Needle> } {
  const { base, head, pathMap } = context;
  const needles = new Map<string, Needle[]>();
  const add = (key: string, needle: Needle) => {
    if (!key || key === '.' || key === context.options.packageRoot) return;
    const list = needles.get(key) ?? [];
    if (!list.some((existing) => existing.from === needle.from)) list.push(needle);
    needles.set(key, list);
  };
  for (const [from, to] of pathMap.moves) {
    add(from, { from, to, form: 'old path' });
    const extension = moduleExtension.exec(from)?.[0];
    if (extension) {
      const stem = from.slice(0, -extension.length);
      add(stem, { from, to, form: 'old path without extension' });
      const emitted = emittedExtension[extension];
      if (emitted && emitted !== extension) add(stem + emitted, { from, to, form: 'old specifier spelling' });
      if (path.posix.basename(stem) === 'index') add(path.posix.dirname(stem).replace(/^\.$/, ''), { from, to, form: 'old directory of an index file' });
    }
    const sourceExtension = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.exec(from)?.[0];
    if (!sourceExtension || /\.d\.[cm]?ts$/.test(from)) continue;
    for (const layout of layouts) {
      if (!layout.files.has(from) || !under(layout.rootDir, from)) continue;
      const stem = path.posix.join(layout.outDir, relativeTo(layout.rootDir, from)).slice(0, -sourceExtension.length);
      add(stem + emittedExtension[sourceExtension]!, { from, to, form: `emitted path (${layout.outDir} from ${layout.rootDir || '.'})` });
      add(stem, { from, to, form: 'emitted path without extension' });
      if (layout.declaration && declarationExtension[sourceExtension]) add(stem + declarationExtension[sourceExtension]!, { from, to, form: 'emitted declaration path' });
      if (path.posix.basename(stem) === 'index') add(path.posix.dirname(stem), { from, to, form: 'emitted directory of an index file' });
    }
  }
  const emptied = new Map<string, Needle>();
  for (const directory of base.directories) {
    if (!directory || head.directories.has(directory)) continue;
    const moved = [...pathMap.moves].find(([from]) => from.startsWith(`${directory}/`));
    if (!moved) continue;
    const needle = { from: directory, to: path.posix.dirname(moved[1]), form: 'directory the move emptied' };
    emptied.set(directory, needle);
    for (const layout of layouts) {
      if (under(layout.rootDir, directory) && directory !== layout.rootDir) emptied.set(path.posix.join(layout.outDir, relativeTo(layout.rootDir, directory)), { ...needle, form: `emitted mirror of a directory the move emptied (${layout.outDir})` });
    }
  }
  return { needles, emptied };
}

const tokenPattern = /(?:[\w@$~+\-./*?]|\[[\w@$~+\-./*?!^,]*\]|\{[\w@$~+\-./*?,]*\})+/g;
const globCharacters = /[*?[{]/;
// `<module path>.<export>`: a Lambda/serverless handler (`dist/handlers/create.handler`), a Procfile-style entry.
const handlerReference = /^(.+)\.([A-Za-z_$][\w$]*)$/;
const fileExtensions = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'json', 'map', 'snap', 'html', 'css', 'scss', 'yml', 'yaml', 'md', 'txt', 'sh', 'sql', 'hbs']);

/** The module part of a token shaped like a handler reference: an extensionless path, then `.export`. */
function handlerModule(token: string, allowed: boolean): string | null {
  const match = allowed ? handlerReference.exec(token) : null;
  return match && !fileExtensions.has(match[2]!.toLowerCase()) && !moduleExtension.test(match[1]!) ? match[1]! : null;
}

/**
 * Repo-relative readings of a path-like token: anchored at each base (a bare file name only at its own directory),
 * or by suffix for absolute paths (a container's `/app/dist/main.js`) and repository links.
 */
function readings(token: string, bases: readonly string[], packageRoot: string): string[] {
  if (token.startsWith('//')) {
    // A URL without its scheme: a repository link (`github.com/o/r/blob/<ref>/server/src/x.ts`) names a repo path.
    const link = /\/(?:blob|tree|raw|edit|blame)\/[^/]+\/(.+)$/.exec(token) ?? /^\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/.exec(token);
    return link ? [link[1]!] : [];
  }
  if (token.startsWith('/')) {
    const suffixes: string[] = [];
    for (let slash = token.indexOf('/'); slash !== -1; slash = token.indexOf('/', slash + 1)) {
      const suffix = token.slice(slash + 1);
      if (suffix) suffixes.push(suffix);
    }
    return suffixes.flatMap((suffix) => (packageRoot ? [suffix, path.posix.join(packageRoot, suffix)] : [suffix]));
  }
  if (!token.includes('/') && !/\.[A-Za-z0-9]+$/.test(token)) return [];
  const results: string[] = [];
  // './x' and '../x' are relative to the file (or, run from the package root, to it); a bare file name only to its own directory.
  const anchors = /^\.\.?\//.test(token) ? [bases[0]!, packageRoot] : token.includes('/') ? bases : bases.slice(0, 1);
  for (const base of new Set(anchors)) {
    const joined = path.posix.normalize(path.posix.join(base, token)).replace(/\/+$/, '');
    if (!joined.startsWith('..') && joined !== '.') results.push(joined);
  }
  return results;
}

function ancestors(file: string): string[] {
  const result: string[] = [];
  for (let directory = path.posix.dirname(file); ; directory = path.posix.dirname(directory)) {
    result.push(directory === '.' ? '' : directory);
    if (directory === '.' || directory === '/') break;
  }
  return result;
}

interface Syntax {
  inComment(offset: number): boolean;
  keys(offset: number): string[];
  /** What the string at `offset` is to its consumers (string-flow.ts); JSON: only prose values are judged. */
  use(offset: number): StringUse;
  /** The token at `offset` starts right after a template substitution (`${base}/x`): it is not the start of a path. */
  followsSubstitution(offset: number): boolean;
  /** JS/TS: the string value at `offset` (string-flow.ts stringValueAt). */
  stringValue(offset: number): ReturnType<typeof stringValueAt>;
}

/** Comment ranges, enclosing property names and string uses of a JS/TS/JSON file, computed when a hit needs them. */
function syntaxOf(file: string, text: string): Syntax | null {
  const json = /\.(json|jsonc|json5)$/.test(file) || /(^|\/)tsconfig[^/]*\.json$/.test(file) || /(^|\/)(flake|devenv)\.lock$/.test(file);
  if (!json && !isScannedSource(file, text)) return null;
  const sourceFile = json ? ts.parseJsonText(file, text) : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const leaf = (offset: number): ts.Node[] => {
    const chain: ts.Node[] = [sourceFile];
    for (;;) {
      const node = chain[chain.length - 1]!;
      const child = node.getChildren(sourceFile).find((candidate) => candidate.pos <= offset && offset < candidate.end);
      if (!child) return chain;
      chain.push(child);
    }
  };
  let uses: ((offset: number) => StringUse) | undefined;
  return {
    inComment: (offset) => isCommentAt(sourceFile, offset),
    followsSubstitution: (offset) => !json && followsSubstitution(sourceFile, offset),
    stringValue: (offset) => (json ? null : stringValueAt(sourceFile, offset)),
    keys(offset) {
      return leaf(offset).filter(ts.isPropertyAssignment).map((property) => (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : property.name.getText(sourceFile)));
    },
    use(offset) {
      if (!json) return (uses ??= stringUses(file, sourceFile))(offset);
      // A JSON consumer gets the whole value: a sentence under a prose key is not a path, whatever words it contains.
      // parseJsonText leaves parent pointers unset: the chain is the way up.
      const chain = leaf(offset);
      const literal = chain[chain.length - 1]!;
      const property = chain[chain.length - 2];
      if (property && ts.isStringLiteral(literal) && ts.isPropertyAssignment(property) && property.initializer === literal && ts.isStringLiteral(property.name)
        && proseKeys.has(property.name.text) && /\s/.test(literal.text)) return { kind: 'consumed', consumer: `prose (the ${property.name.text} of an object)` };
      return { kind: 'open' };
    },
  };
}

/**
 * Nix lock files (`flake.lock`, `devenv.lock`): a `dir` of an input fetched from elsewhere (github, git, tarball, …) is
 * a directory of that input's source tree at its locked revision, not of this checkout. Only a `path` input is local.
 */
function foreignInputDirectory(file: string, text: string, keys: readonly string[]): string | null {
  if (!/(^|\/)(flake|devenv)\.lock$/.test(file) || keys.length !== 4 || keys[0] !== 'nodes' || !['locked', 'original'].includes(keys[2]!) || keys[3] !== 'dir') return null;
  let lock: unknown;
  try {
    lock = JSON.parse(text);
  } catch {
    return null;
  }
  const source = (lock as { nodes?: Record<string, Record<string, Record<string, unknown>>> }).nodes?.[keys[1]!]?.[keys[2]!];
  const type = source?.type;
  if (typeof type !== 'string' || type === 'path') return null;
  const name = [source!.owner, source!.repo].every((part) => typeof part === 'string') ? ` ${source!.owner}/${source!.repo}` : typeof source!.url === 'string' ? ` ${source!.url}` : '';
  return `a directory of the Nix input '${keys[1]}' (${type}${name}), fetched at its locked revision, not of this checkout`;
}

/** YAML keys enclosing a line, by indentation. */
function yamlKeys(lines: readonly string[], lineIndex: number): string[] {
  const keys: string[] = [];
  let indent = lines[lineIndex]!.search(/\S/);
  const own = /^\s*-?\s*([\w.@/-]+)\s*:/.exec(lines[lineIndex]!);
  if (own) keys.unshift(own[1]!);
  for (let index = lineIndex - 1; index >= 0 && indent > 0; index--) {
    const line = lines[index]!;
    const position = line.search(/\S/);
    if (position === -1 || position >= indent) continue;
    const key = /^\s*-?\s*([\w.@/-]+)\s*:/.exec(line);
    if (key) keys.unshift(key[1]!);
    indent = position;
  }
  return keys;
}

interface Hit {
  file: string;
  offset: number;
  token: string;
  needle: Needle;
  glob?: boolean;
  /** For a glob: the directory it was anchored at. */
  base?: string;
}

/** Head text files a path can be named from: not binary, not a submodule or symlink, outside node_modules. */
export function headTextFiles(context: CertifyContext): string[] {
  return [...context.head.entries.values()].filter((entry) => entry.mode !== '160000' && entry.mode !== '120000' && !entry.path.split('/').includes('node_modules')
    && !binaryExtensions.has(path.posix.extname(entry.path).slice(1).toLowerCase())).map((entry) => entry.path);
}

export interface Naming {
  file: string;
  line: number;
  token: string;
  glob: boolean;
}

/**
 * The places in `files` that name `target` with a path token or match it with a glob token, anchored like the old-path
 * scan (the file's directory, each ancestor, the package root), outside comments; ignore files and documentation never
 * load anything.
 */
export function namingsOf(context: CertifyContext, target: string, files: readonly string[]): Naming[] {
  const namings: Naming[] = [];
  const packageRoot = context.options.packageRoot;
  context.head.prefetch(files);
  for (const file of files) {
    if (isDocumentation(file) || ignoreFiles.has(path.posix.basename(file))) continue;
    const bytes = context.head.bytes(file);
    if (!bytes || bytes.subarray(0, 8000).includes(0) || !isUtf8(bytes)) continue;
    const text = bytes.toString('utf8');
    if (!text.includes(path.posix.basename(target).replace(/^\./, '')) && !globCharacters.test(text)) continue;
    const bases = [...new Set([...ancestors(file), packageRoot])];
    const markers = commentMarkers(file);
    let syntax: ReturnType<typeof syntaxOf> | undefined;
    for (const match of text.matchAll(tokenPattern)) {
      const token = match[0].replace(/[.]+$/, '');
      if (token.length < 3) continue;
      const glob = globCharacters.test(token);
      // Like the old-path scan: a run of stars or brackets without a name in it (a banner, `********`) isn't a glob.
      if (glob && !/[A-Za-z0-9]/.test(token.replace(/\{[^}]*\}|\[[^\]]*\]/g, ''))) continue;
      const hit = glob
        ? bases.some((base) => {
          const anchored = path.posix.normalize(path.posix.join(base, token.replace(/^!/, '').replace(/^\.?\//, '')));
          return !anchored.startsWith('..') && globToRegExp(anchored).test(target);
        })
        : readings(token, bases, packageRoot).includes(target);
      if (!hit) continue;
      const line = text.slice(0, match.index).split('\n').length;
      syntax ??= syntaxOf(file, text);
      if (syntax ? syntax.inComment(match.index) : markers !== null && markers.test(text.split('\n')[line - 1] ?? '')) continue;
      namings.push({ file, line, token, glob });
    }
  }
  return namings;
}

/**
 * `opaqueLoads` names the module loads of the repository whose path K4 can't evaluate (`import(table[name])`): any of
 * them can take a relative path string from anywhere, so such a string naming a moved file is then a violation.
 * `inertAdditions`: added tool configs K1 proves inert. Nothing loads them and they load nothing, so the paths they name
 * can't change behavior (a run's whole-PR range adds R4's dependency-cruiser config, which names the new module folders).
 * `computedPaths`: every complete path the non-moved files' path expressions and path-taking calls name (location-scan.ts
 * part 2): the directories code in the repository can root a consumer at.
 */
export function scanOldPaths(context: CertifyContext, layouts: readonly EmittedLayout[], opaqueLoads: readonly string[], inertAdditions: ReadonlySet<string> = new Set(),
  computedPaths: ReadonlySet<string> = new Set()): { violations: Violation[]; findings: Finding[]; metrics: Record<string, number> } {
  const { head, pathMap, views } = context;
  const violations: Violation[] = [];
  const findings: Finding[] = [];
  const metrics = { textFilesScanned: 0, oldPathViolations: 0, coverageViolations: 0, coverageFindings: 0, oldPathFindings: 0, globsChecked: 0, pluginSuffixViolations: 0 };
  if (pathMap.moves.size === 0) return { violations, findings, metrics };
  const { needles, emptied } = buildNeedles(context, layouts);
  const interesting = new Set<string>();
  for (const key of [...needles.keys(), ...emptied.keys()]) interesting.add(path.posix.basename(key));
  const moves = [...pathMap.moves];
  const globResults = new Map<string, [string, string][]>();
  const globChanges = (pattern: string) => {
    let changed = globResults.get(pattern);
    if (!changed) {
      metrics.globsChecked++;
      const regex = globToRegExp(pattern);
      changed = moves.filter(([from, to]) => regex.test(from) !== regex.test(to));
      globResults.set(pattern, changed);
    }
    return changed;
  };
  const orders = new Map<string, Needle | null>();
  const globOrder = (pattern: string) => {
    if (!orders.has(pattern)) {
      const regex = globToRegExp(pattern);
      const detail = globOrderChange(regex, context);
      const [from, to] = moves.find(([source]) => regex.test(source)) ?? ['', ''];
      orders.set(pattern, detail ? { from, to, form: `glob ${pattern} whose matches keep their set but not their order (${detail})` } : null);
    }
    return orders.get(pattern)!;
  };
  const emptiedAncestor = (candidate: string) => {
    for (let directory = candidate; directory && directory !== '.' && directory !== '/'; directory = path.posix.dirname(directory)) {
      const needle = emptied.get(directory);
      if (needle) return needle;
    }
    return undefined;
  };
  // A directory named in config means everything below it (`files: ["dist/handlers"]`, `COPY src/lib`, `include`): a
  // move into or out of it changes what the consumer gets, even when the directory keeps other files.
  const crossed = new Map<string, [string, string]>();
  for (const [from, to] of moves) {
    const fromAncestors = ancestors(from);
    const toAncestors = ancestors(to);
    for (const directory of [...fromAncestors.filter((ancestor) => !toAncestors.includes(ancestor)), ...toAncestors.filter((ancestor) => !fromAncestors.includes(ancestor))]) {
      if (directory && directory !== context.options.packageRoot && !crossed.has(directory)) crossed.set(directory, [from, to]);
    }
  }
  const crossedDirectory = (candidate: string): Needle | undefined => {
    const sources = [candidate, ...layouts.filter((layout) => under(layout.outDir, candidate) && candidate !== layout.outDir)
      .map((layout) => path.posix.join(layout.rootDir, relativeTo(layout.outDir, candidate)))];
    for (const directory of sources) {
      const crossing = crossed.get(directory);
      if (crossing) return { from: crossing[0], to: crossing[1], form: `directory ${directory}${directory === candidate ? '' : ` (as ${candidate})`}, whose contents change with the move` };
    }
    return undefined;
  };
  for (const directory of crossed.keys()) interesting.add(path.posix.basename(directory));
  // Every path a move touched: its old and new path and the directories above them.
  const touchedPaths = new Set(moves.flat().flatMap((file) => [file, ...ancestors(file).filter(Boolean)]));
  const namesBasePath = (candidate: string) => context.base.entries.has(candidate) || context.base.directories.has(candidate)
    || ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'].some((extension) => context.base.entries.has(candidate + extension));

  // Jest's regex path settings match whole paths: a move that changes a match is a hit at the setting.
  const runner = loadRunnerConfig(context.fs.head);
  const jestRoots = new Map(runner.jest.map((jest) => [jest.config, jest.rootDir]));
  const regexHits = new Map<string, Hit[]>();
  for (const jest of runner.jest) {
    const text = head.text(jest.config) ?? '';
    for (const { key, source, pattern } of jest.pathPatterns) {
      const changed = moves.filter(([from, to]) => pattern.test(`/${from}`) !== pattern.test(`/${to}`));
      if (changed.length === 0) continue;
      const [from, to] = changed[0]!;
      const offset = Math.max(0, text.search(new RegExp(`["']?\\b${key}["']?\\s*:`)));
      regexHits.set(jest.config, [...(regexHits.get(jest.config) ?? []), { file: jest.config, offset, token: source, needle: { from, to, form: `regex /${source}/ in ${key}, whose match changes (${changed.length} moved files, e.g. ${from} -> ${to})` } }]);
    }
  }
  const gateOf = coverageGates(context.fs.head);
  const needleOf = (candidate: string): Needle | undefined => {
    const exact = needles.get(candidate);
    if (exact) return exact[0]!;
    const directory = emptiedAncestor(candidate);
    if (directory && (candidate === directory.from || emptied.get(candidate))) return directory;
    if (directory) return { ...directory, form: `path inside a ${directory.form} (${directory.from})`, inside: true };
    return crossedDirectory(candidate);
  };
  /** What a glob token anchored at `base` reaches that the move changed: its match set, its match order, an emptied directory. */
  const globNeedle = (base: string, pattern: string, codeFile: boolean): Needle | undefined => {
    const anchored = path.posix.normalize(path.posix.join(base, pattern));
    if (anchored.startsWith('..') || anchored.startsWith('/')) return undefined;
    const changed = globChanges(anchored);
    const staticPart = anchored.slice(0, anchored.search(globCharacters));
    const inEmptied = emptiedAncestor(path.posix.dirname(`${staticPart}x`));
    if (changed.length) {
      const [from, to] = changed[0]!;
      return { from, to, form: `glob ${anchored} whose matches change (${changed.length} moved files, e.g. ${from} -> ${to})` };
    }
    // In code a glob feeds a loader (routing-controllers `controllers`, entity lists) that registers in match order;
    // only a glob that names its directory (`dist/controllers/**/*.js`, not `**/*.ts`) is anchored well enough.
    const reordered = codeFile && /[^/.]\//.test(pattern.slice(0, pattern.search(globCharacters))) ? globOrder(anchored) : null;
    if (reordered) return reordered;
    if (inEmptied) return { ...inEmptied, form: `glob ${anchored} inside a ${inEmptied.form}`, inside: true };
    return undefined;
  };

  const files = headTextFiles(context).filter((file) => !inertAdditions.has(file));
  head.prefetch(files);
  for (const file of files) {
    const traceStart = performance.now();
    if (process.env.AC_K4_TRACE) process.stderr.write(`> ${file}\n`);
    const bytes = head.bytes(file);
    if (!bytes || bytes.subarray(0, 8000).includes(0) || !isUtf8(bytes)) continue;
    metrics.textFilesScanned++;
    const text = bytes.toString('utf8');
    const documentation = isDocumentation(file);
    const fileCategory = category(file);
    const codeFile = fileCategory === 'code';
    const bases = [...new Set([...ancestors(file), context.options.packageRoot])];
    const hits: Hit[] = [...(regexHits.get(file) ?? [])];
    for (const match of text.matchAll(tokenPattern)) {
      const token = match[0].replace(/[.]+$/, '');
      if (token.length < 3) continue;
      // `<rootDir>/x` names x under the Jest rootDir of the config (its own directory, unless it sets one).
      const rootDirectory = token.startsWith('/') && text.slice(match.index! - '<rootDir>'.length, match.index!) === '<rootDir>' ? (jestRoots.get(file) ?? path.posix.dirname(file).replace(/^\.$/, '')) : null;
      if (globCharacters.test(token)) {
        if (documentation || ignoreFiles.has(path.posix.basename(file)) || !token.includes('/') || token.startsWith('//') || !/[A-Za-z0-9]/.test(token.replace(/\{[^}]*\}|\[[^\]]*\]/g, ''))) continue;
        const pattern = token.replace(/^!/, '').replace(/^\.?\//, '');
        for (const base of rootDirectory !== null ? [rootDirectory] : bases) {
          const needle = globNeedle(base, pattern, codeFile);
          if (needle) {
            hits.push({ file, offset: match.index!, token, glob: true, ...(rootDirectory === null ? { base } : {}), needle });
            break;
          }
        }
        continue;
      }
      // A bare `user.name` in code is a property access; a handler without a directory only counts in infra files.
      const module = handlerModule(token, token.includes('/') || fileCategory === 'infra');
      const segments = (module ? `${token}/${module}` : token).split('/');
      if (!segments.some((segment) => interesting.has(segment))) continue;
      const candidates = rootDirectory !== null ? [path.posix.normalize(path.posix.join(rootDirectory, token.slice(1))).replace(/\/+$/, '')].filter((joined) => !joined.startsWith('..') && joined !== '.')
        : readings(token, bases, context.options.packageRoot);
      let needle = candidates.map(needleOf).find((found) => found !== undefined);
      // `dist/handlers/create.handler` names dist/handlers/create(.js), unless the whole token names a base file.
      if (!needle && module && !candidates.some(namesBasePath)) {
        needle = [...readings(module, bases, context.options.packageRoot), ...readings(`${module}.js`, bases, context.options.packageRoot)]
          .map((candidate) => needles.get(candidate)?.[0]).find((found) => found !== undefined);
        if (needle) needle = { ...needle, form: `${needle.form}, as a handler reference` };
      }
      if (needle) hits.push({ file, offset: match.index!, token, needle });
    }
    if (hits.length === 0) continue;
    const sites = views.head(file)?.sites ?? [];
    let syntax: ReturnType<typeof syntaxOf> | undefined;
    const lines = text.split('\n');
    const lineStarts: number[] = [0];
    for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) lineStarts.push(index + 1);
    const lineIndexOf = (offset: number) => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (lineStarts[middle]! <= offset) low = middle;
        else high = middle - 1;
      }
      return low;
    };
    const markers = commentMarkers(file);
    /**
     * A would-be violation looked at again with what the file's syntax proves: a finding when the token names nothing
     * the move changed (a type, a string only non-path consumers take, an absolute path in code, a path built from
     * the file's location that evaluates elsewhere, a Nix input's directory); the evaluated path when that is what
     * names the change; null when the token readings stand.
     */
    const judge = (hit: Hit, keys: readonly string[]): { finding: string; reason: string } | { names: string } | null => {
      const foreign = foreignInputDirectory(file, text, keys);
      if (foreign) return { finding: 'non-path-string', reason: `it is ${foreign}` };
      const use = syntax?.use(hit.offset) ?? { kind: 'open' };
      if (use.kind === 'type') return { finding: 'old-path-in-type', reason: 'a string in a type, erased at emit' };
      if (use.kind === 'consumed') return { finding: 'non-path-string', reason: `the string goes only to ${use.consumer}` };
      if (use.kind === 'path-expression') {
        const located = use.values.flatMap((value) => locate(value, []));
        if (located.length && located.every((location) => location.complete && !globCharacters.test(location.path))) {
          const reached = located.map((location) => ({ path: location.path, needle: needleOf(location.path) })).find((candidate) => candidate.needle);
          if (!reached) return { finding: 'resolved-path-string', reason: `a segment of ${use.expression}, which names ${located.map((location) => location.path || '.').join(', ')}: nothing the move changed` };
          return { names: `is a segment of ${use.expression}, which names ${reached.path}: the ${reached.needle!.form} of ${reached.needle!.from} (moved to ${reached.needle!.to})` };
        }
      }
      // In code an absolute glob (a route, a URL path, a container path) is rooted at '/': as a repository path it can
      // only be the repository or the package mounted there, the same readings an absolute path gets.
      if (codeFile && hit.glob && hit.base !== undefined && /^!?\/[^/]/.test(hit.token) && hit.base !== '' && hit.base !== context.options.packageRoot
        && !(syntax?.followsSubstitution(hit.offset) ?? true)) {
        const pattern = hit.token.replace(/^!/, '').replace(/^\.?\//, '');
        const mounted = ['', context.options.packageRoot].map((base) => globNeedle(base, pattern, codeFile)).find((needle) => needle !== undefined);
        if (!mounted) return { finding: 'absolute-path-string', reason: `an absolute path in code: read at the repository or package root it reaches nothing the move changed (only its reading at ${hit.base} does)` };
        return { names: `is the ${mounted.form} of ${mounted.from} (moved to ${mounted.to})` };
      }
      return unreachableBelowEmptied(hit);
    };
    /**
     * A string in code that only names something below a directory the move emptied, and only when read at the file's
     * own directory or one between it and the package. A process resolves a relative path against its cwd (the
     * repository root, the package root, the runner cwd, the nearest package.json directory) or, with a location token,
     * against its own file (part 2 judges that file's computed paths); reading this string at those other directories
     * is a consumer configured with one of them as its root. Through such a reading the string can reach no file or
     * directory the move touched: the path exists on neither side and no moved file is at or below it (with
     * substitutions: no touched path ends the way the template ends). Reading or listing it behaves the same; only the
     * emptied directory around it is gone, which a consumer that creates files there would notice: a finding.
     */
    const unreachableBelowEmptied = (hit: Hit): { finding: string; reason: string } | { names: string } | null => {
      if (!codeFile || !hit.needle.inside || /^\.\.?\//.test(hit.token) || hit.token.startsWith('/') || hit.base === undefined && hit.glob) return null;
      const value = syntax?.stringValue(hit.offset);
      // A glob character in a plain string is a glob (it can match a moved file's directory); in a template it is `${…}`.
      if (!value || (value.literal && hit.glob) || syntax?.followsSubstitution(hit.offset)) return null;
      const cwd = cwdBases(context, file, head);
      const pattern = hit.token.replace(/^!/, '').replace(/^\.?\//, '');
      const readAt = (base: string) => (hit.glob ? globNeedle(base, pattern, codeFile)
        : hit.token.includes('/') || base === bases[0] ? needleOf(path.posix.normalize(path.posix.join(base, hit.token)).replace(/\/+$/, '')) : undefined);
      const atCwd = cwd.map(readAt).find((needle) => needle !== undefined);
      if (atCwd) return { names: `is the ${atCwd.form} of ${atCwd.from} (moved to ${atCwd.to})` };
      const others = bases.filter((base) => !cwd.includes(base)).map((base) => ({ base, needle: readAt(base) })).filter((reading) => reading.needle !== undefined);
      // A directory the repository's own code computes (`join(__dirname, '..')`) is a root some consumer is given.
      if (others.length === 0 || others.some((reading) => !reading.needle!.inside || computedPaths.has(reading.base))) return null;
      if (value.literal) {
        const paths = others.map((reading) => path.posix.normalize(path.posix.join(reading.base, hit.token)).replace(/\/+$/, ''));
        if (paths.some((candidate) => touchedPaths.has(candidate))) return null;
      } else {
        const tail = value.tail.replace(/\/+$/, '').replace(/\/\.(?=\/|$)/g, '').replace(/\/{2,}/g, '/');
        if (!tail || tail === '/' || tail.split('/').includes('..')) return null;
        if ([...touchedPaths].some((candidate) => (tail.startsWith('/') ? `/${candidate}`.endsWith(tail) : candidate.endsWith(tail)))) return null;
      }
      const emptiedDirectory = hit.needle.from;
      return {
        finding: 'unreachable-path-string',
        reason: `read at ${cwd.map((base) => base || '.').join(', ')} (where a process runs) it reaches nothing the move changed; read at ${others.map((reading) => reading.base || '.').join(', ')} `
          + `it names no file or directory the move touched${value.literal ? '' : ', whatever its substitutions hold'}; only ${emptiedDirectory} around it is gone, which matters only to a consumer rooted there that creates files in it`,
      };
    };
    for (const hit of hits) {
      if (sites.some((site) => hit.offset < site.end && hit.offset + hit.token.length > site.start)) continue;
      const lineIndex = lineIndexOf(hit.offset);
      const line = lines[lineIndex] ?? '';
      const where = `line ${lineIndex + 1}: '${hit.token}' is the ${hit.needle.form} of ${hit.needle.from} (moved to ${hit.needle.to})`;
      if (documentation) {
        findings.push({ kind: 'old-path-in-docs', file, detail: where });
        continue;
      }
      if (ignoreFiles.has(path.posix.basename(file))) {
        findings.push({ kind: 'old-path-in-ignore-file', file, detail: `${where}; K1 checks the moved files' ignore status` });
        continue;
      }
      syntax ??= syntaxOf(file, text);
      const pragma = /@(jest|vitest)-environment\b/.test(line);
      const comment = !pragma && (syntax ? syntax.inComment(hit.offset) : markers !== null && markers.test(line));
      if (comment) {
        findings.push({ kind: 'old-path-in-comment', file, detail: where });
        continue;
      }
      const keys = syntax ? syntax.keys(hit.offset) : /\.ya?ml$/.test(file) ? yamlKeys(lines, lineIndex) : [];
      if (hit.glob && keys.some((key) => substitutionKeys.has(key))) continue;
      const relativeInCode = codeFile && /^\.\.?\//.test(hit.token);
      if (relativeInCode && opaqueLoads.length === 0) {
        // A './x' string in code means whatever its consumer resolves it against; consumers in this file are part 2's,
        // and with no opaque module load in the repository, nothing else can take it as a module path.
        findings.push({ kind: 'relative-path-string', file, detail: `${where}; not consumed as a path in this file, and no load in the repository takes an opaque path` });
        continue;
      }
      const coverage = isCoverageSetting(file, keys);
      const gate = coverage ? gateOf(file) : null;
      const at = `[${fileCategory}${keys.length ? ` at ${keys.join('.')}` : ''}]`;
      // Coverage scope is only behavior when it gates something: a coverage report that measures other files changes
      // no test outcome and no runtime; a threshold or check-coverage can flip a CI gate.
      if (coverage && gate === null) {
        metrics.coverageFindings++;
        findings.push({ kind: 'coverage-scope', file, detail: `${where} ${at}; coverage now measures a different file set (no coverage threshold in this file, so no gate changes)` });
        continue;
      }
      const judged = judge(hit, keys);
      if (judged && 'finding' in judged) {
        findings.push({ kind: judged.finding, file, detail: `${where} ${at}; ${judged.reason}` });
        continue;
      }
      if (coverage) metrics.coverageViolations++;
      metrics.oldPathViolations++;
      const opaque = relativeInCode ? `; the opaque load at ${opaqueLoads[0]} can take it as a module path` : '';
      const named = judged ? `line ${lineIndex + 1}: '${hit.token}' ${judged.names}` : where;
      violations.push({ file, detail: `${named} ${at}${coverage ? `; a coverage setting with a threshold (${gate}): the CI gate measures a different file set` : ''}${opaque}` });
    }
  }
  for (const plugin of nestPlugins(context.fs.head)) {
    for (const [from, to] of moves) {
      const change = pluginChange(plugin, from, to);
      if (!change) continue;
      metrics.pluginSuffixViolations++;
      violations.push({ file: to, detail: `${path.posix.basename(from) === path.posix.basename(to) ? 'moved' : 'renamed'} from ${from}: ${describePluginChange(plugin, change)}` });
    }
  }
  metrics.oldPathFindings = findings.length;
  return { violations, findings, metrics };
}

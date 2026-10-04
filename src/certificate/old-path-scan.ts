// K4 part 3 (plan §3.4; research 04b A26–A28, M21): no tracked text file of head still names a moved file by its
// old path. Needles per move f → g: f with and without its extension, its specifier spelling (.ts → .js), its
// directory if f is an index file, its emitted path under every tsconfig outDir that compiles it, and every
// directory the move emptied (plus its emitted mirror). A path-like token is compared after anchoring it at the
// file's directory, each ancestor of it, and the package root, so `src/services/x.ts` in server/package.json and
// `../src/services/x.ts` in server/test/ both hit. Glob tokens in code and config are matched instead: a glob
// whose match set over the moved files changes is a hit. Hits inside K2 specifier spans are K3's business.
// Documentation files and comments only produce findings.
import path from 'node:path';
import ts from 'typescript';
import { loadScopes } from '../analyzer/tsconfig-scopes.js';
import { scriptKindOf } from '../analyzer/reference-sites.js';
import { isUtf8 } from './git-tree.js';
import { isScannedSource } from './spans.js';
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
const coverageFiles = /^(\.nycrc(\.(json|ya?ml))?|\.c8rc(\.json)?|\.?codecov\.ya?ml)$/;
const coverageKey = /coverage/i;
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

function category(file: string): string {
  const base = path.posix.basename(file).toLowerCase();
  if (file.startsWith('.github/') || file.startsWith('.gitlab') || file.startsWith('.circleci/') || base === '.gitlab-ci.yml' || base === 'azure-pipelines.yml'
    || base === 'jenkinsfile' || file.startsWith('.buildkite/') || base === 'codeowners') return 'CI';
  if (/^(dockerfile|containerfile|procfile)/.test(base) || /compose.*\.ya?ml$/.test(base) || /^(serverless|app|fly|render|vercel|netlify|now)\.(ya?ml|json|toml)$/.test(base)
    || base.endsWith('.tf') || /^ecosystem\.config\./.test(base) || /^nodemon\.json$/.test(base) || file.split('/').some((segment) => ['k8s', 'kubernetes', 'helm', 'charts', 'deploy', 'infra'].includes(segment))) return 'infra';
  if (isScannedSource(file, '') && !/(^|\/)[^/]*\.config\.[cm]?[jt]s$|(^|\/)\.[^/]*rc\.[cm]?js$/.test(file)) return 'code';
  return 'config';
}

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
      if (close === -1) source += '\\[';
      else {
        source += `[${pattern.slice(index + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
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

/** Every (outDir, rootDir) of the base's tsconfig programs: rootDir when set, else TS 6's and TS 5's defaults. */
export function emittedLayouts(context: CertifyContext): EmittedLayout[] {
  const repo = context.fs.base;
  const relative = (absolute: string) => path.relative(repo.root, absolute).split(path.sep).join('/');
  const layouts = new Map<string, EmittedLayout>();
  for (const [config, program] of loadScopes(repo).programs) {
    if (!program.options.outDir) continue;
    const outDir = relative(program.options.outDir);
    if (outDir.startsWith('..')) continue;
    const roots = program.options.rootDir ? [relative(program.options.rootDir)] : [path.posix.dirname(config).replace(/^\.$/, ''), commonSourceDirectory(program.files)];
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
}

const under = (directory: string, file: string) => directory === '' || file.startsWith(`${directory}/`);
const relativeTo = (directory: string, file: string) => (directory === '' ? file : file.slice(directory.length + 1));

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

/** Comment ranges and enclosing property names of a JS/TS/JSON file, computed when a hit needs them. */
function syntaxOf(file: string, text: string): { inComment(offset: number): boolean; keys(offset: number): string[] } | null {
  const json = /\.(json|jsonc|json5)$/.test(file) || /(^|\/)tsconfig[^/]*\.json$/.test(file);
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
  return {
    inComment(offset) {
      const chain = leaf(offset);
      const node = chain[chain.length - 1]!;
      return offset < node.getStart(sourceFile, false) || (node.kind === ts.SyntaxKind.EndOfFileToken);
    },
    keys(offset) {
      return leaf(offset).filter(ts.isPropertyAssignment).map((property) => (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : property.name.getText(sourceFile)));
    },
  };
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
}

/**
 * Whether a config gates on coverage: Jest `coverageThreshold` / Vitest `coverage.thresholds` with a nonzero number,
 * or nyc/c8 `check-coverage`. Text-level, and it errs toward "gated" (any nonzero number inside the threshold object).
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
    const body = text.slice(match.index + match[0].length, end);
    if (/(?<![\w.])(?:[1-9]\d*(?:\.\d+)?|0?\.\d*[1-9]\d*)(?![\w.])/.test(body.replace(/["'][^"']*["']\s*:/g, ':')) || /\b100\s*:\s*true/.test(body)) return true;
  }
  return false;
}

export function scanOldPaths(context: CertifyContext, layouts: readonly EmittedLayout[]): { violations: Violation[]; findings: Finding[]; metrics: Record<string, number> } {
  const { head, pathMap, views } = context;
  const violations: Violation[] = [];
  const findings: Finding[] = [];
  const metrics = { textFilesScanned: 0, oldPathViolations: 0, coverageViolations: 0, coverageFindings: 0, oldPathFindings: 0, globsChecked: 0 };
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
  const emptiedAncestor = (candidate: string) => {
    for (let directory = candidate; directory && directory !== '.' && directory !== '/'; directory = path.posix.dirname(directory)) {
      const needle = emptied.get(directory);
      if (needle) return needle;
    }
    return undefined;
  };

  const files = [...head.entries.values()].filter((entry) => entry.mode !== '160000' && entry.mode !== '120000' && !entry.path.split('/').includes('node_modules')
    && !binaryExtensions.has(path.posix.extname(entry.path).slice(1).toLowerCase())).map((entry) => entry.path);
  head.prefetch(files);
  for (const file of files) {
    const traceStart = performance.now();
    if (process.env.AC_K4_TRACE) process.stderr.write(`> ${file}\n`);
    const bytes = head.bytes(file);
    if (!bytes || bytes.subarray(0, 8000).includes(0) || !isUtf8(bytes)) continue;
    metrics.textFilesScanned++;
    const text = bytes.toString('utf8');
    const documentation = isDocumentation(file);
    const bases = [...new Set([...ancestors(file), context.options.packageRoot])];
    const hits: Hit[] = [];
    for (const match of text.matchAll(tokenPattern)) {
      const token = match[0].replace(/[.]+$/, '');
      if (token.length < 3) continue;
      if (globCharacters.test(token)) {
        if (documentation || ignoreFiles.has(path.posix.basename(file)) || !token.includes('/') || token.startsWith('//') || !/[A-Za-z0-9]/.test(token.replace(/\{[^}]*\}|\[[^\]]*\]/g, ''))) continue;
        const pattern = token.replace(/^!/, '').replace(/^\.?\//, '');
        for (const base of bases) {
          const anchored = path.posix.normalize(path.posix.join(base, pattern));
          if (anchored.startsWith('..') || anchored.startsWith('/')) continue;
          const changed = globChanges(anchored);
          const staticPart = anchored.slice(0, anchored.search(globCharacters));
          const inEmptied = emptiedAncestor(path.posix.dirname(`${staticPart}x`));
          if (changed.length) {
            const [from, to] = changed[0]!;
            hits.push({ file, offset: match.index!, token, glob: true, needle: { from, to, form: `glob ${anchored} whose matches change (${changed.length} moved files, e.g. ${from} -> ${to})` } });
            break;
          }
          if (inEmptied) {
            hits.push({ file, offset: match.index!, token, glob: true, needle: { ...inEmptied, form: `glob ${anchored} inside a ${inEmptied.form}` } });
            break;
          }
        }
        continue;
      }
      if (!token.split('/').some((segment) => interesting.has(segment))) continue;
      for (const candidate of readings(token, bases, context.options.packageRoot)) {
        const exact = needles.get(candidate);
        const directory = exact ? undefined : emptiedAncestor(candidate);
        if (exact) hits.push({ file, offset: match.index!, token, needle: exact[0]! });
        else if (directory) hits.push({ file, offset: match.index!, token, needle: { ...directory, form: candidate === directory.from || emptied.get(candidate) ? directory.form : `path inside a ${directory.form} (${directory.from})` } });
        else continue;
        break;
      }
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
      if (category(file) === 'code' && /^\.\.?\//.test(hit.token)) {
        // A './x' string in code means whatever its consumer resolves it against; consumers in this file are part 2's.
        findings.push({ kind: 'relative-path-string', file, detail: `${where}; not consumed as a path in this file` });
        continue;
      }
      const coverage = coverageFiles.test(path.posix.basename(file)) || keys.some((key) => coverageKey.test(key));
      const at = `[${category(file)}${keys.length ? ` at ${keys.join('.')}` : ''}]`;
      // Coverage scope is only behavior when it gates something: a coverage report that measures other files changes
      // no test outcome and no runtime; a threshold or check-coverage can flip a CI gate.
      if (coverage && !coverageGated(text)) {
        metrics.coverageFindings++;
        findings.push({ kind: 'coverage-scope', file, detail: `${where} ${at}; coverage now measures a different file set (no coverage threshold in this file, so no gate changes)` });
        continue;
      }
      if (coverage) metrics.coverageViolations++;
      metrics.oldPathViolations++;
      violations.push({ file, detail: `${where} ${at}${coverage ? '; a coverage setting with a threshold: the CI gate measures a different file set' : ''}` });
    }
  }
  metrics.oldPathFindings = findings.length;
  return { violations, findings, metrics };
}

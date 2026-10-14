// Coverage settings and the gates on them: one rule for the executor's config references and the certifier's K4. A
// coverage setting only changes behavior when a gate measures it, so an ungated one is a finding and a gated one a
// decline or violation. What is a coverage setting is decided by the key that holds the value (Vitest `test.coverage`,
// Jest's coverage keys, package.json `nyc` / `c8`, whole nyc/c8/codecov files), never by a script or CI job's name:
// `"test:coverage": "vitest run src/x"` selects tests. A gate is whatever can fail CI on coverage: a threshold that isn't
// literally zero, check-coverage, a CLI threshold flag in the package's scripts or in CI, or one in a config the setting's
// config draws from (an import, a spread, mergeConfig, a Jest preset, an nyc/c8 extends) or in a runner config above it
// (a multi-project root). What can't be read gates.
import fs from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { type RepoFs, toAbsolute } from './repo-fs.js';

const coverageFile = /(^|\/)(\.nycrc(\.(json|ya?ml))?|\.c8rc(\.json)?|\.?codecov\.ya?ml)$/;
const jestCoverageKeys = new Set(['collectCoverageFrom', 'coveragePathIgnorePatterns', 'coverageThreshold']);
// Files that run commands: a coverage flag in one gates the coverage of its package (CI: the whole repository).
const commandFile = /(^|\/)(package\.json|[Mm]akefile|GNUmakefile|[Jj]ustfile|\.?mise\.toml|Taskfile\.ya?ml|turbo\.json|[^/]+\.(sh|bash|zsh|mk))$/;
const cliGateFlag = /--coverage\.thresholds\b|--coverage-?thresholds?\b|(?<![\w-])(--)?check-?coverage\b|--100\b/i;
const moduleExtensions = ['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts', '.json'];
// Runner and coverage configs: one in a directory above a coverage setting (a multi-project root) can gate it too.
const runnerConfig = /(^|\/)(package\.json|jest([.-][^/]*)?\.config([.-][^/]*)?\.[cm]?[jt]s|jest([.-][^/]*)?\.json|(vitest|vite)([.-][^/]*)?\.(config|workspace)([.-][^/]*)?\.[cm]?[jt]s|\.nycrc(\.(json|ya?ml))?|\.c8rc(\.json)?)$/;

const directoryOf = (file: string) => path.posix.dirname(file).replace(/^\.$/, '');
const under = (directory: string, file: string) => directory === '' || file.startsWith(`${directory}/`);
const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length;

/** CI definitions: they run commands for the whole repository. */
export const isCiFile = (file: string) => /^\.(github|gitlab|circleci|buildkite)\//.test(file)
  || /(^|\/)(\.gitlab-ci\.ya?ml|azure-pipelines\.ya?ml|bitbucket-pipelines\.ya?ml|\.travis\.ya?ml|Jenkinsfile)$/.test(file);

/** Whether a value at `keys` (enclosing property names, outermost first) in `file` is a coverage setting. */
export function isCoverageSetting(file: string, keys: readonly string[]): boolean {
  if (coverageFile.test(file)) return true;
  if (isCiFile(file)) return false;
  if (/(^|\/)package\.json$/.test(file)) return keys[0] === 'nyc' || keys[0] === 'c8' || (keys[0] === 'jest' && keys.some((key) => jestCoverageKeys.has(key)));
  return keys.some((key, index) => jestCoverageKeys.has(key) || (key === 'coverage' && keys[index - 1] === 'test'));
}

/**
 * Whether a config's own text gates coverage: check-coverage, `100: true`, or a `coverageThreshold` / `thresholds`
 * whose values aren't all literal zeros (a const, a spread or a call can hold any number).
 */
export function coverageGated(text: string): boolean {
  if (/["']?check-?coverage["']?\s*[:=]\s*true/i.test(text) || /["']?\b100["']?\s*:\s*true\b/.test(text)) return true;
  for (const match of text.matchAll(/["']?\b(coverageThreshold|thresholds)["']?\s*:\s*/g)) {
    const start = match.index + match[0].length;
    if (text[start] !== '{') {
      if (!/^(undefined|null|false|0)\b/.test(text.slice(start))) return true;
      continue;
    }
    let depth = 0;
    let end = start;
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++;
      else if (text[end] === '}' && --depth === 0) break;
    }
    const values = text.slice(start + 1, end)
      .replace(/["']?\b(perFile|autoUpdate)["']?\s*:\s*(true|false)\b/g, ' ')
      .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1\s*:/g, ' ')
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ')
      .replace(/[\w$]+\s*:/g, ' ')
      .split(/[\s{},]+/);
    if (values.some((value) => value !== '' && !/^(-?0+(\.0+)?|false)$/.test(value))) return true;
  }
  return false;
}

/** Text of a repo file, or of an installed one (node_modules is read from disk, through the environment's links). */
function readFile(repo: RepoFs, file: string): string | undefined {
  const text = repo.read(file);
  if (text !== undefined || !file.split('/').includes('node_modules') || !repo.fileExists(toAbsolute(repo, file))) return text;
  try {
    return fs.readFileSync(toAbsolute(repo, file), 'utf8');
  } catch {
    return undefined;
  }
}

interface ConfigSource {
  specifier: string;
  /** preset: a Jest preset (`<it>/jest-preset.*`); config: settings merged in; import: a relative import of the file. */
  kind: 'preset' | 'config' | 'import';
}

/** The file a config source resolves to: a relative path, or a package in the nearest node_modules (a preset, an export, its main). */
function resolveSource(repo: RepoFs, from: string, { specifier, kind }: ConfigSource): string | null {
  const presets = moduleExtensions.map((extension) => `/jest-preset${extension}`);
  const candidates = (base: string) => (kind === 'preset' ? [...presets.map((preset) => base + preset), base]
    : [base, ...moduleExtensions.map((extension) => base + extension), ...moduleExtensions.map((extension) => `${base}/index${extension}`)]);
  const first = (bases: string[]) => bases.flatMap(candidates).find((candidate) => readFile(repo, candidate) !== undefined) ?? null;
  if (/^\.\.?(\/|$)/.test(specifier)) {
    const base = path.posix.normalize(path.posix.join(directoryOf(from), specifier));
    return base.startsWith('..') ? null : first([base]);
  }
  if (specifier.startsWith('/')) return null;
  // Node's lookup: the nearest node_modules holding the package, then its exports map, main, or the file itself.
  const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
  const subpath = `.${specifier.slice(name.length)}`;
  for (let directory = directoryOf(from); ; directory = directoryOf(directory)) {
    const root = path.posix.join(directory, 'node_modules', name);
    const manifestText = readFile(repo, `${root}/package.json`);
    if (manifestText !== undefined) {
      const manifest = parseManifest(manifestText);
      const entry = kind === 'preset' ? `${subpath === '.' ? '.' : subpath}/jest-preset` : subpath;
      const exported = exportTarget(manifest?.exports, entry);
      const main = entry === '.' && typeof manifest?.main === 'string' ? [path.posix.join(root, manifest.main)] : [];
      return first([...(exported ? [path.posix.join(root, exported)] : []), ...main, path.posix.join(root, subpath)]);
    }
    if (directory === '') return null;
  }
}

/** A package.json's entry fields; an unparseable one leaves the conventional entry points. */
function parseManifest(text: string): { main?: unknown; exports?: unknown } | null {
  try {
    return JSON.parse(text) as { main?: unknown; exports?: unknown } | null;
  } catch {
    return null;
  }
}

/** The file a package's `exports` map gives for a subpath (`.`, `./preset`), under the require/node/default conditions. */
function exportTarget(exports: unknown, subpath: string): string | null {
  const conditional = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(conditional).find((target) => target !== null) ?? null;
    if (value && typeof value === 'object') {
      for (const condition of ['require', 'node', 'default']) if (condition in value) return conditional((value as Record<string, unknown>)[condition]);
    }
    return null;
  };
  if (typeof exports === 'string' || Array.isArray(exports)) return subpath === '.' ? conditional(exports) : null;
  if (!exports || typeof exports !== 'object') return null;
  const map = exports as Record<string, unknown>;
  if (!Object.keys(map).some((key) => key.startsWith('.'))) return subpath === '.' ? conditional(map) : null;
  if (subpath in map) return conditional(map[subpath]);
  for (const [key, value] of Object.entries(map)) {
    const star = key.indexOf('*');
    if (star !== -1 && subpath.startsWith(key.slice(0, star)) && subpath.endsWith(key.slice(star + 1))) {
      return conditional(value)?.replace('*', subpath.slice(star, subpath.length - (key.length - star - 1))) ?? null;
    }
  }
  return null;
}

/** Where a config draws settings from: a Jest preset, an nyc/c8/Vitest extends, spread or merged imports, relative imports. */
function configSources(file: string, text: string): ConfigSource[] {
  const sources = new Map<string, ConfigSource>();
  const add = (specifier: string, kind: ConfigSource['kind']) => {
    if (!isBuiltin(specifier) && !sources.has(specifier)) sources.set(specifier, { specifier, kind });
  };
  if (/(^|\/)package\.json$/.test(file)) {
    try {
      const json = JSON.parse(text) as Record<string, { preset?: unknown; extends?: unknown } | undefined>;
      if (typeof json.jest?.preset === 'string') add(json.jest.preset, 'preset');
      for (const value of [json.nyc?.extends, json.c8?.extends].flat()) if (typeof value === 'string') add(value, 'config');
    } catch {
      // Unparseable: the runner config reader reports it.
    }
    return [...sources.values()];
  }
  for (const match of text.matchAll(/["']?\b(preset|extends)["']?\s*:\s*(['"])([^'"\n]+)\2/g)) add(match[3]!, match[1] === 'preset' ? 'preset' : 'config');
  for (const match of text.matchAll(/\.\.\.\s*require\s*\(\s*(['"])([^'"\n]+)\1/g)) add(match[2]!, 'config');
  const bindings = new Map<string, string>();
  for (const match of text.matchAll(/\bimport\s+([^'"]*?)\s+from\s*(['"])([^'"\n]+)\2/g)) {
    for (const name of match[1]!.replace(/[{}]|\*\s*as\s+/g, ' ').split(/[\s,]+/).filter((part, index, parts) => part && part !== 'as' && parts[index + 1] !== 'as')) bindings.set(name, match[3]!);
  }
  for (const match of text.matchAll(/\b(?:const|let|var)\s+([^=;]+?)\s*=\s*require\s*\(\s*(['"])([^'"\n]+)\2/g)) {
    for (const name of match[1]!.replace(/[{}]/g, ' ').split(/[\s,:]+/).filter(Boolean)) bindings.set(name, match[3]!);
  }
  for (const match of [...text.matchAll(/\.\.\.\s*([\w$]+)\b(?!\s*[.(\[])/g), ...text.matchAll(/\bmergeConfigs?\s*\(\s*([\w$]+)\b(?!\s*[.(\[])/g)]) {
    const specifier = bindings.get(match[1]!);
    if (specifier) add(specifier, 'config');
  }
  for (const match of text.matchAll(/(?:\bfrom|\brequire\s*\(|\bimport\s*\()\s*(['"])(\.{1,2}\/[^'"\n]+)\1/g)) add(match[2]!, 'import');
  return [...sources.values()];
}

/** Where a gate on a config's coverage settings is (`a threshold in jest.base.js`), or null when nothing can gate them. */
export type CoverageGate = (config: string) => string | null;

export function coverageGates(repo: RepoFs): CoverageGate {
  const tracked = repo.tracked().filter((file) => !file.split('/').includes('node_modules'));
  let flags: { scope: string; where: string }[] | undefined;
  const cliFlags = () => {
    if (flags) return flags;
    const packages = new Set(tracked.filter((file) => /(^|\/)package\.json$/.test(file)).map(directoryOf));
    const packageOf = (directory: string): string => {
      for (let current = directory; current; current = directoryOf(current)) if (packages.has(current)) return current;
      return '';
    };
    flags = [];
    for (const file of tracked.filter((candidate) => isCiFile(candidate) || commandFile.test(candidate))) {
      const text = repo.read(file);
      const match = text === undefined ? null : cliGateFlag.exec(text);
      if (match) flags.push({ scope: isCiFile(file) ? '' : packageOf(directoryOf(file)), where: `'${match[0]}' in ${file} line ${lineOf(text!, match.index)}` });
    }
    return flags;
  };
  const drawnGate = (file: string, seen: Set<string>): string | null => {
    seen.add(file);
    const text = readFile(repo, file);
    if (text === undefined) return `${file}, which can't be read`;
    if (coverageGated(text)) return `a threshold in ${file}`;
    // An installed package's own imports are its code, not configuration.
    const installed = file.split('/').includes('node_modules');
    for (const source of configSources(file, text).filter((candidate) => !installed || candidate.kind !== 'import')) {
      const resolved = resolveSource(repo, file, source);
      if (resolved === null) return `'${source.specifier}' (from ${file}), which can't be read`;
      if (seen.has(resolved)) continue;
      const gate = drawnGate(resolved, seen);
      if (gate) return gate;
    }
    return null;
  };
  const aboveGate = (config: string): string | null => {
    for (const file of tracked) {
      if (!runnerConfig.test(file) || directoryOf(file) === directoryOf(config) || !under(directoryOf(file), directoryOf(config))) continue;
      const text = repo.read(file);
      if (text !== undefined && coverageGated(text)) return `a threshold in ${file}, a runner config over it`;
    }
    return null;
  };
  const gates = new Map<string, string | null>();
  return (config) => {
    if (!gates.has(config)) {
      const flag = cliFlags().find((candidate) => under(candidate.scope, config));
      gates.set(config, drawnGate(config, new Set()) ?? aboveGate(config) ?? (flag ? `a coverage flag, ${flag.where}` : null));
    }
    return gates.get(config)!;
  };
}

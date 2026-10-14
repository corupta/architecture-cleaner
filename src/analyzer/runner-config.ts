// Test-runner resolution settings, read statically from config ASTs (never by executing target code).
// Plan §2.5: a test config that can't be loaded statically is a preflight decline, so anything we can't read
// is reported in `unreadable` instead of guessed. Every config is kept (monorepos have one per package); a file
// is governed by the config in its nearest ancestor directory.
import path from 'node:path';
import ts from 'typescript';
import type { RepoFs } from './repo-fs.js';

export interface JestMapper {
  pattern: RegExp;
  source: string;
  /** Replacement with `<rootDir>` expanded to a repo-relative directory ('' for the repo root). */
  replacement: string;
}

export interface ViteAlias {
  find: string;
  /** Repo-relative replacement directory or file. */
  replacement: string;
}

/** Which files a runner collects as tests (repo-relative): roots, include/exclude globs, exclude regexes. */
export interface TestScope {
  roots: string[];
  include: string[];
  exclude: string[];
  /** Jest testPathIgnorePatterns, matched against '/' + the repo-relative path. */
  excludePatterns: RegExp[];
}

/** A Jest setting whose values are regexes over a file's path (`coveragePathIgnorePatterns`, `transform` keys). */
export interface JestPathPattern {
  key: string;
  source: string;
  /** Matched against '/' + the repo-relative path, with `<rootDir>` expanded. */
  pattern: RegExp;
}

export interface JestConfig {
  config: string;
  /** Repo-relative directory of the config file ('' for the root). */
  directory: string;
  rootDir: string;
  mappers: JestMapper[];
  scope: TestScope;
  /** Regex path settings besides the test scope's: coverage, module and transform ignores, transform keys. */
  pathPatterns: JestPathPattern[];
}

export interface VitestConfig {
  config: string;
  /**
   * Repo-relative directory the config governs: its Vite root (`test.root`, else `root`; immich's
   * server/test/vitest.config.mjs sets it to server/), else the config file's directory. Test globs are relative to it.
   */
  directory: string;
  aliases: ViteAlias[];
  scope: TestScope;
}

export interface RunnerConfig {
  jest: JestConfig[];
  vitest: VitestConfig[];
  unreadable: { config: string; reason: string }[];
}

// jest.config.ts, jest.e2e.config.js, and any jest*.json (Nest's test/jest-e2e.json): files Jest is pointed at with --config.
const jestConfigPattern = /(^|\/)(jest([.-][^/]*)?\.config([.-][^/]*)?\.[cm]?[jt]s|jest([.-][^/]*)?\.json)$/;
// vitest.config.ts, vite.config.mjs, vitest.config.medium.mjs, vitest.e2e.config.ts (a workspace file lists projects instead).
const viteConfigPattern = /(^|\/)(vitest|vite)([.-][^/]*)?\.config([.-][^/]*)?\.[cm]?[jt]s$/;

/** The config whose directory is the nearest ancestor of `file`. */
export function nearestConfig<T extends { directory: string }>(configs: readonly T[], file: string): T | null {
  let best: T | null = null;
  for (const config of configs) {
    const covers = config.directory === '' || file.startsWith(`${config.directory}/`);
    if (covers && (!best || config.directory.length > best.directory.length)) best = config;
  }
  return best;
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function getProperty(object: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === key) return property.initializer;
  }
  return undefined;
}

/**
 * The exported config object: `module.exports = {…}`, `module.exports = exports = {…}`, `export default {…}`,
 * `defineConfig({…})`, or a const they name. Later mutation (`exports.x = …`, `config.x = …`) makes it unreadable.
 * `constants` are the top-level const initializers, for values a config names (`root: serverRoot`).
 */
function exportedObject(sourceFile: ts.SourceFile): { object: ts.ObjectLiteralExpression | null; mutated: boolean; constants: Map<string, ts.Expression> } {
  const constants = new Map<string, ts.Expression>();
  let exported: ts.Expression | undefined;
  const assignedPaths: string[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) constants.set(declaration.name.text, declaration.initializer);
      }
    } else if (ts.isExportAssignment(statement)) {
      exported = statement.expression;
    } else if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
      && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = statement.expression.left.getText(sourceFile);
      if (left === 'module.exports') exported = statement.expression.right;
      else assignedPaths.push(left);
    }
  }
  const unwrap = (expression: ts.Expression | undefined): ts.ObjectLiteralExpression | null => {
    if (!expression) return null;
    if (ts.isParenthesizedExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isAsExpression(expression)) return unwrap(expression.expression);
    if (ts.isObjectLiteralExpression(expression)) return expression;
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) return unwrap(expression.right);
    if (ts.isIdentifier(expression)) return unwrap(constants.get(expression.text));
    if (ts.isCallExpression(expression) && expression.arguments.length === 1) return unwrap(expression.arguments[0]);
    // `export default async () => ({ … })` (Nx roots): the returned object literal.
    if ((ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) && !ts.isBlock(expression.body)) return unwrap(expression.body);
    if (ts.isAwaitExpression(expression)) return unwrap(expression.expression);
    return null;
  };
  // Mutation of the exported object after its declaration (`exports.x = …`, `config.roots = …`). Unrelated
  // assignments such as `process.env.TZ = 'UTC'` don't change the config.
  const exportedName = exported && ts.isIdentifier(exported) ? exported.text : null;
  const mutated = assignedPaths.some((left) => /^(module\.)?exports\./.test(left) || (exportedName !== null && left.startsWith(`${exportedName}.`)));
  return { object: unwrap(exported), mutated, constants };
}

interface PathContext {
  configDirectory: string;
  /** What a relative string literal is relative to: the config's directory (Jest), the likely cwd (Vite's root). */
  relativeTo?: string;
  sourceFile: ts.SourceFile;
  constants: ReadonlyMap<string, ts.Expression>;
}

/**
 * A config path expression as a repo-relative path: a relative string (`'./src'`, `'src'`), `__dirname`, `import.meta.dirname`,
 * `dirname(fileURLToPath(import.meta.url))`, `fileURLToPath(new URL('./src', import.meta.url))`, `path.resolve(<one of
 * these>, '..', 'src')` (or `join`), and a top-level const holding one of them (immich: `root: serverRoot`).
 */
function staticPath(expression: ts.Expression, context: PathContext, seen: ReadonlySet<string> = new Set()): string | null {
  const { configDirectory, sourceFile, constants } = context;
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) return staticPath(expression.expression, context, seen);
  if (ts.isStringLiteralLike(expression)) return expression.text.startsWith('/') ? expression.text : path.posix.join(context.relativeTo ?? configDirectory, expression.text);
  const text = expression.getText(sourceFile);
  if (text === '__dirname' || text === 'import.meta.dirname') return configDirectory;
  if (ts.isIdentifier(expression)) {
    const initializer = constants.get(expression.text);
    return initializer && !seen.has(expression.text) ? staticPath(initializer, context, new Set([...seen, expression.text])) : null;
  }
  if (!ts.isCallExpression(expression)) return null;
  const callee = expression.expression.getText(sourceFile);
  const [first, ...rest] = expression.arguments;
  if (!first) return null;
  if (['path.resolve', 'resolve', 'path.join', 'join'].includes(callee) && !ts.isStringLiteralLike(first) && rest.every(ts.isStringLiteralLike)) {
    const base = staticPath(first, context, seen);
    return base === null ? null : path.posix.join(base, ...rest.map((argument) => (argument as ts.StringLiteralLike).text));
  }
  // The config file's own directory: dirname(fileURLToPath(import.meta.url)), dirname(__filename), dirname(import.meta.filename).
  if ((callee === 'path.dirname' || callee === 'dirname') && expression.arguments.length === 1) {
    const file = first.getText(sourceFile).replace(/\s/g, '');
    if (['fileURLToPath(import.meta.url)', 'url.fileURLToPath(import.meta.url)', '__filename', 'import.meta.filename'].includes(file)) return configDirectory;
  }
  if ((callee === 'fileURLToPath' || callee === 'url.fileURLToPath') && ts.isNewExpression(first) && first.expression.getText(sourceFile) === 'URL') {
    const [url, base] = first.arguments ?? [];
    if (url && ts.isStringLiteralLike(url) && base?.getText(sourceFile) === 'import.meta.url') return path.posix.join(configDirectory, url.text);
  }
  return null;
}

/** The nearest directory at or above `directory` with a package.json ('' for the repo root). */
function packageDirectory(repo: RepoFs, directory: string): string {
  for (let current = directory; current; current = normalizeDirectory(path.posix.dirname(current))) {
    if (repo.read(`${current}/package.json`) !== undefined) return current;
  }
  return '';
}

const normalizeDirectory = (directory: string) => (directory === '.' ? '' : directory.replace(/\/$/, ''));
const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** The deepest directory holding both ('' for the repo root). */
function commonDirectory(first: string, second: string): string {
  const [a, b] = [first.split('/'), second.split('/')];
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return a.slice(0, shared).join('/');
}

function staticStrings(expression: ts.Expression | undefined): string[] | null {
  if (!expression) return [];
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isArrayLiteralExpression(expression) && expression.elements.every(ts.isStringLiteralLike)) return expression.elements.map((element) => (element as ts.StringLiteralLike).text);
  return null;
}

/** Repo-relative test-scope patterns: `<rootDir>` and config-relative paths expanded. */
function expandPatterns(patterns: string[], rootDir: string, configDirectory: string): string[] {
  return patterns.map((pattern) => {
    const expanded = pattern.replace(/<rootDir>\/?/g, rootDir === '' ? '' : `${rootDir}/`);
    if (expanded === pattern && !pattern.startsWith('**') && !pattern.startsWith('/')) return path.posix.join(configDirectory, pattern);
    return expanded;
  });
}

interface JestFields {
  rootDir?: string;
  roots?: string[];
  testMatch?: string[];
  testPathIgnorePatterns?: string[];
  moduleNameMapper?: [string, string][];
  testRegex?: boolean;
  pathPatterns?: [string, string][];
}

// Jest settings matched as regexes against a file's absolute path (testPathIgnorePatterns is the test scope's).
const pathPatternKeys = ['coveragePathIgnorePatterns', 'modulePathIgnorePatterns', 'transformIgnorePatterns', 'unmockedModulePathPatterns'] as const;

function jestScope(fields: JestFields, rootDir: string, configDirectory: string): TestScope {
  const testMatch = fields.testMatch ?? [];
  const negated = testMatch.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
  return {
    roots: fields.roots?.length ? expandPatterns(fields.roots, rootDir, configDirectory).map(normalizeDirectory) : [rootDir],
    include: expandPatterns(testMatch.filter((pattern) => !pattern.startsWith('!')), rootDir, configDirectory),
    exclude: expandPatterns(negated, rootDir, configDirectory),
    excludePatterns: (fields.testPathIgnorePatterns ?? []).map((pattern) => new RegExp(pattern.replace(/<rootDir>/g, `/${rootDir}`.replace(/\/$/, '')))),
  };
}

function readJestJson(text: string, isPackageJson: boolean): JestFields | null {
  const json = JSON.parse(stripBom(text));
  const jest = isPackageJson ? json.jest : json;
  if (!jest || typeof jest !== 'object' || jest.projects) return null;
  const strings = (value: unknown) => (value === undefined ? undefined : Array.isArray(value) ? value.map(String) : [String(value)]);
  return {
    rootDir: typeof jest.rootDir === 'string' ? jest.rootDir : undefined,
    roots: strings(jest.roots),
    testMatch: strings(jest.testMatch),
    testPathIgnorePatterns: strings(jest.testPathIgnorePatterns),
    moduleNameMapper: Object.entries(jest.moduleNameMapper ?? {}).map(([key, value]) => [key, Array.isArray(value) ? String(value[0]) : String(value)]),
    testRegex: jest.testRegex !== undefined,
    pathPatterns: [
      ...pathPatternKeys.flatMap((key) => (strings(jest[key]) ?? []).map((source): [string, string] => [key, source])),
      ...Object.keys(jest.transform ?? {}).map((source): [string, string] => ['transform', source]),
    ],
  };
}

function readJestScript(config: string, text: string, configDirectory: string): JestFields | string | null {
  const sourceFile = ts.createSourceFile(config, text, ts.ScriptTarget.Latest, true);
  const { object, mutated, constants } = exportedObject(sourceFile);
  if (!object) return 'no static config object';
  if (mutated) return 'config object mutated after its declaration';
  // A multi-project root (`projects: [...]`) delegates to the projects' own configs, which are read separately.
  if (getProperty(object, 'projects')) return null;
  const fields: JestFields = { testRegex: Boolean(getProperty(object, 'testRegex')) };
  const rootDir = getProperty(object, 'rootDir');
  if (rootDir) {
    const resolved = staticPath(rootDir, { configDirectory, sourceFile, constants });
    if (resolved === null) return 'non-literal rootDir';
    fields.rootDir = path.posix.relative(configDirectory || '.', resolved) || '.';
  }
  for (const key of ['roots', 'testMatch', 'testPathIgnorePatterns'] as const) {
    const values = staticStrings(getProperty(object, key));
    if (values === null) return `non-literal ${key}`;
    if (values.length) fields[key] = values;
  }
  fields.pathPatterns = [];
  for (const key of pathPatternKeys) {
    const values = staticStrings(getProperty(object, key));
    if (values === null) return `non-literal ${key}`;
    fields.pathPatterns.push(...values.map((source): [string, string] => [key, source]));
  }
  const transform = getProperty(object, 'transform');
  if (transform) {
    if (!ts.isObjectLiteralExpression(transform)) return 'non-literal transform';
    for (const property of transform.properties) {
      const key = ts.isPropertyAssignment(property) ? propertyName(property.name) : null;
      if (key === null) return 'non-literal transform key';
      fields.pathPatterns.push(['transform', key]);
    }
  }
  const mapper = getProperty(object, 'moduleNameMapper');
  if (mapper) {
    if (!ts.isObjectLiteralExpression(mapper)) return 'non-literal moduleNameMapper';
    fields.moduleNameMapper = [];
    for (const property of mapper.properties) {
      const key = ts.isPropertyAssignment(property) ? propertyName(property.name) : null;
      const value = ts.isPropertyAssignment(property) ? property.initializer : undefined;
      const target = value && ts.isStringLiteralLike(value) ? value.text
        : value && ts.isArrayLiteralExpression(value) && value.elements[0] && ts.isStringLiteralLike(value.elements[0]) ? value.elements[0].text : null;
      if (key === null || target === null) return 'non-literal moduleNameMapper entry';
      fields.moduleNameMapper.push([key, target]);
    }
  }
  return fields;
}

export function loadRunnerConfig(repo: RepoFs): RunnerConfig {
  const result: RunnerConfig = { jest: [], vitest: [], unreadable: [] };
  const tracked = repo.tracked().filter((file) => !file.includes('node_modules/'));
  const jestConfigs = tracked.filter((file) => jestConfigPattern.test(file));
  const packageJest = tracked.filter((file) => file.endsWith('package.json') && /"jest"\s*:/.test(repo.read(file) ?? ''));
  for (const config of [...jestConfigs, ...packageJest]) {
    const configDirectory = normalizeDirectory(path.posix.dirname(config));
    const text = repo.read(config) ?? '';
    let fields: JestFields | string | null;
    try {
      fields = config.endsWith('.json') ? readJestJson(text, config.endsWith('package.json')) : readJestScript(config, text, configDirectory);
    } catch {
      fields = 'invalid JSON';
    }
    if (fields === null) continue;
    if (typeof fields === 'string') {
      result.unreadable.push({ config, reason: fields });
      continue;
    }
    if (fields.testRegex) result.unreadable.push({ config, reason: 'testRegex (regex test scope) is not modelled' });
    const rootDir = normalizeDirectory(fields.rootDir ? path.posix.join(configDirectory || '.', fields.rootDir) : configDirectory);
    let pathPatterns: JestPathPattern[];
    try {
      pathPatterns = (fields.pathPatterns ?? []).map(([key, source]) => ({ key, source, pattern: new RegExp(source.replace(/<rootDir>/g, `/${rootDir}`.replace(/\/$/, ''))) }));
    } catch {
      result.unreadable.push({ config, reason: 'invalid regex in a path setting' });
      continue;
    }
    result.jest.push({
      config,
      directory: configDirectory,
      rootDir,
      scope: jestScope(fields, rootDir, configDirectory),
      mappers: (fields.moduleNameMapper ?? []).map(([source, replacement]) => ({
        pattern: new RegExp(source),
        source,
        replacement: replacement.replace(/<rootDir>\/?/g, rootDir === '' ? '' : `${rootDir}/`),
      })),
      pathPatterns,
    });
  }
  for (const config of tracked.filter((file) => viteConfigPattern.test(file))) {
    const configDirectory = normalizeDirectory(path.posix.dirname(config));
    const sourceFile = ts.createSourceFile(config, repo.read(config) ?? '', ts.ScriptTarget.Latest, true);
    const { object, constants } = exportedObject(sourceFile);
    if (!object) {
      result.unreadable.push({ config, reason: 'no static config object' });
      continue;
    }
    const pathContext: PathContext = { configDirectory, sourceFile, constants };
    const aliasNodes = [getProperty(object, 'resolve'), getProperty(object, 'test')]
      .map((section) => (section && ts.isObjectLiteralExpression(section) ? getProperty(section, 'alias') : undefined))
      .filter((node): node is ts.Expression => Boolean(node));
    const aliases: ViteAlias[] = [];
    let readable = true;
    for (const aliasNode of aliasNodes) {
      if (ts.isObjectLiteralExpression(aliasNode)) {
        for (const property of aliasNode.properties) {
          const find = ts.isPropertyAssignment(property) ? propertyName(property.name) : null;
          const replacement = ts.isPropertyAssignment(property) ? staticPath(property.initializer, pathContext) : null;
          if (find === null || replacement === null) readable = false;
          else aliases.push({ find, replacement: normalizeDirectory(replacement) });
        }
      } else if (ts.isArrayLiteralExpression(aliasNode)) {
        for (const element of aliasNode.elements) {
          const find = ts.isObjectLiteralExpression(element) ? getProperty(element, 'find') : undefined;
          const replacement = ts.isObjectLiteralExpression(element) ? getProperty(element, 'replacement') : undefined;
          const replacementPath = replacement ? staticPath(replacement, pathContext) : null;
          if (!find || !ts.isStringLiteralLike(find) || replacementPath === null) readable = false;
          else aliases.push({ find: find.text, replacement: normalizeDirectory(replacementPath) });
        }
      } else readable = false;
    }
    if (!readable) result.unreadable.push({ config, reason: 'non-literal resolve.alias entry' });
    const testSection = getProperty(object, 'test');
    const test = testSection && ts.isObjectLiteralExpression(testSection) ? testSection : undefined;
    const include = test ? staticStrings(getProperty(test, 'include')) : [];
    const exclude = test ? staticStrings(getProperty(test, 'exclude')) : [];
    if (include === null || exclude === null) result.unreadable.push({ config, reason: 'non-literal test.include/exclude' });
    // Vitest collects tests (and reads include/exclude) relative to its root: test.root, else Vite's root. Vite resolves
    // a relative root against the cwd, most likely the package the config belongs to; when that isn't the config's own
    // directory, the cwd is a guess, so a root that depends on it is unreadable.
    const rootNode = (test && getProperty(test, 'root')) ?? getProperty(object, 'root');
    const cwd = packageDirectory(repo, configDirectory);
    const inRepo = (reading: string | null) => (reading === null || reading.startsWith('/') ? null : normalizeDirectory(path.posix.normalize(reading || '.')));
    const rootInRepo = inRepo(rootNode ? staticPath(rootNode, { ...pathContext, relativeTo: cwd }) : configDirectory);
    const fromConfigDirectory = rootNode ? inRepo(staticPath(rootNode, pathContext)) : rootInRepo;
    if (rootInRepo === null || rootInRepo.startsWith('..')) result.unreadable.push({ config, reason: `root ${rootNode?.getText(sourceFile) ?? ''} is not a static directory in the repo` });
    else if (fromConfigDirectory !== rootInRepo) result.unreadable.push({ config, reason: `root ${rootNode!.getText(sourceFile)} is relative to the cwd, which may be ${cwd || 'the repo root'} or ${configDirectory}` });
    // An unreadable root is Vite's default, the cwd: most likely the package the config belongs to. A cwd-relative one
    // governs both readings.
    let root = rootInRepo === null || rootInRepo.startsWith('..') ? cwd : rootInRepo;
    if (fromConfigDirectory !== rootInRepo) root = commonDirectory(root, fromConfigDirectory === null || fromConfigDirectory.startsWith('..') ? '' : fromConfigDirectory);
    result.vitest.push({
      config,
      directory: root,
      aliases,
      scope: { roots: [root], include: expandPatterns(include ?? [], root, root), exclude: expandPatterns(exclude ?? [], root, root), excludePatterns: [] },
    });
  }
  return result;
}

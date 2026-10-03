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

export interface JestConfig {
  config: string;
  /** Repo-relative directory of the config file ('' for the root). */
  directory: string;
  rootDir: string;
  mappers: JestMapper[];
  scope: TestScope;
}

export interface VitestConfig {
  config: string;
  directory: string;
  aliases: ViteAlias[];
  scope: TestScope;
}

export interface RunnerConfig {
  jest: JestConfig[];
  vitest: VitestConfig[];
  unreadable: { config: string; reason: string }[];
}

const jestConfigPattern = /(^|\/)jest\.config\.(js|cjs|mjs|ts|cts|mts|json)$/;
const viteConfigPattern = /(^|\/)(vitest|vite)\.config\.(js|cjs|mjs|ts|cts|mts)$/;

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
 */
function exportedObject(sourceFile: ts.SourceFile): { object: ts.ObjectLiteralExpression | null; mutated: boolean } {
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
  return { object: unwrap(exported), mutated };
}

/** Resolves `'./src'`, `path.resolve(__dirname, './src')`, `resolve(__dirname, 'src')`, `fileURLToPath(new URL('./src', import.meta.url))`. */
function staticPath(expression: ts.Expression, configDirectory: string, sourceFile: ts.SourceFile): string | null {
  if (ts.isStringLiteralLike(expression)) return expression.text.startsWith('.') ? path.posix.join(configDirectory, expression.text) : expression.text;
  if (ts.isCallExpression(expression)) {
    const callee = expression.expression.getText(sourceFile);
    const [first, ...rest] = expression.arguments;
    if ((callee === 'path.resolve' || callee === 'resolve' || callee === 'path.join' || callee === 'join') && first && first.getText(sourceFile) === '__dirname'
      && rest.every(ts.isStringLiteralLike)) {
      return path.posix.join(configDirectory, ...rest.map((argument) => (argument as ts.StringLiteralLike).text));
    }
    if (callee === 'fileURLToPath' && first && ts.isNewExpression(first) && first.expression.getText(sourceFile) === 'URL') {
      const [url, base] = first.arguments ?? [];
      if (url && ts.isStringLiteralLike(url) && base?.getText(sourceFile) === 'import.meta.url') return path.posix.join(configDirectory, url.text);
    }
  }
  return null;
}

const normalizeDirectory = (directory: string) => (directory === '.' ? '' : directory.replace(/\/$/, ''));
const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

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
}

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
  };
}

function readJestScript(config: string, text: string, configDirectory: string): JestFields | string | null {
  const sourceFile = ts.createSourceFile(config, text, ts.ScriptTarget.Latest, true);
  const { object, mutated } = exportedObject(sourceFile);
  if (!object) return 'no static config object';
  if (mutated) return 'config object mutated after its declaration';
  // A multi-project root (`projects: [...]`) delegates to the projects' own configs, which are read separately.
  if (getProperty(object, 'projects')) return null;
  const fields: JestFields = { testRegex: Boolean(getProperty(object, 'testRegex')) };
  const rootDir = getProperty(object, 'rootDir');
  if (rootDir) {
    const resolved = staticPath(rootDir, configDirectory, sourceFile);
    if (resolved === null) return 'non-literal rootDir';
    fields.rootDir = path.posix.relative(configDirectory || '.', resolved) || '.';
  }
  for (const key of ['roots', 'testMatch', 'testPathIgnorePatterns'] as const) {
    const values = staticStrings(getProperty(object, key));
    if (values === null) return `non-literal ${key}`;
    if (values.length) fields[key] = values;
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
    });
  }
  for (const config of tracked.filter((file) => viteConfigPattern.test(file))) {
    const configDirectory = normalizeDirectory(path.posix.dirname(config));
    const sourceFile = ts.createSourceFile(config, repo.read(config) ?? '', ts.ScriptTarget.Latest, true);
    const { object } = exportedObject(sourceFile);
    if (!object) {
      result.unreadable.push({ config, reason: 'no static config object' });
      continue;
    }
    const aliasNodes = [getProperty(object, 'resolve'), getProperty(object, 'test')]
      .map((section) => (section && ts.isObjectLiteralExpression(section) ? getProperty(section, 'alias') : undefined))
      .filter((node): node is ts.Expression => Boolean(node));
    const aliases: ViteAlias[] = [];
    let readable = true;
    for (const aliasNode of aliasNodes) {
      if (ts.isObjectLiteralExpression(aliasNode)) {
        for (const property of aliasNode.properties) {
          const find = ts.isPropertyAssignment(property) ? propertyName(property.name) : null;
          const replacement = ts.isPropertyAssignment(property) ? staticPath(property.initializer, configDirectory, sourceFile) : null;
          if (find === null || replacement === null) readable = false;
          else aliases.push({ find, replacement: normalizeDirectory(replacement) });
        }
      } else if (ts.isArrayLiteralExpression(aliasNode)) {
        for (const element of aliasNode.elements) {
          const find = ts.isObjectLiteralExpression(element) ? getProperty(element, 'find') : undefined;
          const replacement = ts.isObjectLiteralExpression(element) ? getProperty(element, 'replacement') : undefined;
          const replacementPath = replacement ? staticPath(replacement, configDirectory, sourceFile) : null;
          if (!find || !ts.isStringLiteralLike(find) || replacementPath === null) readable = false;
          else aliases.push({ find: find.text, replacement: normalizeDirectory(replacementPath) });
        }
      } else readable = false;
    }
    if (!readable) result.unreadable.push({ config, reason: 'non-literal resolve.alias entry' });
    const testSection = getProperty(object, 'test');
    const include = testSection && ts.isObjectLiteralExpression(testSection) ? staticStrings(getProperty(testSection, 'include')) : [];
    const exclude = testSection && ts.isObjectLiteralExpression(testSection) ? staticStrings(getProperty(testSection, 'exclude')) : [];
    if (include === null || exclude === null) result.unreadable.push({ config, reason: 'non-literal test.include/exclude' });
    result.vitest.push({
      config,
      directory: configDirectory,
      aliases,
      scope: { roots: [configDirectory], include: expandPatterns(include ?? [], configDirectory, configDirectory), exclude: expandPatterns(exclude ?? [], configDirectory, configDirectory), excludePatterns: [] },
    });
  }
  return result;
}

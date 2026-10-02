// Test-runner resolution settings, read statically from config ASTs (never by executing target code).
// Plan §2.5: a test config that can't be loaded statically is a preflight decline, so anything we can't read
// is reported in `unreadable` instead of guessed.
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

/** Which files a runner collects as tests: directory roots plus glob patterns (repo-relative), when statically known. */
export interface TestScope {
  roots: string[];
  include: string[];
  exclude: string[];
}

export interface RunnerConfig {
  jest: { config: string; rootDir: string; mappers: JestMapper[]; scope: TestScope } | null;
  vitest: { config: string; aliases: ViteAlias[]; scope: TestScope } | null;
  unreadable: { config: string; reason: string }[];
}

const jestConfigPattern = /(^|\/)jest\.config\.(js|cjs|mjs|ts|cts|mts|json)$/;
const viteConfigPattern = /(^|\/)(vitest|vite)\.config\.(js|cjs|mjs|ts|cts|mts)$/;

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

/** The exported config object: `module.exports = {…}`, `export default {…}`, `defineConfig({…})`, or a const they name. */
function exportedObject(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | null {
  const constants = new Map<string, ts.Expression>();
  let exported: ts.Expression | undefined;
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) constants.set(declaration.name.text, declaration.initializer);
      }
    } else if (ts.isExportAssignment(statement)) {
      exported = statement.expression;
    } else if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
      && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && statement.expression.left.getText(sourceFile) === 'module.exports') {
      exported = statement.expression.right;
    }
  }
  const unwrap = (expression: ts.Expression | undefined): ts.ObjectLiteralExpression | null => {
    if (!expression) return null;
    if (ts.isParenthesizedExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isAsExpression(expression)) return unwrap(expression.expression);
    if (ts.isObjectLiteralExpression(expression)) return expression;
    if (ts.isIdentifier(expression)) return unwrap(constants.get(expression.text));
    if (ts.isCallExpression(expression) && expression.arguments.length === 1) return unwrap(expression.arguments[0]);
    return null;
  };
  return unwrap(exported);
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

function staticStrings(expression: ts.Expression | undefined): string[] | null {
  if (!expression) return [];
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isArrayLiteralExpression(expression) && expression.elements.every(ts.isStringLiteralLike)) return expression.elements.map((element) => (element as ts.StringLiteralLike).text);
  return null;
}

/** Repo-relative test-scope patterns; `<rootDir>` and config-relative paths expanded. */
function expandPatterns(patterns: string[], rootDir: string, configDirectory: string): string[] {
  return patterns.map((pattern) => {
    const expanded = pattern.replace(/<rootDir>\/?/g, rootDir === '' ? '' : `${rootDir}/`);
    if (expanded === pattern && !pattern.startsWith('**') && !pattern.startsWith('/')) return path.posix.join(configDirectory, pattern);
    return expanded;
  });
}

export function loadRunnerConfig(repo: RepoFs): RunnerConfig {
  const result: RunnerConfig = { jest: null, vitest: null, unreadable: [] };
  const tracked = repo.tracked().filter((file) => !file.includes('node_modules/'));
  const jestConfigs = tracked.filter((file) => jestConfigPattern.test(file));
  const packageJest = tracked.filter((file) => file.endsWith('package.json') && /"jest"\s*:/.test(repo.read(file) ?? ''));
  for (const config of [...jestConfigs, ...packageJest]) {
    const configDirectory = path.posix.dirname(config);
    const text = repo.read(config) ?? '';
    let mapperEntries: [string, string][] = [];
    let rootDirectory = configDirectory;
    if (config.endsWith('.json')) {
      try {
        const json = JSON.parse(text);
        const jest = config.endsWith('package.json') ? json.jest : json;
        if (typeof jest?.rootDir === 'string') rootDirectory = path.posix.join(configDirectory, jest.rootDir);
        mapperEntries = Object.entries(jest?.moduleNameMapper ?? {}).map(([key, value]) => [key, Array.isArray(value) ? String(value[0]) : String(value)]);
      } catch {
        result.unreadable.push({ config, reason: 'invalid JSON' });
        continue;
      }
    } else {
      const sourceFile = ts.createSourceFile(config, text, ts.ScriptTarget.Latest, true);
      const object = exportedObject(sourceFile);
      if (!object) {
        result.unreadable.push({ config, reason: 'no static config object' });
        continue;
      }
      const rootDir = getProperty(object, 'rootDir');
      if (rootDir) {
        const resolved = staticPath(rootDir, configDirectory, sourceFile);
        if (resolved === null) {
          result.unreadable.push({ config, reason: 'non-literal rootDir' });
          continue;
        }
        rootDirectory = resolved;
      }
      const mapper = getProperty(object, 'moduleNameMapper');
      if (mapper) {
        if (!ts.isObjectLiteralExpression(mapper)) {
          result.unreadable.push({ config, reason: 'non-literal moduleNameMapper' });
          continue;
        }
        for (const property of mapper.properties) {
          const key = ts.isPropertyAssignment(property) ? propertyName(property.name) : null;
          const value = ts.isPropertyAssignment(property) ? property.initializer : undefined;
          const target = value && ts.isStringLiteralLike(value) ? value.text
            : value && ts.isArrayLiteralExpression(value) && value.elements[0] && ts.isStringLiteralLike(value.elements[0]) ? value.elements[0].text : null;
          if (key === null || target === null) {
            result.unreadable.push({ config, reason: 'non-literal moduleNameMapper entry' });
            mapperEntries = [];
            break;
          }
          mapperEntries.push([key, target]);
        }
      }
    }
    const rootDir = normalizeDirectory(rootDirectory);
    let scope: TestScope = { roots: [rootDir], include: [], exclude: [] };
    if (!config.endsWith('.json')) {
      const sourceFile = ts.createSourceFile(config, text, ts.ScriptTarget.Latest, true);
      const object = exportedObject(sourceFile)!;
      const roots = staticStrings(getProperty(object, 'roots'));
      const testMatch = staticStrings(getProperty(object, 'testMatch'));
      const ignore = staticStrings(getProperty(object, 'testPathIgnorePatterns'));
      if (roots === null || testMatch === null || ignore === null || getProperty(object, 'testRegex')) result.unreadable.push({ config, reason: 'non-literal or regex test scope' });
      else scope = { roots: roots.length ? expandPatterns(roots, rootDir, configDirectory).map(normalizeDirectory) : [rootDir], include: expandPatterns(testMatch, rootDir, configDirectory), exclude: [] };
    }
    result.jest = {
      config,
      rootDir,
      scope,
      mappers: mapperEntries.map(([source, replacement]) => ({
        pattern: new RegExp(source),
        source,
        replacement: replacement.replace(/<rootDir>\/?/g, rootDir === '' ? '' : `${rootDir}/`),
      })),
    };
  }
  for (const config of tracked.filter((file) => viteConfigPattern.test(file))) {
    const configDirectory = normalizeDirectory(path.posix.dirname(config));
    const sourceFile = ts.createSourceFile(config, repo.read(config) ?? '', ts.ScriptTarget.Latest, true);
    const object = exportedObject(sourceFile);
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
    const scope: TestScope = { roots: [configDirectory], include: expandPatterns(include ?? [], configDirectory, configDirectory), exclude: expandPatterns(exclude ?? [], configDirectory, configDirectory) };
    result.vitest = { config, aliases, scope };
  }
  return result;
}

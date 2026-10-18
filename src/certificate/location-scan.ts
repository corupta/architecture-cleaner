// K4 location scan (plan §3.4; research 04b E2, A23–A28):
// 1. moved files contain no path-exposing APIs: location tokens (__dirname, import.meta.*, require.resolve, ...),
//    loaders that resolve relative to their caller (non-literal require/import()/mocks, createRequire, caller-location
//    libraries), cwd-relative literal paths, stack inspection, process.argv[1], @jest-environment paths;
//    path strings in moved files name nothing beside them that stays behind (`toMatchFileSnapshot`, caller-relative
//    helpers), and moved files import no unmoved module that reads its caller's location from the stack;
// 2. non-moved files load nothing by a computed path whose static part names a moved file or points into a
//    directory whose tracked contents changed (hunt SEM-5), and their globs keep their matches' sorted order;
// 3. no old path survives as a string in code, config, infra or CI (old-path-scan.ts; docs and comments: findings).
import path from 'node:path';
import ts from 'typescript';
import { scriptKindOf } from '../analyzer/reference-sites.js';
import type { CommitTree } from './git-tree.js';
import { cwdBases, emittedLayouts, type EmittedLayout, globOrderChange, globToRegExp, judgedStringKinds, scanOldPaths } from './old-path-scan.js';
import { type Binding, describeCallee, type Evaluate, familyOf, locate, type Located, moduleBindings, pathEvaluator, type PathValue, unwrapExpression } from './path-expressions.js';
import { isScannedSource } from './spans.js';
import { addedToolConfigs } from './tool-configs.js';
import { type Check, type CertifyContext, type Finding, result, type Violation } from './types.js';

const title = 'Location scan';

const mockCallees = new Set([
  'jest.mock', 'jest.doMock', 'jest.unmock', 'jest.dontMock', 'jest.requireActual', 'jest.requireMock', 'jest.createMockFromModule',
  'vi.mock', 'vi.doMock', 'vi.unmock', 'vi.doUnmock', 'vi.importActual', 'vi.importMock',
]);
const fsMethods = new Set(['readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'exists', 'existsSync', 'stat', 'statSync',
  'lstat', 'lstatSync', 'access', 'accessSync', 'open', 'openSync', 'readdir', 'readdirSync', 'opendir', 'opendirSync', 'mkdir', 'mkdirSync', 'rm', 'rmSync',
  'rmdir', 'rmdirSync', 'unlink', 'unlinkSync', 'rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'createReadStream', 'createWriteStream',
  'watch', 'watchFile', 'realpath', 'realpathSync', 'readlink', 'readlinkSync', 'symlink', 'symlinkSync', 'link', 'linkSync', 'chmod', 'chmodSync',
  'truncate', 'truncateSync', 'utimes', 'utimesSync', 'glob', 'globSync', 'readJson', 'readJsonSync', 'readJSON', 'writeJson', 'writeJsonSync',
  'outputFile', 'outputFileSync', 'outputJson', 'pathExists', 'pathExistsSync', 'ensureDir', 'ensureDirSync', 'ensureFile', 'copy', 'copySync',
  'move', 'moveSync', 'remove', 'removeSync', 'emptyDir', 'emptyDirSync', 'mkdirp', 'mkdirs']);
const enumeratingMethods = new Set(['readdir', 'readdirSync', 'opendir', 'opendirSync', 'watch', 'glob', 'globSync']);
const twoPathMethods = new Set(['rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'symlink', 'symlinkSync', 'link', 'linkSync', 'copy', 'copySync', 'move', 'moveSync']);
const processMethods = new Set(['fork', 'spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'execa', 'execaSync', 'execaNode', 'execaCommand', 'execaCommandSync']);
const requireMembers = new Set(['resolve', 'main', 'cache', 'context', 'extensions']);
const moduleMembers = new Set(['filename', 'id', 'path', 'paths', 'parent', 'children', 'require']);
const errorName = /^(e|ex|exc|err|error|exception|reason|cause|failure|caught|thrown)$|(err|error|exception)$/i;
const pathLike = (text: string) => /^\.\.?(\/|$)/.test(text) || text.includes('/') || /\.[a-z0-9]{1,5}$/i.test(text);
const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.d.ts'];

type SinkKind = 'module' | 'file' | 'enumerate' | 'glob' | 'construction';

interface Sink {
  kind: SinkKind;
  node: ts.Expression;
  /** Short description of the consuming call. */
  call: string;
  recursive: boolean;
  /** String values are relative to the file (module loaders, import.meta.glob) or to the cwd. */
  strings: 'module' | 'cwd';
  /** child_process arguments: only path-like strings count (a command name is not a path). */
  pathLikeOnly?: boolean;
}

interface Hazard {
  node: ts.Node;
  what: string;
  /** A location token whose value can be evaluated at the old and the new location. */
  token?: boolean;
  /** Reads its caller's location (stack frames, caller-location libraries): its callers' moves change what it does. */
  observesCaller?: boolean;
}

interface ScannedFile {
  sourceFile: ts.SourceFile;
  bindings: Map<string, Binding>;
  hazards: Hazard[];
  /** `.stack` read and passed along (logged, rethrown): its text names files, its use doesn't depend on them. */
  stackText: ts.Node[];
  sinks: Sink[];
  opaqueLoads: ts.Node[];
  /** Path-like string literals outside reference sites: what they name beside the file must move along with it. */
  relativeStrings: ts.StringLiteralLike[];
}

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
const excerpt = (sourceFile: ts.SourceFile, node: ts.Node) => node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 100);

function calleeText(expression: ts.Expression): string | null {
  const node = unwrapExpression(expression);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const left = calleeText(node.expression);
    return left === null ? null : `${left}.${node.name.text}`;
  }
  return null;
}

const isLiteral = (node: ts.Expression | undefined) => node !== undefined && ts.isStringLiteralLike(unwrapExpression(node));
// Matchers that resolve a path argument against the test file (vitest, jest-specific-snapshot).
const fileRelativeMatchers = new Set(['toMatchFileSnapshot', 'toMatchSpecificSnapshot']);

/** Objects handed to `Error.captureStackTrace(holder)`: their `.stack` is a stack trace whatever their name. */
function stackHolders(sourceFile: ts.SourceFile): Set<string> {
  const holders = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeText(node.expression) === 'Error.captureStackTrace' && node.arguments[0] && ts.isIdentifier(unwrapExpression(node.arguments[0]))) {
      holders.add((unwrapExpression(node.arguments[0]) as ts.Identifier).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return holders;
}

/** A string literal that is a value (not a property name, a type, or a module specifier of a declaration). */
function isValueString(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return false;
  if (ts.isLiteralTypeNode(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent) || ts.isModuleDeclaration(parent)) return false;
  return !ts.isImportTypeNode(parent.parent);
}

/** Walks one file and records everything K4 looks at; which of it counts depends on whether the file moved. */
export function scanFile(file: string, text: string): ScannedFile {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const bindings = moduleBindings(sourceFile);
  const evaluate = pathEvaluator(sourceFile, file, bindings);
  const hazards: Hazard[] = [];
  const stackText: ts.Node[] = [];
  const sinks: Sink[] = [];
  const opaqueLoads: ts.Node[] = [];
  const relativeStrings: ts.StringLiteralLike[] = [];
  const errorVariables = stackHolders(sourceFile);
  const relativeValue = (node: ts.Expression | undefined, requirePathLike: boolean) => node !== undefined
    && evaluate(node).some((value) => (value.anchor === 'string' && (!requirePathLike || pathLike(value.text))) || value.anchor === 'cwd');
  const addSink = (sink: Sink) => {
    const node = unwrapExpression(sink.node);
    if (ts.isArrayLiteralExpression(node)) for (const element of node.elements) if (!ts.isSpreadElement(element)) sinks.push({ ...sink, node: element });
    if (!ts.isArrayLiteralExpression(node)) sinks.push({ ...sink, node });
  };
  const loader = (call: ts.CallExpression, name: string) => {
    const argument = call.arguments[0];
    if (!argument || isLiteral(argument)) return;
    // vi.mock(import('./x')): the import() literal is a recognized reference site.
    const inner = unwrapExpression(argument);
    if (ts.isCallExpression(inner) && inner.expression.kind === ts.SyntaxKind.ImportKeyword && isLiteral(inner.arguments[0])) return;
    hazards.push({ node: call, what: `${name}(${excerpt(sourceFile, argument)}) with a computed specifier (resolved relative to this file)` });
    addSink({ kind: 'module', node: argument, call: name, recursive: false, strings: 'module' });
    // Nothing static, or only a cwd/empty start (`import(path.resolve(file))`): the path comes from elsewhere.
    if (evaluate(argument).every((value) => value.anchor !== 'repo' && !value.complete && /^\.?\/?$/.test(value.text))) opaqueLoads.push(call);
  };
  const optionValue = (call: ts.CallExpression | ts.NewExpression, name: string): ts.Expression | undefined => {
    for (const argument of call.arguments ?? []) {
      const node = unwrapExpression(argument);
      if (!ts.isObjectLiteralExpression(node)) continue;
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === name) return property.initializer;
      }
    }
    return undefined;
  };
  const isRecursive = (call: ts.CallExpression) => optionValue(call, 'recursive')?.kind === ts.SyntaxKind.TrueKeyword;

  const stackUse = (node: ts.Expression): 'inspect' | 'text' => {
    let current: ts.Node = node;
    while (ts.isParenthesizedExpression(current.parent) || ts.isNonNullExpression(current.parent) || ts.isAsExpression(current.parent)) current = current.parent;
    const parent = current.parent;
    if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === current) {
      return ts.isPropertyAccessExpression(parent) && ['toString', 'valueOf'].includes(parent.name.text) ? 'text' : 'inspect';
    }
    if (ts.isCallExpression(parent) && parent.arguments.includes(current as ts.Expression) && ts.isPropertyAccessExpression(parent.expression)
      && ['test', 'exec'].includes(parent.expression.name.text)) return 'inspect';
    if (ts.isBinaryExpression(parent) && parent.left !== current && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(parent.operatorToken.kind)) return 'inspect';
    if (ts.isBinaryExpression(parent) && parent.left === current && parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return 'inspect';
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      const alias = parent.name.text;
      let inspected = false;
      const visit = (child: ts.Node): void => {
        if (inspected) return;
        if (ts.isIdentifier(child) && child.text === alias && child !== parent.name && stackUse(child) === 'inspect') inspected = true;
        ts.forEachChild(child, visit);
      };
      visit(sourceFile);
      return inspected ? 'inspect' : 'text';
    }
    return 'text';
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) errorVariables.add(node.variableDeclaration.name.text);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && familyOf(node.moduleSpecifier.text) === 'caller-location') {
      hazards.push({ node, what: `imports ${node.moduleSpecifier.text}, which observes its caller's file location`, observesCaller: true });
    }
    if (ts.isStringLiteralLike(node) && isValueString(node) && pathLike(node.text) && !/^[a-z][a-z0-9+.-]*:/i.test(node.text)) relativeStrings.push(node);
    if (ts.isCallExpression(node)) {
      const text = calleeText(node.expression);
      const callee = describeCallee(node.expression, bindings);
      const family = familyOf(callee?.module ?? null);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) loader(node, 'import');
      else if (text === 'require' || text === 'module.require') loader(node, text);
      else if (text === 'require.resolve' && node.arguments[0] && !isLiteral(node.arguments[0])) {
        addSink({ kind: 'module', node: node.arguments[0], call: text, recursive: false, strings: 'module' });
      } else if (text && mockCallees.has(text)) loader(node, text);
      else if (text === 'require.context' && node.arguments[0]) {
        addSink({ kind: 'enumerate', node: node.arguments[0], call: text, recursive: node.arguments[1]?.kind !== ts.SyntaxKind.FalseKeyword, strings: 'module' });
      } else if (text === 'import.meta.glob' && node.arguments[0]) addSink({ kind: 'glob', node: node.arguments[0], call: text, recursive: true, strings: 'module' });
      else if (text === 'process.cwd') hazards.push({ node, what: 'process.cwd()' });
      else if (callee?.name === 'createRequire') hazards.push({ node, what: `createRequire(${node.arguments[0] ? excerpt(sourceFile, node.arguments[0]) : ''})` });
      else if (callee?.name === 'getCallSites' || callee?.name === 'getCallSite' || family === 'caller-location') hazards.push({ node, what: `${excerpt(sourceFile, node.expression)}() reads the caller's file location`, observesCaller: true });
      else if (callee && fileRelativeMatchers.has(callee.name) && callee.receiver !== undefined) hazards.push({ node, what: `${callee.name}(${node.arguments[0] ? excerpt(sourceFile, node.arguments[0]) : ''}) resolves its path against the test file` });
      else if (callee?.name === 'commandDir') hazards.push({ node, what: `${excerpt(sourceFile, node.expression)}() loads a directory relative to this file` });
      else if (family === 'path' && (callee!.name === 'join' || callee!.name === 'resolve')) {
        if (node.arguments.length === 0 ? callee!.name === 'resolve' : relativeValue(node.arguments[0], false)) hazards.push({ node, what: `cwd-relative path ${excerpt(sourceFile, node)}` });
      } else if (family === 'glob' || (family === 'fs' && (callee!.name === 'glob' || callee!.name === 'globSync'))) {
        const pattern = node.arguments[0];
        const cwd = optionValue(node, 'cwd');
        if (pattern) addSink({ kind: 'glob', node: pattern, call: excerpt(sourceFile, node.expression), recursive: true, strings: 'cwd' });
        if (cwd) addSink({ kind: 'enumerate', node: cwd, call: `${excerpt(sourceFile, node.expression)} cwd`, recursive: true, strings: 'cwd' });
        if ((pattern && relativeValue(pattern, false) && !cwd) || (cwd && relativeValue(cwd, false))) hazards.push({ node, what: `glob over cwd-relative paths: ${excerpt(sourceFile, node)}` });
      } else if (callee && fsMethods.has(callee.name) && (family === 'fs' || callee.module === null)) {
        const bound = family === 'fs';
        const kind: SinkKind = enumeratingMethods.has(callee.name) ? 'enumerate' : 'file';
        const recursive = isRecursive(node) || callee.name === 'cp' || callee.name === 'cpSync' || callee.name === 'copy' || callee.name === 'copySync';
        const pathArguments = node.arguments.slice(0, twoPathMethods.has(callee.name) ? 2 : 1);
        for (const argument of pathArguments) {
          addSink({ kind, node: argument, call: excerpt(sourceFile, node.expression), recursive, strings: 'cwd', pathLikeOnly: !bound });
          if (relativeValue(argument, !bound)) hazards.push({ node, what: `cwd-relative path in ${excerpt(sourceFile, node.expression)}(${excerpt(sourceFile, argument)})` });
        }
      } else if (callee && processMethods.has(callee.name) && (family === 'process' || callee.module === null)) {
        const forked = callee.name === 'fork' || callee.name === 'execaNode';
        node.arguments.forEach((argument, position) => {
          if (ts.isSpreadElement(argument)) return;
          const scriptArgument = forked && position === 0;
          addSink({ kind: 'file', node: argument, call: excerpt(sourceFile, node.expression), recursive: false, strings: 'cwd', pathLikeOnly: !scriptArgument });
          const elements = ts.isArrayLiteralExpression(unwrapExpression(argument)) ? (unwrapExpression(argument) as ts.ArrayLiteralExpression).elements : [argument];
          for (const element of elements) {
            if (ts.isSpreadElement(element)) continue;
            const words = evaluate(element).filter((value) => value.anchor === 'string').flatMap((value) => value.text.split(/\s+/));
            if ((scriptArgument && family === 'process' && relativeValue(element, false)) || words.some((word) => /^\.\.?\//.test(word) || (word.includes('/') && !word.startsWith('-') && !/^[a-z]+:/i.test(word)))) {
              hazards.push({ node, what: `child process with a relative path: ${excerpt(sourceFile, node)}` });
              return;
            }
          }
        });
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(unwrapExpression(node.expression)) && ['Worker', 'SharedWorker', 'Glob'].includes((unwrapExpression(node.expression) as ts.Identifier).text)) {
      const name = (unwrapExpression(node.expression) as ts.Identifier).text;
      const binding = bindings.get(name);
      const argument = node.arguments?.[0];
      if (name === 'Glob') {
        if (familyOf(binding?.module ?? null) === 'glob' && argument) addSink({ kind: 'glob', node: argument, call: 'new Glob', recursive: true, strings: 'cwd' });
      } else {
        if (argument) addSink({ kind: 'file', node: argument, call: `new ${name}`, recursive: false, strings: 'cwd', pathLikeOnly: familyOf(binding?.module ?? null) !== 'worker' });
        if (familyOf(binding?.module ?? null) === 'worker') hazards.push({ node, what: `new ${name}(${argument ? excerpt(sourceFile, argument) : ''}) (worker_threads)` });
        else if (argument && relativeValue(argument, true)) hazards.push({ node, what: `new ${name}(${excerpt(sourceFile, argument)}) with a relative path` });
      }
    } else if (ts.isIdentifier(node) && (node.text === '__dirname' || node.text === '__filename') && isValueReference(node)) {
      hazards.push({ node, what: node.text, token: true });
    } else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      const member = ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node ? node.parent.name.text : null;
      if (member !== 'env' && member !== 'hot') hazards.push({ node: member ? node.parent : node, what: `import.meta${member ? `.${member}` : ' (as a value)'}`, token: member === 'dirname' || member === 'filename' || member === 'url' });
    } else if (ts.isPropertyAccessExpression(node) || (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))) {
      const member = ts.isPropertyAccessExpression(node) ? node.name.text : (node.argumentExpression as ts.StringLiteralLike).text;
      const object = unwrapExpression(node.expression);
      const objectText = ts.isIdentifier(object) ? object.text : null;
      if (objectText === 'require' && requireMembers.has(member)) hazards.push({ node, what: `require.${member}` });
      else if (objectText === 'module' && moduleMembers.has(member)) hazards.push({ node, what: `module.${member}` });
      else if (objectText === 'process' && member === 'mainModule') hazards.push({ node, what: 'process.mainModule' });
      else if (objectText === 'Error' && member === 'prepareStackTrace') hazards.push({ node, what: 'Error.prepareStackTrace (reads stack frames, which name files)', observesCaller: true });
      else if (objectText === 'Error' && member === 'captureStackTrace') stackText.push(node);
      else if (member === 'stack' && isErrorLike(object, errorVariables)) {
        if (stackUse(node) === 'inspect') hazards.push({ node, what: `${excerpt(sourceFile, node.parent)}: inspects a stack trace, whose frames name files`, observesCaller: true });
        else stackText.push(node);
      } else if (member === 'argv' && calleeText(object) === 'process') {
        const parent = node.parent;
        const index = ts.isElementAccessExpression(parent) && parent.expression === node ? parent.argumentExpression : undefined;
        const sliced = ts.isPropertyAccessExpression(parent) && parent.name.text === 'slice' && ts.isCallExpression(parent.parent) ? parent.parent.arguments[0] : undefined;
        const destructured = ts.isVariableDeclaration(parent) && ts.isArrayBindingPattern(parent.name) && parent.name.elements.length > 1 && !ts.isOmittedExpression(parent.name.elements[1]!);
        if ((index && ts.isNumericLiteral(index) && index.text === '1') || (sliced && ts.isNumericLiteral(sliced) && Number(sliced.text) < 2) || destructured) {
          hazards.push({ node: parent, what: 'process.argv[1] (the entry script path)' });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const range of ts.getLeadingCommentRanges(text, 0) ?? []) {
    const pragma = /@(jest|vitest)-environment\s+(\S+)/.exec(text.slice(range.pos, range.end));
    if (pragma && pragma[2]!.replace(/\*\/$/, '').includes('/')) hazards.push({ node: sourceFile, what: `@${pragma[1]}-environment ${pragma[2]} names a path` });
  }
  visit(sourceFile);
  return { sourceFile, bindings, hazards, stackText, sinks, opaqueLoads, relativeStrings };
}

/** `__dirname` as an expression, not as a declared name or a property key. */
function isValueReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)
    || ts.isPropertyDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isBindingElement(parent)) && parent.name === identifier) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  return true;
}

function isErrorLike(expression: ts.Expression, errorVariables: ReadonlySet<string>): boolean {
  const node = unwrapExpression(expression);
  if (ts.isIdentifier(node)) return errorName.test(node.text) || errorVariables.has(node.text);
  if (ts.isPropertyAccessExpression(node)) return errorName.test(node.name.text);
  if (ts.isNewExpression(node) || ts.isCallExpression(node)) return /(^|\.)\w*Error$/.test(node.expression.getText());
  return false;
}

// Configuration keys whose directory values are resolution roots, not loader targets.
const resolverKeys = new Set(['alias', 'aliases', 'paths', 'moduleNameMapper', 'modulePaths', 'moduleDirectories', 'root', 'roots', 'rootDir', 'baseUrl', 'cwd',
  'tsconfigRootDir', 'projectRoot', 'sourceRoot', 'srcDir']);

function enclosingKeys(node: ts.Node): string[] {
  const keys: string[] = [];
  for (let current: ts.Node = node; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isPropertyAssignment(current) && (ts.isIdentifier(current.name) || ts.isStringLiteralLike(current.name))) keys.push(current.name.text);
  }
  return keys;
}

/** The largest path-building expression around `node`: `path.join(__dirname, '..', x)` around `__dirname`. */
function pathExpressionAround(node: ts.Node, bindings: ReadonlyMap<string, Binding>): ts.Expression {
  let current = node as ts.Expression;
  for (;;) {
    const parent = current.parent;
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent) || ts.isSatisfiesExpression(parent)
      || (ts.isPropertyAccessExpression(parent) && parent.expression === current && ['pathname', 'href'].includes(parent.name.text))
      || (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) current = parent;
    else if (ts.isTemplateSpan(parent)) current = parent.parent;
    else if (ts.isNewExpression(parent) && parent.arguments?.includes(current) && calleeText(parent.expression) === 'URL') current = parent;
    else if (ts.isCallExpression(parent) && parent.arguments.includes(current)) {
      const callee = describeCallee(parent.expression, bindings);
      const family = familyOf(callee?.module ?? null);
      if ((family === 'path' && ['join', 'resolve', 'dirname', 'normalize'].includes(callee!.name)) || (family === 'url' && ['fileURLToPath', 'pathToFileURL'].includes(callee!.name))) current = parent;
      else return current;
    } else return current;
  }
}

interface DiffIndex {
  moved: ReadonlyMap<string, string>;
  /** Destinations of moves (head paths). */
  destinations: ReadonlySet<string>;
  /** Ancestor directory → names directly below it on the way to a moved file's old or new path. */
  touched: ReadonlyMap<string, ReadonlySet<string>>;
  isDirectory(directory: string): boolean;
  /** Direct entries (files and subdirectories) differ between base and head. */
  directChanged(directory: string): boolean;
  layouts: EmittedLayout[];
}

function childNames(tree: CommitTree): Map<string, Set<string>> {
  const children = new Map<string, Set<string>>();
  const add = (directory: string, name: string) => {
    let names = children.get(directory);
    if (!names) children.set(directory, (names = new Set()));
    names.add(name);
  };
  for (const file of tree.entries.keys()) add(path.posix.dirname(file).replace(/^\.$/, ''), path.posix.basename(file));
  for (const directory of tree.directories) if (directory) add(path.posix.dirname(directory).replace(/^\.$/, ''), path.posix.basename(directory));
  return children;
}

function diffIndex(context: CertifyContext, layouts: EmittedLayout[]): DiffIndex {
  const { base, head, pathMap } = context;
  const touched = new Map<string, Set<string>>();
  for (const [from, to] of pathMap.moves) {
    for (const file of [from, to]) {
      const parts = file.split('/');
      for (let depth = 0; depth < parts.length; depth++) {
        const directory = parts.slice(0, depth).join('/');
        let names = touched.get(directory);
        if (!names) touched.set(directory, (names = new Set()));
        names.add(parts[depth]!);
      }
    }
  }
  let baseChildren: Map<string, Set<string>> | undefined;
  let headChildren: Map<string, Set<string>> | undefined;
  return {
    moved: pathMap.moves,
    destinations: new Set(pathMap.moves.values()),
    touched,
    isDirectory: (directory) => base.directories.has(directory) || head.directories.has(directory),
    directChanged(directory) {
      baseChildren ??= childNames(base);
      headChildren ??= childNames(head);
      const before = [...(baseChildren.get(directory) ?? [])].sort().join('\0');
      const after = [...(headChildren.get(directory) ?? [])].sort().join('\0');
      return before !== after;
    },
    layouts,
  };
}

/** A path under an emitted tree (`dist/…`) also names its source (`src/…`, `.js` → `.ts`). */
function withSources(file: string, layouts: readonly EmittedLayout[]): string[] {
  const candidates = [file];
  for (const layout of layouts) {
    if (file !== layout.outDir && !file.startsWith(`${layout.outDir}/`)) continue;
    const source = file === layout.outDir ? layout.rootDir : path.posix.join(layout.rootDir, file.slice(layout.outDir.length + 1));
    candidates.push(source);
    for (const [emitted, sources] of [['.js', ['.ts', '.tsx']], ['.mjs', ['.mts']], ['.cjs', ['.cts']]] as const) {
      if (source.endsWith(emitted)) for (const extension of sources) candidates.push(source.slice(0, -emitted.length) + extension);
    }
  }
  return candidates;
}

/** `x.js` beside `x.ts` is x.ts's emitted twin: run from an outDir, `join(__dirname, 'x.js')` reaches the compiled x.ts. */
function emittedTwins(file: string): string[] {
  const emitted = /\.(m|c)?js$/.exec(file);
  if (!emitted) return [file];
  const stem = file.slice(0, -emitted[0].length);
  return [file, ...(emitted[1] === 'm' ? ['.mts'] : emitted[1] === 'c' ? ['.cts'] : ['.ts', '.tsx']).map((extension) => stem + extension)];
}

function moduleCandidates(file: string): string[] {
  const candidates = [file, ...sourceExtensions.map((extension) => file + extension), ...sourceExtensions.map((extension) => `${file}/index${extension}`)];
  const emitted = /\.(m|c)?jsx?$/.exec(file);
  if (emitted) candidates.push(file.slice(0, -emitted[0].length) + (emitted[1] === 'm' ? '.mts' : emitted[1] === 'c' ? '.cts' : '.ts'), `${file.slice(0, -emitted[0].length)}.tsx`);
  return candidates;
}

const describeMove = (index: DiffIndex, file: string) => (index.moved.has(file) ? `${file} (moved to ${index.moved.get(file)})` : `${file} (where a moved file now lives)`);
const changedBelow = (index: DiffIndex, directory: string, prefix: string) => [...(index.touched.get(directory) ?? [])].filter((name) => name.startsWith(prefix));
const isAncestorOrSelf = (directory: string, file: string) => directory === '' || file === directory || file.startsWith(`${directory}/`);

/**
 * What a computed path in a non-moved file reaches that moved, or null. A complete directory path that contains
 * the file itself or the package root (`resolve(import.meta.dirname, '..')`) is a root, not a loader target, unless
 * it is listed.
 */
function checkLocated(location: Located, sink: Sink, file: string, index: DiffIndex, packageRoot: string): string | null {
  if (!location.complete) {
    for (const directory of withSources(location.directory, index.layouts)) {
      if (!index.isDirectory(directory)) continue;
      const changed = changedBelow(index, directory, location.prefix);
      if (changed.length) return `computes a path inside ${directory || '.'}${location.prefix ? ` (names starting '${location.prefix}')` : ''}, whose tracked contents changed (${changed.slice(0, 4).join(', ')})`;
    }
    return null;
  }
  for (const candidate of withSources(location.path, index.layouts)) {
    const hit = (sink.kind === 'module' ? moduleCandidates(candidate) : emittedTwins(candidate)).find((target) => index.moved.has(target) || index.destinations.has(target));
    if (hit) return `names ${describeMove(index, hit)}`;
    if (sink.kind === 'module' || !index.isDirectory(candidate)) continue;
    if (sink.kind === 'enumerate' && !sink.recursive) {
      if (index.directChanged(candidate)) return `lists directory ${candidate || '.'}, whose entries changed`;
      continue;
    }
    const changed = changedBelow(index, candidate, '');
    const rootReference = isAncestorOrSelf(candidate, path.posix.dirname(file)) || isAncestorOrSelf(candidate, packageRoot);
    if (changed.length && (sink.kind === 'enumerate' || !rootReference)) return `uses directory ${candidate || '.'}, whose tracked contents changed (below it: ${changed.slice(0, 4).join(', ')})`;
  }
  return null;
}

function basesFor(sink: Sink, value: PathValue, file: string, context: CertifyContext): string[] {
  if (value.anchor !== 'string') return cwdBases(context, file, context.base);
  if (sink.strings === 'module') return /^\.\.?(\/|$)/.test(value.text) ? [path.posix.dirname(file).replace(/^\.$/, '')] : [context.options.packageRoot, ''];
  return cwdBases(context, file, context.base);
}

/** `roots` collects every complete path the file's path expressions and path-taking calls name: what a consumer may be rooted at. */
function checkSinks(scanned: ScannedFile, file: string, context: CertifyContext, index: DiffIndex, roots: Set<string>): { violations: Violation[]; findings: Finding[] } {
  const violations: Violation[] = [];
  const findings: Finding[] = [];
  const { sourceFile, bindings } = scanned;
  const evaluate = pathEvaluator(sourceFile, file, bindings);
  const sinkNodes = new Set(scanned.sinks.map((sink) => sink.node));
  const sinks = [...scanned.sinks];
  // Path expressions built from a location (or path.join/resolve) that no recognized call consumes: a directory or
  // file handed to some loader (`models: [join(__dirname, 'models')]`, autoload dirs).
  const constructions = new Set<ts.Expression>();
  const collect = (node: ts.Node): void => {
    const token = (ts.isIdentifier(node) && (node.text === '__dirname' || node.text === '__filename') && isValueReference(node))
      || (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && ['dirname', 'filename', 'url'].includes(node.name.text));
    const pathCall = ts.isCallExpression(node) && (() => {
      const callee = describeCallee(node.expression, bindings);
      return familyOf(callee?.module ?? null) === 'path' && (callee!.name === 'join' || callee!.name === 'resolve');
    })();
    if (token || pathCall) {
      const outer = pathExpressionAround(node, bindings);
      if (!sinkNodes.has(outer)) constructions.add(outer);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  for (const node of constructions) sinks.push({ kind: 'construction', node, call: 'path expression', recursive: true, strings: 'cwd' });

  const seen = new Set<string>();
  const report = (sink: Sink, problem: string) => {
    const line = lineOf(sourceFile, sink.node);
    const key = `${line}\0${problem}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ file, detail: `line ${line}: ${sink.kind === 'construction' ? '' : `${sink.call}(…) `}${excerpt(sourceFile, sink.node)} ${problem}` });
  };
  for (const sink of sinks) {
    const resolverRoot = sink.kind === 'construction' && enclosingKeys(sink.node).some((key) => resolverKeys.has(key));
    for (const value of evaluate(sink.node)) {
      if (sink.pathLikeOnly && value.anchor === 'string' && !pathLike(value.text)) continue;
      if (value.complete) for (const location of locate(value, basesFor(sink, value, file, context))) roots.add(location.path);
      if (sink.kind === 'construction' && value.anchor === 'string') continue;
      // A directory given to a resolver (an alias target, a runner root) is judged by K3 and K6, which resolve through it.
      if (resolverRoot && value.complete && !/[*?[{]/.test(value.text)) continue;
      // A cwd value with nothing static after the cwd is input-dependent, like an opaque path.
      if (value.anchor === 'cwd' && !value.complete && /^\.?\/?$/.test(value.text)) continue;
      for (const location of locate(value, basesFor(sink, value, file, context))) {
        if ((sink.kind === 'glob' || sink.kind === 'construction') && location.complete && /[*?[{]/.test(location.path)) {
          const pattern = globToRegExp(location.path);
          const changed = [...index.moved].filter(([from, to]) => pattern.test(from) !== pattern.test(to));
          if (changed.length) report(sink, `matches a different set of files (${changed.length} moved, e.g. ${changed[0]![0]} -> ${changed[0]![1]})`);
          const reordered = changed.length ? null : globOrderChange(pattern, context);
          if (reordered) report(sink, `matches the same files in a different order: ${reordered}`);
          continue;
        }
        const problem = checkLocated(location, sink, file, index, context.options.packageRoot);
        if (problem) report(sink, problem);
      }
    }
  }
  for (const node of scanned.opaqueLoads) {
    findings.push({ kind: 'opaque-dynamic-load', file, detail: `line ${lineOf(sourceFile, node)}: ${excerpt(sourceFile, node)} loads a module by a path K4 can't evaluate` });
  }
  return { violations, findings };
}

/** For a location token in a moved file: what the surrounding path expression pointed at before and after. */
function locationDetail(scanned: ScannedFile, hazard: Hazard, from: string, to: string, context: CertifyContext): { detail: string; unchanged: boolean } {
  const { sourceFile, bindings } = scanned;
  const outer = pathExpressionAround(hazard.node, bindings);
  const describe = (file: string, tree: CommitTree) => pathEvaluator(sourceFile, file, bindings)(outer).flatMap((value) => locate(value, [])).map((location) => {
    const exists = location.complete && (tree.entries.has(location.path) || tree.directories.has(location.path));
    return { text: `${location.path || '.'}${location.complete ? '' : '…'}`, exists, complete: location.complete };
  });
  const before = describe(from, context.base);
  const after = describe(to, context.head);
  const expression = excerpt(sourceFile, outer);
  if (before.length !== 1 || after.length !== 1) return { detail: `${hazard.what} in ${expression}`, unchanged: false };
  const [old, now] = [before[0]!, after[0]!];
  if (old.complete && now.complete && old.text === now.text) return { detail: `${hazard.what} in ${expression}`, unchanged: true };
  const state = (location: typeof old) => (location.complete ? (location.exists ? 'exists' : 'missing') : 'dynamic');
  return { detail: `${hazard.what}: ${expression} pointed at ${old.text} (${state(old)} in base), now at ${now.text} (${state(now)} in head)`, unchanged: false };
}

/**
 * Path strings in a moved file that name something beside it in base which does not keep its place relative to the
 * file: whatever resolves them against the file (`toMatchFileSnapshot`, a caller-location helper, `readBeside('x.txt')`)
 * now reaches something else. A string resolved against the cwd almost never names a file beside the module. Strings
 * inside a location-token expression are that hazard's business. A string that names a module only by module
 * resolution (`'../lib/format'`) can be a module path only to a loader: this file's computed loaders are hazards, so
 * it counts only when the repository has an opaque load (`opaqueLoads`); otherwise it is a finding.
 */
function strandedStrings(context: CertifyContext, moved: MovedScan, opaqueLoads: readonly string[]): { violations: Violation[]; findings: Finding[] } {
  const { scanned, from, to } = moved;
  const { sourceFile } = scanned;
  const sites = context.views.base(from)?.sites ?? [];
  const violations: Violation[] = [];
  const findings: Finding[] = [];
  const covered = scanned.hazards.filter((hazard) => hazard.token).map((hazard) => pathExpressionAround(hazard.node, scanned.bindings));
  const directory = (file: string) => path.posix.dirname(file).replace(/^\.$/, '');
  const resolveFrom = (file: string, text: string) => path.posix.normalize(path.posix.join(directory(file) || '.', text)).replace(/\/+$/, '').replace(/^\.$/, '');
  for (const literal of scanned.relativeStrings) {
    const [start, end] = [literal.getStart(sourceFile), literal.getEnd()];
    // './', '..': fragments (`specifier.startsWith('./')`), not names; as paths they come with a location token.
    if (literal.text.startsWith('/') || /^[./]*$/.test(literal.text) || sites.some((site) => site.start < end && site.end > start)) continue;
    if (covered.some((outer) => outer.getStart(sourceFile) <= start && end <= outer.getEnd())) continue;
    const before = resolveFrom(from, literal.text);
    if (before.startsWith('..')) continue;
    const { base } = context;
    const exact = base.entries.has(before) ? [before] : base.directories.has(before) ? [...base.entries.keys()].filter((file) => file.startsWith(`${before}/`)) : [];
    const module = exact.length === 0 && /^\.\.?(\/|$)/.test(literal.text) ? moduleCandidates(before).find((file) => base.entries.has(file)) : undefined;
    const after = resolveFrom(to, literal.text);
    // A file keeps its place when its head path is the string resolved from the new location, plus the same rest.
    // The file's own name (a logger label) names nothing else wherever the file goes.
    const stranded = [...exact, ...(module ? [module] : [])].find((file) => file !== from && context.pathMap.map(file) !== after + file.slice(before.length));
    if (!stranded) continue;
    const detail = `moved to ${to}; line ${lineOf(sourceFile, literal)}: '${literal.text}' names ${stranded} beside the file in base; from the new location it names ${after + stranded.slice(before.length) || '.'}, while ${stranded} is at ${context.pathMap.map(stranded)}`;
    if (module && opaqueLoads.length === 0) findings.push({ kind: 'relative-path-string', file: from, detail: `${detail}; no load in the repository takes an opaque path` });
    else violations.push({ file: from, detail: module ? `${detail}; the opaque load at ${opaqueLoads[0]} can take it as a module path` : detail });
  }
  return { violations, findings };
}

interface MovedScan {
  scanned: ScannedFile;
  from: string;
  to: string;
}

/**
 * `copy`: `to` is an added file whose content is `from`'s (modulo specifiers); reported at `to`.
 * `added`: `to` is an added file with no base counterpart (from === to, read from head); its uses are reported as is.
 */
/** `roots`: where a moved file's location-derived paths point from its new place (what a consumer may be rooted at). */
function scanMovedFile(context: CertifyContext, from: string, to: string, kind: 'move' | 'copy' | 'added' = 'move', roots?: Set<string>): { violations: Violation[]; findings: Finding[]; moved?: MovedScan } {
  const copy = kind !== 'move';
  const text = kind === 'added' ? context.head.text(to) : context.base.text(from);
  const violations: Violation[] = [];
  const findings: Finding[] = [];
  if (text === undefined || !isScannedSource(from, text)) return { violations, findings };
  const scanned = scanFile(from, text);
  const { sourceFile } = scanned;
  for (const hazard of scanned.hazards) {
    const line = lineOf(sourceFile, hazard.node);
    let detail = hazard.what;
    if (hazard.token && roots) {
      for (const value of pathEvaluator(sourceFile, to, scanned.bindings)(pathExpressionAround(hazard.node, scanned.bindings))) {
        for (const location of locate(value, [])) if (location.complete) roots.add(location.path);
      }
    }
    if (hazard.token && kind !== 'added') {
      const located = locationDetail(scanned, hazard, from, to, context);
      // A directory-only rename keeps every location-derived value (only when the whole expression evaluates).
      if (located.unchanged) continue;
      detail = located.detail;
    }
    const where = kind === 'added' ? 'added with no base counterpart;' : copy ? `a copy of ${from};` : `moved to ${to};`;
    violations.push({ file: copy ? to : from, detail: `${where} line ${line}: ${detail}` });
  }
  if (scanned.stackText.length) {
    const where = { file: copy ? to : from, detail: kind === 'added' ? 'added with no base counterpart;' : copy ? `a copy of ${from};` : `moved to ${to};` };
    findings.push({ kind: 'stack-text', file: where.file, detail: `${where.detail} ${scanned.stackText.length} stack-trace reads passed along as text (line ${lineOf(sourceFile, scanned.stackText[0]!)}); their frames now name the new path` });
  }
  return { violations, findings, ...(kind === 'move' ? { moved: { scanned, from, to } } : {}) };
}

/**
 * Moved files that import a module which reads its caller's location (an in-repo `callerDirectory()` built on stack
 * frames, a wrapper around callsites): the module's behavior follows its callers' paths. Direct importers only; a
 * caller reached through another unmoved wrapper is a residual.
 */
function movedCallers(context: CertifyContext, observers: ReadonlyMap<string, string>): Violation[] {
  if (observers.size === 0) return [];
  const analysis = context.analyses().base;
  const violations: Violation[] = [];
  for (const [from, to] of context.pathMap.moves) {
    const targets = new Set((analysis.files.get(from)?.sites ?? []).flatMap((site) => (site.resolution.type === 'file' ? [site.resolution.path] : [])));
    for (const target of targets) {
      const observer = observers.get(target);
      if (observer) violations.push({ file: from, detail: `moved to ${to}; imports ${target}, which reads its caller's location (${observer}): it now sees ${to}` });
    }
  }
  return violations;
}

/** `judgedStrings`: old-path findings for strings in code or config whose syntax shows they name nothing the move changed. */
export function checkLocations(context: CertifyContext): { violations: Violation[]; findings: Finding[]; metrics: Record<string, number>; judgedStrings: number } {
  const { base, pathMap } = context;
  const layouts = emittedLayouts(context);
  const index = diffIndex(context, layouts);
  const violations: Violation[] = [];
  const findings: Finding[] = [];
  // JS/TS by extension, or extensionless (a `#!…node` script); everything else can't hold a path-exposing call.
  const sources = [...base.entries.values()].filter((entry) => entry.mode !== '160000' && entry.mode !== '120000' && !entry.path.split('/').includes('node_modules')
    && (isScannedSource(entry.path, '') || !path.posix.basename(entry.path).includes('.'))).map((entry) => entry.path);
  base.prefetch(sources);

  // Complete paths the repository's code computes: directories a consumer may be rooted at (old-path-scan.ts).
  const computedPaths = new Set<string>();
  let movedScanned = 0;
  let movedHazards = 0;
  const movedScans: MovedScan[] = [];
  for (const [from, to] of pathMap.moves) {
    const outcome = scanMovedFile(context, from, to, 'move', computedPaths);
    if (outcome.moved) movedScans.push(outcome.moved);
    movedScanned++;
    movedHazards += outcome.violations.length;
    violations.push(...outcome.violations);
    findings.push(...outcome.findings);
  }

  // Added files (K1 already rejects them) that observe their location: named, so a copy-instead-of-move restructure
  // shows which copies would break once wired in.
  let copyHazards = 0;
  for (const added of pathMap.added) {
    const outcome = added.copyOf ? scanMovedFile(context, added.copyOf, added.path, 'copy') : scanMovedFile(context, added.path, added.path, 'added');
    copyHazards += outcome.violations.length;
    violations.push(...outcome.violations);
    findings.push(...outcome.findings);
  }

  let computedScanned = 0;
  let computedViolations = 0;
  const opaqueLoads: string[] = [];
  const callerObservers = new Map<string, string>();
  if (pathMap.moves.size) {
    for (const file of sources) {
      if (pathMap.map(file) !== file) continue;
      const text = base.text(file);
      if (text === undefined || !isScannedSource(file, text)) continue;
      computedScanned++;
      const scanned = scanFile(file, text);
      const outcome = checkSinks(scanned, file, context, index, computedPaths);
      computedViolations += outcome.violations.length;
      violations.push(...outcome.violations);
      findings.push(...outcome.findings);
      for (const node of scanned.opaqueLoads) opaqueLoads.push(`${file} line ${lineOf(scanned.sourceFile, node)}`);
      const observer = scanned.hazards.find((hazard) => hazard.observesCaller);
      if (observer) callerObservers.set(file, `line ${lineOf(scanned.sourceFile, observer.node)}: ${observer.what}`);
    }
  }
  const callerViolations = movedCallers(context, callerObservers);
  movedHazards += callerViolations.length;
  violations.push(...callerViolations);
  for (const moved of movedScans) {
    const outcome = strandedStrings(context, moved, opaqueLoads);
    movedHazards += outcome.violations.length;
    violations.push(...outcome.violations);
    findings.push(...outcome.findings);
  }

  const inertAdditions = new Set([...addedToolConfigs(context)].filter(([, check]) => check.problem === null).map(([file]) => file));
  const oldPaths = scanOldPaths(context, layouts, opaqueLoads, inertAdditions, computedPaths);
  violations.push(...oldPaths.violations);
  findings.push(...oldPaths.findings);
  return {
    violations,
    findings,
    metrics: { movedFilesScanned: movedScanned, movedFileHazards: movedHazards, copiedFileHazards: copyHazards, filesScannedForComputedPaths: computedScanned, computedPathViolations: computedViolations, ...oldPaths.metrics },
    judgedStrings: oldPaths.findings.filter((finding) => judgedStringKinds.has(finding.kind)).length,
  };
}

export const locationScan: Check = {
  id: 'K4',
  title,
  run(context) {
    const { violations, findings, metrics, judgedStrings } = checkLocations(context);
    // Strings the syntax around them clears are findings in code and config, not in docs or comments: counted apart.
    const listed = judgedStrings
      ? `${metrics.oldPathFindings} findings: ${metrics.oldPathFindings! - judgedStrings} in docs, comments or ungated coverage settings, ${judgedStrings} strings in code or config whose syntax shows they name nothing the move changed`
      : `${metrics.oldPathFindings} findings in docs, comments or ungated coverage settings`;
    const summary = violations.length
      ? `${metrics.movedFileHazards} path-exposing uses in moved files${metrics.copiedFileHazards ? ` (and ${metrics.copiedFileHazards} in added files)` : ''}, ${metrics.computedPathViolations} computed paths into changed directories, ${metrics.oldPathViolations} old paths in code/config (${metrics.coverageViolations} in coverage settings)`
      : `${metrics.movedFilesScanned} moved files expose no location; no computed path reaches a change; no old path in code, config or CI (${listed})`;
    return result('K4', title, { summary, violations, findings, metrics });
  },
};

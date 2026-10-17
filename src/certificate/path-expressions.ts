// Static evaluation of path-building expressions for K4 (plan §3.4): where `path.join(__dirname, '../services', name)`
// or import(`./handlers/${name}.js`) points, as far as its literal parts say. A value is anchored at a repository
// location (derived from the file's own location), at the process cwd, or not yet (a relative string that the
// consuming call anchors). Parameters, environment variables and call results are opaque: no value.
import path from 'node:path';
import ts from 'typescript';

/** Virtual absolute root of repository coordinates; a path that climbs out of the repository loses this prefix. */
export const virtualRoot = '/repo';

export interface PathValue {
  /** repo: `text` is absolute under virtualRoot; cwd: relative to the process cwd; string: a relative string; absolute: outside the repo. */
  anchor: 'repo' | 'cwd' | 'string' | 'absolute';
  text: string;
  /** False when a dynamic part follows `text` (a trailing '/' means the dynamic part starts a new segment). */
  complete: boolean;
}

/** A local name bound to a module: `member` null is the module object itself (default or namespace import). */
export interface Binding {
  module: string;
  member: string | null;
}

export type Family = 'path' | 'fs' | 'process' | 'worker' | 'glob' | 'url' | 'module' | 'util' | 'caller-location';

const families: Record<string, Family> = {
  path: 'path', 'path/posix': 'path', 'path/win32': 'path', upath: 'path', pathe: 'path',
  fs: 'fs', 'fs/promises': 'fs', 'fs-extra': 'fs', 'graceful-fs': 'fs', 'original-fs': 'fs',
  child_process: 'process', 'cross-spawn': 'process', execa: 'process',
  worker_threads: 'worker', glob: 'glob', 'fast-glob': 'glob', globby: 'glob', tinyglobby: 'glob',
  url: 'url', module: 'module', util: 'util',
  // Libraries that observe their caller's location (research 04b A24).
  'parent-module': 'caller-location', 'caller-path': 'caller-location', 'caller-callsite': 'caller-location', callsites: 'caller-location',
  'get-caller-file': 'caller-location', 'import-fresh': 'caller-location', 'require-directory': 'caller-location', 'require-all': 'caller-location',
  'require-dir': 'caller-location', 'import-modules': 'caller-location',
};

export function familyOf(module: string | null): Family | null {
  if (module === null) return null;
  return families[module.replace(/^node:/, '')] ?? null;
}

// Unimported objects that conventionally hold these modules.
const conventionalNames: Record<string, string> = { fs: 'fs', fsp: 'fs', fse: 'fs', fsPromises: 'fs', fsExtra: 'fs', path: 'path', childProcess: 'child_process', cp: 'child_process' };

const unwrap = (node: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isAwaitExpression(node)) node = node.expression;
  return node;
};
export { unwrap as unwrapExpression };

const requireCall = (node: ts.Expression | undefined): string | null => {
  if (!node) return null;
  const inner = unwrap(node);
  if (ts.isCallExpression(inner) && (inner.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(inner.expression) && inner.expression.text === 'require'))) {
    const argument = inner.arguments[0];
    return argument && ts.isStringLiteralLike(argument) ? argument.text : null;
  }
  return null;
};

export function moduleBindings(sourceFile: ts.SourceFile): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause) {
      const module = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause.name) bindings.set(clause.name.text, { module, member: null });
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) bindings.set(clause.namedBindings.name.text, { module, member: null });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) bindings.set(element.name.text, { module, member: (element.propertyName ?? element.name).text });
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      bindings.set(node.name.text, { module: node.moduleReference.expression.text, member: null });
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer = unwrap(node.initializer);
      let module = requireCall(initializer);
      let member: string | null = null;
      if (module === null && ts.isPropertyAccessExpression(initializer)) {
        module = requireCall(initializer.expression);
        member = initializer.name.text;
      }
      if (module !== null) {
        if (ts.isIdentifier(node.name)) bindings.set(node.name.text, { module, member });
        else if (ts.isObjectBindingPattern(node.name) && member === null) {
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            const property = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text;
            bindings.set(element.name.text, { module, member: property });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

export interface Callee {
  module: string | null;
  /** The function's name: the imported member, the accessed property, or 'default' for a called module object. */
  name: string;
  /** The receiver's text for unbound method calls (`this.storage` in `this.storage.readdir`). */
  receiver?: string;
}

export function describeCallee(expression: ts.Expression, bindings: ReadonlyMap<string, Binding>): Callee | null {
  const node = unwrap(expression);
  if (ts.isIdentifier(node)) {
    const binding = bindings.get(node.text);
    return binding ? { module: binding.module, name: binding.member ?? 'default' } : { module: null, name: node.text };
  }
  const member = ts.isPropertyAccessExpression(node) ? node.name.text
    : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
  if (member === null || !(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return null;
  const object = unwrap(node.expression);
  if (ts.isIdentifier(object)) {
    const binding = bindings.get(object.text);
    if (binding) return { module: binding.module, name: member };
    const conventional = conventionalNames[object.text];
    return conventional ? { module: conventional, name: member } : { module: null, name: member, receiver: object.text };
  }
  const inner = describeCallee(object, bindings);
  // `fs.promises.readFile`, `path.posix.join`: the namespace of a module is that module.
  if (inner?.module && ['promises', 'posix', 'win32', 'default'].includes(inner.name)) return { module: inner.module, name: member };
  return { module: null, name: member, receiver: object.getText().slice(0, 60) };
}

const isUrlLike = (text: string) => /^[a-z][a-z0-9+.-]+:/i.test(text);
const classify = (value: PathValue): PathValue | null => {
  if (value.anchor !== 'string') return value;
  if (isUrlLike(value.text)) return null;
  if (value.text.startsWith('/') || value.text.startsWith('~')) return { ...value, anchor: 'absolute' };
  return value;
};

const maxAlternatives = 4;

const commonPrefix = (texts: string[]) => texts.reduce((prefix, text) => {
  let length = 0;
  while (length < prefix.length && prefix[length] === text[length]) length++;
  return prefix.slice(0, length);
});

/**
 * Distinct values; past `maxAlternatives`, each anchor's values widen to their common prefix with a dynamic rest, so
 * the 5th branch of a conditional still counts (as part of a wider value) instead of being dropped.
 */
const dedupe = (values: PathValue[]): PathValue[] => {
  const distinct = [...new Map(values.map((value) => [`${value.anchor}\0${value.text}\0${value.complete}`, value])).values()];
  if (distinct.length <= maxAlternatives) return distinct;
  const anchors = [...new Set(distinct.map((value) => value.anchor))];
  return anchors.map((anchor) => ({ anchor, text: commonPrefix(distinct.filter((value) => value.anchor === anchor).map((value) => value.text)), complete: false }));
};

/** Appends text (or a dynamic part) to a value, as string concatenation does. */
function append(value: PathValue, next: PathValue | null): PathValue {
  if (!value.complete) return value;
  if (next === null) return { ...value, complete: false };
  if (next.anchor === 'string' || next.anchor === 'absolute') return { ...value, text: value.text + next.text, complete: next.complete };
  return { ...value, complete: false };
}

const empty: PathValue = { anchor: 'string', text: '', complete: true };

/** String concatenation of parts, each a list of alternatives (an empty list is an opaque part). */
function concatenate(parts: PathValue[][]): PathValue[] {
  let current: PathValue[] = [empty];
  for (const alternatives of parts) {
    const next: PathValue[] = [];
    for (const value of current) {
      const atStart = value.anchor === 'string' && value.text === '' && value.complete;
      if (alternatives.length === 0) {
        if (!atStart) next.push(append(value, null));
        continue;
      }
      for (const alternative of alternatives) next.push(atStart ? alternative : append(value, alternative));
    }
    current = dedupe(next);
    if (current.length === 0) return [];
  }
  return current.map(classify).filter((value): value is PathValue => value !== null && !(value.anchor === 'string' && value.text === '' && value.complete));
}

/** `path.join`: segments joined with '/', normalized; a dynamic segment ends the static part. */
function join(first: PathValue[], rest: PathValue[][]): PathValue[] {
  let current = first;
  for (const alternatives of rest) {
    current = dedupe(current.flatMap((value) => {
      if (!value.complete) return [value];
      if (alternatives.length === 0) return [{ ...value, text: `${value.text}/`, complete: false }];
      return alternatives.map((alternative) => alternative.anchor === 'string' || alternative.anchor === 'absolute'
        ? { ...value, text: joinText(value.text, alternative.text), complete: alternative.complete }
        : { ...value, text: `${value.text}/`, complete: false });
    }));
  }
  return current;
}

/** posix join that keeps a trailing '/' (it marks where a dynamic segment starts). */
const joinText = (left: string, right: string) => {
  if (right === '') return left;
  const joined = path.posix.join(left || '.', right);
  return right.endsWith('/') && !joined.endsWith('/') ? `${joined}/` : joined;
};

/** `path.resolve`: like join from the cwd, restarting at every absolute or located segment. */
function resolve(argumentsList: PathValue[][]): PathValue[] {
  let current: PathValue[] = [{ anchor: 'cwd', text: '.', complete: true }];
  for (const alternatives of argumentsList) {
    current = dedupe(current.flatMap((value) => {
      if (!value.complete) return [value];
      if (alternatives.length === 0) return [{ ...value, text: `${value.text}/`, complete: false }];
      return alternatives.map((alternative) => (alternative.anchor === 'string' ? { ...value, text: joinText(value.text, alternative.text), complete: alternative.complete } : alternative));
    }));
  }
  return current;
}

const dirname = (values: PathValue[]) => values.map((value) => (value.complete ? { ...value, text: path.posix.dirname(value.text) } : value));

export type Evaluate = (node: ts.Expression) => PathValue[];

/**
 * The expressions a name of the file can stand for: `const x = …`; `for (const x of [a, b])` (each element); a
 * parameter of a function only this file calls (each call's argument, and the default); class properties with an
 * initializer. A name declared twice is ambiguous (null), and so is a parameter some call can't name.
 */
function constantInitializers(sourceFile: ts.SourceFile): { constants: Map<string, ts.Expression[] | null>; properties: Map<string, ts.Expression[] | null> } {
  const constants = new Map<string, ts.Expression[] | null>();
  const properties = new Map<string, ts.Expression[] | null>();
  const record = (map: Map<string, ts.Expression[] | null>, name: string, alternatives: ts.Expression[] | null) => {
    map.set(name, map.has(name) || !alternatives ? null : alternatives);
  };
  const callSites = locallyCalledFunctions(sourceFile);
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const constant = ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
      const loop = node.parent.parent;
      const elements = constant && ts.isForOfStatement(loop) && loop.initializer === node.parent ? literalElements(loop.expression) : null;
      record(constants, node.name.text, elements ?? (constant && node.initializer ? [node.initializer] : null));
    } else if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      const readonly = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false;
      record(properties, node.name.text, readonly && node.initializer ? [node.initializer] : null);
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      record(constants, node.name.text, parameterArguments(node, callSites));
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      // A function or class with the same name shadows a constant somewhere: the name is ambiguous.
      record(constants, node.name.text, null);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { constants, properties };
}

/** The elements of `[a, b, c]` (no spread, no hole), or null. */
function literalElements(expression: ts.Expression): ts.Expression[] | null {
  const array = unwrap(expression);
  if (!ts.isArrayLiteralExpression(array) || array.elements.some((element) => ts.isSpreadElement(element) || ts.isOmittedExpression(element))) return null;
  return [...array.elements];
}

/**
 * Functions declared in the file (not exported) whose name is used only as the callee of direct calls in the file:
 * their calls are all known, so each parameter takes exactly the arguments given at those calls.
 */
function locallyCalledFunctions(sourceFile: ts.SourceFile): Map<ts.SignatureDeclaration, ts.CallExpression[]> {
  const declarations = new Map<string, ts.SignatureDeclaration | null>();
  const declare = (name: string, declaration: ts.SignatureDeclaration | null) => declarations.set(name, declarations.has(name) ? null : declaration);
  const exported = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword);
  const collect = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) declare(node.name.text, exported(node) ? null : node);
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      const initializer = node.initializer && unwrap(node.initializer);
      const statement = node.parent.parent;
      const function_ = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) ? initializer : null;
      declare(node.name.text, function_ && !(ts.isVariableStatement(statement) && exported(statement)) ? function_ : null);
    } else if ((ts.isParameter(node) || ts.isClassDeclaration(node) || ts.isBindingElement(node) || ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node))
      && node.name && ts.isIdentifier(node.name)) declare(node.name.text, null);
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  const calls = new Map<ts.SignatureDeclaration, ts.CallExpression[]>();
  const disqualified = new Set<ts.SignatureDeclaration>();
  const uses = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const declaration = declarations.get(node.text);
      if (declaration && node !== declaration.name && !isNameOnly(node) && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node)) {
        const call = node.parent;
        if (ts.isCallExpression(call) && call.expression === node) calls.set(declaration, [...(calls.get(declaration) ?? []), call]);
        else disqualified.add(declaration);
      }
    }
    ts.forEachChild(node, uses);
  };
  uses(sourceFile);
  for (const declaration of disqualified) calls.delete(declaration);
  return calls;
}

/** The target of an assignment, `++` or `--`. */
function isAssigned(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isBinaryExpression(parent)) return parent.left === identifier && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
  return (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken);
}

/** An identifier that names a property or a type, not a value of the scope. */
function isNameOnly(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === identifier) || ts.isQualifiedName(parent)
    || ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)
      || ts.isMethodSignature(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent) || ts.isEnumMember(parent)) && parent.name === identifier)
    || ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent) || ts.isJsxAttribute(parent) || ts.isLabeledStatement(parent)
    || ts.isBreakOrContinueStatement(parent);
}

/**
 * A parameter's arguments at every call of its function, plus its default; null when a call doesn't name it, or the
 * function assigns the parameter or reads `arguments` (which can alias it).
 */
function parameterArguments(parameter: ts.ParameterDeclaration, callSites: ReadonlyMap<ts.SignatureDeclaration, ts.CallExpression[]>): ts.Expression[] | null {
  const signature = parameter.parent;
  const calls = callSites.get(signature);
  const position = signature.parameters.indexOf(parameter);
  if (!calls || parameter.dotDotDotToken || signature.parameters.slice(0, position).some((earlier) => earlier.dotDotDotToken)) return null;
  const name = (parameter.name as ts.Identifier).text;
  let rebound = false;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && (node.text === 'arguments' || (node.text === name && isAssigned(node)))) rebound = true;
    if (!rebound) ts.forEachChild(node, visit);
  };
  if ('body' in signature && signature.body) visit(signature.body);
  if (rebound) return null;
  const alternatives: ts.Expression[] = parameter.initializer ? [parameter.initializer] : [];
  for (const call of calls) {
    if (call.arguments.slice(0, position + 1).some((argument) => ts.isSpreadElement(argument))) return null;
    const argument = call.arguments[position];
    if (argument) alternatives.push(argument);
    else if (!parameter.initializer) return null;
  }
  return alternatives.length ? alternatives : null;
}

/**
 * An evaluator for expressions of `sourceFile` as if the file lived at `file` (repo-relative). Location tokens
 * (`__dirname`, `import.meta.dirname`, ...) evaluate to repository paths; `process.cwd()` to the cwd.
 */
export function pathEvaluator(sourceFile: ts.SourceFile, file: string, bindings: ReadonlyMap<string, Binding>): Evaluate {
  const { constants, properties } = constantInitializers(sourceFile);
  const own = path.posix.join(virtualRoot, file);
  const located = (text: string): PathValue[] => [{ anchor: 'repo', text, complete: true }];
  const active = new Set<ts.Node>();
  // A name with several alternatives (loop elements, call arguments) is opaque when any of them is.
  const alternativesOf = (alternatives: ts.Expression[] | null | undefined): PathValue[] => {
    const values: PathValue[] = [];
    for (const alternative of alternatives ?? []) {
      const value = evaluate(alternative);
      if (value.length === 0) return [];
      values.push(...value);
    }
    return dedupe(values);
  };

  const evaluate = (input: ts.Expression): PathValue[] => {
    const node = unwrap(input);
    if (active.has(node) || active.size > 12) return [];
    active.add(node);
    try {
      return dedupe(evaluateNode(node));
    } finally {
      active.delete(node);
    }
  };

  const evaluateNode = (node: ts.Expression): PathValue[] => {
    if (ts.isStringLiteralLike(node)) {
      const value = classify({ anchor: 'string', text: node.text, complete: true });
      return value ? [value] : [];
    }
    if (ts.isTemplateExpression(node)) {
      const parts: PathValue[][] = [[{ anchor: 'string', text: node.head.text, complete: true }]];
      for (const span of node.templateSpans) {
        parts.push(evaluate(span.expression));
        parts.push([{ anchor: 'string', text: span.literal.text, complete: true }]);
      }
      return concatenate(parts);
    }
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const parts: PathValue[][] = [];
        const flatten = (operand: ts.Expression) => {
          const inner = unwrap(operand);
          if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            flatten(inner.left);
            flatten(inner.right);
          } else parts.push(ts.isStringLiteralLike(inner) ? [{ anchor: 'string', text: inner.text, complete: true }] : evaluate(inner));
        };
        flatten(node);
        return concatenate(parts);
      }
      if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken) return [...evaluate(node.left), ...evaluate(node.right)];
      return [];
    }
    if (ts.isConditionalExpression(node)) return [...evaluate(node.whenTrue), ...evaluate(node.whenFalse)];
    if (ts.isIdentifier(node)) {
      if (node.text === '__dirname') return located(path.posix.dirname(own));
      if (node.text === '__filename') return located(own);
      return alternativesOf(constants.get(node.text));
    }
    if (ts.isPropertyAccessExpression(node)) {
      const object = unwrap(node.expression);
      const name = node.name.text;
      if (ts.isMetaProperty(object) && object.keywordToken === ts.SyntaxKind.ImportKeyword) {
        if (name === 'dirname') return located(path.posix.dirname(own));
        if (name === 'filename' || name === 'url') return located(own);
        return [];
      }
      if (name === 'pathname' || name === 'href') return evaluate(object);
      if (object.kind === ts.SyntaxKind.ThisKeyword || ts.isIdentifier(object)) return alternativesOf(properties.get(name));
      return [];
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.length) {
      const [relative, base] = node.arguments;
      if (!base) return [];
      const relatives = evaluate(relative!);
      return evaluate(base).flatMap((baseValue) => (baseValue.anchor !== 'repo' || !baseValue.complete ? []
        : relatives.filter((value) => value.anchor === 'string').map((value) => {
          const directory = baseValue.text.endsWith('/') ? baseValue.text : `${path.posix.dirname(baseValue.text)}/`;
          return { anchor: 'repo' as const, text: joinText(directory, value.text), complete: value.complete };
        })));
    }
    if (ts.isCallExpression(node)) {
      const callee = describeCallee(node.expression, bindings);
      if (!callee) return [];
      const args = node.arguments.map((argument) => (ts.isSpreadElement(argument) ? [] : evaluate(argument)));
      const family = familyOf(callee.module);
      if (callee.module === null && callee.receiver === 'process' && callee.name === 'cwd') return [{ anchor: 'cwd', text: '.', complete: true }];
      if (family === 'path') {
        if (callee.name === 'join' && args.length) return join(args[0]!, args.slice(1));
        if (callee.name === 'resolve') return resolve(args);
        if (callee.name === 'dirname' && args.length) return dirname(args[0]!);
        if (callee.name === 'normalize' && args.length) return args[0]!;
        return [];
      }
      if ((family === 'url' && (callee.name === 'fileURLToPath' || callee.name === 'pathToFileURL')) || (callee.module === null && callee.name === 'String' && !callee.receiver)
        || callee.name === 'toString' || callee.name === 'decodeURI' || callee.name === 'decodeURIComponent') {
        if (callee.name === 'toString') return ts.isPropertyAccessExpression(unwrap(node.expression)) ? evaluate((unwrap(node.expression) as ts.PropertyAccessExpression).expression) : [];
        return args[0] ?? [];
      }
      return [];
    }
    return [];
  };
  return evaluate;
}

export interface Located {
  /** Repo-relative path ('' is the root). */
  path: string;
  complete: boolean;
  /** For an incomplete value: the directory the static part points into, and the start of the dynamic name. */
  directory: string;
  prefix: string;
}

/** Places a value in the repository: repo values directly, cwd and string values under each of `bases`. */
export function locate(value: PathValue, bases: readonly string[]): Located[] {
  const anchored = value.anchor === 'repo' ? [value.text] : value.anchor === 'absolute' ? [] : bases.map((base) => path.posix.join(virtualRoot, base, value.text));
  const results: Located[] = [];
  for (const text of anchored) {
    const normalized = path.posix.normalize(text);
    if (normalized !== virtualRoot && normalized !== `${virtualRoot}/` && !normalized.startsWith(`${virtualRoot}/`)) continue;
    const relative = normalized.slice(virtualRoot.length + 1);
    const separated = relative.endsWith('/') || relative === '';
    const trimmed = relative.replace(/\/+$/, '');
    if (value.complete) results.push({ path: trimmed, complete: true, directory: trimmed, prefix: '' });
    else if (separated) results.push({ path: trimmed, complete: false, directory: trimmed, prefix: '' });
    else {
      const slash = trimmed.lastIndexOf('/');
      results.push({ path: trimmed, complete: false, directory: slash === -1 ? '' : trimmed.slice(0, slash), prefix: trimmed.slice(slash + 1) });
    }
  }
  return results;
}

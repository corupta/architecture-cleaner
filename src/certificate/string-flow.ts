// K4 part 3 (old-path-scan.ts): what a path-like token inside a JS/TS file is to the program, read from the syntax
// around it. A token in a comment or a type has no runtime value. A token inside a string matters only to a consumer
// that takes that string as a path; when the string provably goes only to consumers that take something else (an HTTP
// route of a known router, a test title, a description), the token names no file. A consumer that compares the string
// with another value (`===`, a switch case, an `in` lookup, an assertion, `'…'.startsWith(x)`) or fetches it as a URL
// takes a path when that value is one the program computes: it is reported as comparing, and old-path-scan.ts clears
// such a hit only when the string names nothing either tree has. A string that is a segment of a path built from the
// file's own location (`resolve(__dirname, './src')`) means the path that expression evaluates to. Everything else is
// open: the token's readings decide, as before.
import ts from 'typescript';
import { type Binding, describeCallee, familyOf, moduleBindings, pathEvaluator, type PathValue, unwrapExpression } from './path-expressions.js';

/**
 * How a consumer's outcome depends on a value other than the string: `value` when it compares that value with the
 * string itself (`===`, a switch case, an `in` lookup, an assertion, a URL fetched as written), `part` when with a part
 * of it or with a string built from it (`'…'.startsWith(x)`, `'src/' + name === x`, `toContain`). When the other value
 * is a path the program computes, a move can flip the outcome.
 */
export type Comparison = 'value' | 'part';

export type StringUse =
  | { kind: 'comment' }
  | { kind: 'type' }
  /**
   * Every place the string goes takes something other than a file-system path; `compares`: some of them compare it
   * with a value the syntax doesn't fix (null: none does).
   */
  | { kind: 'consumed'; consumer: string; compares: Comparison | null }
  /** A segment of a path built from the file's location: these values, not the token, are what it names. */
  | { kind: 'path-expression'; expression: string; values: PathValue[] }
  | { kind: 'open' };

// Known consumers by module and export: which arguments (and which keys of an object argument) are not paths.
interface ApiParameter {
  /** Positions of string arguments that aren't paths; for `keys`, the positions of the object (empty: any). */
  arguments: readonly number[];
  keys?: readonly string[];
  /** What the consumer takes, for the finding. */
  what: string;
}

const nestRoute: ApiParameter = { arguments: [0], keys: ['path'], what: 'an HTTP route' };
const knownApis: Record<string, Record<string, ApiParameter>> = {
  '@nestjs/common': Object.fromEntries(['Controller', 'Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head', 'All', 'Search'].map((name) => [name, nestRoute])),
  '@hono/zod-openapi': { createRoute: { arguments: [], keys: ['path'], what: 'an HTTP route' } },
};
const testFrameworks = new Set(['vitest', '@jest/globals', 'bun:test', 'node:test', 'mocha', 'vite-plus/test']);
const testFunctions = new Set(['describe', 'it', 'test', 'suite', 'bench', 'context', 'fdescribe', 'fit', 'xdescribe', 'xit', 'xtest']);
const testModifiers = new Set(['only', 'skip', 'todo', 'concurrent', 'sequential', 'failing', 'fails', 'each', 'runIf', 'skipIf', 'shuffle']);
// Matchers that compare the received value with their arguments (Jest, Vitest, @relmify/jest-fp-ts); path-taking
// matchers (`toMatchFileSnapshot`) and custom ones are not here.
const comparingMatchers = new Set(['toBe', 'toEqual', 'toStrictEqual', 'toMatchObject', 'toContain', 'toContainEqual', 'toMatch', 'toHaveProperty',
  'toThrow', 'toThrowError', 'toHaveBeenCalledWith', 'toHaveBeenLastCalledWith', 'toHaveBeenNthCalledWith', 'toHaveBeenCalledExactlyOnceWith',
  'toBeCalledWith', 'lastCalledWith', 'nthCalledWith', 'toHaveReturnedWith', 'toHaveLastReturnedWith', 'toHaveNthReturnedWith', 'toReturnWith',
  'lastReturnedWith', 'nthReturnedWith', 'toMatchInlineSnapshot', 'toThrowErrorMatchingInlineSnapshot', 'toBeOneOf',
  'toEqualLeft', 'toEqualRight', 'toStrictEqualLeft', 'toStrictEqualRight', 'toSubsetEqualLeft', 'toSubsetEqualRight', 'toEqualSome', 'toStrictEqualSome', 'toSubsetEqualSome']);
const asymmetricMatchers = new Set(['stringContaining', 'stringMatching', 'objectContaining', 'arrayContaining']);
// Matchers that test a part of a string (a substring, a pattern, an error message) rather than the whole value.
const partMatchers = new Set(['toContain', 'toMatch', 'toThrow', 'toThrowError', 'stringContaining', 'stringMatching']);
// Keys whose string values are prose in every format that has them (OpenAPI, GraphQL, JSON Schema, package.json, Nest).
export const proseKeys = new Set(['description', 'summary', 'deprecationReason']);
const comparisons = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
// String methods whose result is not a string (a test, a position, a character code).
const inspectingMethods = new Set(['startsWith', 'endsWith', 'includes', 'indexOf', 'lastIndexOf', 'localeCompare', 'search', 'charCodeAt', 'codePointAt']);
const maxDepth = 4;

const isStringPart = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateLiteralLikeNode =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);

/** The innermost node at `offset`, JSDoc included. */
function nodeAt(sourceFile: ts.SourceFile, offset: number): ts.Node[] {
  const chain: ts.Node[] = [sourceFile];
  for (;;) {
    const node = chain[chain.length - 1]!;
    const child = node.getChildren(sourceFile).find((candidate) => candidate.pos <= offset && offset < candidate.end);
    if (!child) return chain;
    chain.push(child);
  }
}

/**
 * Whether `offset` lies in a comment: trivia before a token, or a JSDoc block. (A JSDoc `import('./x')` type, which
 * checkJs resolves, is a reference site: K3 judges it before any comment rule applies.)
 */
export function isCommentAt(sourceFile: ts.SourceFile, offset: number): boolean {
  const chain = nodeAt(sourceFile, offset);
  const node = chain[chain.length - 1]!;
  if (chain.some((link) => link.kind >= ts.SyntaxKind.FirstJSDocNode && link.kind <= ts.SyntaxKind.LastJSDocNode)) return true;
  return offset < node.getStart(sourceFile, false) || node.kind === ts.SyntaxKind.EndOfFileToken;
}

/** Whether the text at `offset` directly follows a `${…}` substitution of a template: its path is relative to that value. */
export function followsSubstitution(sourceFile: ts.SourceFile, offset: number): boolean {
  const part = [...nodeAt(sourceFile, offset)].reverse().find(isStringPart);
  return part !== undefined && (ts.isTemplateMiddle(part) || ts.isTemplateTail(part)) && offset === part.getStart(sourceFile) + 1;
}

/**
 * The string value at `offset`: `literal` without substitutions, or a template whose `tail` is the static text after its
 * last substitution; null outside a string value.
 */
export function stringValueAt(sourceFile: ts.SourceFile, offset: number): { literal: true; text: string } | { literal: false; tail: string } | null {
  const part = [...nodeAt(sourceFile, offset)].reverse().find(isStringPart);
  const value = part && !inType(part) ? valueOf(part) : null;
  if (!value) return null;
  if (ts.isTemplateExpression(value)) return { literal: false, tail: value.templateSpans[value.templateSpans.length - 1]!.literal.text };
  return { literal: true, text: ts.isStringLiteralLike(value) ? value.text : '' };
}

/** A string in a type (a literal type, a template literal type, a member name of an interface): erased at emit. */
function inType(part: ts.Node): boolean {
  let parent = part.parent;
  if (ts.isComputedPropertyName(parent)) parent = parent.parent;
  if (ts.isLiteralTypeNode(parent)) return !ts.isImportTypeNode(parent.parent);
  if (ts.isTemplateLiteralTypeNode(parent) || ts.isTemplateLiteralTypeSpan(parent)) return true;
  return (ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) && parent.name === part;
}

/** The value expression a string part belongs to: the literal, or the template expression around a head/middle/tail. */
function valueOf(part: ts.Node): ts.Expression | null {
  if (ts.isStringLiteral(part) || ts.isNoSubstitutionTemplateLiteral(part)) return part;
  if (ts.isTemplateHead(part) && ts.isTemplateExpression(part.parent)) return part.parent;
  if ((ts.isTemplateMiddle(part) || ts.isTemplateTail(part)) && ts.isTemplateSpan(part.parent)) return part.parent.parent;
  return null;
}

const staticText = (value: ts.Expression) => (ts.isTemplateExpression(value) ? [value.head.text, ...value.templateSpans.map((span) => span.literal.text)].join('') : ts.isStringLiteralLike(value) ? value.text : '');

/** The static text an expression contributes to a string: its literals, also inside templates and concatenations. */
function textOf(expression: ts.Expression): string {
  const inner = unwrapExpression(expression);
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.PlusToken) return textOf(inner.left) + textOf(inner.right);
  return staticText(inner);
}

/** Text before a string that makes it not the start of a URL's path: anything but slashes and dots (`https://h`, `/api/v1`). */
const leads = (text: string) => /[^./]/.test(text);

/** A value the syntax fixes: a literal, a keyword constant, `typeof x`. */
function isConstant(expression: ts.Expression): boolean {
  const inner = unwrapExpression(expression);
  return ts.isStringLiteralLike(inner) || ts.isNumericLiteral(inner) || ts.isBigIntLiteral(inner) || ts.isRegularExpressionLiteral(inner)
    || inner.kind === ts.SyntaxKind.TrueKeyword || inner.kind === ts.SyntaxKind.FalseKeyword || inner.kind === ts.SyntaxKind.NullKeyword
    || (ts.isIdentifier(inner) && inner.text === 'undefined') || ts.isTypeOfExpression(inner) || (ts.isPrefixUnaryExpression(inner) && ts.isNumericLiteral(inner.operand));
}

/** Where a string goes, and whether it is compared there with a value the syntax doesn't fix. */
interface Consumer {
  what: string;
  compares: Comparison | null;
}

/**
 * How the string reached the place: `joined` when it is only a part of the value there (a concatenation, a template),
 * `led` when static text other than slashes and dots comes before it in that value.
 */
interface Flow {
  joined: boolean;
  led: boolean;
}

const direct: Flow = { joined: false, led: false };
const takes = (what: string): Consumer => ({ what, compares: null });

/** A comparison of the string (as it flowed) with `others`: none when every other operand is a constant (null: unknown). */
const comparison = (kind: Comparison, flow: Flow, others: readonly ts.Expression[] | null): Comparison | null =>
  (others !== null && others.every(isConstant) ? null : flow.joined ? 'part' : kind);

const exported = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

/** The nearest node that scopes a declaration: a block, a function, a loop, the file. */
function scopeOf(node: ts.Node): ts.Node {
  for (let current = node.parent; ; current = current.parent) {
    if (ts.isSourceFile(current) || ts.isBlock(current) || ts.isFunctionLike(current) || ts.isForOfStatement(current) || ts.isForInStatement(current)
      || ts.isForStatement(current) || ts.isCaseBlock(current) || ts.isModuleBlock(current) || ts.isClassLike(current)) return current;
  }
}

function containsIdentifier(node: ts.Node, name: string): boolean {
  return (ts.isIdentifier(node) && node.text === name) || (ts.forEachChild(node, (child) => containsIdentifier(child, name) || undefined) ?? false);
}

/** Value references to `name` inside `scope`; null when the scope declares the name again or assigns to it. */
function referencesIn(scope: ts.Node, name: ts.Identifier): ts.Identifier[] | null {
  const references: ts.Identifier[] = [];
  let ambiguous = false;
  const visit = (node: ts.Node): void => {
    if (ambiguous) return;
    if (ts.isIdentifier(node) && node.text === name.text && node !== name) {
      const parent = node.parent;
      const declaration = (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isFunctionDeclaration(parent)
        || ts.isClassDeclaration(parent) || ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) && parent.name === node;
      const assigned = (ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
        || ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator));
      const nameOnly = (ts.isPropertyAccessExpression(parent) && parent.name === node) || ts.isQualifiedName(parent) || ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)
        || ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)
          || ts.isGetAccessor(parent) || ts.isSetAccessor(parent) || ts.isEnumMember(parent) || ts.isJsxAttribute(parent)) && parent.name === node);
      if (declaration || assigned) ambiguous = true;
      else if (!nameOnly) references.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return ambiguous ? null : references;
}

/**
 * The test framework function a title-taking call is rooted at (`it.only('…')`, `describe.each(table)('…')`), or null.
 * `describe.each(table)` itself takes the table, test data the test function receives, not a title.
 */
function testFunctionRoot(callee: ts.Expression, bindings: ReadonlyMap<string, Binding>): string | null {
  let node = unwrapExpression(callee);
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'each') return null;
  for (;;) {
    if (ts.isCallExpression(node)) node = unwrapExpression(node.expression);
    else if (ts.isPropertyAccessExpression(node) && testModifiers.has(node.name.text)) node = unwrapExpression(node.expression);
    else if (ts.isTaggedTemplateExpression(node)) node = unwrapExpression(node.tag);
    else break;
  }
  if (!ts.isIdentifier(node) || !testFunctions.has(node.text)) return null;
  const binding = bindings.get(node.text);
  return !binding || (testFrameworks.has(binding.module) && (binding.member === null || testFunctions.has(binding.member))) ? node.text : null;
}

/** `expect` as the test framework's (a global, or imported from one). */
const isExpect = (node: ts.Expression, bindings: ReadonlyMap<string, Binding>) => {
  const inner = unwrapExpression(node);
  if (!ts.isIdentifier(inner) || inner.text !== 'expect') return false;
  const binding = bindings.get('expect');
  return !binding || (testFrameworks.has(binding.module) && (binding.member === null || binding.member === 'expect'));
};

/** For `expect(x)[.not|.resolves|.rejects].matcher(…)`: the matcher call, when `call` is the `expect(x)` part or the matcher itself. */
function expectChain(call: ts.CallExpression, bindings: ReadonlyMap<string, Binding>): { matcher: string; received: ts.CallExpression; matcherCall: ts.CallExpression } | null {
  const fromReceived = (received: ts.CallExpression) => {
    let node: ts.Node = received;
    while (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && ['not', 'resolves', 'rejects'].includes(node.parent.name.text)) node = node.parent;
    const access = node.parent;
    if (!ts.isPropertyAccessExpression(access) || access.expression !== node || !ts.isCallExpression(access.parent) || access.parent.expression !== access) return null;
    return { matcher: access.name.text, received, matcherCall: access.parent };
  };
  if (isExpect(call.expression, bindings)) return fromReceived(call);
  let node = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(node)) return null;
  node = unwrapExpression(node.expression);
  while (ts.isPropertyAccessExpression(node) && ['not', 'resolves', 'rejects'].includes(node.name.text)) node = unwrapExpression(node.expression);
  return ts.isCallExpression(node) && isExpect(node.expression, bindings) ? fromReceived(node) : null;
}

/**
 * The judge for one file. `file` is the file's repo-relative path at the side its text comes from; path expressions
 * are evaluated there.
 */
export function stringUses(file: string, sourceFile: ts.SourceFile): (offset: number) => StringUse {
  const bindings = moduleBindings(sourceFile);
  const evaluate = pathEvaluator(sourceFile, file, bindings);

  /** An assertion on the string (`expect(x).toBe('…')`, `expect('…').toContain(x)`): compared with its other operands. */
  const assertion = (chain: NonNullable<ReturnType<typeof expectChain>>, argument: ts.Expression, flow: Flow): Consumer => ({
    what: `a value ${chain.matcher} compares`,
    compares: comparison(partMatchers.has(chain.matcher) ? 'part' : 'value', flow, [...chain.received.arguments, ...chain.matcherCall.arguments].filter((operand) => operand !== argument)),
  });

  /** Where an argument of `call` goes: its consumer, or null. `key`: the property of an object argument. */
  const callConsumer = (call: ts.CallExpression | ts.NewExpression, index: number, key: string | null, depth: number, flow: Flow): Consumer | null => {
    if (ts.isCallExpression(call)) {
      const chain = expectChain(call, bindings);
      if (chain && comparingMatchers.has(chain.matcher)) return assertion(chain, call.arguments[index]!, flow);
      const callee = unwrapExpression(call.expression);
      if (ts.isPropertyAccessExpression(callee) && asymmetricMatchers.has(callee.name.text) && isExpect(callee.expression, bindings)) {
        // What it is matched against is anywhere: never a constant.
        return { what: `a value expect.${callee.name.text} compares`, compares: comparison(partMatchers.has(callee.name.text) ? 'part' : 'value', flow, null) };
      }
      if (index === 0 && key === null && testFunctionRoot(call.expression, bindings)) return takes(`the title of a ${testFunctionRoot(call.expression, bindings)}() block`);
      if (ts.isIdentifier(callee)) {
        const binding = bindings.get(callee.text);
        const api = binding?.member ? knownApis[binding.module]?.[binding.member] : undefined;
        if (api && (key === null ? api.arguments.includes(index) : api.keys?.includes(key) && (api.arguments.length === 0 || api.arguments.includes(index)))) {
          return takes(`${api.what} (${binding!.member} from ${binding!.module})`);
        }
        // A URL that starts with the string is resolved against the page's origin, which a dev server can map onto the
        // repository: as a path, like a value compared with one. After a host or a path prefix it names neither.
        if (!binding && callee.text === 'fetch') return { what: 'a URL (fetch)', compares: flow.led ? null : flow.joined ? 'part' : 'value' };
        if (!binding && ['Error', 'TypeError', 'RangeError', 'SyntaxError'].includes(callee.text) && key === null) return takes(`an error message (${callee.text})`);
      }
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'console' && !bindings.has('console')) return takes(`console output (console.${callee.name.text})`);
      return localFunctionConsumer(callee, index, key, depth, flow);
    }
    const constructor = unwrapExpression(call.expression);
    if (ts.isIdentifier(constructor) && !bindings.has(constructor.text) && ['Error', 'TypeError', 'RangeError', 'SyntaxError'].includes(constructor.text) && index === 0 && key === null) {
      return takes(`an error message (new ${constructor.text})`);
    }
    return null;
  };

  /** A function declared in this file (not exported): where its parameter takes the argument. */
  const localFunctionConsumer = (callee: ts.Expression, index: number, key: string | null, depth: number, flow: Flow): Consumer | null => {
    if (!ts.isIdentifier(callee) || key !== null || depth >= maxDepth || bindings.has(callee.text)) return null;
    const declaration = localFunction(callee.text);
    const parameter = declaration?.parameters[index];
    if (!declaration || !parameter || !ts.isIdentifier(parameter.name) || parameter.dotDotDotToken || declaration.parameters.slice(0, index).some((earlier) => earlier.dotDotDotToken)) return null;
    // `arguments[i]` reads the argument without the parameter's name.
    const body = declaration.body;
    if (!body || containsIdentifier(body, 'arguments')) return null;
    const references = referencesIn(body, parameter.name);
    return references ? allConsumers(references, depth + 1, flow) : null;
  };

  // A name declared once in the file, as a function (or a const bound to one): every use of the name means it.
  const localFunctions = new Map<string, ts.SignatureDeclaration & { body?: ts.Node } | null>();
  const localFunction = (name: string) => {
    if (!localFunctions.has(name)) {
      const functions: (ts.SignatureDeclaration & { body?: ts.Node })[] = [];
      let declarations = 0;
      const visit = (node: ts.Node): void => {
        if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) || ts.isClassDeclaration(node)
          || ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)) && node.name && ts.isIdentifier(node.name) && node.name.text === name) declarations++;
        if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) functions.push(node);
        else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
          const initializer = unwrapExpression(node.initializer);
          if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) functions.push(initializer);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      localFunctions.set(name, declarations === 1 && functions.length === 1 ? functions[0]! : null);
    }
    return localFunctions.get(name)!;
  };

  /** Every reference's consumer (null if one is unknown); it compares when any of them does, `part` before `value`. */
  const allConsumers = (references: readonly ts.Node[], depth: number, flow: Flow): Consumer | null => {
    const consumers = new Set<string>();
    let compares: Comparison | null = null;
    for (const reference of references) {
      const consumer = consumerOf(reference as ts.Expression, depth, flow);
      if (consumer === null) return null;
      consumers.add(consumer.what);
      if (consumer.compares === 'part' || (consumer.compares === 'value' && compares === null)) compares = consumer.compares;
    }
    return consumers.size ? { what: [...consumers].sort().join('; '), compares } : takes('nothing (the name is never read)');
  };

  /** Where the value of `expression` goes, as far as the syntax around it shows. */
  const consumerOf = (expression: ts.Expression, depth: number, flow: Flow): Consumer | null => {
    let node: ts.Node = expression;
    while (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) || ts.isSatisfiesExpression(node.parent) || ts.isNonNullExpression(node.parent)
      || ts.isTypeAssertionExpression(node.parent)) node = node.parent;
    const parent = node.parent;
    if (ts.isTemplateSpan(parent) && parent.expression === node) {
      const template = parent.parent;
      const before = [template.head.text, ...template.templateSpans.slice(0, template.templateSpans.indexOf(parent)).map((span) => span.literal.text)].join('');
      return consumerOf(template, depth, { joined: true, led: flow.led || leads(before) });
    }
    if (ts.isBinaryExpression(parent)) {
      const operator = parent.operatorToken.kind;
      if (comparisons.has(operator)) return { what: 'a comparison', compares: comparison('value', flow, [parent.left === node ? parent.right : parent.left]) };
      // The result contains this string: it goes where the result goes.
      if (operator === ts.SyntaxKind.PlusToken) return consumerOf(parent, depth, { joined: true, led: flow.led || (parent.right === node && leads(textOf(parent.left))) });
      // The result can be this string: it goes where the result goes.
      if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken || (operator === ts.SyntaxKind.AmpersandAmpersandToken && parent.right === node)) {
        return consumerOf(parent, depth, flow);
      }
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return takes('a truth test');
      if (operator === ts.SyntaxKind.InKeyword && parent.left === node) return { what: 'a key lookup', compares: comparison('value', flow, [parent.right]) };
      return null;
    }
    if (ts.isConditionalExpression(parent)) return parent.condition === node ? takes('a truth test') : consumerOf(parent, depth, flow);
    if (ts.isCaseClause(parent) && parent.expression === node) return { what: 'a switch case', compares: comparison('value', flow, [parent.parent.parent.expression]) };
    if (ts.isExpressionStatement(parent)) return takes('nothing (an expression statement)');
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(node as ts.Expression)) return callConsumer(parent, parent.arguments.indexOf(node as ts.Expression), null, depth, flow);
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      if (parent.name.text === 'length') return takes('its length');
      if (inspectingMethods.has(parent.name.text) && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
        return { what: `a string test (${parent.name.text})`, compares: comparison('part', flow, parent.parent.arguments) };
      }
      return null;
    }
    if (ts.isPropertyAssignment(parent) && parent.initializer === node) return propertyConsumer(parent, parent.name, node as ts.Expression, depth, flow);
    if (ts.isShorthandPropertyAssignment(parent)) return propertyConsumer(parent, parent.name, node as ts.Expression, depth, flow);
    if (ts.isArrayLiteralExpression(parent)) return arrayConsumer(parent, depth, flow);
    if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isIdentifier(parent.name) && ts.isVariableDeclarationList(parent.parent)
      && (parent.parent.flags & ts.NodeFlags.Const) !== 0 && !(ts.isVariableStatement(parent.parent.parent) && exported(parent.parent.parent)) && depth < maxDepth) {
      const references = referencesIn(scopeOf(parent.parent), parent.name);
      return references && !exportsName(parent.name.text) ? allConsumers(references, depth + 1, flow) : null;
    }
    return null;
  };

  /** `export { name }` anywhere in the file. */
  const exportsName = (name: string) => sourceFile.statements.some((statement) => ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause
    && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.some((element) => (element.propertyName ?? element.name).text === name))
    || sourceFile.statements.some((statement) => ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression) && statement.expression.text === name);

  const propertyConsumer = (property: ts.ObjectLiteralElementLike, name: ts.PropertyName, value: ts.Expression, depth: number, flow: Flow): Consumer | null => {
    const key = ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;
    if (key !== null && proseKeys.has(key) && /\s/.test(staticText(unwrapExpression(value)))) return takes(`prose (the ${key} of an object)`);
    const object = property.parent;
    if (key === null || !ts.isObjectLiteralExpression(object)) return null;
    let node: ts.Node = object;
    while (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) || ts.isSatisfiesExpression(node.parent)) node = node.parent;
    const call = node.parent;
    if ((ts.isCallExpression(call) || ts.isNewExpression(call)) && call.arguments?.includes(node as ts.Expression)) {
      const chain = ts.isCallExpression(call) ? expectChain(call, bindings) : null;
      if (chain && comparingMatchers.has(chain.matcher)) return assertion(chain, node as ts.Expression, flow);
      return callConsumer(call, call.arguments.indexOf(node as ts.Expression), key, depth, flow);
    }
    return null;
  };

  const arrayConsumer = (array: ts.ArrayLiteralExpression, depth: number, flow: Flow): Consumer | null => {
    let node: ts.Node = array;
    while (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) || ts.isSatisfiesExpression(node.parent)) node = node.parent;
    const parent = node.parent;
    if (ts.isForOfStatement(parent) && parent.expression === node && ts.isVariableDeclarationList(parent.initializer) && (parent.initializer.flags & ts.NodeFlags.Const) !== 0
      && parent.initializer.declarations.length === 1 && ts.isIdentifier(parent.initializer.declarations[0]!.name) && depth < maxDepth) {
      const references = referencesIn(parent.statement, parent.initializer.declarations[0]!.name as ts.Identifier);
      return references ? allConsumers(references, depth + 1, flow) : null;
    }
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(node as ts.Expression)) {
      // Route decorators take an array of routes; assertions compare arrays.
      return callConsumer(parent, parent.arguments.indexOf(node as ts.Expression), null, depth, flow);
    }
    if (ts.isArrayLiteralExpression(parent) || ts.isPropertyAssignment(parent)) return consumerOf(node as ts.Expression, depth, flow);
    return null;
  };

  /**
   * `resolve(__dirname, './src')`, `__dirname + '/src'`: the largest path-building expression around the string whose
   * every value is a repository path (anchored at the file's own location), or null.
   */
  const pathExpression = (value: ts.Expression): StringUse | null => {
    const isAnchored = (expression: ts.Expression) => {
      const values = evaluate(expression);
      return values.length > 0 && values.every((candidate) => candidate.anchor === 'repo');
    };
    let anchored: ts.Expression | null = isAnchored(value) ? value : null;
    for (let current: ts.Expression = value; ;) {
      let node: ts.Node = current;
      while (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) || ts.isNonNullExpression(node.parent) || ts.isSatisfiesExpression(node.parent)) node = node.parent;
      const parent = node.parent;
      if (ts.isTemplateSpan(parent)) current = parent.parent;
      else if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken) current = parent;
      else if (ts.isCallExpression(parent) && parent.arguments.includes(node as ts.Expression) && familyOf(describeCallee(parent.expression, bindings)?.module ?? null) === 'path'
        && ['join', 'resolve'].includes(describeCallee(parent.expression, bindings)!.name)) current = parent;
      else break;
      if (isAnchored(current)) anchored = current;
    }
    if (!anchored) return null;
    return { kind: 'path-expression', expression: anchored.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 100), values: evaluate(anchored) };
  };

  return (offset) => {
    if (isCommentAt(sourceFile, offset)) return { kind: 'comment' };
    const chain = nodeAt(sourceFile, offset);
    const part = [...chain].reverse().find(isStringPart);
    if (!part) return { kind: 'open' };
    if (inType(part)) return { kind: 'type' };
    const value = valueOf(part);
    if (!value) return { kind: 'open' };
    const expression = pathExpression(value);
    if (expression) return expression;
    const consumer = consumerOf(value, 0, direct);
    return consumer ? { kind: 'consumed', consumer: consumer.what, compares: consumer.compares } : { kind: 'open' };
  };
}

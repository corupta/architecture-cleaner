// K2's one class of change beyond specifier spans (plan §2.3 S3): a change of import layout, what the re-wrap makes.
// Base and head, each with its specifier spans replaced by the same placeholder (one neither file contains), are
// layout-equal when
// (i) their token streams are equal: every token's text and every comment's text, read from the parser's tree (JSX
//     text and template literal parts are tokens, so whitespace inside them counts), the shebang and byte order mark
//     too, with nothing but whitespace between them. One difference is allowed: a trailing comma right before the `}`
//     of the named bindings of a top-level import or `export … from` declaration, inserted or removed (prettier's
//     `trailingComma`);
// (ii) both parse without syntax errors, and their syntax trees are equal ignoring positions;
// (iii) every gap (the whitespace between two tokens or comments) that differs lies strictly inside one top-level
//     import or `export … from` declaration on both sides, after its first token and before its last, and holds only
//     spaces, tabs and the file's line terminator; every other gap is byte-identical. So no line break moves where
//     the grammar restricts one (automatic semicolon insertion, an arrow's `=>`), next to a JSDoc comment it could
//     attach or detach, or anywhere else in the code;
// (iv) no directive comment (`@ts-expect-error`, `eslint-disable-next-line`, `c8 ignore next 3`, ...) precedes or
//     sits inside a statement whose line breaks changed, and no changed line break falls in the lines a directive
//     reaches (its own line through the next N, for `next N`; 1 otherwise);
// (v) nothing maps the file's lines: no `sourceMappingURL` comment (a tracked `<file>.map` is the caller's to check).
// A coverage gate that measures line totals is the caller's too (byte-spans.ts): it needs the tree.
// The same reading gives the key path-map.ts pairs a moved and re-wrapped file by (`importLayoutKey`).
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { scriptKindOf } from '../analyzer/reference-sites.js';
import type { SpanView } from './spans.js';

/** What every specifier span is replaced with on both sides: no quote, escape, line break or `${`. */
export const specifierPlaceholder = 'ac-specifier';

/**
 * Joins each side's chunks around one placeholder that no chunk on either side contains: `specifierPlaceholder`,
 * else it with a counter. Its only `a` is its first character, so two of its occurrences never overlap, and each
 * joined text splits back into exactly its chunks: a literal that spells the placeholder can't pass for a span.
 */
export function joinChunks(before: readonly string[], after: readonly string[]): [string, string] {
  const taken = (candidate: string) => before.some((chunk) => chunk.includes(candidate)) || after.some((chunk) => chunk.includes(candidate));
  let placeholder = specifierPlaceholder;
  for (let counter = 1; taken(placeholder); counter++) placeholder = `${specifierPlaceholder}-${counter}`;
  return [before.join(placeholder), after.join(placeholder)];
}

/**
 * Comments whose effect depends on where lines break: they apply to their own line, the next N lines or the next
 * node (TypeScript, linters, formatters, coverage tools, bundler annotations, source maps). src/rewrap keeps its own
 * copy (the certifier never imports the executor); test/rewrap checks the two are equal.
 */
export const directiveComment = /@ts-(?:ignore|expect-error|nocheck)\b|\b(?:eslint|oxlint)-(?:disable|enable)|\btslint:(?:disable|enable)|\bjshint\b|\bjscs:|\bbiome-ignore\b|\bdeno-(?:lint|fmt)-ignore\b|\bprettier-ignore\b|\b(?:istanbul|c8|v8|node:coverage)\s+(?:ignore|disable|enable)\b|@vite-ignore\b|\bwebpack[A-Z]\w*\s*:|[@#]__[A-Z_]+__|\bnoinspection\b|\bsourceMappingURL=/;

/** Lines after its own that a directive reaches: `c8 ignore next 3` reaches 3, every other one 1. */
export const directiveReach = (comment: string) => Number(/\bnext\s+(\d+)\b/.exec(comment)?.[1] ?? 1);

interface Element {
  text: string;
  start: number;
  end: number;
  comment: boolean;
  /** The token itself, or for a comment the token whose leading trivia holds it. */
  owner: ts.Node;
}

interface Reading {
  sourceFile: ts.SourceFile;
  /** The byte order mark and shebang line, outside every gap. */
  preamble: string;
  elements: Element[];
  /** Pre-order node kinds, -1 closing each node with children: equal shapes and tokens mean equal trees. */
  shape: number[];
  /** Where each shape entry's node starts (or, for -1, ends). */
  shapeAt: number[];
  /** The text before each element (the last entry: after the last one), with the tolerated trailing commas blanked. */
  gaps: string[];
  /** Whether the gap before each element lies strictly inside one top-level import or `export … from` declaration. */
  inside: boolean[];
  /** Where a gap holds something that is neither whitespace nor a comment (conflict-marker trivia). */
  strayText: number | null;
  syntaxErrors: boolean;
}

const lineBreaks = /\r\n|[\n\r\u2028\u2029]/g;
const whitespace = /^[ \t\v\f\u00a0\n\r\u2028\u2029]*$/;
const isJsDoc = (node: ts.Node) => node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
const bomOf = (text: string) => text.charCodeAt(0) === 0xfeff;

/** A top-level import or `export … from` declaration: the only code whose layout may change. */
const isImportLayoutDeclaration = (node: ts.Node | undefined): boolean => node !== undefined && node.parent !== undefined && ts.isSourceFile(node.parent)
  && (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined));

function read(file: string, text: string): Reading {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const elements: Element[] = [];
  const shape: number[] = [];
  const shapeAt: number[] = [];
  /** Trailing commas left out of the stream: blanked when the gaps are read. */
  const dropped: number[] = [];
  // Every comment in a token's leading trivia (ts.getLeadingCommentRanges leaves out those on the previous token's line).
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, sourceFile.languageVariant);
  const comments = (from: number, to: number, owner: ts.Node) => {
    if (from >= to) return;
    scanner.setText(text, from, to - from);
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
      if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
        elements.push({ text: scanner.getTokenText(), start: scanner.getTokenStart(), end: scanner.getTokenEnd(), comment: true, owner });
      }
    }
  };
  const visit = (node: ts.Node, trailing = false): void => {
    if (isJsDoc(node)) return;
    // The end of the file holds the comments after the last token, whether or not a JSDoc one makes it a parent.
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return comments(node.pos, node.end, node);
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      // JSX text has no trivia (what looks like a comment in it is text), and its leading whitespace is its own.
      const jsxText = node.kind === ts.SyntaxKind.JsxText;
      const start = jsxText ? node.pos : node.getStart(sourceFile);
      if (trailing) dropped.push(start);
      else {
        shape.push(node.kind);
        shapeAt.push(start);
      }
      if (start === node.end) return;
      if (!jsxText) comments(node.pos, start, node);
      if (!trailing) elements.push({ text: text.slice(start, node.end), start, end: node.end, comment: false, owner: node });
      return;
    }
    shape.push(node.kind);
    shapeAt.push(node.getStart(sourceFile));
    // The list of a top-level import or `export … from` clause's bindings: its trailing comma is layout (its comments are not).
    const bindings = node.parent;
    const trailingComma = node.kind === ts.SyntaxKind.SyntaxList && bindings !== undefined
      && ((ts.isNamedImports(bindings) && isImportLayoutDeclaration(bindings.parent.parent)) || (ts.isNamedExports(bindings) && isImportLayoutDeclaration(bindings.parent)))
      && children.at(-1)!.kind === ts.SyntaxKind.CommaToken;
    children.forEach((child, index) => visit(child, trailingComma && index === children.length - 1));
    shape.push(-1);
    shapeAt.push(node.end);
  };
  visit(sourceFile);
  const blanked = dropped.reduce((current, comma) => `${current.slice(0, comma)} ${current.slice(comma + 1)}`, text);
  const shebang = ts.getShebang(text);
  const first = (bomOf(text) ? 1 : 0) + (shebang && text.startsWith(shebang, bomOf(text) ? 1 : 0) ? shebang.length : 0);
  const gaps: string[] = [];
  let strayText: number | null = null;
  let previous = first;
  for (const position of [...elements.map((element) => [element.start, element.end] as const), [text.length, text.length] as const]) {
    const gap = blanked.slice(previous, position[0]);
    if (strayText === null && !whitespace.test(gap)) strayText = previous;
    gaps.push(gap);
    previous = position[1];
  }
  // The declaration each element lies in (-1 for none): both are in text order.
  const declarations = sourceFile.statements.filter(isImportLayoutDeclaration).map((statement) => [statement.getStart(sourceFile), statement.end] as const);
  let next = 0;
  const declarationOf = elements.map((element) => {
    while (next < declarations.length && declarations[next]![1] <= element.start) next++;
    const declaration = declarations[next];
    return declaration && element.start >= declaration[0] && element.end <= declaration[1] ? next : -1;
  });
  const inside = gaps.map((_, gap) => gap > 0 && gap < elements.length && declarationOf[gap - 1] !== -1 && declarationOf[gap - 1] === declarationOf[gap]);
  const syntaxErrors = (sourceFile as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics.length > 0;
  return { sourceFile, preamble: text.slice(0, first), elements, shape, shapeAt, gaps, inside, strayText, syntaxErrors };
}

const lineAt = (reading: Reading, position: number) => reading.sourceFile.getLineAndCharacterOfPosition(position).line + 1;
const excerpt = (text: string) => JSON.stringify(text.length > 60 ? `${text.slice(0, 57)}...` : text);
const breaksIn = (gap: string) => gap.match(lineBreaks)?.length ?? 0;
const describe = (reading: Reading, element: Element | undefined, otherwise: string) => (element ? `${element.comment ? 'comment' : 'token'} ${excerpt(element.text)} on line ${lineAt(reading, element.start)}` : otherwise);
const codePoint = (character: string) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/** Statements and class members that hold a node, innermost first. */
function statementsAround(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  for (let current: ts.Node | undefined = node; current; current = current.parent) if (ts.isStatement(current) || ts.isClassElement(current)) found.push(current);
  return found;
}

/** Element indices a directive reaches: from the first element on its line through those on the lines it reaches. */
function reachOf(reading: Reading, index: number): [number, number] {
  const directive = reading.elements[index]!;
  const firstLine = lineAt(reading, directive.start);
  const lastLine = lineAt(reading, directive.end) + directiveReach(directive.text);
  let from = index;
  while (from > 0 && lineAt(reading, reading.elements[from - 1]!.end) >= firstLine) from--;
  let to = index;
  while (to + 1 < reading.elements.length && lineAt(reading, reading.elements[to + 1]!.start) <= lastLine) to++;
  return [from, to];
}

/**
 * What a changed gap may hold besides spaces and tabs: the file's line terminator (base's first one, else head's),
 * when that is `\n` or `\r\n`. A lone CR, U+2028 or U+2029 is a line break to the parser but not to git, editors and
 * coverage tools, so a file using one may change spaces only.
 */
function layoutSpace(before: string, after: string): { terminator: string | null; other: RegExp } {
  const terminator = /\r\n|[\n\r\u2028\u2029]/.exec(before)?.[0] ?? /\r\n|[\n\r\u2028\u2029]/.exec(after)?.[0] ?? '\n';
  if (terminator === '\r\n') return { terminator, other: /(?:\r\n|[ \t])+/g };
  if (terminator === '\n') return { terminator, other: /[\n \t]+/g };
  return { terminator: null, other: /[ \t]+/g };
}

export type LayoutComparison =
  | { layoutOnly: true; /** Gaps whose line breaks changed. */ changedBreaks: number; /** Head line where the first one starts. */ firstLine: number; lineDelta: number }
  | { layoutOnly: false; problem: string };

/** Whether head differs from base in import layout only (both with specifier spans replaced by one placeholder: `joinChunks`). */
export function compareLayout(file: string, before: string, after: string): LayoutComparison {
  const problem = (text: string): LayoutComparison => ({ layoutOnly: false, problem: text });
  if (bomOf(before) !== bomOf(after)) return problem(`the byte order mark was ${bomOf(after) ? 'added' : 'removed'}`);
  if (ts.getShebang(before) !== ts.getShebang(after)) return problem('the shebang line changed');
  const base = read(file, before);
  const head = read(file, after);
  for (const [side, reading] of [['base', base], ['head', head]] as const) {
    if (reading.strayText !== null) return problem(`${side} line ${lineAt(reading, reading.strayText)} has text between tokens that is neither whitespace nor a comment`);
  }
  const count = Math.max(base.elements.length, head.elements.length);
  for (let index = 0; index < count; index++) {
    const was = base.elements[index];
    const is = head.elements[index];
    if (was && is && was.text === is.text && was.comment === is.comment) continue;
    return problem(`token ${index + 1} differs: base has ${describe(base, was, 'the end of the file')}, head has ${describe(head, is, 'the end of the file')}`);
  }
  for (const [side, reading] of [['base', base], ['head', head]] as const) if (reading.syntaxErrors) return problem(`${side} has syntax errors`);
  const differentNode = Array.from({ length: Math.max(base.shape.length, head.shape.length) }, (_, index) => index).find((index) => base.shape[index] !== head.shape[index]);
  if (differentNode !== undefined) {
    const at = head.shapeAt[Math.min(differentNode, head.shapeAt.length - 1)] ?? 0;
    return problem(`same tokens, different syntax tree near head line ${lineAt(head, at)}: a line break changed how the code parses (automatic semicolon insertion)`);
  }
  const space = layoutSpace(before, after);
  for (const [gap, was] of base.gaps.entries()) {
    if (was === head.gaps[gap]) continue;
    const between = `between ${describe(head, head.elements[gap - 1], 'the start of the file')} and ${describe(head, head.elements[gap], 'the end of the file')}`;
    if (!base.inside[gap] || !head.inside[gap]) return problem(`the whitespace ${between} changed outside an import or export declaration`);
    for (const [side, reading] of [['base', base], ['head', head]] as const) {
      const other = reading.gaps[gap]!.replace(space.other, '');
      if (other) return problem(`the whitespace ${between} changed, and ${side} has ${codePoint(other)} in it: only spaces, tabs and ${space.terminator ? `the file's line terminator (${JSON.stringify(space.terminator).slice(1, -1)})` : 'no line break (the file\'s first one is a lone CR, U+2028 or U+2029)'} may change`);
    }
  }
  if (/\bsourceMappingURL=/.test(after)) return problem('its layout changed and a sourceMappingURL comment maps its lines and columns');
  const changed = base.gaps.flatMap((gap, index) => (breaksIn(gap) === breaksIn(head.gaps[index]!) ? [] : [index]));
  if (!changed.length) return { layoutOnly: true, changedBreaks: 0, firstLine: 0, lineDelta: 0 };
  // Statements whose line breaks changed: those around the two elements of each changed gap.
  const marked = new Set<ts.Node>();
  for (const gap of changed) for (const element of [head.elements[gap - 1], head.elements[gap]]) if (element) for (const statement of statementsAround(element.owner)) marked.add(statement);
  for (const [index, element] of head.elements.entries()) {
    if (!element.comment || !directiveComment.test(element.text)) continue;
    const where = `the directive ${excerpt(element.text)} on line ${lineAt(head, element.start)}`;
    if (statementsAround(element.owner).some((statement) => marked.has(statement))) return problem(`${where} precedes or sits inside a statement whose line breaks changed`);
    for (const reading of [base, head]) {
      const [from, to] = reachOf(reading, index);
      if (changed.some((gap) => gap >= from && gap <= to + 1)) return problem(`line breaks changed within the lines ${where} applies to`);
    }
  }
  // The line the first moved line break starts from (the head line of the element before it).
  const previous = head.elements[changed[0]! - 1];
  return {
    layoutOnly: true, changedBreaks: changed.length, firstLine: previous ? lineAt(head, previous.end) : 1,
    lineDelta: head.sourceFile.getLineStarts().length - base.sourceFile.getLineStarts().length,
  };
}

/**
 * A key two versions of a source file share when they differ in specifiers and import layout only: its text (spans
 * replaced by `specifierPlaceholder`) with every gap inside a top-level import or `export … from` declaration, the
 * tolerated trailing comma included, read as one space, hashed with its site kinds. Undefined when the text has
 * syntax errors or stray text, which compareLayout rejects. path-map.ts pairs a moved and re-wrapped file by it, and
 * K2 then holds the pair to compareLayout: a key that collides (a literal spelling the placeholder) can only pair
 * files K2 rejects.
 */
export function importLayoutKey(file: string, view: SpanView): string | undefined {
  const reading = read(file, view.chunks.join(specifierPlaceholder));
  if (reading.syntaxErrors || reading.strayText !== null) return undefined;
  const text = [reading.preamble, ...reading.elements.flatMap((element, index) => [reading.inside[index] ? ' ' : reading.gaps[index]!, element.text]), reading.gaps.at(-1)!];
  return `layout:${createHash('sha256').update(JSON.stringify([text, view.sites.map((site) => site.kind)])).digest('hex')}`;
}

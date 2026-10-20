// K2's one class of change beyond specifier spans (plan §2.3 S3): a layout-only edit of a source file. Base and head,
// each with its specifier spans replaced by the same placeholder, are layout-equal when
// (i) their token streams are equal: every token's text and every comment's text, read from the parser's tree (JSX
//     text and template literal parts are tokens, so whitespace inside them counts), the shebang and byte order mark
//     too, with nothing but whitespace between them. One difference is allowed: a trailing comma right before the `}`
//     of an import or export named-bindings clause, inserted or removed (prettier's `trailingComma`);
// (ii) their syntax trees are equal ignoring positions: a line break that changes automatic semicolon insertion
//     (`return x` -> `return\nx`) keeps the tokens and changes the tree;
// (iii) no directive comment (`@ts-expect-error`, `eslint-disable-next-line`, `c8 ignore next 3`, ...) precedes or
//     sits inside a statement whose line breaks changed, and no changed line break falls in the lines a directive
//     reaches (its own line through the next N, for `next N`; 1 otherwise);
// (iv) nothing maps the file's lines: no `sourceMappingURL` comment (a tracked `<file>.map` is the caller's to check);
// (v) no gap next to `<`, `!`, `--` or `>` opens, closes or gains a line break (Annex B's HTML-like comments).
// A coverage gate that measures line totals is the caller's too (byte-spans.ts): it needs the tree.
import ts from 'typescript';
import { scriptKindOf } from '../analyzer/reference-sites.js';

/** What every specifier span is replaced with on both sides: no quote, escape, line break or `${`. */
export const specifierPlaceholder = 'ac-specifier';

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
  elements: Element[];
  /** Pre-order node kinds, -1 closing each node with children: equal shapes and tokens mean equal trees. */
  shape: number[];
  /** Where each shape entry's node starts (or, for -1, ends). */
  shapeAt: number[];
  /** Line breaks before each element (the last entry: after the last one). */
  breaks: number[];
  /** Whether the gap before each element is empty (two tokens touching). */
  touching: boolean[];
  /** Where a gap holds something that is neither whitespace nor a comment (conflict-marker trivia). */
  strayText: number | null;
}

const lineBreaks = /\r\n|[\n\r\u2028\u2029]/g;
const whitespace = /^[ \t\v\f\u00a0\n\r\u2028\u2029]*$/;
const isJsDoc = (node: ts.Node) => node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
const bomOf = (text: string) => text.charCodeAt(0) === 0xfeff;

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
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      if (node.kind === ts.SyntaxKind.EndOfFileToken) return comments(node.pos, node.end, node);
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
    // The list of an import or export clause's bindings: its trailing comma is layout (its comments are not).
    const trailingComma = node.kind === ts.SyntaxKind.SyntaxList && node.parent !== undefined && (ts.isNamedImports(node.parent) || ts.isNamedExports(node.parent))
      && children.at(-1)!.kind === ts.SyntaxKind.CommaToken;
    children.forEach((child, index) => visit(child, trailingComma && index === children.length - 1));
    shape.push(-1);
    shapeAt.push(node.end);
  };
  visit(sourceFile);
  const blanked = dropped.reduce((current, comma) => `${current.slice(0, comma)} ${current.slice(comma + 1)}`, text);
  const shebang = ts.getShebang(text);
  const first = (bomOf(text) ? 1 : 0) + (shebang && text.startsWith(shebang, bomOf(text) ? 1 : 0) ? shebang.length : 0);
  const breaks: number[] = [];
  const touching: boolean[] = [];
  let strayText: number | null = null;
  let previous = first;
  for (const position of [...elements.map((element) => [element.start, element.end] as const), [text.length, text.length] as const]) {
    const gap = blanked.slice(previous, position[0]);
    if (strayText === null && !whitespace.test(gap)) strayText = previous;
    breaks.push(gap.match(lineBreaks)?.length ?? 0);
    touching.push(gap === '');
    previous = position[1];
  }
  return { sourceFile, elements, shape, shapeAt, breaks, touching, strayText };
}

const lineAt = (reading: Reading, position: number) => reading.sourceFile.getLineAndCharacterOfPosition(position).line + 1;
const excerpt = (text: string) => JSON.stringify(text.length > 60 ? `${text.slice(0, 57)}...` : text);

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

export type LayoutComparison =
  | { layoutOnly: true; /** Gaps whose line breaks changed. */ changedBreaks: number; /** Head line where the first one starts. */ firstLine: number; lineDelta: number }
  | { layoutOnly: false; problem: string };

/** Whether head differs from base in layout only (both with specifier spans replaced by `specifierPlaceholder`). */
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
    const describe = (reading: Reading, element: Element | undefined) => (element ? `${element.comment ? 'comment' : 'token'} ${excerpt(element.text)} on line ${lineAt(reading, element.start)}` : 'the end of the file');
    return problem(`token ${index + 1} differs: base has ${describe(base, was)}, head has ${describe(head, is)}`);
  }
  if ((head.sourceFile as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics.length) return problem('head has syntax errors');
  const differentNode = Array.from({ length: Math.max(base.shape.length, head.shape.length) }, (_, index) => index).find((index) => base.shape[index] !== head.shape[index]);
  if (differentNode !== undefined) {
    const at = head.shapeAt[Math.min(differentNode, head.shapeAt.length - 1)] ?? 0;
    return problem(`same tokens, different syntax tree near head line ${lineAt(head, at)}: a line break changed how the code parses (automatic semicolon insertion)`);
  }
  if (/\bsourceMappingURL=/.test(after)) return problem('its layout changed and a sourceMappingURL comment maps its lines and columns');
  // Node reads `<!--`, and `-->` starting a line, as comments in a CommonJS script (ECMAScript Annex B), where TypeScript
  // reads `<`, `!`, `--`, `>`: a gap next to one of those tokens may neither open, close nor gain a line break.
  const htmlLike = new Set(['<', '!', '--', '>']);
  const markerGap = base.touching.findIndex((touching, gap) => (touching !== head.touching[gap] || base.breaks[gap] !== head.breaks[gap])
    && [head.elements[gap - 1], head.elements[gap]].some((element) => element && !element.comment && htmlLike.has(element.text)));
  if (markerGap !== -1) return problem(`the space around ${excerpt(head.elements[markerGap]?.text ?? '')} on head line ${lineAt(head, head.elements[markerGap]?.start ?? 0)} changed: <!-- and a line-leading --> are comments to Node in a CommonJS script`);
  const changed = base.breaks.flatMap((breaks, gap) => (breaks === head.breaks[gap] ? [] : [gap]));
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

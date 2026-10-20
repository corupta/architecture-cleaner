// What the re-wrap reads in one file's text: its top-level import and `export … from` declarations, the comments
// that act on lines (directives), and whether a re-formatted declaration differs from the original in layout only.
// Executor side: nothing here imports src/certificate, which checks the result on its own (K2's layout class).
import ts from 'typescript';
import { scriptKindOf } from '../analyzer/reference-sites.js';

export interface Declaration {
  /** Offsets of the declaration's own text (leading comments excluded). */
  start: number;
  end: number;
  /** Where its leading trivia starts (the previous token's end). */
  pos: number;
  text: string;
  /** The module specifier as written, quotes included. */
  specifier: string;
  /** 1-based lines of its first and last character. */
  firstLine: number;
  lastLine: number;
}

export interface Comment {
  text: string;
  start: number;
  end: number;
  firstLine: number;
  lastLine: number;
}

/**
 * Comments whose effect depends on where lines break (TypeScript, linters, formatters, coverage tools, bundler
 * annotations, source maps): a copy of the certifier's list (src/certificate/layout.ts), which test/rewrap keeps equal.
 */
export const directiveComment = /@ts-(?:ignore|expect-error|nocheck)\b|\b(?:eslint|oxlint)-(?:disable|enable)|\btslint:(?:disable|enable)|\bjshint\b|\bjscs:|\bbiome-ignore\b|\bdeno-(?:lint|fmt)-ignore\b|\bprettier-ignore\b|\b(?:istanbul|c8|v8|node:coverage)\s+(?:ignore|disable|enable)\b|@vite-ignore\b|\bwebpack[A-Z]\w*\s*:|[@#]__[A-Z_]+__|\bnoinspection\b|\bsourceMappingURL=/;

/** Lines after its own that a directive reaches: `c8 ignore next 3` reaches 3, every other one 1. */
export const directiveReach = (comment: string) => Number(/\bnext\s+(\d+)\b/.exec(comment)?.[1] ?? 1);

export interface FileReading {
  declarations: Declaration[];
  comments: Comment[];
}

/** The file's top-level import and `export … from` declarations and every comment, in order. */
export function readFile(file: string, text: string): FileReading {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const line = (position: number) => sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  const declarations: Declaration[] = [];
  for (const statement of sourceFile.statements) {
    const specifier = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) ? statement.moduleSpecifier : undefined;
    if (!specifier) continue;
    const start = statement.getStart(sourceFile);
    declarations.push({ start, end: statement.end, pos: statement.pos, text: text.slice(start, statement.end), specifier: specifier.getText(sourceFile), firstLine: line(start), lastLine: line(statement.end) });
  }
  // Comments are trivia before a token: scanned there only, so a regex or template literal can't look like one.
  const comments: Comment[] = [];
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, sourceFile.languageVariant);
  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(sourceFile);
    if (children.length) return children.forEach(visit);
    if (node.kind === ts.SyntaxKind.JsxText) return;
    const start = node.kind === ts.SyntaxKind.EndOfFileToken ? node.end : node.getStart(sourceFile);
    if (start <= node.pos) return;
    scanner.setText(text, node.pos, start - node.pos);
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
      if (kind !== ts.SyntaxKind.SingleLineCommentTrivia && kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
      comments.push({ text: scanner.getTokenText(), start: scanner.getTokenStart(), end: scanner.getTokenEnd(), firstLine: line(scanner.getTokenStart()), lastLine: line(scanner.getTokenEnd()) });
    }
  };
  visit(sourceFile);
  return { declarations, comments };
}

/**
 * A directive that a new line break in `declaration` could move off what it applies to: one in its leading trivia or
 * inside it, or one whose lines (its own through the next N) reach the declaration's.
 */
export function directiveOver(declaration: Declaration, comments: readonly Comment[]): Comment | null {
  return comments.find((comment) => directiveComment.test(comment.text) && (
    (comment.start >= declaration.pos && comment.end <= declaration.end)
    || (comment.firstLine <= declaration.lastLine && comment.lastLine + directiveReach(comment.text) >= declaration.firstLine))) ?? null;
}

/** Whether the declaration has its lines to itself: it starts a line and only whitespace follows it on its last one. */
export function ownsItsLines(text: string, declaration: Declaration): boolean {
  const lineStart = Math.max(text.lastIndexOf('\n', declaration.start - 1), text.lastIndexOf('\r', declaration.start - 1)) + 1;
  const lineEnd = text.slice(declaration.end).search(/[\n\r]|$/);
  return lineStart === declaration.start && /^[ \t]*$/.test(text.slice(declaration.end, declaration.end + lineEnd));
}

/**
 * The tokens and comments of one declaration's text, without the trailing comma of its named-bindings clause (the
 * one difference prettier's `trailingComma` makes besides whitespace).
 */
export function declarationTokens(text: string): string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  const tokens: { kind: ts.SyntaxKind; text: string }[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.WhitespaceTrivia || kind === ts.SyntaxKind.NewLineTrivia) continue;
    tokens.push({ kind, text: scanner.getTokenText() });
  }
  const from = tokens.findIndex((token) => token.kind === ts.SyntaxKind.FromKeyword);
  const code = (index: number) => tokens.slice(index + 1).find((token) => token.kind !== ts.SyntaxKind.SingleLineCommentTrivia && token.kind !== ts.SyntaxKind.MultiLineCommentTrivia);
  return tokens.filter((token, index) => !(token.kind === ts.SyntaxKind.CommaToken && (from === -1 || index < from) && code(index)?.kind === ts.SyntaxKind.CloseBraceToken))
    .map((token) => token.text);
}

/** Whether two texts of a declaration differ in layout only (whitespace, the clause's trailing comma). */
export function sameDeclarationTokens(before: string, after: string): boolean {
  const a = declarationTokens(before);
  const b = declarationTokens(after);
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

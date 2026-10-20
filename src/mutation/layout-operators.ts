// Layout mutants (plan §2.3 S3): edits that look like layout but change what the code means or what a tool reads,
// each of which K2's layout class must reject while it passes the good head's genuine re-wraps (the control). M34 a
// line break moved where it changes automatic semicolon insertion; M35 whitespace inside a string, template literal or
// JSX text, where the output keeps it; M36 a comma that changes an array's elements or breaks a call; M37 a line break
// moved past a directive comment; M38 a directive comment's text edited so it no longer acts; M39 a line break where
// the grammar forbids one (before an arrow's `=>`), one that detaches a JSDoc comment, and a line terminator of another
// kind (a lone CR between statements, U+2028 inside an import). None is behavior-preserving: a mutant K2 rejects only
// by its byte contract (a trailing comma in a call, a plain comment's words) is not a kill.
import ts from 'typescript';
import { scriptKindOf } from '../analyzer/reference-sites.js';
import { directiveComment } from '../certificate/layout.js';
import { readFile } from '../rewrap/declarations.js';
import { editFile, headText } from './edits.js';
import type { Candidate, Operator } from './operators.js';
import type { Subject } from './subject.js';

interface Source {
  file: string;
  text: string;
  sourceFile: ts.SourceFile;
}

/**
 * Head source files at their base path: the ones the result edited in place first, else every unmoved one. A moved
 * file's mutant is paired with its base only when its import layout alone changed (path-map.ts), so K1 would kill
 * most of them before K2 looks.
 */
function sources(subject: Subject): Source[] {
  const unmoved = [...subject.analyses.head.files.keys()].filter((file) => subject.pathMap.inverse.get(file) === file).sort();
  const edited = unmoved.filter((file) => subject.touched.includes(file));
  return (edited.length ? edited : unmoved).flatMap((file) => {
    const text = headText(subject, file);
    return text === undefined || subject.views.head(file)?.utf8 === false ? [] : [{ file, text, sourceFile: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file)) }];
  });
}

function nodes(source: Source, keep: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (keep(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source.sourceFile);
  return found;
}

/** `text` with [start, end) replaced, as one mutant of `file`. */
function splice(subject: Subject, source: Source, variant: string, start: number, end: number, insert: string, description: string): Candidate {
  return {
    variant,
    key: `${source.file}@${start}`,
    description: `${source.file} line ${source.sourceFile.getLineAndCharacterOfPosition(start).line + 1}: ${description}`,
    build: () => editFile(subject, source.file, source.text.slice(0, start) + insert + source.text.slice(end)),
  };
}

/** Whether a string literal is a reference site's (a specifier: a change inside it is K3's, not a layout question). */
const isSpecifier = (subject: Subject, source: Source, literal: ts.Node) => (subject.views.head(source.file)?.sites ?? []).some((site) => site.start === literal.getStart(source.sourceFile) + 1);

const excerpt = (text: string) => JSON.stringify(text.length > 40 ? `${text.slice(0, 37)}...` : text);

/** The token after `position` (trivia skipped). */
function tokenAfter(source: Source, position: number): { kind: ts.SyntaxKind; start: number } | null {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, source.sourceFile.languageVariant, source.text, undefined, position);
  const kind = scanner.scan();
  return kind === ts.SyntaxKind.EndOfFileToken ? null : { kind, start: scanner.getTokenStart() };
}

/** Whether the text with [start, end) replaced still parses without syntax errors. */
function parses(source: Source, start: number, end: number, insert: string): boolean {
  const text = source.text.slice(0, start) + insert + source.text.slice(end);
  const parsed = ts.createSourceFile(source.file, text, ts.ScriptTarget.Latest, false, scriptKindOf(source.file));
  return (parsed as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics.length === 0;
}

/**
 * Where a space inside JSX text survives the JSX transform, which trims whitespace at the edges of every line but the
 * first line's start and the last line's end: before the first word when it is on the text's first line, else
 * between two characters of one line. Null when there is no such place.
 */
function keptSpace(text: string): number | null {
  const firstLine = /^[^\n\r]*/.exec(text)![0];
  if (/\S/.test(firstLine)) return firstLine.search(/\S/);
  const inner = /\S(?=[^\S\n\r]*\S)/.exec(text);
  return inner ? inner.index + 1 : null;
}

export const layoutOperators: Operator[] = [
  {
    id: 'M34',
    title: 'Move a line break where it changes automatic semicolon insertion',
    expectedKillers: 'K2 (same tokens, different syntax tree)',
    candidates(subject) {
      return sources(subject).flatMap((source) => [
        ...nodes(source, (node) => ts.isReturnStatement(node) && node.expression !== undefined).map((node) => {
          const keyword = node.getStart(source.sourceFile) + 'return'.length;
          return splice(subject, source, 'return', keyword, (node as ts.ReturnStatement).expression!.getStart(source.sourceFile), '\n', `a line break after \`return\`: it now returns undefined`);
        }),
        ...nodes(source, (node) => ts.isPostfixUnaryExpression(node)).flatMap((node) => {
          // `x++` and `y` on the next line become `x` and `++y`: the same tokens, where a statement has no semicolon.
          const update = node as ts.PostfixUnaryExpression;
          if (!ts.isExpressionStatement(update.parent) || update.parent.end !== update.end) return [];
          const next = tokenAfter(source, update.end);
          if (!next || next.kind !== ts.SyntaxKind.Identifier || !/[\n\r]/.test(source.text.slice(update.end, next.start))) return [];
          const moved = `${source.text.slice(update.end, next.start)}${ts.tokenToString(update.operator)}`;
          if (!parses(source, update.operand.end, next.start, moved)) return [];
          return [splice(subject, source, 'postfix', update.operand.end, next.start, moved, `the line break after a postfix ${ts.tokenToString(update.operator)} moved before it: it now applies to the next line`)];
        }),
      ]);
    },
  },
  {
    id: 'M35',
    title: 'Change whitespace inside a string, template literal or JSX text',
    expectedKillers: 'K2 (a token differs)',
    candidates(subject) {
      return sources(subject).flatMap((source) => nodes(source, (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || (ts.isJsxText(node) && node.text.trim() !== ''))
        .filter((node) => !isSpecifier(subject, source, node))
        .flatMap((node) => {
          const start = ts.isJsxText(node) ? node.pos : node.getStart(source.sourceFile);
          const variant = ts.isJsxText(node) ? 'jsx' : ts.isStringLiteral(node) ? 'string' : 'template';
          const at = variant === 'jsx' ? keptSpace(node.getFullText(source.sourceFile)) : 1;
          return at === null ? [] : [splice(subject, source, variant, start + at, start + at, ' ', `a space added inside ${excerpt(source.text.slice(start, node.end))}`)];
        }));
    },
  },
  {
    id: 'M36',
    title: 'Add or remove a comma that is not the trailing comma of an import or export clause',
    expectedKillers: 'K2 (a token differs)',
    candidates(subject) {
      return sources(subject).flatMap((source) => nodes(source, (node) => ts.isCallExpression(node) || ts.isArrayLiteralExpression(node)).flatMap((node) => {
        const list = ts.isCallExpression(node) ? node.arguments : (node as ts.ArrayLiteralExpression).elements;
        const kind = ts.isCallExpression(node) ? 'call' : 'array';
        if (!list.length) return [];
        // A hole before the first element shifts every index (a trailing comma would change nothing).
        const hole = kind === 'array' ? [splice(subject, source, 'array-hole', list.pos, list.pos, ',', `a hole added before the first element of ${excerpt(node.getText(source.sourceFile))}`)] : [];
        const comma = list.length > 1 ? list[0]!.end : -1;
        const removed = comma !== -1 && source.text[comma] === ',' ? [splice(subject, source, 'removed', comma, comma + 1, ' ', `the comma after the first ${kind === 'call' ? 'argument' : 'element'} of ${excerpt(node.getText(source.sourceFile))} removed`)] : [];
        return [...hole, ...removed];
      }));
    },
  },
  {
    id: 'M37',
    title: 'Move a line break past a directive comment (@ts-expect-error, eslint-disable-next-line, ...)',
    expectedKillers: 'K2 (a directive next to a changed line break)',
    candidates(subject) {
      return sources(subject).flatMap((source) => readFile(source.file, source.text).comments.filter((comment) => directiveComment.test(comment.text)).flatMap((comment) => {
        const statement = source.sourceFile.statements.find((candidate) => candidate.pos <= comment.start && candidate.getStart(source.sourceFile) >= comment.end)
          ?? nodes(source, (node) => ts.isStatement(node) && node.pos <= comment.start && node.getStart(source.sourceFile) >= comment.end).at(-1);
        if (!statement) return [];
        const instances: Candidate[] = [splice(subject, source, 'blank-line', comment.end, comment.end, '\n', `a blank line between ${excerpt(comment.text)} and the statement it applies to`)];
        // A line break after an opening bracket, a comma or `=` never changes automatic semicolon insertion.
        const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, source.sourceFile.languageVariant, source.text, undefined, statement.getStart(source.sourceFile));
        for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken && scanner.getTokenEnd() <= statement.end; kind = scanner.scan()) {
          if (kind !== ts.SyntaxKind.OpenParenToken && kind !== ts.SyntaxKind.OpenBracketToken && kind !== ts.SyntaxKind.CommaToken && kind !== ts.SyntaxKind.EqualsToken) continue;
          instances.push(splice(subject, source, 'into-statement', scanner.getTokenEnd(), scanner.getTokenEnd(), '\n', `a line break inside the statement after ${excerpt(comment.text)}: part of it leaves the line the directive applies to`));
          break;
        }
        return instances;
      }));
    },
  },
  {
    id: 'M38',
    title: "Edit a directive comment's text so it no longer acts",
    expectedKillers: 'K2 (a comment differs)',
    candidates(subject) {
      return sources(subject).flatMap((source) => readFile(source.file, source.text).comments.flatMap((comment) => {
        const directive = directiveComment.exec(comment.text);
        if (!directive) return [];
        // A space after the directive's first character: `@ ts-expect-error`, `e slint-disable-next-line`.
        const at = comment.start + directive.index + 1;
        const edited = `${source.text.slice(comment.start, at)} ${source.text.slice(at, comment.end)}`;
        if (directiveComment.test(edited)) return [];
        return [splice(subject, source, comment.text.startsWith('/*') ? 'block' : 'line', at, at, ' ', `${excerpt(comment.text)} becomes ${excerpt(edited)}: no tool reads it as a directive`)];
      }));
    },
  },
  {
    id: 'M39',
    title: 'Break a line where the grammar forbids one, detach a JSDoc comment, or use another line terminator',
    expectedKillers: 'K2 (whitespace changed outside an import or export declaration, or a line terminator the file does not use)',
    candidates(subject) {
      return sources(subject).flatMap((source) => {
        const arrows = nodes(source, ts.isArrowFunction).map((node) => {
          const arrow = (node as ts.ArrowFunction).equalsGreaterThanToken.getStart(source.sourceFile);
          return splice(subject, source, 'arrow', arrow, arrow, '\n', 'a line break before an arrow\'s `=>`: tsc (TS1200) and every runtime reject it');
        });
        const comments = readFile(source.file, source.text).comments;
        const jsDocs = comments.filter((comment) => comment.text.startsWith('/**')).flatMap((comment) => {
          // The line break before it, removed: the comment now trails the previous statement and documents nothing.
          const gap = /\s*$/.exec(source.text.slice(0, comment.start))!;
          const lineComment = comments.some((other) => other.end === gap.index && other.text.startsWith('//'));
          if (gap.index === 0 || !/[\n\r]/.test(gap[0]) || lineComment) return [];
          return [splice(subject, source, 'jsdoc', gap.index, comment.start, ' ', `${excerpt(comment.text)} moved onto the line before: it no longer documents the declaration after it`)];
        });
        const statements = source.sourceFile.statements;
        const carriageReturns = statements.slice(1).flatMap((statement, index) => {
          const gap = source.text.slice(statements[index]!.end, statement.getStart(source.sourceFile));
          const lineFeed = gap.lastIndexOf('\n');
          if (lineFeed === -1 || /\/\/|\/\*/.test(gap)) return [];
          const at = statements[index]!.end + lineFeed;
          return [splice(subject, source, 'carriage-return', at, at + 1, '\r', 'a line feed between two statements replaced by a lone CR: git, editors and coverage tools see one line')];
        }).slice(0, 1);
        const separators = statements.filter((statement) => ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)).flatMap((statement) => {
          const start = statement.getStart(source.sourceFile);
          const lineFeed = source.text.slice(start, statement.end).indexOf('\n');
          if (lineFeed === -1) return [];
          return [splice(subject, source, 'line-separator', start + lineFeed, start + lineFeed + 1, '\u2028', 'a line feed inside an import declaration replaced by U+2028: a line break to the parser, not to git or coverage tools')];
        }).slice(0, 1);
        return [...arrows, ...jsDocs, ...carriageReturns, ...separators];
      });
    },
  },
];

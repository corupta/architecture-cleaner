// Layout mutants (plan §2.3 S3): edits that look like layout but change what the code means or what a tool reads,
// each of which K2's layout class must reject while it passes the good head's genuine re-wraps (the control). M34 a
// line break that changes automatic semicolon insertion; M35 whitespace inside a string, template literal or JSX
// text; M36 a comma that isn't the trailing comma of an import or export clause; M37 a line break moved past a
// directive comment; M38 a comment's text changed.
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
 * file's mutant isn't paired with its base (its text differs beyond specifiers), so K1 would kill it before K2 looks.
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

export const layoutOperators: Operator[] = [
  {
    id: 'M34',
    title: 'Break a line where it changes automatic semicolon insertion',
    expectedKillers: 'K2 (same tokens, different syntax tree)',
    candidates(subject) {
      return sources(subject).flatMap((source) => [
        ...nodes(source, (node) => ts.isReturnStatement(node) && node.expression !== undefined).map((node) => {
          const keyword = node.getStart(source.sourceFile) + 'return'.length;
          return splice(subject, source, 'return', keyword, (node as ts.ReturnStatement).expression!.getStart(source.sourceFile), '\n', `a line break after \`return\`: it now returns undefined`);
        }),
        ...nodes(source, (node) => ts.isPostfixUnaryExpression(node)).map((node) => {
          const operand = (node as ts.PostfixUnaryExpression).operand;
          return splice(subject, source, 'postfix', operand.end, operand.end, '\n', `a line break before a postfix ${ts.tokenToString((node as ts.PostfixUnaryExpression).operator)}: it now applies to the next line`);
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
        .map((node) => {
          const start = ts.isJsxText(node) ? node.pos : node.getStart(source.sourceFile);
          const variant = ts.isJsxText(node) ? 'jsx' : ts.isStringLiteral(node) ? 'string' : 'template';
          // After the opening quote or backtick; in JSX text, before its first word (whitespace at a line's edge is dropped).
          const at = variant === 'jsx' ? start + node.getFullText(source.sourceFile).search(/\S/) : start + 1;
          return splice(subject, source, variant, at, at, ' ', `a space added inside ${excerpt(source.text.slice(start, node.end))}`);
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
        const added = list.hasTrailingComma ? [] : [splice(subject, source, `${kind}-trailing`, list.end, list.end, ',', `a trailing comma added to the ${kind === 'call' ? 'arguments' : 'elements'} of ${excerpt(node.getText(source.sourceFile))}`)];
        const comma = list.length > 1 ? list[0]!.end : -1;
        const removed = comma !== -1 && source.text[comma] === ',' ? [splice(subject, source, 'removed', comma, comma + 1, ' ', `the comma after the first ${kind === 'call' ? 'argument' : 'element'} of ${excerpt(node.getText(source.sourceFile))} removed`)] : [];
        return [...added, ...removed];
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
    title: "Change a comment's text",
    expectedKillers: 'K2 (a comment differs)',
    candidates(subject) {
      return sources(subject).flatMap((source) => readFile(source.file, source.text).comments.map((comment) => {
        const block = comment.text.startsWith('/*');
        const at = block ? comment.end - 2 : comment.end;
        return splice(subject, source, block ? 'block' : 'line', at, at, ' (edited)', `${excerpt(comment.text)} gets " (edited)"`);
      }));
    },
  },
];

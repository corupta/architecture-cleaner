// Extracts every module reference with the exact span of its literal content, plus hazards
// (plan §3.3 step 2; research 04a §2 rows 1-11, 18). Parsing only: no resolution, no Program.
import ts from 'typescript';
import type { Hazard, ReferenceSite } from './types.js';

const mockCallees = new Set([
  'jest.mock', 'jest.doMock', 'jest.unmock', 'jest.dontMock', 'jest.requireActual', 'jest.requireMock', 'jest.createMockFromModule',
  'vi.mock', 'vi.doMock', 'vi.unmock', 'vi.doUnmock', 'vi.importActual', 'vi.importMock',
]);
// `path=` is always file-relative; `types=` only when it starts with './' or '../' (otherwise it names a package).
const tripleSlashReference = /^\/\/\/\s*<reference\s+(path|types)\s*=\s*(["'])([^"']*)\2/;

export interface ExtractedFile {
  sites: ReferenceSite[];
  hazards: Hazard[];
}

export function scriptKindOf(fileName: string): ts.ScriptKind {
  if (/\.(tsx)$/.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.(jsx)$/.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.(m|c)?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function calleeText(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const left = calleeText(expression.expression);
    return left === null ? null : `${left}.${expression.name.text}`;
  }
  return null;
}

function hasVirtualOption(call: ts.CallExpression): boolean {
  const options = call.arguments[2];
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  return options.properties.some((property) => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)
    && property.name.text === 'virtual' && property.initializer.kind === ts.SyntaxKind.TrueKeyword);
}

export function extractSites(fileName: string, text: string): ExtractedFile {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const sites: ReferenceSite[] = [];
  const hazards: Hazard[] = [];

  const literalSite = (literal: ts.StringLiteralLike, kind: ReferenceSite['kind'], extra: Partial<ReferenceSite> = {}) => {
    const start = literal.getStart(sourceFile) + 1;
    const end = literal.getEnd() - 1;
    sites.push({ kind, specifier: literal.text, start, end, typeOnly: false, ...extra });
  };

  for (const range of ts.getLeadingCommentRanges(text, 0) ?? []) {
    const comment = text.slice(range.pos, range.end);
    const match = tripleSlashReference.exec(comment);
    if (!match || (match[1] === 'types' && !/^\.\.?\//.test(match[3]!))) continue;
    const start = range.pos + comment.indexOf(match[2]!, comment.indexOf(match[1]!)) + 1;
    sites.push({ kind: 'triple-slash', specifier: match[3]!, start, end: start + match[3]!.length, typeOnly: true });
  }
  const isAugmentationScope = ts.isExternalModule(sourceFile);

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly = Boolean(clause?.isTypeOnly) || Boolean(clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        && !clause.name && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly));
      literalSite(node.moduleSpecifier, 'import', { typeOnly });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      literalSite(node.moduleSpecifier, 'export', { typeOnly: node.isTypeOnly });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)) {
      literalSite(node.moduleReference.expression, 'import-equals', { typeOnly: node.isTypeOnly });
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name) && (/^\.\.?(\/|$)/.test(node.name.text) || isAugmentationScope)) {
      // In a module file, `declare module 'x'` augments whatever 'x' resolves to (possibly a repo file via paths).
      literalSite(node.name, 'declare-module', { typeOnly: true });
    } else if (ts.isJSDocImportTag(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      literalSite(node.moduleSpecifier, 'import', { typeOnly: true });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      literalSite(node.argument.literal, 'typeof-import', { typeOnly: true });
    } else if (ts.isCallExpression(node)) {
      const argument = node.arguments[0];
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (argument && ts.isStringLiteralLike(argument)) literalSite(argument, 'dynamic-import');
        else hazards.push({ kind: 'dynamic-reference', detail: `import(${argument ? argument.getText(sourceFile).slice(0, 80) : ''})`, offset: node.getStart(sourceFile) });
      } else {
        const callee = calleeText(node.expression);
        if (callee === 'require' || callee === 'require.resolve') {
          if (argument && ts.isStringLiteralLike(argument)) literalSite(argument, callee === 'require' ? 'require' : 'require-resolve');
          else if (argument) hazards.push({ kind: 'dynamic-reference', detail: `${callee}(${argument.getText(sourceFile).slice(0, 80)})`, offset: node.getStart(sourceFile) });
        } else if (callee && mockCallees.has(callee) && argument && ts.isStringLiteralLike(argument)) {
          literalSite(argument, 'mock', { callee, virtual: hasVirtualOption(node) });
        } else if (callee === 'process.cwd') {
          hazards.push({ kind: 'location-sensitive', detail: 'process.cwd()', offset: node.getStart(sourceFile) });
        }
      }
    } else if (ts.isIdentifier(node) && (node.text === '__dirname' || node.text === '__filename') && isValueReference(node)) {
      hazards.push({ kind: 'location-sensitive', detail: node.text, offset: node.getStart(sourceFile) });
    } else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      // Any use of import.meta except the bundler's env/hot objects can expose the module's own location
      // (import.meta.url, import.meta['url'], `const { url } = import.meta`, aliasing).
      const member = ts.isPropertyAccessExpression(node.parent) ? node.parent.name.text : null;
      if (member !== 'env' && member !== 'hot') hazards.push({ kind: 'location-sensitive', detail: `import.meta${member ? `.${member}` : ' (computed)'}`, offset: node.getStart(sourceFile) });
    }
    // `new URL('./x', import.meta.url)` and `import.meta.resolve('./x')` reference a file by its relative path.
    if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === 'URL' && node.arguments?.length === 2) {
      const [first, second] = node.arguments;
      if (first && ts.isStringLiteralLike(first) && /^\.\.?\//.test(first.text) && second?.getText(sourceFile) === 'import.meta.url') literalSite(first, 'url-reference');
    }
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === 'import.meta.resolve') {
      const [first] = node.arguments;
      if (first && ts.isStringLiteralLike(first) && /^\.\.?\//.test(first.text)) literalSite(first, 'url-reference');
    }
    ts.forEachChild(node, visit);
    // JSDoc (`@import`, `@type {import('./x').T}`) is real module syntax in checkJs files; forEachChild skips it.
    for (const doc of (node as { jsDoc?: ts.JSDoc[] }).jsDoc ?? []) visit(doc);
  };
  visit(sourceFile);
  sites.sort((a, b) => a.start - b.start);
  return { sites, hazards };
}

// `__dirname` as an expression, not as a declared name or a property key (`{ __dirname: 1 }`, `declare const __dirname`).
function isValueReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)
    || ts.isPropertyDeclaration(parent) || ts.isFunctionDeclaration(parent)) && parent.name === identifier) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  return true;
}

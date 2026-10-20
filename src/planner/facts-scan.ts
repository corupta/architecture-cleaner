// Per-file syntactic scans for the planner facts: table access (Kysely, Prisma, Drizzle call shapes), route prefixes,
// generated-code banners and pre-existing re-export barrels. Text and AST only, no type checker.
import ts from 'typescript';
import type { PlannerRules } from './types.js';

/** The Kysely calls whose first argument scanTables reads as a table read. */
const kyselyReads = new Set(['selectFrom', 'innerJoin', 'leftJoin', 'rightJoin', 'fullJoin']);

/** The name a Kysely table literal starts with: `'asset as a'` → asset, `'tree(id, parent)'` → tree. */
const leadingName = (literal: string) => /^\s*([\w.]+)/.exec(literal)?.[1];

/** `x.selectFrom(…)` → selectFrom; a bare call (a destructured `selectFrom(…)`) → its identifier. */
const calledName = (call: ts.CallExpression) =>
  ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : ts.isIdentifier(call.expression) ? call.expression.text : undefined;

/**
 * The name a `with` or `withRecursive` call gives its common table expression: a literal (`'tree(id)'` → tree), or the
 * builder form `(cte) => cte('mapping').materialized()` (the literal its parameter is called with).
 */
function cteNameOf(argument: ts.Expression | undefined): string | undefined {
  if (argument && ts.isStringLiteralLike(argument)) return leadingName(argument.text);
  if (!argument || !(ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) return undefined;
  const factory = argument.parameters[0]?.name;
  if (!factory || !ts.isIdentifier(factory)) return undefined;
  let name: string | undefined;
  const visit = (node: ts.Node): void => {
    if (name !== undefined) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === factory.text && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) name = leadingName(node.arguments[0].text);
    else ts.forEachChild(node, visit);
  };
  visit(argument.body);
  return name;
}

/** The outermost expression of the call chain `node` sits in: `db.with(…).selectFrom(…).where(…)`, awaited or not. */
function chainTop(node: ts.Node): ts.Node {
  let current = node;
  for (;;) {
    const parent = current.parent;
    const continues = ((ts.isPropertyAccessExpression(parent) || ts.isCallExpression(parent)) && parent.expression === current) || ts.isNonNullExpression(parent) || ts.isAwaitExpression(parent);
    if (!continues) return current;
    current = parent;
  }
}

/**
 * Where Kysely reads a common table expression, not a table: the offsets of the literals of `selectFrom('<alias>')`
 * and joins inside the query that declares `.with('<alias>', …)` or `.withRecursive('<alias>', …)` (the call chain
 * holding the declaration, nested callbacks included), except inside a non-recursive `with`'s own body, where the
 * name is still the table it may shadow (immich: `.with('asset', (db) => db.selectFrom('asset'))`). A query built
 * across statements isn't one chain: its later reads of the alias stay table reads.
 */
function cteAliasReads(text: string): Set<number> {
  const offsets = new Set<number>();
  if (!/\.\s*with(?:Recursive)?\s*\(/.test(text)) return offsets;
  const sourceFile = ts.createSourceFile('scan.ts', text, ts.ScriptTarget.Latest, true);
  const ctes: { name: string; query: ts.Node; body: ts.Node | undefined }[] = [];
  const reads: { name: string; literal: ts.Node }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const method = calledName(node);
      const first = node.arguments[0];
      if (method === 'with' || method === 'withRecursive') {
        const name = cteNameOf(first);
        if (name) ctes.push({ name, query: chainTop(node), body: method === 'with' ? node.arguments[1] : undefined });
      } else if (method && kyselyReads.has(method) && first && ts.isStringLiteralLike(first)) {
        const name = leadingName(first.text);
        if (name) reads.push({ name, literal: first });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const within = (node: ts.Node, outer: ts.Node | undefined) => outer !== undefined && node.getStart(sourceFile) >= outer.getStart(sourceFile) && node.getEnd() <= outer.getEnd();
  for (const read of reads) {
    if (ctes.some((cte) => cte.name === read.name && within(read.literal, cte.query) && !within(read.literal, cte.body))) offsets.add(read.literal.getStart(sourceFile));
  }
  return offsets;
}

/**
 * Table names a file reads and writes, from query call shapes, sorted. Planner rules 1 read every Kysely
 * `selectFrom`/join literal as a table; rules 2 leave out the reads of a common table expression's alias
 * (cteAliasReads). The Prisma and Drizzle shapes are the same under both.
 */
export function scanTables(text: string, rules: PlannerRules): { reads: string[]; writes: string[] } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const aliasReads = rules === 1 ? new Set<number>() : cteAliasReads(text);
  // Where a match's literal starts (its opening quote): the regexes end on the name, right after that quote.
  const literalAt = (match: RegExpMatchArray, name: string) => match.index! + match[0].length - name.length - 1;
  // Kysely (immich): selectFrom('album'), insertInto('asset'), updateTable(...), deleteFrom(...), joins read.
  for (const match of text.matchAll(/\b(selectFrom|insertInto|updateTable|deleteFrom|replaceInto|mergeInto)\(\s*['"`]([\w.]+)/g)) {
    if (match[1] === 'selectFrom' && aliasReads.has(literalAt(match, match[2]!))) continue;
    (match[1] === 'selectFrom' ? reads : writes).add(match[2]!);
  }
  for (const match of text.matchAll(/\b(?:innerJoin|leftJoin|rightJoin|fullJoin)\(\s*['"`]([\w.]+)/g)) {
    if (!aliasReads.has(literalAt(match, match[1]!))) reads.add(match[1]!);
  }
  // Prisma (hoppscotch, ghostfolio): prisma.team.findMany(...); `prisma.$transaction` is not a table.
  for (const match of text.matchAll(/\bprisma(?:Service)?\.(\w+)\.(\w+)\(/g)) {
    if (match[1]!.startsWith('$')) continue;
    (/^(find|count|aggregate|groupBy)/.test(match[2]!) ? reads : writes).add(match[1]!);
  }
  // Drizzle (kaneo): db.select().from(taskTable), db.insert(taskTable), db.update(taskTable), db.delete(taskTable).
  for (const match of text.matchAll(/\.(from|innerJoin|leftJoin|insert|update|delete)\(\s*(\w+Table)\b/g)) {
    (match[1] === 'from' || match[1] === 'innerJoin' || match[1] === 'leftJoin' ? reads : writes).add(match[2]!.replace(/Table$/, ''));
  }
  return { reads: [...reads].sort(), writes: [...writes].sort() };
}

const routerHint = /\bnew Hono\b|\bnew OpenAPIHono\b|express\.Router\(|\bRouter\(\)/;
const routerMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use', 'route', 'basePath']);

/** Path segments without parameters: `/users/:id/albums` → users, albums. */
const routeSegments = (routePath: string) => routePath.split('/').filter((segment) => segment && !/[:{*]/.test(segment));

/**
 * Route prefixes: every segment of a `@Controller('admin/users')` / `@Controller({ path: … })` path, and in files
 * that create an Express or Hono router, the first segment of each `x.get('/tasks/…')`-style path literal.
 */
export function scanRoutes(sourceFile: ts.SourceFile): string[] {
  const routes = new Set<string>();
  const isRouterFile = routerHint.test(sourceFile.text);
  const pathsOf = (argument: ts.Expression | undefined): string[] => {
    if (!argument) return [];
    if (ts.isStringLiteralLike(argument)) return [argument.text];
    if (ts.isArrayLiteralExpression(argument)) return argument.elements.flatMap((element) => (ts.isStringLiteralLike(element) ? [element.text] : []));
    if (ts.isObjectLiteralExpression(argument)) {
      const property = argument.properties.find((candidate) => ts.isPropertyAssignment(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === 'path');
      return property && ts.isPropertyAssignment(property) ? pathsOf(property.initializer) : [];
    }
    return [];
  };
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      for (const decorator of ts.getDecorators(node) ?? []) {
        const call = decorator.expression;
        if (ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === 'Controller') {
          for (const routePath of pathsOf(call.arguments[0])) for (const segment of routeSegments(routePath)) routes.add(segment);
        }
      }
    } else if (isRouterFile && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && routerMethods.has(node.expression.name.text)) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument) && argument.text.startsWith('/')) {
        const first = routeSegments(argument.text)[0];
        if (first && argument.text.split('/')[1] === first) routes.add(first);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...routes].sort();
}

const generatedBanner = /@generated|auto-generated|autogenerated|do not edit/i;

/** A leading comment (after any shebang) that marks the file as generated. */
export function isGenerated(text: string): boolean {
  const start = text.startsWith('#!') ? text.indexOf('\n') + 1 || text.length : 0;
  return (ts.getLeadingCommentRanges(text, start) ?? []).some((range) => generatedBanner.test(text.slice(range.pos, range.end)));
}

/**
 * A pre-existing re-export barrel: only imports and exports, at least one export, and every export re-exports
 * (`export … from`, or `export { x }` / `export default x` of an imported name). Side-effect imports are allowed.
 */
export function isBarrel(sourceFile: ts.SourceFile): boolean {
  const imported = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const clause = statement.importClause;
    if (clause.name) imported.add(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) imported.add(clause.namedBindings.name.text);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const element of clause.namedBindings.elements) imported.add(element.name.text);
  }
  let exports = 0;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (!statement.moduleSpecifier) {
        if (!clause || !ts.isNamedExports(clause) || !clause.elements.every((element) => imported.has((element.propertyName ?? element.name).text))) return false;
        // `export {}` only marks the file as a module.
        if (!clause.elements.length) continue;
      }
    } else if (!(ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression) && imported.has(statement.expression.text))) {
      return false;
    }
    exports++;
  }
  return exports > 0;
}

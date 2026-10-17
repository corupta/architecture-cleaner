// What a scramble sees in the package at its base commit: the TypeScript files under the module root (code, tests with
// their co-located subject, declaration files), the package's other TS files, every tracked package file (paths a move
// must not land on), and for each code file what its syntax and type checker say: barrel or not, decorators, router,
// type-only exports, primary export. Paths are package-relative, like the manifest's.
import path from 'node:path';
import ts from 'typescript';
import type { RepoFs } from '../analyzer/repo-fs.js';
import { loadScopes } from '../analyzer/tsconfig-scopes.js';
import { createProgram } from '../planner/facts-checker.js';
import { declarationExtension, sourceExtension, testedStem, testPattern } from '../planner/facts-roles.js';
import { isBarrel } from '../planner/facts-scan.js';
import type { SyntaxHints } from './classify.js';

export interface CodeFile extends SyntaxHints {
  path: string;
  barrel: boolean;
  /** The exported class, else the first value export, else the first export (the planner facts' rule). */
  primaryExport: string | null;
}

export interface Inventory {
  /** Code under the module root, sorted by path. */
  code: CodeFile[];
  /** Tests under the module root with the code file they sit next to (`x.service.spec.ts` → `x.service.ts`), sorted. */
  tests: { path: string; subject: string | null }[];
  /** Declaration files under the module root. */
  declarations: string[];
  /** Package TS files outside the module root. */
  outside: string[];
  /** Every tracked file of the package. */
  tracked: string[];
}

// The G1 spike's router hint (Hono, Express): a file that builds a router is a route file.
const routerHint = /\bnew Hono\b|\bnew OpenAPIHono\b|\bcreateRoute\(|\bapiRouter\b|express\.Router\(|\bRouter\(\)/;

/** Decorator names on classes and their members (`@Injectable()`, `@Controller('x')`, `@Field`). */
function decoratorsOf(sourceFile: ts.SourceFile): Set<string> {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isDecorator(node)) {
      const expression = ts.isCallExpression(node.expression) ? node.expression.expression : node.expression;
      if (ts.isIdentifier(expression)) found.add(expression.text);
    }
    if (ts.isSourceFile(node) || ts.isClassDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node)
      || ts.isDecorator(node) || ts.isModuleDeclaration(node) || ts.isModuleBlock(node)) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function readInventory(repo: RepoFs, packageRoot: string, moduleRoot: string): Inventory {
  const packagePrefix = packageRoot ? `${packageRoot}/` : '';
  const modulePrefix = `${moduleRoot}/`;
  const tracked = repo.tracked().filter((file) => file.startsWith(packagePrefix)).map((file) => file.slice(packagePrefix.length)).sort();
  const sources = tracked.filter((file) => sourceExtension.test(file) && !file.split('/').includes('node_modules'));
  const underRoot = sources.filter((file) => file.startsWith(modulePrefix));
  const declarations = underRoot.filter((file) => declarationExtension.test(file));
  const testFiles = underRoot.filter((file) => testPattern.test(file) && !declarationExtension.test(file));
  const codePaths = underRoot.filter((file) => !testPattern.test(file) && !declarationExtension.test(file));
  const codeSet = new Set(codePaths);

  const tests = testFiles.map((test) => {
    const stem = testedStem(path.posix.basename(test));
    const directory = path.posix.dirname(test);
    const subject = stem === null || testPattern.test(`${directory}/`) ? undefined
      : ['.ts', '.tsx', '.mts', '.cts'].map((extension) => path.posix.join(directory, stem + extension)).find((option) => codeSet.has(option));
    return { path: test, subject: subject ?? null };
  });

  // One program per tsconfig scope, as the planner facts build them: exports need the checker (aliases, `export =`).
  const scopeOf = loadScopes(repo);
  const absolutePath = (file: string) => path.join(repo.root, packagePrefix + file);
  const groups = new Map<string, { options: ts.CompilerOptions; files: string[] }>();
  for (const file of codePaths) {
    const scope = scopeOf(packagePrefix + file);
    const key = scope.config ?? '';
    const group = groups.get(key) ?? { options: scope.options, files: [] };
    group.files.push(file);
    groups.set(key, group);
  }
  const code: CodeFile[] = [];
  for (const group of groups.values()) {
    const program = createProgram(repo, group.files.map(absolutePath), group.options);
    const checker = program.getTypeChecker();
    const resolved = (symbol: ts.Symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
    for (const file of group.files) {
      const sourceFile = program.getSourceFile(absolutePath(file)) ?? ts.createSourceFile(file, repo.read(packagePrefix + file) ?? '', ts.ScriptTarget.Latest, true);
      const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
      const exports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
      const values = exports.filter((symbol) => resolved(symbol).flags & ts.SymbolFlags.Value);
      const classExport = exports.find((symbol) => resolved(symbol).flags & ts.SymbolFlags.Class);
      code.push({
        path: file,
        barrel: isBarrel(sourceFile),
        decorators: decoratorsOf(sourceFile),
        router: routerHint.test(sourceFile.text),
        typeOnlyExports: exports.length > 0 && values.length === 0,
        primaryExport: (classExport ?? values[0] ?? exports[0])?.name ?? null,
      });
    }
  }
  code.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    code,
    tests,
    declarations,
    outside: sources.filter((file) => !file.startsWith(modulePrefix)),
    tracked,
  };
}

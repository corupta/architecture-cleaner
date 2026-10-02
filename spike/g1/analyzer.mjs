// Analyzer v0 (G1 spike): inventory, TS-resolved import graph with symbol-level edges through barrels,
// roles, exports, and a cheap table-access scan. Uses the TypeScript 6 compiler API (pinned 6.0.3).
//
//   node spike/g1/analyzer.mjs <repoDir> <packageRoot> [tsconfig] > graph.json
import ts from 'typescript';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const sourceExtensions = /\.(ts|tsx|mts|cts)$/;
const testPattern = /(\.|\/)(spec|test|e2e-spec)\.(ts|tsx|mts|cts)$|(^|\/)(__tests__|__mocks__|test|tests|e2e)\//;
export const roleWords = [
  'controller', 'service', 'module', 'resolver', 'model', 'entity', 'dto', 'args', 'input', 'guard', 'strategy',
  'decorator', 'interceptor', 'filter', 'pipe', 'middleware', 'repository', 'gateway', 'processor', 'mapper',
  'schema', 'interface', 'enum', 'constants', 'config', 'handler', 'command', 'query', 'event', 'subscriber',
  'validator', 'mock', 'helper', 'util', 'utils', 'types', 'type', 'seeder', 'migration', 'table', 'repo', 'dao', 'job', 'worker',
];
const typeFolderRoles = {
  controllers: 'controller', services: 'service', repositories: 'repository', dtos: 'dto', dto: 'dto', entities: 'entity',
  models: 'model', guards: 'guard', strategies: 'strategy', decorators: 'decorator', interceptors: 'interceptor',
  middlewares: 'middleware', middleware: 'middleware', utils: 'util', helpers: 'helper', types: 'types', interfaces: 'interface',
  commands: 'command', queries: 'query', events: 'event', handlers: 'handler', mappers: 'mapper', resolvers: 'resolver',
  schemas: 'schema', schema: 'schema', routes: 'route', routers: 'route', pipes: 'pipe', filters: 'filter', validators: 'validator',
  migrations: 'migration', tables: 'table', workers: 'worker', jobs: 'job', config: 'config',
};
const mockCallees = new Set(['jest.mock', 'jest.doMock', 'jest.unmock', 'jest.requireActual', 'jest.requireMock', 'vi.mock', 'vi.doMock', 'vi.unmock', 'vi.importActual', 'vi.importMock']);

export function roleOf(relativePath) {
  const base = path.posix.basename(relativePath).replace(sourceExtensions, '');
  const parts = base.split('.');
  for (let index = parts.length - 1; index >= 1; index--) {
    const word = parts[index].toLowerCase();
    if (['spec', 'test', 'e2e-spec', 'd'].includes(word)) continue;
    if (roleWords.includes(word)) return word;
  }
  const folders = path.posix.dirname(relativePath).split('/').reverse();
  for (const folder of folders) if (typeFolderRoles[folder]) return typeFolderRoles[folder];
  return 'other';
}

function loadCompilerOptions(configPath) {
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  const options = { ...(parsed?.options ?? {}) };
  // TS 6 legacy-resolution shim (plan §3.3): node10 when unset on CJS repos, and silence 6.0 deprecations.
  if (options.moduleResolution === undefined) {
    const module = options.module;
    options.moduleResolution = module === ts.ModuleKind.Node16 || module === ts.ModuleKind.NodeNext ? ts.ModuleResolutionKind.NodeNext
      : module === undefined || module === ts.ModuleKind.CommonJS ? ts.ModuleResolutionKind.Node10 : ts.ModuleResolutionKind.Bundler;
  }
  options.ignoreDeprecations = '6.0';
  options.types = [];
  options.noEmit = true;
  options.incremental = false;
  delete options.tsBuildInfoFile;
  return options;
}

function scanTables(text) {
  const reads = new Set();
  const writes = new Set();
  // Kysely (immich): selectFrom('album'), insertInto('asset'), updateTable(...), deleteFrom(...)
  for (const match of text.matchAll(/\b(selectFrom|insertInto|updateTable|deleteFrom|replaceInto|mergeInto)\(\s*['"`]([\w.]+)/g)) {
    (match[1] === 'selectFrom' ? reads : writes).add(match[2].split(' ')[0]);
  }
  for (const match of text.matchAll(/\b(?:innerJoin|leftJoin|rightJoin|fullJoin)\(\s*['"`]([\w.]+)/g)) reads.add(match[1].split(' ')[0]);
  // Prisma (hoppscotch, ghostfolio): prisma.team.findMany(...)
  for (const match of text.matchAll(/\bprisma(?:Service)?\.(\w+)\.(\w+)\(/g)) {
    const operation = match[2];
    if (match[1].startsWith('$')) continue;
    (/^(find|count|aggregate|groupBy)/.test(operation) ? reads : writes).add(match[1]);
  }
  // Drizzle (kaneo): db.select().from(taskTable), db.insert(taskTable), db.update(taskTable), db.delete(taskTable)
  for (const match of text.matchAll(/\.(from|innerJoin|leftJoin|insert|update|delete)\(\s*(\w+Table)\b/g)) {
    (['from', 'innerJoin', 'leftJoin'].includes(match[1]) ? reads : writes).add(match[2].replace(/Table$/, ''));
  }
  return { reads: [...reads].sort(), writes: [...writes].sort() };
}

function isBarrelFile(sourceFile) {
  const statements = sourceFile.statements;
  if (statements.length === 0) return false;
  return statements.every((statement) => ts.isExportDeclaration(statement) || (ts.isImportDeclaration(statement) && statements.some(ts.isExportDeclaration)) || ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression));
}

function decoratorsOf(sourceFile) {
  const found = new Set();
  const visit = (node) => {
    if (ts.isDecorator(node)) {
      const expression = ts.isCallExpression(node.expression) ? node.expression.expression : node.expression;
      if (ts.isIdentifier(expression)) found.add(expression.text);
    }
    if (ts.isClassDeclaration(node) || ts.isSourceFile(node) || ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node) || ts.isDecorator(node) || ts.isModuleBlock(node) || ts.isModuleDeclaration(node)) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...found].sort();
}

export function analyze({ repoDir, packageRoot, tsconfig = 'tsconfig.json', trackedFiles }) {
  const packageDir = path.resolve(repoDir, packageRoot);
  const files = (trackedFiles ?? execFileSync('git', ['-C', repoDir, 'ls-files', '-z', '--', packageRoot], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0'))
    .filter((file) => file && sourceExtensions.test(file) && !file.endsWith('.d.ts') && !file.includes('node_modules/'))
    .map((file) => path.posix.relative(packageRoot === '.' ? '' : packageRoot, file))
    .sort();
  const absoluteToId = new Map(files.map((file) => [path.join(packageDir, file), file]));
  const options = loadCompilerOptions(path.join(packageDir, tsconfig));
  const program = ts.createProgram({ rootNames: [...absoluteToId.keys()], options });
  const checker = program.getTypeChecker();
  const moduleHost = { fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, realpath: ts.sys.realpath, directoryExists: ts.sys.directoryExists, getCurrentDirectory: () => packageDir };
  // Non-package specifiers (relative, or matching a tsconfig `paths` key) that fail to resolve: stale after a move.
  const pathKeys = Object.keys(options.paths ?? {}).map((key) => key.replace(/\*$/, ''));
  const isInternalSpecifier = (specifier) => /^\.{1,2}(\/|$)/.test(specifier) || pathKeys.some((key) => key && specifier.startsWith(key));
  const unresolvedSites = [];
  const idOf = (fileName) => absoluteToId.get(path.resolve(fileName)) ?? null;

  const fileFacts = [];
  const edgeMap = new Map();
  const unresolvedRelative = [];
  const addEdge = (from, to, kind, typeOnly, symbol) => {
    if (!to || to === from) return;
    const key = `${from}\0${to}`;
    let edge = edgeMap.get(key);
    if (!edge) edgeMap.set(key, (edge = { from, to, kinds: new Set(), symbols: new Set(), sites: 0, valueSites: 0 }));
    edge.kinds.add(kind);
    edge.sites++;
    if (!typeOnly) edge.valueSites++;
    if (symbol) edge.symbols.add(symbol);
  };

  for (const [absolutePath, id] of absoluteToId) {
    const sourceFile = program.getSourceFile(absolutePath);
    if (!sourceFile) continue;
    const text = sourceFile.text;
    const resolveSpecifier = (specifierNode) => {
      const resolved = program.getResolvedModuleFromModuleSpecifier?.(specifierNode, sourceFile)?.resolvedModule
        ?? ts.resolveModuleName(specifierNode.text, absolutePath, options, moduleHost).resolvedModule;
      const target = resolved ? idOf(resolved.resolvedFileName) : null;
      if (!resolved && /^\.{1,2}\//.test(specifierNode.text)) unresolvedRelative.push({ from: id, specifier: specifierNode.text });
      if (!resolved && isInternalSpecifier(specifierNode.text)) unresolvedSites.push({ from: id, specifier: specifierNode.text, kind: 'import' });
      return target;
    };
    const resolveText = (specifier, kind) => {
      const resolved = ts.resolveModuleName(specifier, absolutePath, options, moduleHost).resolvedModule;
      if (!resolved && isInternalSpecifier(specifier)) unresolvedSites.push({ from: id, specifier, kind });
      return resolved ? idOf(resolved.resolvedFileName) : null;
    };
    const declaringFile = (identifier) => {
      let symbol = checker.getSymbolAtLocation(identifier);
      if (!symbol) return null;
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const declaration = symbol?.declarations?.[0];
      return declaration ? idOf(declaration.getSourceFile().fileName) : null;
    };

    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const moduleTarget = resolveSpecifier(statement.moduleSpecifier);
        const clause = statement.importClause;
        if (!clause) {
          addEdge(id, moduleTarget, 'side-effect', false);
          continue;
        }
        const clauseTypeOnly = clause.isTypeOnly;
        let symbolEdges = 0;
        if (clause.name) {
          const target = declaringFile(clause.name) ?? moduleTarget;
          addEdge(id, target, 'import', clauseTypeOnly, 'default');
          symbolEdges++;
        }
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            const target = declaringFile(element.name) ?? moduleTarget;
            addEdge(id, target, 'import', clauseTypeOnly || element.isTypeOnly, (element.propertyName ?? element.name).text);
            symbolEdges++;
          }
        } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          addEdge(id, moduleTarget, 'namespace-import', clauseTypeOnly, '*');
          symbolEdges++;
        }
        if (!symbolEdges) addEdge(id, moduleTarget, 'import', clauseTypeOnly);
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        addEdge(id, resolveSpecifier(statement.moduleSpecifier), 'reexport', statement.isTypeOnly);
      } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference) && ts.isStringLiteral(statement.moduleReference.expression)) {
        addEdge(id, resolveSpecifier(statement.moduleReference.expression), 'import-equals', statement.isTypeOnly);
      }
    }

    const visit = (node) => {
      if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) {
        const callee = node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'import' : node.expression.getText(sourceFile);
        if (callee === 'require' || callee === 'require.resolve') addEdge(id, resolveText(node.arguments[0].text, 'require'), 'require', false);
        else if (callee === 'import') addEdge(id, resolveText(node.arguments[0].text, 'dynamic-import'), 'dynamic-import', false);
        else if (mockCallees.has(callee)) addEdge(id, resolveText(node.arguments[0].text, 'mock'), 'mock', false);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        addEdge(id, resolveText(node.argument.literal.text, 'typeof-import'), 'typeof-import', true);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    const exportSymbols = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
    const resolvedFlags = (symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol).flags;
    const valueExports = exportSymbols.filter((symbol) => resolvedFlags(symbol) & ts.SymbolFlags.Value);
    const classExport = exportSymbols.find((symbol) => resolvedFlags(symbol) & ts.SymbolFlags.Class);
    const exportsList = exportSymbols.map((symbol) => symbol.name).filter((name) => name !== 'default');
    fileFacts.push({
      id,
      role: roleOf(id),
      loc: text.split('\n').length,
      isTest: testPattern.test(id),
      isBarrel: isBarrelFile(sourceFile),
      exports: exportsList.sort(),
      primaryExport: (classExport ?? valueExports[0] ?? exportSymbols[0])?.name ?? null,
      typeOnlyExports: exportSymbols.length > 0 && valueExports.length === 0,
      hints: { router: /\bnew Hono\b|\bnew OpenAPIHono\b|\bcreateRoute\(|\bapiRouter\b|express\.Router\(|\bRouter\(\)/.test(text) },
      decorators: decoratorsOf(sourceFile),
      tables: scanTables(text),
      locationSensitive: /\b__dirname\b|\b__filename\b|import\.meta\.(url|dirname|filename)|process\.cwd\(\)/.test(text),
    });
  }

  const edges = [...edgeMap.values()].map((edge) => ({
    from: edge.from, to: edge.to, kinds: [...edge.kinds].sort(), symbols: [...edge.symbols].sort(), sites: edge.sites, typeOnly: edge.valueSites === 0,
  }));
  const optionDiagnostics = program.getOptionsDiagnostics().map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
  return {
    repoDir,
    packageRoot,
    sha: trackedFiles ? 'archive' : execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    typescript: ts.version,
    moduleResolution: ts.ModuleResolutionKind[options.moduleResolution],
    files: fileFacts,
    edges,
    unresolvedRelative,
    unresolvedSites,
    optionDiagnostics,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [repoDir, packageRoot = '.', tsconfig = 'tsconfig.json'] = process.argv.slice(2);
  const graph = analyze({ repoDir, packageRoot, tsconfig });
  process.stdout.write(JSON.stringify(graph));
  const stats = { files: graph.files.length, tests: graph.files.filter((file) => file.isTest).length, edges: graph.edges.length, unresolvedRelative: graph.unresolvedRelative.length, moduleResolution: graph.moduleResolution };
  fs.writeSync(2, JSON.stringify(stats) + '\n');
}

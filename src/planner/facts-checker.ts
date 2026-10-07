// The type-checker half of the planner facts: a ts.Program read through the RepoFs, exported symbols, and symbol-level
// edges between movable files (through barrels: each imported name goes to the file that declares it), plus `member`
// edges for `this.x` properties typed as a class from another movable file (immich's BaseService injects ~55
// repositories that services use as `this.albumRepository` without importing them).
import path from 'node:path';
import ts from 'typescript';
import { type RepoFs, moduleResolutionHost, toRelative } from '../analyzer/repo-fs.js';
import type { ResolvedSite } from '../analyzer/types.js';
import type { Edge, EdgeKind } from './types.js';

/** A program over `rootNames` (absolute) whose repo files come from the RepoFs; lib and outside files from disk. */
export function createProgram(repo: RepoFs, rootNames: string[], scopeOptions: ts.CompilerOptions): ts.Program {
  // Same trimming as the G1 spike: no automatic @types (globals don't affect symbol edges), nothing written.
  const options: ts.CompilerOptions = { ...scopeOptions, types: [], noEmit: true, incremental: false, composite: false };
  delete options.tsBuildInfoFile;
  const base = ts.createCompilerHost(options, true);
  const resolution = moduleResolutionHost(repo);
  const inRepo = (fileName: string) => !toRelative(repo, fileName).startsWith('..');
  const readFile = (fileName: string) => resolution.readFile(fileName);
  return ts.createProgram({
    rootNames,
    options,
    host: {
      ...base,
      getCurrentDirectory: () => repo.root,
      fileExists: (fileName) => (inRepo(fileName) ? repo.fileExists(fileName) : ts.sys.fileExists(fileName)),
      directoryExists: (directoryName) => (inRepo(directoryName) ? repo.directoryExists(directoryName) : ts.sys.directoryExists(directoryName)),
      getDirectories: (directoryName) => (inRepo(directoryName) ? resolution.getDirectories!(directoryName) : ts.sys.getDirectories(directoryName)),
      realpath: resolution.realpath!,
      readFile,
      getSourceFile: (fileName, languageVersionOrOptions) => {
        const text = readFile(fileName);
        return text === undefined ? undefined : ts.createSourceFile(fileName, text, languageVersionOrOptions);
      },
    },
  });
}

interface EdgeAccumulator {
  from: string;
  to: string;
  kinds: Set<EdgeKind>;
  symbols: Set<string>;
  valueSites: number;
}

export interface EdgeCollector {
  add(from: string, to: string | null, kind: EdgeKind, typeOnly: boolean, symbol?: string): void;
  /** Aggregated per (from, to), sorted; weight 1 if any site is a value use, 0.5 if all are type-only. */
  edges(): Edge[];
}

export function createEdgeCollector(movable: ReadonlySet<string>): EdgeCollector {
  const accumulators = new Map<string, EdgeAccumulator>();
  return {
    add(from, to, kind, typeOnly, symbol) {
      if (!to || to === from || !movable.has(from) || !movable.has(to)) return;
      const key = `${from}\0${to}`;
      let edge = accumulators.get(key);
      if (!edge) accumulators.set(key, (edge = { from, to, kinds: new Set(), symbols: new Set(), valueSites: 0 }));
      edge.kinds.add(kind);
      if (!typeOnly) edge.valueSites++;
      if (symbol) edge.symbols.add(symbol);
    },
    edges() {
      return [...accumulators.values()]
        .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0))
        .map((edge) => ({
          from: edge.from,
          to: edge.to,
          weight: edge.valueSites ? 1 : 0.5,
          typeOnly: edge.valueSites === 0,
          kinds: [...edge.kinds].sort(),
          symbols: [...edge.symbols].sort(),
        }));
    },
  };
}

export interface CheckedFile {
  /** Exported names without `default`, sorted. */
  exports: string[];
  primaryExport: string | null;
  /** Files this file imports value symbols from (registry detection). */
  valueImports: Set<string>;
}

// Analyzer site kinds that become module-level edges; imports and re-exports are handled per symbol from the AST.
const siteEdgeKinds: Partial<Record<ResolvedSite['kind'], EdgeKind>> = {
  'import-equals': 'import-equals', require: 'require', 'require-resolve': 'require', 'dynamic-import': 'dynamic-import',
  mock: 'mock', 'typeof-import': 'typeof-import',
};

/**
 * Exports and edges of `files` (package-relative, all in `program`). `sitesOf` gives the analyzer's resolved sites of
 * a file; `sourcePathOf` maps an absolute or repo-relative path to a tracked package source file (null otherwise, so
 * a name declared in node_modules or a .d.ts falls back to the module its specifier names, as in the spike).
 */
export function checkFiles(input: {
  program: ts.Program;
  files: string[];
  absolutePath: (file: string) => string;
  sourcePathOf: (fileName: string) => string | null;
  sitesOf: (file: string) => ResolvedSite[];
  collector: EdgeCollector;
}): Map<string, CheckedFile> {
  const { program, collector, sourcePathOf } = input;
  const checker = program.getTypeChecker();
  const resolvedSymbol = (symbol: ts.Symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
  const declaringFile = (symbol: ts.Symbol | undefined) => {
    const declaration = symbol ? resolvedSymbol(symbol).declarations?.[0] : undefined;
    return declaration ? sourcePathOf(declaration.getSourceFile().fileName) : null;
  };
  const checked = new Map<string, CheckedFile>();

  for (const file of input.files) {
    const sourceFile = program.getSourceFile(input.absolutePath(file));
    if (!sourceFile) continue;
    const sites = input.sitesOf(file);
    const targetAt = new Map(sites.map((site) => [site.start, site.resolution.type === 'file' ? sourcePathOf(site.resolution.path) : null]));
    const valueImports = new Set<string>();
    // One imported or re-exported name: the edge goes to the declaring file, else to the module the specifier names.
    const addName = (name: ts.Identifier | ts.StringLiteral, moduleTarget: string | null, kind: EdgeKind, typeOnly: boolean, symbolName: string) => {
      const symbol = checker.getSymbolAtLocation(name);
      const declared = declaringFile(symbol);
      const target = declared ?? moduleTarget;
      collector.add(file, target, kind, typeOnly, symbolName);
      if (kind === 'import' && !typeOnly && declared && symbol && resolvedSymbol(symbol).flags & ts.SymbolFlags.Value) valueImports.add(declared);
    };

    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const moduleTarget = targetAt.get(statement.moduleSpecifier.getStart(sourceFile) + 1) ?? null;
        const clause = statement.importClause;
        if (!clause) {
          collector.add(file, moduleTarget, 'side-effect', false);
          continue;
        }
        let symbolEdges = 0;
        if (clause.name) {
          addName(clause.name, moduleTarget, 'import', clause.isTypeOnly, 'default');
          symbolEdges++;
        }
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            addName(element.name, moduleTarget, 'import', clause.isTypeOnly || element.isTypeOnly, (element.propertyName ?? element.name).text);
            symbolEdges++;
          }
        } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          collector.add(file, moduleTarget, 'namespace-import', clause.isTypeOnly, '*');
          symbolEdges++;
        }
        if (!symbolEdges) collector.add(file, moduleTarget, 'import', clause.isTypeOnly);
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const moduleTarget = targetAt.get(statement.moduleSpecifier.getStart(sourceFile) + 1) ?? null;
        const clause = statement.exportClause;
        if (clause && ts.isNamedExports(clause)) {
          for (const element of clause.elements) addName(element.name, moduleTarget, 'reexport', statement.isTypeOnly || element.isTypeOnly, (element.propertyName ?? element.name).text);
        } else {
          collector.add(file, moduleTarget, 'reexport', statement.isTypeOnly);
        }
      }
    }
    for (const site of sites) {
      const kind = siteEdgeKinds[site.kind];
      if (kind) collector.add(file, targetAt.get(site.start) ?? null, kind, site.typeOnly);
    }

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) addMemberEdge(node);
      ts.forEachChild(node, visit);
    };
    // `this.x` where x is a property (own, parameter property or inherited) typed as a class declared elsewhere.
    const addMemberEdge = (access: ts.PropertyAccessExpression) => {
      const property = checker.getSymbolAtLocation(access.name);
      if (!property || !(property.flags & (ts.SymbolFlags.Property | ts.SymbolFlags.GetAccessor))) return;
      const type = checker.getNonNullableType(checker.getTypeAtLocation(access));
      for (const part of type.isUnion() ? type.types : [type]) {
        const classSymbol = part.getSymbol();
        const declaration = classSymbol?.declarations?.find((candidate) => ts.isClassDeclaration(candidate) || ts.isClassExpression(candidate));
        if (classSymbol && declaration) collector.add(file, sourcePathOf(declaration.getSourceFile().fileName), 'member', false, classSymbol.name);
      }
    };
    visit(sourceFile);

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    const exportSymbols = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
    const valueExports = exportSymbols.filter((symbol) => resolvedSymbol(symbol).flags & ts.SymbolFlags.Value);
    const classExport = exportSymbols.find((symbol) => resolvedSymbol(symbol).flags & ts.SymbolFlags.Class);
    checked.set(file, {
      exports: exportSymbols.map((symbol) => symbol.name).filter((name) => name !== 'default').sort(),
      primaryExport: (classExport ?? valueExports[0] ?? exportSymbols[0])?.name ?? null,
      valueImports,
    });
  }
  return checked;
}

/** Maps an absolute or repo-relative path to its package-relative path when that is one of `sources`, else null. */
export function sourcePathMapper(repo: RepoFs, packageRoot: string, sources: ReadonlySet<string>): (fileName: string) => string | null {
  const packageDirectory = path.join(repo.root, packageRoot);
  return (fileName) => {
    const relative = path.relative(packageDirectory, path.isAbsolute(fileName) ? fileName : path.join(repo.root, fileName)).split(path.sep).join('/');
    return sources.has(relative) ? relative : null;
  };
}

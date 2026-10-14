// R4's rules (plan §2.3) as a dependency-cruiser config: a module DAG allow-list and barrel-less public files per
// module, shared is a leaf, platform never imports a module, controllers never reach persistence, and no file-level
// cycle leaves its folder. Paths are package-relative: the check runs from the package root. Type-only imports count
// (tsPreCompilationDeps), tests are exempt as importers, and every rule is an error; today's violations are frozen in
// the known-violations baseline, not allowed by the rules.
import { compare, type FolderGraph } from './folder-graph.js';
import { backEdgesOf } from './order.js';
import { dataAccessPattern, schemaPattern, type Persistence } from './persistence.js';
import { testPattern } from '../planner/facts-roles.js';

export type RuleKind = 'module-dag' | 'module-public-files' | 'shared-leaf' | 'platform-not-modules' | 'controller-not-persistence' | 'folder-cycle';

export interface Restriction {
  path?: string;
  pathNot?: string | string[];
  dependencyTypes?: string[];
  circular?: boolean;
  via?: { pathNot: string };
}

export interface BoundaryRule {
  name: string;
  kind: RuleKind;
  severity: 'error';
  comment: string;
  from: Restriction;
  to: Restriction;
  /** The module key of a per-module rule. */
  module?: string;
}

export interface RuleInput {
  graph: FolderGraph;
  /** The DAG order over the module keys (importers first). */
  order: string[];
  persistence: Persistence;
}

export const configFileName = '.dependency-cruiser.json';
export const knownViolationsFileName = '.dependency-cruiser-known-violations.json';

export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anyOf = (alternatives: string[]) => `(${alternatives.map(escapeRegExp).join('|')})`;
const exactFiles = (files: string[]) => `^${anyOf(files)}$`;
const moduleName = (key: string) => key.slice('module/'.length);
const listed = (names: string[]) => (names.length ? names.join(', ') : 'none');

/** Package-relative path prefixes of the layout, as regex sources. */
export function layoutPatterns(moduleRoot: string) {
  const base = moduleRoot ? `${escapeRegExp(moduleRoot)}/` : '';
  return {
    scope: `^${base}`,
    modules: `^${base}modules/`,
    module: (key: string) => `^${base}modules/${escapeRegExp(moduleName(key))}/`,
    platform: `^${base}platform/`,
    shared: `^${base}shared/`,
    /** One capture group: the folder of a module, platform or shared file. */
    folder: `^(${base}(?:modules|platform)/[^/]+|${base}shared)/`,
    // dependency-cruiser refuses nested quantifiers (safe-regex), hence no `(?:[^/]+/)*`.
    controller: `^${base}.*[^/]\\.controller\\.[cm]?[jt]sx?$`,
  };
}

/** Local files only: never a package, a Node built-in, or a file outside the package. */
const localOnly = { dependencyTypes: ['local', 'localmodule'], outside: ['^\\.\\./', '(^|/)node_modules/'] };

/** For each module, the modules it may import: today's edges that point forward in the order. */
export function allowedImports(graph: FolderGraph, order: string[]): Map<string, string[]> {
  const position = new Map(order.map((key, at) => [key, at]));
  const allowed = new Map<string, string[]>(graph.modules.map((key) => [key, []]));
  for (const edge of graph.edges) {
    if (!position.has(edge.from) || !position.has(edge.to)) continue;
    if (position.get(edge.from)! < position.get(edge.to)!) allowed.get(edge.from)!.push(edge.to);
  }
  for (const list of allowed.values()) list.sort((left, right) => position.get(left)! - position.get(right)!);
  return allowed;
}

export function boundaryRules({ graph, order, persistence }: RuleInput): BoundaryRule[] {
  const patterns = layoutPatterns(graph.layout.moduleRoot);
  const tests = testPattern.source;
  const moduleRoot = graph.layout.moduleRoot ? `${graph.layout.moduleRoot}/` : '';
  const rootPath = graph.compositionRoot && graph.folders.find((folder) => folder.key === graph.compositionRoot)!.path;
  const rootExemption = rootPath ? [`^${escapeRegExp(rootPath)}/`] : [];
  const rootNote = rootPath ? ` ${rootPath}/ is the composition root (DI and route tables): it wires every module and is exempt.` : '';
  const rules: BoundaryRule[] = [
    {
      name: 'shared-is-a-leaf', kind: 'shared-leaf', severity: 'error',
      comment: `${moduleRoot}shared/ is a leaf: it imports nothing in the package outside ${moduleRoot}shared/ (packages and Node built-ins are fine), so every folder can use it without a cycle.`,
      from: { path: patterns.shared, pathNot: tests },
      to: { dependencyTypes: localOnly.dependencyTypes, pathNot: [patterns.shared, ...localOnly.outside] },
    },
    {
      name: 'platform-not-to-modules', kind: 'platform-not-modules', severity: 'error',
      comment: `${moduleRoot}platform/ holds cross-cutting concerns that feature modules build on; a platform file never imports a module.${rootNote}`,
      from: { path: patterns.platform, pathNot: [tests, ...rootExemption] },
      to: { path: patterns.modules },
    },
    {
      name: 'controller-not-to-persistence', kind: 'controller-not-persistence', severity: 'error',
      comment: `A controller handles requests and delegates to services; it never imports persistence directly: schema, table and entity definitions, migrations, or a data-access file (*.repository, *.repo, *.dao). ${persistence.adapters.length} data-access files that reach no database today are adapters and exempt: ${listed(persistence.adapters)}.`,
      from: { path: patterns.controller, pathNot: tests },
      to: {
        path: `${schemaPattern}|${dataAccessPattern}`, dependencyTypes: localOnly.dependencyTypes,
        pathNot: [...localOnly.outside, ...(persistence.adapters.length ? [exactFiles(persistence.adapters)] : [])],
      },
    },
    {
      name: 'no-cycle-leaving-a-folder', kind: 'folder-cycle', severity: 'error',
      comment: 'A file-level import cycle may stay inside its folder (a module, a platform concern, shared/); a cycle that leaves the folder fails.',
      from: { path: patterns.folder, pathNot: tests },
      to: { circular: true, via: { pathNot: '^$1/' } },
    },
  ];
  const allowed = allowedImports(graph, order);
  const position = new Map(order.map((key, at) => [key, at]));
  const backEdges = backEdgesOf(order, graph.edges.filter((edge) => position.has(edge.from) && position.has(edge.to)));
  for (const key of [...graph.modules].sort(compare)) {
    const may = allowed.get(key) ?? [];
    const frozen = backEdges.filter((edge) => edge.from === key).map((edge) => moduleName(edge.to));
    rules.push({
      name: `module-dag/${moduleName(key)}`, kind: 'module-dag', severity: 'error', module: key,
      comment: `${key} may import only the modules it imports today that come after it in the module DAG order: ${listed(may.map(moduleName))}. Any other module import, forward or back, fails; today's back-edges (${listed(frozen)}) are frozen in the baseline.`,
      from: { path: patterns.module(key), pathNot: tests },
      to: { path: patterns.modules, pathNot: `${patterns.modules}${anyOf([key, ...may].map(moduleName))}/` },
    });
  }
  for (const key of [...graph.modules].sort(compare)) {
    const publicFiles = graph.publicFiles[key] ?? [];
    rules.push({
      name: `module-public/${moduleName(key)}`, kind: 'module-public-files', severity: 'error', module: key,
      comment: `${key} has no barrel: its public files are the ones other folders import today (${publicFiles.length}: ${listed(publicFiles)}). Importing any other file of the module from outside it fails.${rootNote}`,
      from: { path: patterns.scope, pathNot: [patterns.module(key), tests, ...rootExemption] },
      to: { path: patterns.module(key), ...(publicFiles.length ? { pathNot: exactFiles(publicFiles) } : {}) },
    });
  }
  return rules;
}

export interface ConfigOptions {
  /** Package-relative tsconfig whose `paths` the check resolves with, or null. */
  tsConfig: string | null;
}

/** The dependency-cruiser config file: the rules (severity error, with their comments) and the cruise options. */
export function configText(rules: BoundaryRule[], options: ConfigOptions): string {
  const config = {
    forbidden: rules.map(({ name, severity, comment, from, to }) => ({ name, severity, comment, from, to })),
    options: {
      doNotFollow: { path: '(^|/)node_modules/' },
      tsPreCompilationDeps: true,
      ...(options.tsConfig ? { tsConfig: { fileName: options.tsConfig } } : {}),
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

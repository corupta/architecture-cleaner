// R4's input (plan §2.3, contract C8): the analyzer's resolved file edges of a package, collapsed to the layout's
// folders: module/<m>, platform/<c>, shared, and other:<dir> for the files R1–R3 left where they were. The importers
// are the production files under the module root, the scope the boundary rules check: tests (the planner's test
// pattern) reach across folders by design, so they are neither checked nor counted. All paths are package-relative.
// platform/registry is the composition root (the planner's label for DI and route tables, plan §2.2): it wires every
// module, so what it imports doesn't make a module file public.
import path from 'node:path';
import type { Analysis, SiteKind } from '../analyzer/types.js';
import { testPattern } from '../planner/facts-roles.js';

export interface Layout {
  /** Repo-relative package root ('' for the repo root). */
  packageRoot: string;
  /** Package-relative directory holding modules/, platform/ and shared/ ('' for the package root). */
  moduleRoot: string;
}

export interface Folder {
  /** module/<m> | platform/<c> | shared | other:<package-relative dir> */
  key: string;
  /** Package-relative directory ('' for the package root). */
  path: string;
  files: number;
}

/** One importer and one imported file, however many sites connect them. */
export interface FilePair {
  from: string;
  to: string;
  /** Every site between the two is type-only (erased at runtime). */
  typeOnly: boolean;
}

export interface FolderEdge {
  from: string;
  to: string;
  /** File pairs, value and type-only. */
  files: number;
  typeOnlyFiles: number;
  sample: { from: string; to: string }[];
}

export interface FolderGraph {
  layout: Layout;
  folders: Folder[];
  /** Folder key → its source files (tests included), sorted. */
  filesOf: Map<string, string[]>;
  pairs: FilePair[];
  /** Folder-level edges, sorted by from, then to. */
  edges: FolderEdge[];
  /** Module key → its files that production code in other folders (but the composition root) imports today, sorted. */
  publicFiles: Record<string, string[]>;
  /** The composition root's folder key, when the tree has one. */
  compositionRoot: string | null;
  /** Module keys, sorted. */
  modules: string[];
}

/** Sites that load the file they name (mocks, ambient declarations, URLs and `require.resolve` don't). */
const dependencyKinds = new Set<SiteKind>(['import', 'export', 'import-equals', 'dynamic-import', 'typeof-import', 'require', 'triple-slash']);
const sampleSize = 3;
/** The planner's group for registries (DI and route tables): the composition root. */
export const compositionRootKey = 'platform/registry';

export const isTestCode = (file: string) => testPattern.test(file);

const join = (...parts: string[]) => parts.filter(Boolean).join('/');

export function normalizeDirectory(directory: string): string {
  const normalized = directory.replace(/^\.\/?/, '').replace(/\/+$/, '');
  return normalized === '.' ? '' : normalized;
}

/** The folder a package-relative file belongs to. */
export function folderOf(file: string, moduleRoot: string): { key: string; path: string } {
  const prefix = moduleRoot ? `${moduleRoot}/` : '';
  if (file.startsWith(prefix)) {
    const [kind, name, ...rest] = file.slice(prefix.length).split('/');
    if (kind === 'modules' && name && rest.length) return { key: `module/${name}`, path: join(moduleRoot, 'modules', name) };
    if (kind === 'platform' && name && rest.length) return { key: `platform/${name}`, path: join(moduleRoot, 'platform', name) };
    if (kind === 'shared' && name) return { key: 'shared', path: join(moduleRoot, 'shared') };
  }
  const directory = path.posix.dirname(file);
  return { key: `other:${directory}`, path: directory === '.' ? '' : directory };
}

/** The folder graph of `analysis` (repo-relative paths) for the package and module root of `layout`. */
export function folderGraph(analysis: Analysis, layout: Layout): FolderGraph {
  const packagePrefix = layout.packageRoot ? `${layout.packageRoot}/` : '';
  const scopePrefix = layout.moduleRoot ? `${layout.moduleRoot}/` : '';
  const inPackage = (file: string) => file.startsWith(packagePrefix);
  const relative = (file: string) => file.slice(packagePrefix.length);
  const inScope = (file: string) => file.startsWith(scopePrefix);

  const pairs = new Map<string, FilePair>();
  const nodes = new Set<string>();
  for (const analyzed of analysis.files.values()) {
    if (!inPackage(analyzed.path)) continue;
    const from = relative(analyzed.path);
    if (!inScope(from)) continue;
    nodes.add(from);
    if (isTestCode(from)) continue;
    for (const site of analyzed.sites) {
      if (!dependencyKinds.has(site.kind) || site.resolution.type !== 'file' || !inPackage(site.resolution.path)) continue;
      const to = relative(site.resolution.path);
      if (to === from) continue;
      nodes.add(to);
      const key = `${from}\0${to}`;
      const existing = pairs.get(key);
      if (existing) existing.typeOnly &&= site.typeOnly;
      else pairs.set(key, { from, to, typeOnly: site.typeOnly });
    }
  }

  const filesOf = new Map<string, string[]>();
  const folderPaths = new Map<string, string>();
  const keyOf = new Map<string, string>();
  for (const file of [...nodes].sort()) {
    const folder = folderOf(file, layout.moduleRoot);
    keyOf.set(file, folder.key);
    folderPaths.set(folder.key, folder.path);
    filesOf.set(folder.key, [...(filesOf.get(folder.key) ?? []), file]);
  }
  const folders = [...filesOf].map(([key, files]) => ({ key, path: folderPaths.get(key)!, files: files.length })).sort((left, right) => compare(left.key, right.key));

  const sortedPairs = [...pairs.values()].sort((left, right) => compare(left.from, right.from) || compare(left.to, right.to));
  const edgeMap = new Map<string, FolderEdge>();
  const publicSets = new Map<string, Set<string>>();
  for (const pair of sortedPairs) {
    const from = keyOf.get(pair.from)!;
    const to = keyOf.get(pair.to)!;
    if (from === to) continue;
    const key = `${from}\0${to}`;
    let edge = edgeMap.get(key);
    if (!edge) edgeMap.set(key, (edge = { from, to, files: 0, typeOnlyFiles: 0, sample: [] }));
    edge.files++;
    if (pair.typeOnly) edge.typeOnlyFiles++;
    if (edge.sample.length < sampleSize) edge.sample.push({ from: pair.from, to: pair.to });
    if (to.startsWith('module/') && from !== compositionRootKey) publicSets.set(to, (publicSets.get(to) ?? new Set()).add(pair.to));
  }
  const edges = [...edgeMap.values()].sort((left, right) => compare(left.from, right.from) || compare(left.to, right.to));
  const modules = folders.map((folder) => folder.key).filter((key) => key.startsWith('module/'));
  const publicFiles: Record<string, string[]> = {};
  for (const module of modules) publicFiles[module] = [...(publicSets.get(module) ?? [])].sort();
  const compositionRoot = filesOf.has(compositionRootKey) ? compositionRootKey : null;
  return { layout, folders, filesOf, pairs: sortedPairs, edges, publicFiles, modules, compositionRoot };
}

/** Code-point order, so the order never depends on the locale. */
export const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

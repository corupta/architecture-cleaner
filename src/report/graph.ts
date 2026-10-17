// The before/after module graph of a run (plan §4 "Outputs"): the analyzer's resolved imports at the run's base and
// final commits, both read from git objects (never a working tree), collapsed to display folders: the layout's
// module/<m>, platform/<c> and shared, and for everything else the first directory under the module root (the type
// folders: src/controllers/, src/services/, ...). Plus the files flow: where each source file under the module root
// went, through the run's certified steps' path maps. Stored as <run-dir>/graph.json, so a committed run dir renders
// offline; recomputed only when the repo is reachable.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { analyzeRepo, isSourceFile } from '../analyzer/analyze.js';
import type { Analysis } from '../analyzer/types.js';
import { compare, compositionRootKey, folderGraph, folderOf, isTestCode, type Layout } from '../boundaries/folder-graph.js';
import { stronglyConnectedComponents } from '../boundaries/order.js';
import { prefetchAnalyzerInputs } from '../certificate/certify.js';
import { commitRepoFs, createEnvironment } from '../certificate/commit-fs.js';
import { readCommitTree, type CommitTree } from '../certificate/git-tree.js';
import type { RunState } from '../orchestrator/types.js';

export type FolderKind = 'module' | 'platform' | 'shared' | 'folder' | 'root' | 'outside';

export interface GraphFolder {
  /** `module/<m>`, `platform/<c>`, `shared`, or a package-relative directory with a trailing slash (`src/controllers/`). */
  key: string;
  kind: FolderKind;
  /** Source files under the module root in this folder, tests included. */
  files: number;
  /** Of them, production files (not tests): the importers the edges count. */
  productionFiles: number;
  /** Importer → imported file pairs with both files in this folder. */
  internalPairs: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** Production importer → imported file pairs between the two folders. */
  pairs: number;
  /** Of them, pairs whose every site is type-only. */
  typeOnlyPairs: number;
}

export interface GraphSide {
  commit: string;
  tree: string;
  folders: GraphFolder[];
  /** Folder edges, sorted by from, then to. */
  edges: GraphEdge[];
  /** Importer → imported file pairs that stay inside one folder, and those that cross folders. */
  internalPairs: number;
  crossPairs: number;
  /** Strongly connected folder sets of more than one folder, largest first; the composition root is left out. */
  cycles: string[][];
}

export interface FlowEdge {
  /** Base display folder → head display folder. */
  from: string;
  to: string;
  files: number;
}

/** <run-dir>/graph.json */
export interface RunGraph {
  format: 'ac-graph/1';
  /** The repo's `origin` remote as an https URL (no credentials, no .git), when it has one: links to the base commit. */
  origin: string | null;
  packageRoot: string;
  moduleRoot: string;
  base: GraphSide;
  head: GraphSide;
  /** Every source file under the module root at base, by where it ended at head (moved or not). */
  flow: FlowEdge[];
  /** Files whose final path isn't in the head tree (a step map that doesn't match the tree): none in a sound run. */
  unmatched: string[];
  source: { analyzer: string; typescript: string };
}

const join = (...parts: string[]) => parts.filter(Boolean).join('/');

/** The display folder of a package-relative file: the layout's folders, else the first directory under the module root. */
export function displayFolder(file: string, moduleRoot: string): { key: string; kind: FolderKind } {
  const layoutFolder = folderOf(file, moduleRoot).key;
  if (layoutFolder.startsWith('module/')) return { key: layoutFolder, kind: 'module' };
  if (layoutFolder.startsWith('platform/')) return { key: layoutFolder, kind: 'platform' };
  if (layoutFolder === 'shared') return { key: layoutFolder, kind: 'shared' };
  const prefix = moduleRoot ? `${moduleRoot}/` : '';
  if (file.startsWith(prefix)) {
    const rest = file.slice(prefix.length).split('/');
    if (rest.length === 1) return { key: prefix || './', kind: 'root' };
    return { key: `${prefix}${rest[0]}/`, kind: 'folder' };
  }
  const parts = file.split('/');
  return { key: parts.length === 1 ? './' : `${parts[0]}/`, kind: 'outside' };
}

const kindOrder: FolderKind[] = ['folder', 'root', 'module', 'platform', 'shared', 'outside'];
const byKindThenKey = (left: GraphFolder, right: GraphFolder) => kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind) || compare(left.key, right.key);

/** One side's graph from an analysis of the module root's source files (repo-relative keys). */
export function graphSide(analysis: Analysis, layout: Layout, commit: { commit: string; tree: string }): GraphSide {
  const graph = folderGraph(analysis, layout);
  const packagePrefix = layout.packageRoot ? `${layout.packageRoot}/` : '';
  const folders = new Map<string, GraphFolder>();
  const folderFor = (file: string) => {
    const { key, kind } = displayFolder(file, layout.moduleRoot);
    let folder = folders.get(key);
    if (!folder) folders.set(key, (folder = { key, kind, files: 0, productionFiles: 0, internalPairs: 0 }));
    return folder;
  };
  for (const file of [...graph.filesOf.values()].flat()) {
    const folder = folderFor(file);
    folder.files++;
    if (!isTestCode(file)) folder.productionFiles++;
  }
  // Every analyzed file counts, even one with no edge (folderGraph only lists files that import or are imported).
  const listed = new Set([...graph.filesOf.values()].flat());
  for (const file of [...analysis.files.keys()].filter((key) => key.startsWith(packagePrefix)).map((key) => key.slice(packagePrefix.length)).sort(compare)) {
    if (listed.has(file) || (layout.moduleRoot && !file.startsWith(`${layout.moduleRoot}/`))) continue;
    const folder = folderFor(file);
    folder.files++;
    if (!isTestCode(file)) folder.productionFiles++;
  }
  const edges = new Map<string, GraphEdge>();
  let internalPairs = 0;
  let crossPairs = 0;
  for (const pair of graph.pairs) {
    const from = folderFor(pair.from).key;
    const to = folderFor(pair.to).key;
    if (from === to) {
      internalPairs++;
      folders.get(from)!.internalPairs++;
      continue;
    }
    crossPairs++;
    const key = `${from}\0${to}`;
    let edge = edges.get(key);
    if (!edge) edges.set(key, (edge = { from, to, pairs: 0, typeOnlyPairs: 0 }));
    edge.pairs++;
    if (pair.typeOnly) edge.typeOnlyPairs++;
  }
  const sortedEdges = [...edges.values()].sort((left, right) => compare(left.from, right.from) || compare(left.to, right.to));
  const outsideRoot = (key: string) => key !== compositionRootKey;
  const cycles = stronglyConnectedComponents([...folders.keys()].filter(outsideRoot),
    sortedEdges.filter((edge) => outsideRoot(edge.from) && outsideRoot(edge.to)).map((edge) => ({ from: edge.from, to: edge.to, weight: edge.pairs })))
    .filter((component) => component.length > 1)
    .sort((left, right) => right.length - left.length || compare(left[0]!, right[0]!));
  return { ...commit, folders: [...folders.values()].sort(byKindThenKey), edges: sortedEdges, internalPairs, crossPairs, cycles };
}

/** Base path → final path of every file the run's certified steps moved, composed in step order (repo-relative). */
export function composedPathMap(state: Pick<RunState, 'steps'>): Map<string, string> {
  const originOf = new Map<string, string>();
  const finalOf = new Map<string, string>();
  for (const step of [...state.steps].sort((left, right) => left.index - right.index)) {
    if (step.status !== 'certified' || !step.pathMap) continue;
    for (const [from, to] of Object.entries(step.pathMap).sort(([left], [right]) => compare(left, right))) {
      const origin = originOf.get(from) ?? from;
      originOf.delete(from);
      originOf.set(to, origin);
      finalOf.set(origin, to);
    }
  }
  return new Map([...finalOf].sort(([left], [right]) => compare(left, right)));
}

/** Where every module-root source file at base ended at head, as display-folder counts. */
export function filesFlow(baseFiles: readonly string[], headFiles: ReadonlySet<string>, pathMap: ReadonlyMap<string, string>, layout: Layout): { flow: FlowEdge[]; unmatched: string[] } {
  const packagePrefix = layout.packageRoot ? `${layout.packageRoot}/` : '';
  const counts = new Map<string, FlowEdge>();
  const unmatched: string[] = [];
  for (const file of [...baseFiles].sort(compare)) {
    const final = pathMap.get(file) ?? file;
    if (!headFiles.has(final)) {
      unmatched.push(file);
      continue;
    }
    const from = displayFolder(file.slice(packagePrefix.length), layout.moduleRoot).key;
    const to = displayFolder(final.slice(packagePrefix.length), layout.moduleRoot).key;
    const key = `${from}\0${to}`;
    const edge = counts.get(key) ?? { from, to, files: 0 };
    edge.files++;
    counts.set(key, edge);
  }
  return { flow: [...counts.values()].sort((left, right) => compare(left.from, right.from) || compare(left.to, right.to)), unmatched };
}

/** Source files under the module root of a tree (repo-relative). */
export function moduleRootFiles(tree: Pick<CommitTree, 'entries'>, layout: Layout): string[] {
  const scope = join(layout.packageRoot, layout.moduleRoot);
  return [...tree.entries.keys()].filter((file) => isSourceFile(file) && (!scope || file.startsWith(`${scope}/`))).sort(compare);
}

/** `origin` as a browsable https URL: credentials, a trailing .git and ssh forms (git@host:owner/repo) normalized. */
export function browsableUrl(remote: string): string | null {
  const ssh = /^git@([^:]+):(.+?)(\.git)?$/.exec(remote);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = /^https:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(\.git)?\/?$/.exec(remote);
  return https ? `https://${https[1]}/${https[2]}` : null;
}

function originUrl(repo: string): string | null {
  try {
    return browsableUrl(execFileSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return null;
  }
}

export interface ComputeGraphInput {
  /** Any clone holding the run's base and head commits. */
  repo: string;
  /** A checkout whose node_modules the analyzer may read (tsconfig `extends` from a package); optional. */
  environment?: string;
  state: Pick<RunState, 'packageRoot' | 'moduleRoot' | 'base' | 'head' | 'steps'>;
  log?: (message: string) => void;
}

/** Analyzes the run's base and head trees from git objects and builds graph.json. */
export function computeRunGraph(input: ComputeGraphInput): RunGraph {
  const layout: Layout = { packageRoot: input.state.packageRoot, moduleRoot: input.state.moduleRoot };
  const base = readCommitTree(input.repo, input.state.base);
  const head = readCommitTree(input.repo, input.state.head);
  const shadowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-report-'));
  try {
    const checkout = input.environment && fs.existsSync(input.environment) ? input.environment : input.repo;
    const environment = createEnvironment(checkout, [base, head], shadowRoot);
    const side = (tree: CommitTree): { side: GraphSide; files: string[] } => {
      const started = performance.now();
      prefetchAnalyzerInputs(tree);
      const files = moduleRootFiles(tree, layout);
      const analysis = analyzeRepo(commitRepoFs(tree, environment.shadowRoot, environment.checkout), { files });
      input.log?.(`analyzed ${files.length} files at ${tree.commit.slice(0, 10)} in ${Math.round(performance.now() - started)} ms`);
      return { side: graphSide(analysis, layout, { commit: tree.commit, tree: tree.tree }), files };
    };
    const before = side(base);
    const after = side(head);
    const { flow, unmatched } = filesFlow(before.files, new Set(head.entries.keys()), composedPathMap(input.state), layout);
    return {
      format: 'ac-graph/1',
      origin: originUrl(input.repo),
      packageRoot: layout.packageRoot,
      moduleRoot: layout.moduleRoot,
      base: before.side,
      head: after.side,
      flow,
      unmatched,
      source: { analyzer: 'architecture-cleaner analyzer (TypeScript module resolution), production importers under the module root', typescript: ts.version },
    };
  } finally {
    fs.rmSync(shadowRoot, { recursive: true, force: true });
  }
}

export const graphFileName = 'graph.json';

/** graph.json of a run dir when it describes this run's base and head, else null. */
export function readRunGraph(runDirectory: string, state: Pick<RunState, 'base' | 'head'>): RunGraph | null {
  const file = path.join(runDirectory, graphFileName);
  if (!fs.existsSync(file)) return null;
  const graph = JSON.parse(fs.readFileSync(file, 'utf8')) as RunGraph;
  if (graph.format !== 'ac-graph/1' || graph.base.commit !== state.base || graph.head.commit !== state.head) return null;
  return graph;
}

export const graphJson = (graph: RunGraph) => `${JSON.stringify(graph, null, 1)}\n`;

// The bench's deterministic baselines (plan §7), over the product's Facts (built by `buildFacts` on the scrambled
// tree, or on a real target): B0 type folders, name-token (full stem, and anchored with prefix merging), export-token
// (anchored; survives opaque file names), the planner's own seeds draft from both seed sources (file names, export
// names; the planner starts from the one plannerDraft picks), and Louvain at resolutions 1, 2, 4 × seeds 1–5. Ported from the G1 spike (spike/g1/baselines.mjs on branch
// spike/gates); the name-token family reuses the planner's seeds code (src/planner/seeds.ts) with its propagation and
// its four review rules off, which is the spike's algorithm.
import graphologyModule from 'graphology';
import louvainModule from 'graphology-communities-louvain';
import { exportName, exportSeedDraft, plannerDraft, renamedFacts, seedDraft, stemTokens } from '../planner/seeds.js';

export { exportName, renamedFacts };
import type { Facts, FileFact } from '../planner/types.js';
import type { BenchDraft } from './types.js';

// TypeScript reads both packages' typings as CommonJS (neither declares "type": "module") and types the default import
// as the module object; at runtime the default import is the class and the function themselves.
const Graph = graphologyModule as unknown as typeof graphologyModule.default;
const louvain = louvainModule as unknown as typeof louvainModule.default;

export type Assignment = Map<string, string>;

export interface BaselinePartition {
  method: string;
  kind: 'baseline' | 'draft';
  assignment: Assignment;
}

export const louvainResolutions = [1, 2, 4] as const;
export const louvainSeeds = [1, 2, 3, 4, 5] as const;

/** The spike's seeded PRNG (Louvain's rng). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** B0: the first folder under the module root, `root` for a file directly in it. On a scramble, the type folders. */
export function typeFolders(facts: Facts): Assignment {
  const prefix = facts.moduleRoot ? `${facts.moduleRoot}/` : '';
  return new Map(facts.files.map((file) => {
    const segments = (file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path).split('/');
    return [file.path, segments.length > 1 ? segments[0]! : 'root'];
  }));
}

/** Every file in the group its whole stem names (`team-collection.service.ts` → team-collection). */
export function nameTokenFullStem(facts: Facts): Assignment {
  return new Map(facts.files.map((file) => [file.path, stemTokens(file.path).join('-') || '(empty)']));
}

/**
 * Anchors are the stems of entity-like files plus 1–2 token sequences shared by ≥ 3 stems; every file joins the longest
 * anchor inside its tokens ("prefix merging", research 03b §6), else the group its stem names. That is the seeds
 * draft's seeding step alone: no propagation, none of the review rules.
 */
export function nameTokenAnchored(facts: Facts): Assignment {
  return seedDraft(facts, { iterations: 0, audienceQualifiers: false, genericAnchors: false, registries: false, attestedSingulars: false }).assignment;
}

/** A method run on renamed facts, its assignment keyed by the real paths again. */
export function underNames(facts: Facts, nameOf: (file: FileFact) => string, method: (facts: Facts) => Assignment): Assignment {
  const view = renamedFacts(facts, nameOf);
  return new Map([...method(view.facts)].map(([key, label]) => [view.original.get(key)!, label]));
}

/**
 * Louvain (graphology) on the undirected graph of the facts' edges; both directions of a pair add their weights. Nodes
 * go in in facts order (sorted paths), and Louvain depends on that order: an H1 tree can find other communities than its
 * default twin. With the spike's node order this reproduces every G1 seed exactly.
 */
export function louvainClusters(facts: Facts, { seed, resolution }: { seed: number; resolution: number }): Assignment {
  const graph = new Graph({ type: 'undirected' });
  for (const file of facts.files) graph.addNode(file.path);
  for (const edge of facts.edges) {
    if (edge.from === edge.to || !graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;
    if (graph.hasEdge(edge.from, edge.to)) graph.updateEdgeAttribute(edge.from, edge.to, 'weight', (weight: number) => weight + edge.weight);
    else graph.addEdge(edge.from, edge.to, { weight: edge.weight });
  }
  const communities = louvain(graph, { getEdgeWeight: 'weight', resolution, rng: mulberry32(seed) });
  return new Map(facts.files.map((file) => [file.path, `louvain-${communities[file.path]}`]));
}

/**
 * Every baseline but Louvain, plus the seeds draft from both seed sources (every rule on). The one the planner starts
 * from (plannerDraft's GT-free choice) is kind `draft`, the other a baseline.
 */
export function baselinePartitions(facts: Facts): BaselinePartition[] {
  const { source } = plannerDraft(facts);
  return [
    { method: 'B0 type folders', kind: 'baseline', assignment: typeFolders(facts) },
    { method: 'name-token (full stem)', kind: 'baseline', assignment: nameTokenFullStem(facts) },
    { method: 'name-token (anchored)', kind: 'baseline', assignment: nameTokenAnchored(facts) },
    { method: 'export-token (anchored)', kind: 'baseline', assignment: underNames(facts, exportName, nameTokenAnchored) },
    { method: 'seeds draft (file names)', kind: source === 'file names' ? 'draft' : 'baseline', assignment: seedDraft(facts).assignment },
    { method: 'seeds draft (export names)', kind: source === 'export names' ? 'draft' : 'baseline', assignment: exportSeedDraft(facts).assignment },
  ];
}

/** The seeds draft the planner starts from, and the contested counts plannerDraft chose it by. */
export function benchDraft(facts: Facts): BenchDraft {
  const { source } = plannerDraft(facts);
  return { method: `seeds draft (${source})`, source, contested: { fileNames: seedDraft(facts).contested.length, exportNames: exportSeedDraft(facts).contested.length } };
}

/** Louvain per resolution, one partition per seed. */
export function louvainPartitions(facts: Facts): Map<number, Assignment[]> {
  return new Map(louvainResolutions.map((resolution) => [resolution, louvainSeeds.map((seed) => louvainClusters(facts, { seed, resolution }))]));
}

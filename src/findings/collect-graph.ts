// Module cycles and back-edges (plan §2.3 findings log). The folder graph comes from R4's boundary report (contract
// C8) when R4 ran, else from the planner's facts at the run's base commit grouped by the run's plan. A strongly
// connected set is one finding however large, with the edges that close its cycles: R4's back-edges inside it, else
// (and for what they leave cyclic) the backward edges of a greedy feedback-arc order that keeps heavy edges forward.
import { plannedEdges, stronglyConnectedComponents } from '../planner/metrics.js';
import type { BoundaryReport } from './run-data.js';
import type { Target } from './target.js';
import type { CollectedFinding } from './types.js';

export interface GraphEdge {
  from: string;
  to: string;
  /** File pairs (the plan graph) or files (the boundary report) behind the edge. */
  weight: number;
  sample: { from: string; to: string }[];
}

export interface GroupGraph {
  nodes: string[];
  edges: GraphEdge[];
  /** What an edge's weight counts. */
  unit: 'file pairs' | 'files';
  /** What a node is: a plan group, or a folder of the boundary report. */
  noun: 'groups' | 'folders';
  /** Where the graph came from, for the evidence. */
  origin: string;
  /** Edges the boundary rules froze as against their order (C8 backEdges), empty for the plan graph. */
  backEdges: GraphEdge[];
  /** Strongly connected sets of size > 1. */
  sccs: string[][];
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const edgeKey = (edge: { from: string; to: string }) => `${edge.from}\0${edge.to}`;
const closingEdgeLimit = 15;
const sampleLimit = 3;

function componentsOf(nodes: readonly string[], edges: readonly GraphEdge[]): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    let targets = adjacency.get(edge.from);
    if (!targets) adjacency.set(edge.from, (targets = new Set()));
    targets.add(edge.to);
  }
  return stronglyConnectedComponents(nodes, adjacency)
    .filter((component) => component.length > 1)
    .map((component) => component.sort(byCodeUnit))
    .sort((a, b) => b.length - a.length || byCodeUnit(a[0]!, b[0]!));
}

/** The plan's groups over the facts' edges (registries included: their imports are real). */
export function planGraph(target: Target): GroupGraph {
  const groupOf = new Map(target.plan.placements.map((placement) => [placement.path, `${placement.kind}/${placement.name}`]));
  const byPair = new Map<string, GraphEdge>();
  for (const edge of plannedEdges(target.facts.edges, groupOf)) {
    const from = groupOf.get(edge.from)!;
    const to = groupOf.get(edge.to)!;
    if (from === to) continue;
    const key = edgeKey({ from, to });
    const groupEdge = byPair.get(key) ?? { from, to, weight: 0, sample: [] };
    groupEdge.weight++;
    if (groupEdge.sample.length < sampleLimit) groupEdge.sample.push({ from: target.repoPath(edge.from), to: target.repoPath(edge.to) });
    byPair.set(key, groupEdge);
  }
  const nodes = [...new Set(groupOf.values())].sort(byCodeUnit);
  const edges = [...byPair.values()].sort((a, b) => byCodeUnit(edgeKey(a), edgeKey(b)));
  return { nodes, edges, unit: 'file pairs', noun: 'groups', origin: `the planner's facts at ${target.facts.sha.slice(0, 10)}, grouped by the run's plan.yaml`, backEdges: [], sccs: componentsOf(nodes, edges) };
}

/** C8 samples are package-relative (`src/modules/album/album.service.ts`); findings name repo-relative paths. */
export function repoPathOf(report: Pick<BoundaryReport, 'packageRoot'>): (file: string) => string {
  const prefix = report.packageRoot ? `${report.packageRoot}/` : '';
  return (file) => (file.startsWith(prefix) ? file : prefix + file);
}

export function boundaryGraph(report: BoundaryReport): GroupGraph {
  const repoPath = repoPathOf(report);
  const asEdge = (edge: BoundaryReport['edges'][number]): GraphEdge => ({
    from: edge.from, to: edge.to, weight: edge.files, sample: edge.sample.slice(0, sampleLimit).map((pair) => ({ from: repoPath(pair.from), to: repoPath(pair.to) })),
  });
  const nodes = [...new Set([...report.folders.map((folder) => folder.key), ...report.edges.flatMap((edge) => [edge.from, edge.to])])].sort(byCodeUnit);
  const sccs = report.sccs.filter((component) => component.length > 1).map((component) => [...component].sort(byCodeUnit))
    .sort((a, b) => b.length - a.length || byCodeUnit(a[0]!, b[0]!));
  return { nodes, edges: report.edges.map(asEdge), unit: 'files', noun: 'folders', origin: 'R4\'s boundary report (boundaries/report.json)', backEdges: report.backEdges.map(asEdge), sccs };
}

/**
 * Eades–Lin–Smyth: peel sinks to the back and sources to the front, else move the node with the largest outgoing minus
 * incoming weight to the front. Importers come before what they import; ties break by name, so the order is stable.
 */
export function feedbackArcOrder(nodes: readonly string[], edges: readonly GraphEdge[]): string[] {
  const remaining = new Set(nodes);
  const front: string[] = [];
  const back: string[] = [];
  const weightOf = (node: string, direction: 'out' | 'in') => edges.reduce((sum, edge) => {
    const [self, other] = direction === 'out' ? [edge.from, edge.to] : [edge.to, edge.from];
    return self === node && other !== node && remaining.has(other) ? sum + edge.weight : sum;
  }, 0);
  const pick = (predicate: (node: string) => boolean) => [...remaining].sort(byCodeUnit).find(predicate);
  while (remaining.size) {
    let node: string | undefined;
    if ((node = pick((candidate) => weightOf(candidate, 'out') === 0))) back.unshift(node);
    else if ((node = pick((candidate) => weightOf(candidate, 'in') === 0))) front.push(node);
    else {
      const scored = [...remaining].sort(byCodeUnit).map((candidate) => ({ candidate, score: weightOf(candidate, 'out') - weightOf(candidate, 'in') }));
      node = scored.reduce((best, entry) => (entry.score > best.score ? entry : best)).candidate;
      front.push(node);
    }
    remaining.delete(node);
  }
  return [...front, ...back];
}

/** Edges whose removal leaves `members` acyclic: the given back-edges inside it, then a feedback-arc order's backward edges for what is still cyclic. */
export function closingEdges(members: readonly string[], edges: readonly GraphEdge[], backEdges: readonly GraphEdge[]): GraphEdge[] {
  const inside = new Set(members);
  const internal = edges.filter((edge) => edge.from !== edge.to && inside.has(edge.from) && inside.has(edge.to));
  const given = new Set(backEdges.filter((edge) => inside.has(edge.from) && inside.has(edge.to)).map(edgeKey));
  const closing = internal.filter((edge) => given.has(edgeKey(edge)));
  for (const component of componentsOf(members, internal.filter((edge) => !given.has(edgeKey(edge))))) {
    const componentSet = new Set(component);
    const componentEdges = internal.filter((edge) => !given.has(edgeKey(edge)) && componentSet.has(edge.from) && componentSet.has(edge.to));
    const position = new Map(feedbackArcOrder(component, componentEdges).map((node, index) => [node, index]));
    closing.push(...componentEdges.filter((edge) => position.get(edge.from)! > position.get(edge.to)!));
  }
  return closing.sort((a, b) => b.weight - a.weight || byCodeUnit(edgeKey(a), edgeKey(b)));
}

const sampleText = (edge: GraphEdge) => (edge.sample.length ? `, e.g. ${edge.sample.slice(0, 1).map((pair) => `${pair.from} → ${pair.to}`).join('')}` : '');
const edgeLine = (edge: GraphEdge, unit: string) => `- ${edge.from} → ${edge.to} (${edge.weight} ${unit}${sampleText(edge)})`;

export function cycleFindings(graph: GroupGraph): CollectedFinding[] {
  return graph.sccs.map((members) => {
    const inside = new Set(members);
    const internal = graph.edges.filter((edge) => edge.from !== edge.to && inside.has(edge.from) && inside.has(edge.to));
    const closing = closingEdges(members, graph.edges, graph.backEdges);
    const sum = (edges: GraphEdge[]) => edges.reduce((total, edge) => total + edge.weight, 0);
    const title = members.length === 2 ? `${members[0]} and ${members[1]} import each other` : `${members.length} ${graph.noun} form one import cycle`;
    const evidence = [
      `${members.length} of ${graph.nodes.length} ${graph.noun} are strongly connected (from ${graph.origin}): each reaches every other through imports.`,
      `Members: ${members.join(', ')}.`,
      `Inside the set: ${internal.length} edges between them over ${sum(internal)} ${graph.unit}. These ${closing.length} edges (${sum(closing)} ${graph.unit}) close every cycle${graph.backEdges.length ? ' (R4\'s back-edges first)' : ''}; without them the set is acyclic:`,
      ...closing.slice(0, closingEdgeLimit).map((edge) => edgeLine(edge, graph.unit)),
      ...(closing.length > closingEdgeLimit ? [`- … ${closing.length - closingEdgeLimit} more edges (${sum(closing.slice(closingEdgeLimit))} ${graph.unit})`] : []),
    ].join('\n');
    return {
      key: members.join('\0'),
      kind: 'module-cycle',
      title,
      files: closing.slice(0, closingEdgeLimit).flatMap((edge) => edge.sample.slice(0, 1).flatMap((pair) => [pair.from, pair.to])),
      evidence,
      source: graph.unit === 'files' ? 'boundaries' : 'plan-graph',
      weight: members.length,
    };
  });
}

/** One finding per back-edge R4 froze (C8): an import against the module order its allow-list encodes. */
export function backEdgeFindings(report: BoundaryReport): CollectedFinding[] {
  const repoPath = repoPathOf(report);
  return report.backEdges.map((edge) => ({
    key: edgeKey(edge),
    kind: 'back-edge',
    title: `Back-edge ${edge.from} → ${edge.to}`,
    files: edge.sample.flatMap((pair) => [repoPath(pair.from), repoPath(pair.to)]),
    evidence: [
      `${edge.from} imports ${edge.to} in ${edge.files} files, against the module order R4's allow-list encodes; R4's baseline freezes it as a known violation.`,
      ...edge.sample.slice(0, sampleLimit).map((pair) => `- ${repoPath(pair.from)} → ${repoPath(pair.to)}`),
    ].join('\n'),
    source: 'boundaries',
    weight: edge.files,
  }));
}

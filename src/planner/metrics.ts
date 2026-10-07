// The validator's graph metrics for one plan (plan §3.5 items 4 and 6), ported from the G1 spike's evaluatePlan:
// cross-group edge ratio, cycles in the group quotient graph (Tarjan), graph disagreements, and TurboMQ.
// None of them knows the right answer: on immich TurboMQ ranked the unedited draft first (gates.md G1, item 4).
import { turboMq } from './metrics-turbo-mq.js';
import { groupKey, type Draft, type Edge, type Facts, type Placement, type PlanMetrics } from './types.js';

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round = (value: number, digits: number) => Number(value.toFixed(digits));
const disagreementLimit = 25;

/** Each (from, to) pair once (first occurrence), no self-loops, both ends planned. */
export function plannedEdges(edges: readonly Edge[], groupOf: ReadonlyMap<string, string>): Edge[] {
  const seen = new Set<string>();
  const unique: Edge[] = [];
  for (const edge of edges) {
    if (edge.from === edge.to || !groupOf.has(edge.from) || !groupOf.has(edge.to)) continue;
    const pair = `${edge.from}\0${edge.to}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    unique.push(edge);
  }
  return unique;
}

/** Tarjan's strongly connected components; neighbours are visited in code-unit order so the output is stable. */
export function stronglyConnectedComponents(nodes: readonly string[], adjacency: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  let counter = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const components: string[][] = [];
  const strongConnect = (node: string) => {
    indices.set(node, counter);
    lowlink.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    for (const next of [...(adjacency.get(node) ?? [])].sort(byCodeUnit)) {
      if (!indices.has(next)) {
        strongConnect(next);
        lowlink.set(node, Math.min(lowlink.get(node)!, lowlink.get(next)!));
      } else if (onStack.has(next)) lowlink.set(node, Math.min(lowlink.get(node)!, indices.get(next)!));
    }
    if (lowlink.get(node) === indices.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component);
    }
  };
  for (const node of nodes) if (!indices.has(node)) strongConnect(node);
  return components;
}

/** Metrics over `placements` (movable files only, one placement per path). */
export function planMetrics(facts: Facts, draft: Draft, placements: readonly Placement[]): PlanMetrics {
  const groupOf = new Map(placements.map((placement) => [placement.path, groupKey(placement)]));
  const sizes = new Map<string, number>();
  for (const group of groupOf.values()) sizes.set(group, (sizes.get(group) ?? 0) + 1);
  const groups = [...sizes.keys()].sort(byCodeUnit);
  const edges = plannedEdges(facts.edges, groupOf);

  let crossEdges = 0;
  const adjacency = new Map<string, Set<string>>();
  // pull: file → group → summed weight of its edges (both directions) to files in that group, its own group included.
  // Registries wire every feature, so their edges say nothing about where a file belongs (G1: they topped the list).
  const registries = new Set(facts.files.filter((file) => file.role === 'registry').map((file) => file.path));
  const pull = new Map<string, Map<string, number>>();
  for (const edge of edges) {
    const from = groupOf.get(edge.from)!;
    const to = groupOf.get(edge.to)!;
    const wiring = registries.has(edge.from) || registries.has(edge.to);
    for (const [file, other] of wiring ? [] : ([[edge.from, to], [edge.to, from]] as const)) {
      let votes = pull.get(file);
      if (!votes) pull.set(file, (votes = new Map()));
      votes.set(other, (votes.get(other) ?? 0) + edge.weight);
    }
    if (from === to) continue;
    crossEdges++;
    let targets = adjacency.get(from);
    if (!targets) adjacency.set(from, (targets = new Set()));
    targets.add(to);
  }

  const cycles = stronglyConnectedComponents(groups, adjacency)
    .filter((component) => component.length > 1)
    .map((component) => component.sort(byCodeUnit))
    .sort((a, b) => byCodeUnit(a[0]!, b[0]!));

  const disagreements: (PlanMetrics['disagreements'][number] & { rawShare: number })[] = [];
  for (const [file, votes] of pull) {
    const own = groupOf.get(file)!;
    const ownWeight = votes.get(own) ?? 0;
    let total = 0;
    let strongest: [string, number] | null = null;
    for (const [group, weight] of votes) {
      total += weight;
      if (group === own) continue;
      if (!strongest || weight > strongest[1] || (weight === strongest[1] && group < strongest[0])) strongest = [group, weight];
    }
    if (!strongest || strongest[1] <= ownWeight) continue;
    disagreements.push({ path: file, group: own, pulledTo: strongest[0], share: round(strongest[1] / total, 2), ownShare: round(ownWeight / total, 2), rawShare: strongest[1] / total });
  }
  disagreements.sort((a, b) => b.rawShare - a.rawShare || byCodeUnit(a.path, b.path));

  const { sum, mean } = turboMq(groupOf, edges);
  return {
    files: placements.length,
    groups: groups.length,
    modules: groups.filter((group) => group.startsWith('module/')).length,
    sharedOrPlatformFiles: placements.filter((placement) => placement.kind !== 'module').length,
    singletonGroups: groups.filter((group) => sizes.get(group) === 1),
    crossEdgeRatio: edges.length ? round(crossEdges / edges.length, 4) : 0,
    turboMqSum: round(sum, 4),
    turboMqMean: round(mean, 4),
    cycles,
    groupsInCycles: cycles.reduce((count, cycle) => count + cycle.length, 0),
    disagreements: disagreements.slice(0, disagreementLimit).map(({ rawShare, ...disagreement }) => disagreement),
    movedFromDraft: placements.filter((placement) => placement.name !== draft.assignment.get(placement.path)).length,
  };
}

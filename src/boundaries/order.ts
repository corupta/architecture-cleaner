// The module DAG order R4's allow-list is cut from: strongly connected components (Tarjan) in topological order,
// and inside each component the Eades–Lin–Smyth greedy minimum-feedback heuristic on edge weights (file pairs).
// Every choice breaks ties by name, so the order is a function of the graph. Edges point from importer to imported,
// and the order lists importers first: an edge is forward when its target comes later, a back-edge otherwise.
import { compare } from './folder-graph.js';

export interface WeightedEdge {
  from: string;
  to: string;
  weight: number;
}

/** Strongly connected components; members sorted, components sorted by their first member. */
export function stronglyConnectedComponents(nodes: readonly string[], edges: readonly WeightedEdge[]): string[][] {
  const successors = adjacency(nodes, edges);
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (node: string) => {
    index.set(node, index.size);
    lowLink.set(node, index.get(node)!);
    stack.push(node);
    onStack.add(node);
    for (const next of successors.get(node)!) {
      if (!index.has(next)) {
        visit(next);
        lowLink.set(node, Math.min(lowLink.get(node)!, lowLink.get(next)!));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node)!, index.get(next)!));
      }
    }
    if (lowLink.get(node) !== index.get(node)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    components.push(component.sort(compare));
  };
  for (const node of [...nodes].sort(compare)) if (!index.has(node)) visit(node);
  return components.sort((left, right) => compare(left[0]!, right[0]!));
}

/** Importers first: the components in topological order, each ordered by the greedy heuristic. */
export function dagOrder(nodes: readonly string[], edges: readonly WeightedEdge[]): string[] {
  const components = stronglyConnectedComponents(nodes, edges);
  const componentOf = new Map<string, number>();
  components.forEach((component, position) => component.forEach((node) => componentOf.set(node, position)));
  const successors = components.map(() => new Set<number>());
  const incoming = components.map(() => 0);
  for (const edge of edges) {
    const from = componentOf.get(edge.from)!;
    const to = componentOf.get(edge.to)!;
    if (from === to || successors[from]!.has(to)) continue;
    successors[from]!.add(to);
    incoming[to]!++;
  }
  // Kahn's algorithm; among ready components the one whose first member sorts first.
  const ready = components.map((_, position) => position).filter((position) => incoming[position] === 0);
  const order: string[] = [];
  while (ready.length) {
    ready.sort((left, right) => compare(components[left]![0]!, components[right]![0]!));
    const position = ready.shift()!;
    const component = components[position]!;
    order.push(...(component.length === 1 ? component : greedyOrder(component, edges.filter((edge) => component.includes(edge.from) && component.includes(edge.to)))));
    for (const next of successors[position]!) if (--incoming[next]! === 0) ready.push(next);
  }
  return order;
}

/**
 * Eades, Lin and Smyth (1993), weighted: repeatedly peel off sinks (to the back) and sources (to the front), then move
 * the node with the largest outgoing minus incoming weight to the front.
 */
export function greedyOrder(nodes: readonly string[], edges: readonly WeightedEdge[]): string[] {
  const remaining = new Set(nodes);
  const front: string[] = [];
  const back: string[] = [];
  const weight = (node: string, direction: 'out' | 'in') => edges
    .filter((edge) => (direction === 'out' ? edge.from === node && remaining.has(edge.to) : edge.to === node && remaining.has(edge.from)) && edge.from !== edge.to)
    .reduce((sum, edge) => sum + edge.weight, 0);
  const take = (node: string) => remaining.delete(node);
  while (remaining.size) {
    for (let sink = firstWhere(remaining, (node) => weight(node, 'out') === 0); sink; sink = firstWhere(remaining, (node) => weight(node, 'out') === 0)) {
      back.unshift(sink);
      take(sink);
    }
    for (let source = firstWhere(remaining, (node) => weight(node, 'in') === 0); source; source = firstWhere(remaining, (node) => weight(node, 'in') === 0)) {
      front.push(source);
      take(source);
    }
    if (!remaining.size) break;
    let best: string | undefined;
    let bestDelta = -Infinity;
    for (const node of [...remaining].sort(compare)) {
      const delta = weight(node, 'out') - weight(node, 'in');
      if (delta > bestDelta) [best, bestDelta] = [node, delta];
    }
    front.push(best!);
    take(best!);
  }
  return [...front, ...back];
}

/** Edges whose target comes before their source in `order`. */
export function backEdgesOf<Edge extends { from: string; to: string }>(order: readonly string[], edges: readonly Edge[]): Edge[] {
  const position = new Map(order.map((node, at) => [node, at]));
  return edges.filter((edge) => position.has(edge.from) && position.has(edge.to) && position.get(edge.from)! > position.get(edge.to)!);
}

function adjacency(nodes: readonly string[], edges: readonly WeightedEdge[]): Map<string, string[]> {
  const successors = new Map<string, string[]>(nodes.map((node) => [node, []]));
  for (const edge of edges) if (edge.from !== edge.to && successors.has(edge.to)) successors.get(edge.from)?.push(edge.to);
  for (const list of successors.values()) list.sort(compare);
  return successors;
}

const firstWhere = (nodes: Set<string>, predicate: (node: string) => boolean) => [...nodes].sort(compare).find(predicate);

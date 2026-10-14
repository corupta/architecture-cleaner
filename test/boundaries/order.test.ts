import { describe, expect, test } from 'vitest';
import { backEdgesOf, dagOrder, greedyOrder, stronglyConnectedComponents, type WeightedEdge } from '../../src/boundaries/order.js';

const edge = (from: string, to: string, weight = 1): WeightedEdge => ({ from, to, weight });

describe('strongly connected components', () => {
  test('finds the cycles, members and components sorted, singletons kept', () => {
    const components = stronglyConnectedComponents(['d', 'c', 'b', 'a'], [edge('b', 'a'), edge('a', 'b'), edge('c', 'd'), edge('d', 'c'), edge('a', 'c')]);
    expect(components).toEqual([['a', 'b'], ['c', 'd']]);
    expect(stronglyConnectedComponents(['x', 'y'], [edge('x', 'y')])).toEqual([['x'], ['y']]);
  });

  test('ignores edges to nodes outside the graph', () => {
    expect(stronglyConnectedComponents(['a'], [edge('a', 'z')])).toEqual([['a']]);
  });
});

describe('the DAG order', () => {
  test('lists importers first and breaks ties by name', () => {
    expect(dagOrder(['c', 'b', 'a'], [edge('a', 'c'), edge('b', 'c')])).toEqual(['a', 'b', 'c']);
    expect(dagOrder(['a', 'b', 'c'], [edge('c', 'b'), edge('b', 'a')])).toEqual(['c', 'b', 'a']);
  });

  test('orders a cycle by weight: the lighter direction becomes the back-edge', () => {
    // b imports a through 5 file pairs, a imports b through 1: a after b, whatever the names say.
    const edges = [edge('b', 'a', 5), edge('a', 'b', 1)];
    const order = dagOrder(['a', 'b'], edges);
    expect(order).toEqual(['b', 'a']);
    expect(backEdgesOf(order, edges)).toEqual([edge('a', 'b', 1)]);
  });

  test('puts a component where its edges to the rest of the graph say', () => {
    // top → {x, y} → bottom; inside the cycle x → y is heavier.
    const edges = [edge('top', 'y'), edge('x', 'y', 3), edge('y', 'x', 1), edge('x', 'bottom'), edge('y', 'bottom')];
    expect(dagOrder(['bottom', 'top', 'x', 'y'], edges)).toEqual(['top', 'x', 'y', 'bottom']);
  });

  test('greedy order peels sinks and sources, then the largest out-minus-in weight', () => {
    // a → b → c → a with weights 3, 2, 1: a has δ = 3 - 1 = 2, the largest, so it goes first; then b, c follow.
    expect(greedyOrder(['a', 'b', 'c'], [edge('a', 'b', 3), edge('b', 'c', 2), edge('c', 'a', 1)])).toEqual(['a', 'b', 'c']);
    // Equal weights: every δ is 0, the name decides.
    expect(greedyOrder(['c', 'b', 'a'], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')])).toEqual(['a', 'b', 'c']);
  });
});

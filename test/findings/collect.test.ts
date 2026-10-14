// The collectors' pure parts: the edges that close a strongly connected set (on random graphs, removing them always
// leaves it acyclic), one finding per set however large, and how recorded findings are anchored and merged.
import { describe, expect, it } from 'vitest';
import { closingEdges, cycleFindings, feedbackArcOrder, type GraphEdge, type GroupGraph } from '../../src/findings/collect-graph.js';
import { anchorOf, recordedRunFindings, stepRanges } from '../../src/findings/collect-records.js';
import { stronglyConnectedComponents } from '../../src/planner/metrics.js';

const edge = (from: string, to: string, weight = 1): GraphEdge => ({ from, to, weight, sample: [] });

function isAcyclic(nodes: string[], edges: GraphEdge[]): boolean {
  const adjacency = new Map<string, Set<string>>();
  for (const { from, to } of edges) adjacency.set(from, new Set([...(adjacency.get(from) ?? []), to]));
  return stronglyConnectedComponents(nodes, adjacency).every((component) => component.length === 1) && edges.every((candidate) => candidate.from !== candidate.to);
}

/** A seeded pseudo-random graph (mulberry32), so a failure reproduces. */
function randomGraph(seed: number, size: number, density: number): { nodes: string[]; edges: GraphEdge[] } {
  let state = seed;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const nodes = Array.from({ length: size }, (_, index) => `module/m${index}`);
  const edges = nodes.flatMap((from) => nodes.filter((to) => to !== from && random() < density).map((to) => edge(from, to, 1 + Math.floor(random() * 9))));
  return { nodes, edges };
}

describe('closing edges', () => {
  it('leave every strongly connected set acyclic once removed, on random graphs', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { nodes, edges } = randomGraph(seed, 6 + (seed % 15), 0.08 + (seed % 5) * 0.05);
      const graph: GroupGraph = { nodes, edges, unit: 'file pairs', noun: 'groups', origin: 'a random graph', backEdges: [], sccs: [] };
      const adjacency = new Map<string, Set<string>>();
      for (const { from, to } of edges) adjacency.set(from, new Set([...(adjacency.get(from) ?? []), to]));
      for (const members of stronglyConnectedComponents(nodes, adjacency).filter((component) => component.length > 1)) {
        const closing = new Set(closingEdges(members, graph.edges, []).map((candidate) => `${candidate.from}>${candidate.to}`));
        const inside = edges.filter((candidate) => members.includes(candidate.from) && members.includes(candidate.to));
        expect(isAcyclic(members, inside.filter((candidate) => !closing.has(`${candidate.from}>${candidate.to}`))), `seed ${seed}`).toBe(true);
      }
    }
  });

  it('keep the heavy direction of a two-way pair forward', () => {
    expect(feedbackArcOrder(['module/a', 'module/b'], [edge('module/a', 'module/b', 9), edge('module/b', 'module/a', 1)])).toEqual(['module/a', 'module/b']);
    expect(closingEdges(['module/a', 'module/b'], [edge('module/a', 'module/b', 9), edge('module/b', 'module/a', 1)], [])).toEqual([edge('module/b', 'module/a', 1)]);
  });

  it('start from the given back-edges and add only what they leave cyclic', () => {
    const edges = [edge('module/a', 'module/b', 1), edge('module/b', 'module/a', 5), edge('module/b', 'module/c', 1), edge('module/c', 'module/b', 1)];
    const closing = closingEdges(['module/a', 'module/b', 'module/c'], edges, [edge('module/a', 'module/b', 1)]);
    expect(closing).toHaveLength(2);
    expect(closing).toContainEqual(edge('module/a', 'module/b', 1));
  });

  it('make one finding of a large set, listing at most 15 edges', () => {
    const nodes = Array.from({ length: 30 }, (_, index) => `module/m${String(index).padStart(2, '0')}`);
    const edges = nodes.flatMap((from, index) => [edge(from, nodes[(index + 1) % 30]!), edge(from, nodes[(index + 7) % 30]!)]);
    const findings = cycleFindings({ nodes, edges, unit: 'file pairs', noun: 'groups', origin: 'a ring', backEdges: [], sccs: [nodes] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toBe('30 groups form one import cycle');
    const listed = findings[0]!.evidence.split('\n').filter((line) => line.startsWith('- module/'));
    expect(listed.length).toBeLessThanOrEqual(15);
  });
});

describe('recorded findings', () => {
  it('anchor a detail at its line and quoted path, else at the detail without machine paths', () => {
    expect(anchorOf("line 36: 'src/services/' is the directory server/src/services, whose contents change with the move of x")).toBe("line 36: 'src/services/'");
    expect(anchorOf("server/test/vitest.config.mjs line 19 [test.coverage.include]: coverage glob 'src/services/**' (server/src/services/**)")).toBe("line 19: 'src/services/**'");
    expect(anchorOf("line 510: import(filePath) loads a module by a path K4 can't evaluate")).toBe('line 510');
    expect(anchorOf('unit on head: 5 network attempts refused (log /tmp/x/network.jsonl)')).toBe('unit on head: 5 network attempts refused (log <path>)');
  });

  it('print step lists as ranges', () => {
    expect(stepRanges([5, 1, 2, 3, 8, 7, 3])).toBe('1–3, 5, 7–8');
    expect(stepRanges([4])).toBe('4');
  });

  it('list a rung\'s declined renames in one finding and merge an executor finding per file', () => {
    const findings = recordedRunFindings([
      { kind: 'rename-declined', rung: 'R3', files: ['server/src/modules/a/userController.ts'], detail: 'observed: name-from-file DI' },
      { kind: 'rename-declined', rung: 'R3', files: ['server/src/modules/b/viewRepo.ts'], detail: 'unparseable: no role word' },
      { kind: 'ungated-coverage-glob', step: 1, rung: 'R1', files: ['server/c.mjs'], detail: "server/c.mjs line 2: glob 'a/**' for x" },
      { kind: 'ungated-coverage-glob', step: 4, rung: 'R1', files: ['server/c.mjs'], detail: "server/c.mjs line 2: glob 'a/**' for y" },
    ]);
    expect(findings.map((finding) => [finding.kind, finding.steps, finding.files])).toEqual([
      ['ungated-coverage-glob', [1, 4], ['server/c.mjs']],
      ['rename-declined', [], ['server/src/modules/a/userController.ts', 'server/src/modules/b/viewRepo.ts']],
    ]);
    expect(findings[1]).toMatchObject({ title: 'Rename declined (R3): 2 in R3', evidence: 'R3 recorded 2:\n- server/src/modules/a/userController.ts: observed: name-from-file DI\n- server/src/modules/b/viewRepo.ts: unparseable: no role word' });
  });
});

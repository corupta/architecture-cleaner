// Scores of one partition: against the ground truth over the scored feature files (and the hard ones), and without it
// (TurboMQ, back-edges between clusters against the partition's own DAG order).
import { describe, expect, it } from 'vitest';
import { clusterEdges, graphScores, truthScores, truthTokens, type GroundTruth } from '../../src/bench/score.js';
import type { Edge, Facts, FileFact } from '../../src/planner/types.js';

function factsOf(files: string[], edges: [string, string][]): Facts {
  return {
    packageRoot: '',
    moduleRoot: 'src',
    sha: 'test',
    files: [...files].sort().map((filePath, index): FileFact => ({
      path: filePath, id: index + 1, role: 'util', loc: 1, exports: [], primaryExport: null, tables: { reads: [], writes: [] }, routes: [], tests: [],
    })),
    edges: edges.map(([from, to]): Edge => ({ from, to, weight: 1, typeOnly: false, kinds: ['import'], symbols: [] })),
    pins: [],
  };
}

describe('scores against the ground truth', () => {
  const groundTruth: GroundTruth = {
    truth: new Map([['a1', 'album'], ['a2', 'album'], ['a3', 'album'], ['u1', 'user'], ['u2', 'user'], ['u3', 'user'], ['s1', 'shared:utils']]),
    featureFiles: ['a1', 'a2', 'a3', 'u1', 'u2', 'u3'],
    hardFiles: ['a3', 'u3'],
  };

  it('scores the ground truth itself perfectly, over the feature files only', () => {
    const perfect = new Map([...groundTruth.truth].map(([file, label]) => [file, file === 's1' ? 'album' : `predicted-${label}`]));
    expect(truthScores(perfect, groundTruth)).toEqual({ mojoFm: 100, ari: 1, c2cCvg: 1, clusterCountRatio: 1, mojoFmHard: 100 });
  });

  it('scores one misplaced file of six and the hard files on their own', () => {
    const oneOff = new Map([['a1', 'x'], ['a2', 'x'], ['a3', 'y'], ['u1', 'y'], ['u2', 'y'], ['u3', 'y'], ['s1', 'z']]);
    const scores = truthScores(oneOff, groundTruth);
    // mno = 1 move; max = 6 − 2 = 4; MoJoFM = 75.
    expect(scores.mojoFm).toBe(75);
    expect(scores.c2cCvg).toBe(1);
    expect(scores.clusterCountRatio).toBe(1);
    expect(scores.mojoFmHard).toBe(0);
  });

  it('has no hard-file MoJoFM below two hard files', () => {
    expect(truthScores(groundTruth.truth, { ...groundTruth, hardFiles: ['a3'] }).mojoFmHard).toBeNull();
  });

  it('reads a ground-truth label as name tokens of its last segment', () => {
    expect(truthTokens('plugins/github')).toBe('github');
    expect(truthTokens('team-collections')).toBe('team-collection');
  });
});

describe('scores without ground truth', () => {
  const facts = factsOf(['src/a.ts', 'src/a2.ts', 'src/b.ts', 'src/c.ts'], [
    ['src/a.ts', 'src/a2.ts'], ['src/a.ts', 'src/b.ts'], ['src/a2.ts', 'src/b.ts'], ['src/b.ts', 'src/c.ts'], ['src/c.ts', 'src/a.ts'],
  ]);

  it('weights cluster edges by file pairs', () => {
    const assignment = new Map([['src/a.ts', 'A'], ['src/a2.ts', 'A'], ['src/b.ts', 'B'], ['src/c.ts', 'C']]);
    expect(clusterEdges(assignment, facts)).toEqual([{ from: 'A', to: 'B', weight: 2 }, { from: 'B', to: 'C', weight: 1 }, { from: 'C', to: 'A', weight: 1 }]);
  });

  it('counts the cluster edges a DAG order cannot point forward, and TurboMQ', () => {
    // A → B (2 file pairs) → C → A: one cycle; the cheapest edge to reverse is one of the single-pair ones.
    const cyclic = graphScores(new Map([['src/a.ts', 'A'], ['src/a2.ts', 'A'], ['src/b.ts', 'B'], ['src/c.ts', 'C']]), facts);
    expect(cyclic.clusters).toBe(3);
    expect(cyclic.backEdges).toBe(1);
    // CF(A) = 2·1 / (2·1 + 3) = 0.4; B and C have no internal edge.
    expect(cyclic.turboMq).toEqual({ sum: 0.4, mean: 0.1333 });
    const chain = factsOf(['src/a.ts', 'src/b.ts', 'src/c.ts'], [['src/a.ts', 'src/b.ts'], ['src/b.ts', 'src/c.ts']]);
    expect(graphScores(new Map(chain.files.map((file) => [file.path, file.path])), chain).backEdges).toBe(0);
    const one = graphScores(new Map(facts.files.map((file) => [file.path, 'all'])), facts);
    expect(one).toEqual({ clusters: 1, turboMq: { sum: 1, mean: 1 }, backEdges: 0 });
  });
});

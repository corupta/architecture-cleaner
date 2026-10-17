// summary.md from BenchResult files alone: the empty case, a real entry (no ground truth: dashes), bolding and notes.
import { describe, expect, it } from 'vitest';
import { benchSummary } from '../../src/bench/summary.js';
import type { BenchResult, MethodScore } from '../../src/bench/types.js';

const score = (method: string, kind: MethodScore['kind'], turboMq: number, extra: Partial<MethodScore> = {}): MethodScore => ({
  method, kind, clusters: 10, mojoFm: null, ari: null, c2cCvg: null, clusterCountRatio: null, mojoFmHard: null, turboMq: { sum: turboMq, mean: turboMq / 10 }, backEdges: 3, ...extra,
});

const real: BenchResult = {
  format: 'ac-bench/1', entry: 'immich', kind: 'real', variant: 'default', repo: '~/ac-targets/immich', sha: '02063972e82b1bfd17b6fc2e3b3ff39936229ea5',
  packageRoot: 'server', moduleRoot: 'src', files: 269, featureFiles: null, groundTruthModules: null, hardFiles: null, leakyFiles: null, scramble: null,
  methods: [
    score('B0 type folders', 'baseline', 1.94),
    score('Louvain r=4 (mean of seeds 1-5)', 'baseline', 10.5, { clusters: 47.6, backEdges: 166, note: 'mean of seeds 1-5' }),
    score('planner (Ultra)', 'planner', 10.07, { clusters: 59, note: 'invalid plan: 2 validator errors' }),
  ],
  bestBaseline: { method: 'Louvain r=4 (mean of seeds 1-5)', mojoFm: null, turboMq: 10.5 },
  planner: { cassette: 'cassettes/s6-immich.jsonl', recordedCostUsd: 0.199784, spentUsd: 0, replayed: true, groups: 59, planSha256: 'b4c7c548883c0635951f893c7717727f3d086a0c4e23b2db442e796dd416cc7f' },
  louvainMojoFmByResolution: null,
  notes: ['A note in plain words.'],
};

describe('bench summary', () => {
  it('says when nothing is recorded yet', () => {
    expect(benchSummary([])).toMatch(/No results recorded yet\.\n$/);
  });

  it('renders a real entry: dashes where there is no ground truth, the best method and the planner bolded', () => {
    const summary = benchSummary([real]);
    expect(summary).toContain('## immich (real)\n');
    expect(summary).toContain('- Target: `~/ac-targets/immich` `server/src` @ `02063972e82b`.');
    expect(summary).toContain('- Best deterministic method: Louvain r=4 (mean of seeds 1-5), TurboMQ 10.50.');
    expect(summary).toContain('- Planner: replayed from `cassettes/s6-immich.jsonl` (recorded cost $0.1998, this run spent $0); 59 groups; plan.yaml sha256 `b4c7c548883c`.');
    expect(summary).toContain('| B0 type folders | 10 | – | – | – | – | – | 1.94 | 3 |');
    expect(summary).toContain('| **Louvain r=4 (mean of seeds 1-5)** | **47.6** | – | – | – | – | – | **10.50** | **166** |');
    expect(summary).toContain('| **planner (Ultra) (invalid plan: 2 validator errors)** | **59** |');
    expect(summary).toContain('\n- A note in plain words.\n');
    expect(benchSummary([real])).toBe(summary);
  });
});

// summary.md from BenchResult files alone: the empty case, a real entry (no ground truth: dashes), bolding and notes,
// and the scramble verdicts the header states from the results.
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

const scramble = (entry: string, certificate: NonNullable<BenchResult['scramble']>['certificate'], extra: Partial<BenchResult> = {}): BenchResult => ({
  ...real, entry, kind: 'scramble', files: 454, featureFiles: 401, groundTruthModules: 47, hardFiles: 234, leakyFiles: 5,
  leakage: { renamed: 2, inFeatureFolder: 1, underSubFolder: 2, subFolders: [{ folder: 'queue', files: 2, features: 1 }], unseen: 52 },
  scramble: { commit: 'a'.repeat(40), tree: 'b'.repeat(40), moved: 400, declined: 1, excluded: 12, certificate },
  draft: { method: 'seeds draft (file names)', source: 'file names', contested: { fileNames: 5, exportNames: 7 } },
  ...extra,
});
const certificate = (verdict: 'pass' | 'fail', failing: string[] = []) => ({ verdict, scope: 'static' as const, digest: `sha256:${'d'.repeat(64)}`, failing });

describe('bench summary', () => {
  it("states each scramble's verdict from the results, never a blanket 'certified' (kaneo's FAIL, S7)", () => {
    const summary = benchSummary([scramble('hoppscotch', certificate('pass')), scramble('kaneo', certificate('fail', ['K3c', 'K4'])), scramble('ghostfolio', certificate('pass')), real]);
    expect(summary.replace(/\s+/g, ' ')).not.toContain('certified commit');
    expect(summary).toContain('in one commit. Our certifier checks that commit as a pure move: hoppscotch and ghostfolio pass; kaneo (K3c, K4) fails. Verdict, scope and failing checks are per entry below');
    expect(benchSummary([scramble('hoppscotch', null), scramble('kaneo', null)])).toContain('Our certifier checks that commit as a pure move: hoppscotch and kaneo were not certified in this run.');
    expect(benchSummary([real])).toContain('into type folders with our own executor, in one commit.\n');
  });

  it('points the scored line at the leakage note, and keeps the old wording for results written before the split', () => {
    expect(benchSummary([scramble('kaneo', null)])).toContain('of 454 movable files. 5 of the movable files give their feature away in their path (the leakage note below).');
    expect(benchSummary([scramble('kaneo', null, { leakage: undefined })])).toContain('of 454 movable files. 5 files give their feature away (leaky renames and files left in a feature folder).');
  });

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

// summary.md from BenchResult files alone: the empty case, a real entry (no ground truth: dashes), bolding and notes,
// the scramble verdicts the header states from the results, a repeats block (a run that delivered the seeds draft
// included), and the committed summary byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repeatsOf } from '../../src/bench/repeats.js';
import { readBenchManifest, readResults } from '../../src/bench/run.js';
import { benchSummary } from '../../src/bench/summary.js';
import type { BenchPlannerRun, BenchResult, MethodScore } from '../../src/bench/types.js';

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
    // Results written before S8 record no planner rules: the header doesn't explain them.
    expect(summary).not.toContain('Planner rules');
  });

  it('says where the planner\'s answers came from, call by call, and which planner rules read them (S8)', () => {
    const planner = (calls: { replayed: number; recorded: number }, spentUsd: number) =>
      benchSummary([{ ...real, planner: { ...real.planner!, calls, rules: 1, spentUsd, replayed: spentUsd === 0, recordedCostUsd: 0.1683 } }]);
    expect(planner({ replayed: 2, recorded: 0 }, 0)).toContain('- Planner: replayed from `cassettes/s6-immich.jsonl` (2 calls, recorded cost $0.1683, this run spent $0); 59 groups; planner rules 1; plan.yaml sha256 `b4c7c548883c`.');
    // An auto run replays the edit and records the critic, whose request changed with the winner.
    expect(planner({ replayed: 1, recorded: 1 }, 0.0612)).toContain('- Planner: 1 of 2 calls replayed from `cassettes/s6-immich.jsonl` and 1 recorded into it for $0.0612 (the plan\'s calls cost $0.1683 when recorded); 59 groups;');
    expect(planner({ replayed: 0, recorded: 2 }, 0.1683)).toContain('- Planner: recorded into `cassettes/s6-immich.jsonl` (2 calls) for $0.1683; 59 groups;');
    expect(planner({ replayed: 2, recorded: 0 }, 0)).toContain('- Planner rules (src/planner/types.ts) say how the planner reads the target and Nemotron\'s answers and ranks its\n');
  });

  it('once the header explains planner rules, every entry with a planner row states its own, a result from before S8 included (review P4)', () => {
    // `ac bench --only immich` into a results directory that still holds S7's kaneo.json: the summary reads both.
    const s7 = scramble('kaneo', certificate('fail', ['K3c', 'K4']));
    const s8 = { ...real, planner: { ...real.planner!, calls: { replayed: 2, recorded: 0 }, rules: 1 } };
    const noRow = scramble('ghostfolio', certificate('pass'), { planner: null });
    const summary = benchSummary([s7, noRow, s8]);
    expect(summary).toContain('each entry with a planner row says\n  which it used.\n');
    expect(summary).not.toContain('no scramble entry has one');
    const plannerLines = summary.split('\n').filter((line) => line.startsWith('- Planner: '));
    expect(plannerLines).toEqual([
      "- Planner: replayed from `cassettes/s6-immich.jsonl` (recorded cost $0.1998, this run spent $0); 59 groups, from the seeds draft (file names); planner rules 1 (from before S8, which didn't record them); plan.yaml sha256 `b4c7c548883c`.",
      '- Planner: no row (see the notes).',
      '- Planner: replayed from `cassettes/s6-immich.jsonl` (2 calls, recorded cost $0.1998, this run spent $0); 59 groups; planner rules 1; plan.yaml sha256 `b4c7c548883c`.',
    ]);
  });

  it('renders the committed bench/results/summary.md byte for byte from its JSON files: one run of the default configuration says nothing new', () => {
    const repoRoot = path.join(import.meta.dirname, '..', '..');
    const results = readResults(path.join(repoRoot, 'bench', 'results'), readBenchManifest(path.join(repoRoot, 'bench', 'manifest.json')));
    expect(results.map((result) => [result.entry, result.repeats])).toEqual([['hoppscotch', undefined], ['hoppscotch-H1', undefined], ['kaneo', undefined], ['ghostfolio', undefined], ['immich', undefined]]);
    expect(benchSummary(results)).toBe(fs.readFileSync(path.join(repoRoot, 'bench', 'results', 'summary.md'), 'utf8'));
  });

  it('renders one run of another configuration: its configuration and its runs table, no mean, min and max', () => {
    const method = 'planner (Super VL, thinking on)';
    const row = score(method, 'planner', 11.2, { clusters: 40 });
    const run: BenchPlannerRun = {
      repeat: 1, method, valid: true, validatorErrors: 0, fromEdit: true, criticRan: true, editChoices: { asked: 3, returned: 3, parsed: 3, truncated: 0 },
      groups: 40, modules: 31, samePartition: false, planSha256: 'c'.repeat(64), recordedCostUsd: 0.0412, spentUsd: 0,
      calls: { replayed: 2, recorded: 0 }, tokens: { prompt: 25_000, completion: 12_345, reasoning: 10_000 },
    };
    const summary = benchSummary([{ ...real, methods: [...real.methods.slice(0, 2), row], plannerConfiguration: 'super-vl', repeats: repeatsOf([{ run, score: row }]) }]);
    expect(summary).toContain('- A planner configuration (src/planner/configurations.ts) names the models that edit the draft and review the');
    expect(summary).toContain('- Planner configuration `super-vl`: Nemotron 3.5 Super VL (thinking on) edits and reviews.\n- Planner: replayed from');
    expect(summary).toContain('Planner runs (`super-vl`):');
    expect(summary).toContain('| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |');
    expect(summary).toContain(`| ${method} | an edit | 3 of 3 parsed | yes | yes | 40 | 31 | $0.0412 | $0.0000 | 2 replayed | 25,000 | 12,345 | 10,000 | \`cccccccccccc\` |`);
    expect(summary).not.toContain('| over the');
    expect(summary).toContain("\n1 of 1 run scores above the best deterministic method on TurboMQ's sum, each run as delivered. "
      + '0 of 1 run had no usable edit; the critic reviewed 1 of 1 plan; 0 of 3 edit choices were cut by the length cap (finish_reason length). '
      + 'The validator accepts 1 of 1 plan, counting only plans that came from an edit.\n');
  });

  it('keeps a run that delivered the seeds draft in the mean, min and max as delivered, and never counts it as a valid plan of the model', () => {
    const method = 'planner (Super VL, thinking on)';
    const rows = [11, 10, 12].map((turboMq, index) => score(`${method} #${index + 1}`, 'planner', turboMq, { clusters: 40 }));
    const run = (index: number, extra: Partial<BenchPlannerRun>): BenchPlannerRun => ({
      repeat: index + 1, method: rows[index]!.method, valid: true, validatorErrors: 0, fromEdit: true, criticRan: true, editChoices: { asked: 3, returned: 3, parsed: 3, truncated: 0 },
      groups: 40, modules: 31, samePartition: false, planSha256: String(index).repeat(64), recordedCostUsd: 0.04, spentUsd: 0,
      calls: { replayed: 2, recorded: 0 }, tokens: { prompt: 25_000, completion: 12_000, reasoning: 10_000 }, ...extra,
    });
    const runs = [
      run(0, { editChoices: { asked: 3, returned: 3, parsed: 2, truncated: 1 } }),
      // Every choice cut by the length cap: the draft is the plan, no critic ran, and the validator accepts the draft.
      run(1, { fromEdit: false, criticRan: false, editChoices: { asked: 3, returned: 3, parsed: 0, truncated: 3 }, calls: { replayed: 1, recorded: 0 } }),
      run(2, { valid: false, validatorErrors: 2, editChoices: { asked: 3, returned: 2, parsed: 1, truncated: 1 } }),
    ];
    const summary = benchSummary([{ ...real, methods: [...real.methods.slice(0, 2), ...rows], plannerConfiguration: 'super-vl', repeats: repeatsOf(runs.map((each, index) => ({ run: each, score: rows[index]! }))) }]);
    expect(summary).toContain(`| ${method} #1 | an edit | 2 of 3 parsed (1 truncated) | yes | yes | 40 |`);
    expect(summary).toContain(`| ${method} #2 | the seeds draft | 0 of 3 parsed (3 truncated) | no | yes | 40 |`);
    expect(summary).toContain(`| ${method} #3 | an edit | 1 of 3 parsed (2 returned, 1 truncated) | yes | no (2 errors) | 40 |`);
    expect(summary).toContain('| over the 3 runs, as delivered | TurboMQ |');
    expect(summary).toContain('| mean | 11.00 |');
    expect(summary).toContain('| min | 10.00 |');
    expect(summary).toContain("\n2 of 3 runs score above the best deterministic method on TurboMQ's sum, each run as delivered. "
      + '1 of 3 runs had no usable edit, so the seeds draft became its plan; the critic reviewed 2 of 3 plans; 5 of 9 edit choices were cut by the length cap (finish_reason length). '
      + 'The validator accepts 1 of 3 plans, counting only plans that came from an edit.\n');
  });
});

// `ac bench compare` from fixture results: one directory as a default bench writes it (one run, no repeats block, as
// before S8b), two with three runs per entry; a missing planner row and a missing entry; runs whose edit choices all
// came back unusable, so the seeds draft became the plan; the numbers and the ranges they fall in (as printed), never a
// winner; a real entry with a partial key; the committed experiment's compare.md byte for byte; and the command line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { benchCommand } from '../../src/bench/command.js';
import { compareReport, readComparedResults } from '../../src/bench/compare.js';
import { repeatsOf } from '../../src/bench/repeats.js';
import type { BenchKeyScore, BenchPlannerRun, BenchResult, MethodScore } from '../../src/bench/types.js';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-bench-compare-'));
afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));

const score = (method: string, kind: MethodScore['kind'], values: { mojoFm?: number; turboMq: number; backEdges?: number }, note?: string): MethodScore => ({
  method, kind, clusters: 10, mojoFm: values.mojoFm ?? null, ari: null, c2cCvg: null, clusterCountRatio: null, mojoFmHard: null,
  turboMq: { sum: values.turboMq, mean: values.turboMq / 10 }, backEdges: values.backEdges ?? 3, ...(note ? { note } : {}),
});

/** `draft`: no edit choice was usable, so the seeds draft is the plan and no critic ran; `truncated`: edit choices cut by the length cap. */
interface Run { mojoFm?: number; turboMq: number; backEdges?: number; valid?: boolean; modules?: number; cost?: number; completion?: number; reasoning?: number; draft?: boolean; truncated?: number }

/** A result with the given planner runs: one run of `ultra` as S8 wrote it (no repeats block), else a repeats block. */
function result(entry: string, kind: BenchResult['kind'], best: { mojoFm?: number; turboMq: number }, runs: Run[], configuration: string | null): BenchResult {
  const method = configuration === 'ultra' || configuration === null ? 'planner (Ultra)' : configuration === 'super-vl' ? 'planner (Super VL, thinking on)' : 'planner (Super VL, low_effort)';
  const rows = runs.map((run, index) => score(runs.length > 1 ? `${method} #${index + 1}` : method, 'planner', run, run.valid === false ? 'invalid plan: 1 validator error' : undefined));
  const planned = runs.map((run, index): BenchPlannerRun => ({
    repeat: index + 1, method: rows[index]!.method, valid: run.valid !== false, validatorErrors: run.valid === false ? 1 : 0, fromEdit: !run.draft, criticRan: !run.draft,
    editChoices: { asked: 3, returned: 3, parsed: run.draft ? 0 : 3 - (run.truncated ?? 0), truncated: run.truncated ?? 0 }, groups: 20, modules: run.modules ?? 12,
    samePartition: false, planSha256: String(index).repeat(64), recordedCostUsd: run.cost ?? 0.01, spentUsd: 0, calls: { replayed: 2, recorded: 0 },
    tokens: { prompt: 1000, completion: run.completion ?? 2000, reasoning: run.reasoning ?? 1500 },
  }));
  return {
    format: 'ac-bench/1', entry, kind, variant: 'default', repo: `~/ac-targets/${entry}`, sha: 'a'.repeat(40), packageRoot: '', moduleRoot: 'src', files: 100,
    featureFiles: null, groundTruthModules: null, hardFiles: null, leakyFiles: null, scramble: null,
    methods: [score('seeds draft (file names)', 'draft', best), ...rows],
    bestBaseline: { method: 'seeds draft (file names)', mojoFm: best.mojoFm ?? null, turboMq: best.turboMq },
    planner: runs.length ? {
      cassette: 'cassettes/x.jsonl', recordedCostUsd: planned[0]!.recordedCostUsd, spentUsd: 0, replayed: true, groups: 20, modules: planned[0]!.modules, planSha256: planned[0]!.planSha256,
      change: {
        draftGroups: 24, samePartition: false, filesMoved: 5, groupsMerged: 4,
        winner: runs[0]!.draft ? null : { label: 'ultra#1', groupEntries: 24, moves: 5, issues: {} }, critic: runs[0]!.draft ? null : { suggestions: 3, kept: 2 },
      },
    } : null,
    louvainMojoFmByResolution: null,
    notes: runs.length ? [] : ['The planner is not recorded in cassettes/x.jsonl for these facts (replay miss on run 1 of 3); record it with --mode auto --run <budget run>.'],
    ...(configuration === null ? {} : { plannerConfiguration: configuration }),
    ...(runs.length && configuration !== null ? { repeats: repeatsOf(planned.map((run, index) => ({ run, score: rows[index]! }))) } : {}),
  };
}

function writeDirectory(name: string, results: BenchResult[]): string {
  const directory = path.join(temporary, name);
  fs.mkdirSync(directory, { recursive: true });
  for (const each of results) fs.writeFileSync(path.join(directory, `${each.entry}.json`), `${JSON.stringify(each, null, 1)}\n`);
  fs.writeFileSync(path.join(directory, 'summary.md'), '# not a result\n');
  return directory;
}

const scrambleBest = { mojoFm: 81.38, turboMq: 7.37 };
const realBest = { turboMq: 10.5 };
const committedLike = writeDirectory('results', [
  result('hoppscotch', 'scramble', scrambleBest, [{ mojoFm: 87.59, turboMq: 8.12 }], null),
  result('immich', 'real', realBest, [{ turboMq: 10.07, backEdges: 30, valid: false }], null),
]);
const superVl = writeDirectory('results-super-vl', [
  // Run 1 delivered the seeds draft (its three edit choices cut by the length cap), which the validator accepts; run 2 lost one choice.
  result('hoppscotch', 'scramble', scrambleBest, [{ mojoFm: 80, turboMq: 7, draft: true, truncated: 3 }, { mojoFm: 85, turboMq: 8, truncated: 1 }, { mojoFm: 90, turboMq: 9, modules: 15 }], 'super-vl'),
  result('immich', 'real', realBest, [{ turboMq: 9, backEdges: 20 }, { turboMq: 11, backEdges: 25, valid: false }, { turboMq: 12, backEdges: 27 }], 'super-vl'),
  result('kaneo', 'scramble', { mojoFm: 50, turboMq: 3 }, [{ mojoFm: 51, turboMq: 3 }, { mojoFm: 52, turboMq: 3 }, { mojoFm: 49, turboMq: 3 }], 'super-vl'),
]);
const superVlLow = writeDirectory('results-super-vl-low', [
  result('hoppscotch', 'scramble', scrambleBest, [{ mojoFm: 70, turboMq: 6, cost: 0.004, completion: 900, reasoning: 300 }, { mojoFm: 72, turboMq: 6, cost: 0.004, completion: 900, reasoning: 300 }, { mojoFm: 74, turboMq: 6, cost: 0.004, completion: 900, reasoning: 300 }], 'super-vl-low'),
  result('immich', 'real', realBest, [], 'super-vl-low'),
]);

describe('ac bench compare', () => {
  const report = compareReport(readComparedResults([committedLike, superVl, superVlLow]));
  const lines = report.split('\n');

  it('names each directory with its configuration, its models and its runs per entry, and states k and what is conclusive', () => {
    expect(report).toMatch(/^# ac bench compare\n\nThe planner's runs from 3 results directories, one planner configuration each/);
    expect(lines).toContain(`| results | \`${committedLike}\` | \`ultra\` | Nemotron 3 Ultra (medium_effort) edits and reviews | 1 |`);
    expect(lines).toContain(`| results-super-vl | \`${superVl}\` | \`super-vl\` | Nemotron 3.5 Super VL (thinking on) edits and reviews | 3 |`);
    expect(lines).toContain(`| results-super-vl-low | \`${superVlLow}\` | \`super-vl-low\` | Nemotron 3.5 Super VL (low_effort) edits and reviews | 3 |`);
    expect(report).toContain("The directories have from 1 to 3 runs per entry. A difference that falls inside another directory's min-to-max range isn't conclusive, and a single run has no range at all.");
    const evenly = compareReport(readComparedResults([superVl, superVlLow]));
    expect(evenly).toContain("Every directory has k=3 runs per entry. A difference that falls inside the other directory's min-to-max range over k=3 isn't conclusive.");
  });

  it('gives a scramble per directory: MoJoFM mean (min to max), runs above the best deterministic method, where the plans came from, valid plans, modules, cost and tokens per run', () => {
    expect(report).toContain('## hoppscotch (scramble, default)\n\nBest deterministic method: seeds draft (file names), MoJoFM 81.38 in every directory.');
    expect(report).toContain('| results | configuration | runs | MoJoFM mean (min to max), as delivered | beat the best deterministic | draft as the plan | edit choices truncated | critic ran | valid plans from an edit | modules mean (min to max) |');
    expect(lines).toContain('| results | `ultra` | 1 | 87.59 | 1 of 1 | 0 of 1 | – | 1 of 1 | 1 of 1 | 12 | $0.0100 | – | – |');
    expect(lines).toContain('| results-super-vl | `super-vl` | 3 | 85.00 (80.00 to 90.00) | 2 of 3 | 1 of 3 | 4 of 9 | 2 of 3 | 2 of 3 | 13.0 (12 to 15) | $0.0100 | 2,000 | 1,500 |');
    expect(lines).toContain('| results-super-vl-low | `super-vl-low` | 3 | 72.00 (70.00 to 74.00) | 0 of 3 | 0 of 3 | 0 of 9 | 3 of 3 | 3 of 3 | 12.0 (12 to 12) | $0.0040 | 900 | 300 |');
  });

  it('keeps a run that delivered the seeds draft in the mean as delivered, never counts it as a valid plan of the model, and says so', () => {
    // results-super-vl's hoppscotch run 1: all three edit choices cut by the length cap, so the draft (valid) is its plan.
    expect(report).toContain("every run as delivered: with the plan `ac plan` would give, which is the seeds draft when none of a run's edit choices came back usable.");
    expect(report).toContain('- Draft as the plan: the runs where none of the K edit choices came back usable (each one cut by the length cap or unparseable), so the seeds draft became the plan and the critic had nothing to review. Edit choices truncated: the choices the length cap cut (finish_reason length), of K per run. Critic ran: the runs whose winning edit the critic reviewed.');
    expect(report).toContain('- Valid plans from an edit: the runs whose plan came from an edit and that our validator accepts. A run that delivered the draft is no plan of the model, so it never counts here, whatever the validator says of the draft;');
    // A result written before the S7 fix round doesn't say where its plan came from: dashes, not a guess.
    const before = JSON.parse(fs.readFileSync(path.join(committedLike, 'hoppscotch.json'), 'utf8')) as BenchResult;
    delete before.planner!.change;
    const unknown = compareReport([{ directory: 'old', label: 'old', results: [before] }]);
    expect(unknown).toContain('| old | `ultra` | 1 | 87.59 | 1 of 1 | – | – | – | – | 12 | $0.0100 | – | – |');
    expect(unknown).toContain('| old | `ultra` | 1 | 1 | 1 of 1 | – | – | – | – | $0.0100 | $0.0100 | – | – |');
  });

  it("places each mean against the other directories' runs, inside, above or below, and names no winner", () => {
    const hoppscotch = report.slice(report.indexOf('## hoppscotch'), report.indexOf('## kaneo'));
    expect(hoppscotch).toContain("Each MoJoFM mean against the other directories' runs:\n\n"
      + '- results: 87.59, inside the range (80.00 to 90.00) of results-super-vl and above the range (70.00 to 74.00) of results-super-vl-low.\n'
      + '- results-super-vl: 85.00, below the one run (87.59) of results and above the range (70.00 to 74.00) of results-super-vl-low.\n'
      + '- results-super-vl-low: 72.00, below the one run (87.59) of results and below the range (80.00 to 90.00) of results-super-vl.\n');
    expect(report).not.toMatch(/\b(win|wins|winner|better|worse|beats)\b/i);
  });

  it('gives a real target TurboMQ and back-edges, says which directories have no planner row or no result, and orders scrambles first', () => {
    const immich = report.slice(report.indexOf('## immich'), report.indexOf('## Totals'));
    expect(immich).toContain('Best deterministic method: seeds draft (file names), TurboMQ 10.50 in every directory.');
    expect(immich).toContain('| results | configuration | runs | TurboMQ mean (min to max), as delivered | beat the best deterministic | back-edges mean (min to max) | draft as the plan | edit choices truncated | critic ran | valid plans from an edit |');
    expect(immich).toContain('| results | `ultra` | 1 | 10.07 | 0 of 1 | 30 | 0 of 1 | – | 1 of 1 | 0 of 1 | 12 | $0.0100 | – | – |');
    expect(immich).toContain('| results-super-vl | `super-vl` | 3 | 10.67 (9.00 to 12.00) | 2 of 3 | 24.0 (20 to 27) | 0 of 3 | 0 of 9 | 3 of 3 | 2 of 3 |');
    // A result without a planner row doesn't say its configuration: the row names its directory's.
    expect(immich).toContain('| results-super-vl-low | `super-vl-low` | 0 | no planner row (its notes say why) | – | – | – | – | – | – | – | – | – | – |');
    expect(report).toContain('| results | `ultra` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – |');
    expect(lines.filter((line) => line.startsWith('## '))).toEqual(['## hoppscotch (scramble, default)', '## kaneo (scramble, default)', '## immich (real)', '## Totals']);
    expect(report).toContain('## kaneo (scramble, default)\n\nBest deterministic method: seeds draft (file names), MoJoFM 50.00.\n');
    // Planner rules 2 changed immich's facts (S8): a different best names each directory's.
    const rules1: BenchResult = { ...JSON.parse(fs.readFileSync(path.join(committedLike, 'immich.json'), 'utf8')), bestBaseline: { method: 'Louvain r=4 (mean of seeds 1-5)', mojoFm: null, turboMq: 10.5 } };
    rules1.planner!.rules = 1;
    const rulesDiffer = compareReport([{ directory: 'a', label: 'a', results: [rules1] }, { directory: 'b', label: 'b', results: [{ ...rules1, planner: { ...rules1.planner!, rules: 2 }, bestBaseline: { method: 'B0 type folders', mojoFm: null, turboMq: 1.94 } }] }]);
    expect(rulesDiffer).toContain('Best deterministic method: Louvain r=4 (mean of seeds 1-5), TurboMQ 10.50 (a, planner rules 1); B0 type folders, TurboMQ 1.94 (b, planner rules 2). The directories scored different facts.');
  });

  it('totals each directory: entries and runs, how many beat the best deterministic method, delivered the draft, lost edit choices to the length cap, valid plans from an edit, cost and tokens', () => {
    expect(report).toContain('| results | configuration | entries with runs | runs | beat the best deterministic | draft as the plan | edit choices truncated | critic ran | valid plans from an edit | recorded cost |');
    expect(lines).toContain('| results | `ultra` | 2 | 2 | 1 of 2 | 0 of 2 | – | 2 of 2 | 1 of 2 | $0.0200 | $0.0100 | – | – |');
    expect(lines).toContain('| results-super-vl | `super-vl` | 3 | 9 | 6 of 9 | 1 of 9 | 4 of 27 | 8 of 9 | 7 of 9 | $0.0900 | $0.0100 | 18,000 | 13,500 |');
    expect(lines).toContain('| results-super-vl-low | `super-vl-low` | 1 | 3 | 0 of 3 | 0 of 3 | 0 of 9 | 3 of 3 | 3 of 3 | $0.0120 | $0.0040 | 2,700 | 900 |');
  });

  it('places a mean by the values as printed: a gap below the second decimal reads as inside', () => {
    // a's mean is 85.004 and b's top run 85: both print 85.00. c's mean 84.998 against a's bottom run 85.001: both print 85.00.
    const a = result('hoppscotch', 'scramble', scrambleBest, [{ mojoFm: 85.001, turboMq: 8 }, { mojoFm: 85.004, turboMq: 8 }, { mojoFm: 85.007, turboMq: 8 }], 'super-vl');
    const b = result('hoppscotch', 'scramble', scrambleBest, [{ mojoFm: 80, turboMq: 8 }, { mojoFm: 82, turboMq: 8 }, { mojoFm: 85, turboMq: 8 }], 'super-vl-low');
    const c = result('hoppscotch', 'scramble', scrambleBest, [{ mojoFm: 84.997, turboMq: 8 }, { mojoFm: 84.998, turboMq: 8 }, { mojoFm: 84.999, turboMq: 8 }], 'ultra');
    const placed = compareReport([{ directory: 'a', label: 'a', results: [a] }, { directory: 'b', label: 'b', results: [b] }, { directory: 'c', label: 'c', results: [c] }]);
    expect(placed).toContain('- a: 85.00, inside the range (80.00 to 85.00) of b and inside the range (85.00 to 85.00) of c.\n');
    expect(placed).toContain('- b: 82.33, below the range (85.00 to 85.01) of a and below the range (85.00 to 85.00) of c.\n');
    expect(placed).toContain('- c: 85.00, inside the range (85.00 to 85.01) of a and inside the range (80.00 to 85.00) of b.\n');
  });

  it('labels two directories with one base name by the paths given', () => {
    const elsewhere = path.join(temporary, 'elsewhere');
    fs.cpSync(superVl, path.join(elsewhere, 'results-super-vl'), { recursive: true });
    const sets = readComparedResults([superVl, path.join(elsewhere, 'results-super-vl')]);
    expect(sets.map((set) => set.label)).toEqual([superVl, path.join(elsewhere, 'results-super-vl')]);
  });

  it('writes the report to --out, or to stdout, and refuses a missing or empty directory', async () => {
    const out = path.join(temporary, 'out', 'compare.md');
    const logged: string[] = [];
    const errors: string[] = [];
    const [log, error, write] = [console.log, console.error, process.stdout.write];
    console.log = (message: string) => logged.push(message);
    console.error = (message: string) => errors.push(message);
    process.stdout.write = ((chunk: string) => logged.push(chunk) > 0) as typeof process.stdout.write;
    try {
      expect(await benchCommand(['compare', committedLike, superVl, superVlLow, '--out', out])).toBe(0);
      expect(await benchCommand(['compare', superVl])).toBe(0);
      expect(await benchCommand(['compare'])).toBe(2);
      expect(await benchCommand(['compare', path.join(temporary, 'nowhere')])).toBe(2);
      fs.mkdirSync(path.join(temporary, 'empty'));
      expect(await benchCommand(['compare', path.join(temporary, 'empty')])).toBe(2);
    } finally {
      [console.log, console.error, process.stdout.write] = [log, error, write];
    }
    expect(fs.readFileSync(out, 'utf8')).toBe(report);
    expect(logged).toContain(compareReport(readComparedResults([superVl])));
    expect(errors.join('\n')).toContain('give one or more results directories');
    expect(errors.join('\n')).toContain('nowhere: not a results directory');
    expect(errors.join('\n')).toContain('empty: no ac-bench/1 result in it');
  });
});

describe('ac bench compare with a partial key', () => {
  const keyScoreOf = (method: string, mojoFm: number): BenchKeyScore => ({ method, mojoFm, ari: 0.8, c2cCvg: 0.9, clusterCountRatio: 1, mojoFmHard: null, assignment: {} });
  /** immich with a partial key whose planner runs score `onKey` over it. */
  function keyed(runs: Run[], configuration: string, onKey: number[]): BenchResult {
    const base = result('immich', 'real', realBest, runs, configuration);
    const planners = base.methods.filter((score) => score.kind === 'planner');
    return {
      ...base, files: 269,
      partialKey: {
        file: 'bench/ground-truth/immich-2024.rsf', sha256: 'e'.repeat(64), source: "immich's 2024 domain layer", labeled: 44, scoredFiles: 44, features: 22, share: 0.164,
        hardFiles: ['a', 'b', 'c'], notMovable: [], truth: {}, louvainSeeds: {},
        methods: [keyScoreOf('seeds draft (file names)', 95), ...planners.map((score, index) => keyScoreOf(score.method, onKey[index]!))],
        bestBaseline: { method: 'seeds draft (file names)', mojoFm: 95 },
      },
    };
  }
  const ultraKey = writeDirectory('ultra-key', [keyed([{ turboMq: 10 }, { turboMq: 10.2 }, { turboMq: 10.4 }], 'ultra', [90, 92, 96])]);
  const superKey = writeDirectory('super-vl-key', [keyed([{ turboMq: 10.1 }, { turboMq: 10.3 }, { turboMq: 10.5 }], 'super-vl', [94, 95, 97])]);
  const noRowKey = writeDirectory('super-vl-low-key', [keyed([], 'super-vl-low', [])]);
  const report = compareReport(readComparedResults([ultraKey, superKey, noRowKey, committedLike]));
  const immich = report.slice(report.indexOf('## immich'), report.indexOf('## Totals'));

  it("says what the key covers against the scrambles' complete keys, its best deterministic method, and which directories have none", () => {
    expect(report).toContain('- MoJoFM over the key: a real target with a partial answer key adds the mean (min to max) of MoJoFM over the files the key labels');
    expect(immich).toContain("\n\nMoJoFM over the key is computed over the files immich's 2024 domain layer labels (44 of 269 movable files, 22 features, 3 hard), unlike the scrambles' complete keys (key `bench/ground-truth/immich-2024.rsf`, sha256 `eeeeeeeeeeee`) in the 3 directories with a key.\n"
      + 'Best deterministic method on MoJoFM over the key: seeds draft (file names), MoJoFM 95.00 in the 3 directories with a key.\n'
      + 'results scores no key for this entry: dashes.\n\n');
  });

  it('shows MoJoFM over the key next to TurboMQ, the runs above the best on it, and dashes where a directory has no key or no run', () => {
    expect(immich).toContain('| results | configuration | runs | TurboMQ mean (min to max), as delivered | beat the best deterministic | back-edges mean (min to max) | MoJoFM over the key mean (min to max) | beat the best on it | draft as the plan |');
    expect(immich).toContain('| ultra-key | `ultra` | 3 | 10.20 (10.00 to 10.40) | 0 of 3 | 3.0 (3 to 3) | 92.67 (90.00 to 96.00) | 1 of 3 | 0 of 3 |');
    expect(immich).toContain('| super-vl-key | `super-vl` | 3 | 10.30 (10.10 to 10.50) | 0 of 3 | 3.0 (3 to 3) | 95.33 (94.00 to 97.00) | 1 of 3 | 0 of 3 |');
    expect(immich).toContain(`| super-vl-low-key | \`super-vl-low\` | 0 | no planner row (its notes say why) | ${Array.from({ length: 12 }, () => '–').join(' | ')} |`);
    expect(immich).toContain('| results | `ultra` | 1 | 10.07 | 0 of 1 | 30 | – | – | 0 of 1 |');
    expect(immich).toContain("Each MoJoFM mean over the key against the other directories' runs:\n\n"
      + '- ultra-key: 92.67, below the range (94.00 to 97.00) of super-vl-key.\n'
      + '- super-vl-key: 95.33, inside the range (90.00 to 96.00) of ultra-key.\n');
    expect(report).not.toMatch(/\b(win|wins|winner|better|worse|beats)\b/i);
  });

  it('names each directory\'s key when they differ', () => {
    const other = keyed([{ turboMq: 10 }], 'ultra', [91]);
    other.partialKey = { ...other.partialKey!, scoredFiles: 40, sha256: 'f'.repeat(64), bestBaseline: { method: 'name-token (anchored)', mojoFm: 92.5 } };
    const differing = compareReport([{ directory: 'a', label: 'a', results: [keyed([{ turboMq: 10 }], 'ultra', [90])] }, { directory: 'b', label: 'b', results: [other] }]);
    expect(differing).toContain("MoJoFM over the key is computed over the files immich's 2024 domain layer labels (44 of 269 movable files, 22 features, 3 hard), unlike the scrambles' complete keys (key `bench/ground-truth/immich-2024.rsf`, sha256 `eeeeeeeeeeee`) in a; "
      + "computed over the files immich's 2024 domain layer labels (40 of 269 movable files, 22 features, 3 hard), unlike the scrambles' complete keys (key `bench/ground-truth/immich-2024.rsf`, sha256 `ffffffffffff`) in b.");
    expect(differing).toContain('Best deterministic method on MoJoFM over the key: seeds draft (file names), MoJoFM 95.00 (a); name-token (anchored), MoJoFM 92.50 (b).');
  });
});

describe('the committed experiment', () => {
  it('renders bench/experiments/s8b-super-vl/compare.md byte for byte from its result directories', () => {
    const repoRoot = path.join(import.meta.dirname, '..', '..');
    // As made from the package root: the directories as given there.
    const given = ['ultra', 'super-vl-direct', 'super-vl-256k', 'super-vl', 'super-vl-low', 'super-vl-long'].map((name) => `bench/experiments/s8b-super-vl/${name}`);
    const sets = readComparedResults(given.map((directory) => path.join(repoRoot, directory))).map((set, index) => ({ ...set, directory: given[index]! }));
    expect(compareReport(sets)).toBe(fs.readFileSync(path.join(repoRoot, 'bench', 'experiments', 's8b-super-vl', 'compare.md'), 'utf8'));
  });
});

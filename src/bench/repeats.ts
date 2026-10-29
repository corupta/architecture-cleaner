// The planner's runs of a bench entry (`ac bench --repeats k`): one row per run and the mean, min and max over them.
// summary.md and `ac bench compare` read them back from any result: from its repeats block, or from its one planner
// row when it has none (a default run, and every result before S8b).
// Also the two measures every report gives an entry, MoJoFM and TurboMQ's sum, with the best deterministic method on
// each and whether a planner row beats it.
import { defaultPlannerConfiguration, isPlannerConfigurationName, plannerConfigurations } from '../planner/configurations.js';
import { modelLabel } from '../planner/outputs.js';
import type { BenchPlannerRun, BenchRepeats, BenchResult, BenchRunMeasures, MethodScore } from './types.js';

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** Rounding of each measure's mean, as the bench rounds the scores themselves (Louvain's mean rows). */
const digits: Record<keyof BenchRunMeasures, number> = {
  mojoFm: 2, ari: 3, c2cCvg: 3, clusterCountRatio: 2, mojoFmHard: 2, turboMq: 4, backEdges: 1, groups: 1, modules: 1,
  recordedCostUsd: 6, promptTokens: 0, completionTokens: 0, reasoningTokens: 0,
};

function measuresOf(run: BenchPlannerRun, score: MethodScore): BenchRunMeasures {
  return {
    mojoFm: score.mojoFm, ari: score.ari, c2cCvg: score.c2cCvg, clusterCountRatio: score.clusterCountRatio, mojoFmHard: score.mojoFmHard,
    turboMq: score.turboMq.sum, backEdges: score.backEdges, groups: run.groups, modules: run.modules, recordedCostUsd: run.recordedCostUsd,
    promptTokens: run.tokens.prompt, completionTokens: run.tokens.completion, reasoningTokens: run.tokens.reasoning,
  };
}

/** Each measure reduced over the runs; null when any run has none (MoJoFM on a real target). */
function reduce(rows: BenchRunMeasures[], over: (values: number[], field: keyof BenchRunMeasures) => number): BenchRunMeasures {
  const fields = Object.keys(digits) as (keyof BenchRunMeasures)[];
  return Object.fromEntries(fields.map((field) => {
    const values = rows.map((row) => row[field]);
    return [field, values.every((value): value is number => value !== null) ? over(values, field) : null];
  })) as unknown as BenchRunMeasures;
}

/** The repeats block of an entry: its runs, each with its row in `methods`, and the mean, min and max over them. */
export function repeatsOf(runs: { run: BenchPlannerRun; score: MethodScore }[]): BenchRepeats {
  const rows = runs.map(({ run, score }) => measuresOf(run, score));
  return {
    runs: runs.map(({ run }) => run),
    mean: reduce(rows, (values, field) => round(values.reduce((sum, value) => sum + value, 0) / values.length, digits[field])),
    min: reduce(rows, (values) => Math.min(...values)),
    max: reduce(rows, (values) => Math.max(...values)),
  };
}

/** The two measures every report gives each entry: MoJoFM against its ground truth, and TurboMQ's sum. */
export type BenchMetric = 'MoJoFM' | 'TurboMQ';
export const benchMetrics: readonly BenchMetric[] = ['MoJoFM', 'TurboMQ'];

/** The first row with the highest value: how the bench picks a best deterministic method (run.ts's `bestBaseline`). */
export function bestDeterministicBy(methods: readonly MethodScore[], value: (score: MethodScore) => number): MethodScore | null {
  return methods.filter((score) => score.kind !== 'planner').reduce<MethodScore | null>((best, score) => (!best || value(score) > value(best) ? score : best), null);
}

/** Whether an entry has a MoJoFM: a scramble against its original folders, a real entry over its partial key only. */
export const hasMoJoFm = (result: BenchResult) => result.kind === 'scramble' || result.partialKey !== undefined;

/**
 * A row's value on a measure: TurboMQ's sum; MoJoFM on a scramble, or over a real entry's partial key (null without
 * one, or when the key doesn't score the row).
 */
export function metricValue(result: BenchResult, metric: BenchMetric, score: MethodScore): number | null {
  if (metric === 'TurboMQ') return score.turboMq.sum;
  if (result.kind === 'scramble') return score.mojoFm;
  return result.partialKey?.methods.find((row) => row.method === score.method)?.mojoFm ?? null;
}

/**
 * The best deterministic method (baselines and the seeds draft) on a measure. The bench records one per entry, by
 * MoJoFM on a scramble and by TurboMQ's sum on a real entry (`bestBaseline`), and a partial key its own by MoJoFM over
 * the key; a scramble's best by TurboMQ is picked here by the same rule. Null when the entry has no value on it.
 */
export function bestDeterministicOn(result: BenchResult, metric: BenchMetric): { method: string; value: number } | null {
  if (metric === 'MoJoFM') {
    const best = result.kind === 'scramble' ? result.bestBaseline : result.partialKey?.bestBaseline;
    return best && best.mojoFm !== null ? { method: best.method, value: best.mojoFm } : null;
  }
  if (result.kind === 'real') return result.bestBaseline && { method: result.bestBaseline.method, value: result.bestBaseline.turboMq };
  const best = bestDeterministicBy(result.methods, (score) => score.turboMq.sum);
  return best && { method: best.method, value: best.turboMq.sum };
}

/** Whether a planner row scores above the best deterministic method on a measure; null when the entry has none (MoJoFM on a real entry without a key). */
export function beatsBestOn(result: BenchResult, metric: BenchMetric, score: MethodScore): boolean | null {
  if (metric === 'MoJoFM' && !hasMoJoFm(result)) return null;
  const best = bestDeterministicOn(result, metric);
  return best !== null && (metricValue(result, metric, score) ?? -Infinity) > best.value;
}

/**
 * A planner run as compare reads it. Tokens and edit choices are null for a result written without a repeats block;
 * where the plan came from and whether the critic ran, for a result written before the S7 fix round (no `change`).
 */
export interface PlannerRunView {
  score: MethodScore;
  /** The validator's verdict on the plan as delivered, the seeds draft included. */
  valid: boolean;
  fromEdit: boolean | null;
  criticRan: boolean | null;
  editChoices: BenchPlannerRun['editChoices'] | null;
  modules: number | null;
  recordedCostUsd: number;
  tokens: BenchPlannerRun['tokens'] | null;
}

/** `Nemotron 3.5 Super VL (low_effort) edits and reviews`; a configuration this build doesn't know is named as written. */
export function configurationText(configuration: string): string {
  if (!isPlannerConfigurationName(configuration)) return `${configuration} (not a configuration of this build)`;
  const { edit, critic } = plannerConfigurations[configuration];
  const [editLabel, criticLabel] = [modelLabel(edit.model, edit.templateKwargs), modelLabel(critic.model, critic.templateKwargs)];
  return editLabel === criticLabel ? `${editLabel} edits and reviews` : `${editLabel} edits, ${criticLabel} reviews`;
}

/** The planner configuration a result asked for: absent, the default (every result before S8b). */
export const configurationOf = (result: BenchResult): string => result.plannerConfiguration ?? defaultPlannerConfiguration;

/** Every planner run of a result, in repeat order: from its repeats block, or its one planner row and `planner`. */
export function plannerRunsOf(result: BenchResult): PlannerRunView[] {
  const rows = new Map(result.methods.filter((score) => score.kind === 'planner').map((score) => [score.method, score]));
  if (result.repeats) {
    return result.repeats.runs.map((run) => ({
      score: rows.get(run.method)!, valid: run.valid, fromEdit: run.fromEdit, criticRan: run.criticRan, editChoices: run.editChoices,
      modules: run.modules, recordedCostUsd: run.recordedCostUsd, tokens: run.tokens,
    }));
  }
  const [score] = rows.values();
  if (!score || !result.planner) return [];
  const { change } = result.planner;
  // Before S8b the validator's verdict lives in the row's note (plannerNotes), the only place it was written; the
  // change names no winning edit when the draft is the plan, and no critic when none ran.
  return [{
    score, valid: !score.note?.startsWith('invalid plan'), fromEdit: change ? change.winner !== null : null, criticRan: change ? change.critic !== null : null,
    editChoices: null, modules: result.planner.modules ?? null, recordedCostUsd: result.planner.recordedCostUsd, tokens: null,
  }];
}

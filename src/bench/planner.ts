// The planner's row of the bench: `planRepo` exactly as `ac plan` and `ac run` call it (the profile's planner rules
// and critic prompt), through a gateway on the entry's cassette, so a replay reproduces the recorded plan (the
// immich entry's plan.yaml hashes to the S6 run's b4c7c548883c…). Its placements are the partition the bench scores,
// next to how far that partition moved from the seeds draft it started from: a plan that keeps its draft's partition
// scores the draft, not Nemotron's edit, and the bench says so. A planner configuration other than the default
// (src/planner/configurations.ts) names its row after its model and reasoning mode.
import crypto from 'node:crypto';
import type { RepoFs } from '../analyzer/repo-fs.js';
import type { Profile } from '../certificate/profile.js';
import { models, reasoningMode } from '../gateway/models.js';
import type { CassetteMode, Gateway, StructuredRequest } from '../gateway/types.js';
import { defaultPlannerConfiguration, plannerConfigurations, type PlannerConfigurationName } from '../planner/configurations.js';
import { criticSettingsFor, type CriticSettings } from '../planner/critic.js';
import { editSettingsFor, type EditRun, type EditSettings } from '../planner/edit.js';
import { planOutputs } from '../planner/outputs.js';
import { fileResolver, lowConfidenceNames } from '../planner/facts.js';
import { planRepo, type PlanRun } from '../planner/plan.js';
import { groupKey, type PlannerRules, type RecordingPins } from '../planner/types.js';
import type { Assignment } from './baselines.js';
import type { BenchPlannerChange, BenchPlannerRun } from './types.js';

export interface PlannerPartition {
  method: string;
  assignment: Assignment;
  groups: number;
  /** sha256 of plan.yaml as `ac plan` writes it. */
  planSha256: string;
  /** What the edit and critic calls cost when they were recorded. */
  recordedCostUsd: number;
  /** The validator's errors: the bench scores an invalid plan too, and says so. */
  errors: string[];
  /** Feature modules among the groups. */
  modules: number;
  change: BenchPlannerChange;
  /** The planner rules the answers were read and ranked with. */
  rules: PlannerRules;
  /** Calls answered from the cassette, and calls this run made live (and recorded). */
  calls: { replayed: number; recorded: number };
  /** The edit's and the critic's usage summed, as the cassette records it (a call without reasoning tokens counts 0). */
  usage: EditRun['usage'];
  /** The edit's K choices: how many came back, parsed into an edit, and were cut by the max_tokens cap. */
  editChoices: BenchPlannerRun['editChoices'];
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The final partition against the draft's, by files (names don't count: renaming or re-kinding a draft group moves
 * nothing). Each draft group's image is the plan group holding most of its files (ties: the first by key); a file
 * outside its draft group's image moved, and draft groups sharing an image merged. The partitions are the same when no
 * file moved and no group merged.
 */
export function partitionChange(draft: Assignment, final: Assignment): Pick<BenchPlannerChange, 'draftGroups' | 'samePartition' | 'filesMoved' | 'groupsMerged'> {
  const counts = new Map<string, Map<string, number>>();
  for (const [file, group] of final) {
    const label = draft.get(file) ?? `(not in the draft) ${file}`;
    const tally = counts.get(label) ?? new Map<string, number>();
    tally.set(group, (tally.get(group) ?? 0) + 1);
    counts.set(label, tally);
  }
  let filesMoved = 0;
  const images = new Set<string>();
  for (const tally of counts.values()) {
    const [image, kept] = [...tally].sort(([a, countA], [b, countB]) => countB - countA || byCodeUnit(a, b))[0]!;
    images.add(image);
    filesMoved += [...tally.values()].reduce((sum, count) => sum + count, 0) - kept;
  }
  const groupsMerged = counts.size - images.size;
  return { draftGroups: new Set(draft.values()).size, samePartition: filesMoved === 0 && groupsMerged === 0, filesMoved, groupsMerged };
}

/** Moves of the winning edit that name their file by an id the edit prompt showed: a name only rules 2 read, not a path. */
function movesById(run: PlanRun): number {
  const byPath = fileResolver(run.facts, 1);
  const byName = fileResolver(run.facts, 2, lowConfidenceNames(run.draft));
  return (run.winner.edit?.moves ?? []).filter((move) => !byPath(move.file).length && byName(move.file).length).length;
}

const tallyCodes = (codes: string[]) => Object.fromEntries([...codes.reduce((tally, code) => tally.set(code, (tally.get(code) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => byCodeUnit(a, b)));

/**
 * The planner row's method: `planner (Ultra)` for the default configuration, as every result before S8b names it;
 * another configuration adds its edit's reasoning mode (`planner (Super VL, low_effort)`).
 */
export function plannerMethod(configuration: PlannerConfigurationName): string {
  const { model, templateKwargs } = plannerConfigurations[configuration].edit;
  const shortName = models[model].name.replace(/^Nemotron [\d.]+ /, '');
  return `planner (${shortName}${configuration === defaultPlannerConfiguration ? '' : `, ${reasoningMode(templateKwargs)}`})`;
}

/** The settings a bench entry's planner runs with: its configuration, its row's method and its edit and critic settings. */
export interface BenchPlanner {
  configuration: PlannerConfigurationName;
  method: string;
  edit: EditSettings;
  critic: CriticSettings;
}

/**
 * `pins`: the profile's, when the bench reads the entry's own cassette (the recording they belong to), else null.
 * `mode` is the gateway's cassette mode: a replay with the default configuration asks with the pinned critic prompt
 * and reads the answers with the pinned planner rules; a recording (record, auto) uses the current ones.
 */
export function benchPlanner(configuration: PlannerConfigurationName, pins: RecordingPins | null, mode: CassetteMode): BenchPlanner {
  return { configuration, method: plannerMethod(configuration), edit: editSettingsFor(pins, mode, configuration), critic: criticSettingsFor(pins, mode, configuration) };
}

export async function planPartition(repo: RepoFs, gateway: Gateway, profile: Profile, roots: { packageRoot: string; moduleRoot: string }, planner: BenchPlanner): Promise<PlannerPartition> {
  const { edit, critic } = planner;
  const calls = { replayed: 0, recorded: 0 };
  const counting: Gateway = {
    async structured<T>(request: StructuredRequest<T>) {
      const result = await gateway.structured(request);
      calls[result.replayed ? 'replayed' : 'recorded']++;
      return result;
    },
    spent: () => gateway.spent(),
  };
  const run = await planRepo(repo, counting, { ...roots, pins: profile.plan?.pins ?? [], edit, critic });
  const planYaml = planOutputs(run, { name: profile.name }, { edit, critic }).get('plan.yaml')!;
  const assignment = new Map(run.plan.placements.map((placement) => [placement.path, groupKey(placement)]));
  const draft = new Map(run.draftCandidate.plan.placements.map((placement) => [placement.path, groupKey(placement)]));
  const { winner } = run;
  const usage = (part: keyof EditRun['usage']) => run.editRun.usage[part] + (run.criticRun?.usage[part] ?? 0);
  const choices = run.editRun.candidates;
  return {
    method: planner.method,
    assignment,
    groups: run.validation.metrics.groups,
    planSha256: crypto.createHash('sha256').update(planYaml).digest('hex'),
    recordedCostUsd: run.editRun.costUsd + (run.criticRun?.costUsd ?? 0),
    errors: run.validation.issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.code}: ${issue.detail}`),
    modules: run.validation.metrics.modules,
    rules: run.rules,
    calls,
    usage: { promptTokens: usage('promptTokens'), completionTokens: usage('completionTokens'), reasoningTokens: usage('reasoningTokens') },
    editChoices: {
      asked: edit.samples, returned: choices.length, parsed: choices.filter((choice) => choice.edit).length, truncated: choices.filter((choice) => choice.finishReason === 'length').length,
    },
    change: {
      ...partitionChange(draft, assignment),
      winner: winner.edit
        ? { label: winner.label, groupEntries: winner.edit.groups.length, moves: winner.edit.moves.length, movesById: movesById(run), issues: tallyCodes(winner.dropped.map((issue) => issue.code)) }
        : null,
      critic: run.criticRun && { suggestions: run.criticRun.suggestions.length, kept: run.criticRun.suggestions.filter((suggestion) => suggestion.accepted).length },
    },
  };
}

// The ladder re-executed without the run loop around it: each step's moves through the executor and one commit per
// step (R1 and R2 from the plan, R3's renames computed on the tree after R2, R4's boundary rules generated on the final
// tree), on the demo's branch. No certificate is made here and no step is replanned: a decline is reported as is.
import fs from 'node:fs';
import path from 'node:path';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import { buildBoundaryRules } from '../boundaries/index.js';
import type { Profile } from '../certificate/profile.js';
import { executeMove } from '../executor/execute.js';
import { normalizationSteps } from '../filename-normalization/index.js';
import { scopeOf, stepMessage } from '../orchestrator/commit-message.js';
import { commitStaged, git, headCommit, resetHard, treeOf } from '../orchestrator/git.js';
import { planSteps, renameSteps } from '../orchestrator/steps.js';
import type { RungId, RunState, StepRecord } from '../orchestrator/types.js';
import type { PlanFile } from '../planner/plan-file.js';
import type { DemoReport, RenamePhase, StepEntry } from './report.js';

export interface LadderContext {
  repo: string;
  packageRoot: string;
  moduleRoot: string;
  planSha256: string;
}

export interface ExecutedStep {
  index: number;
  rung: RungId;
  group: string;
  /** Requested moves (R4: files added). */
  moves: number;
  outcome: 'committed' | 'declined' | 'unverified' | 'error';
  parent: string;
  commit?: string;
  tree?: string;
  counts?: { filesMoved: number; specifierEdits: number; filesEdited: number };
  /** Why nothing was committed. */
  detail?: string;
  durationMs: number;
}

const elapsed = (started: number) => Math.round(performance.now() - started);

/** One R1, R2 or R3 step: the executor moves the files, one commit holds the step. Nothing changes on a decline. */
export function executeStep(context: LadderContext, step: Pick<StepRecord, 'index' | 'rung' | 'group'> & { moves: ReadonlyMap<string, string> }): ExecutedStep {
  const started = performance.now();
  const parent = headCommit(context.repo);
  const base = { index: step.index, rung: step.rung, group: step.group, moves: step.moves.size, parent };
  let result;
  try {
    result = executeMove(gitRepoFs(context.repo), step.moves);
  } catch (error) {
    resetHard(context.repo, parent);
    return { ...base, outcome: 'error', detail: `the executor crashed: ${(error as Error).message.split('\n')[0]}`, durationMs: elapsed(started) };
  }
  if (result.outcome === 'declined') {
    return { ...base, outcome: 'declined', detail: result.declines.slice(0, 3).map((decline) => `${decline.code} ${decline.file}: ${decline.detail}`).join('; '), durationMs: elapsed(started) };
  }
  if (result.outcome === 'unverified') {
    return { ...base, outcome: 'unverified', detail: result.violations.slice(0, 3).map((violation) => `${violation.file}: ${violation.detail}`).join('; '), durationMs: elapsed(started) };
  }
  const counts = { filesMoved: result.moves.size, specifierEdits: result.edits.length, filesEdited: new Set(result.edits.map((edit) => edit.file)).size };
  const commit = commitStaged(context.repo, stepMessage({
    scope: scopeOf(context.repo, context.packageRoot), packageRoot: context.packageRoot, rung: step.rung, index: step.index, group: step.group, moves: step.moves,
    planSha256: context.planSha256, counts, pinned: [], replans: 0,
  }));
  return { ...base, outcome: 'committed', commit, tree: treeOf(context.repo, commit), counts, durationMs: elapsed(started) };
}

/** R3's steps as `ac run` computes them: on the tree after R2, numbered from `firstIndex`. */
export function computeRenameSteps(context: LadderContext, profile: Profile, firstIndex: number): { steps: StepRecord[]; declined: number } {
  const { steps, declined } = normalizationSteps(gitRepoFs(context.repo), { packageRoot: context.packageRoot, moduleRoot: context.moduleRoot, profile });
  return { steps: renameSteps(steps, firstIndex), declined: declined.length };
}

/** R4's step, with how many of its rules fired on their synthetic violation (anti-vacuity). */
export type BoundaryStep = ExecutedStep & { summary?: string; antiVacuity?: { fired: number; rules: number } };

/**
 * R4: the boundary rules generated on HEAD and committed as one step, as `ac run` commits them (no certificate; a rule
 * that never fires is reported, where `ac run` would fail R4).
 */
export async function commitBoundaryRules(context: LadderContext, index: number, options: { environment: string; workDir: string; log(message: string): void }): Promise<BoundaryStep> {
  const started = performance.now();
  const parent = headCommit(context.repo);
  const base = { index, rung: 'R4' as const, group: 'boundaries', moves: 0, parent };
  let rules;
  try {
    rules = await buildBoundaryRules({ repo: context.repo, environment: options.environment, packageRoot: context.packageRoot, moduleRoot: context.moduleRoot, workDir: options.workDir, log: options.log });
  } catch (error) {
    return { ...base, outcome: 'error', detail: `the boundary rules could not be generated: ${(error as Error).message.split('\n')[0]}`, durationMs: elapsed(started) };
  }
  const antiVacuity = { fired: rules.antiVacuity.filter((entry) => entry.fired).length, rules: rules.antiVacuity.length };
  for (const [file, content] of rules.files) {
    fs.mkdirSync(path.dirname(path.join(context.repo, file)), { recursive: true });
    fs.writeFileSync(path.join(context.repo, file), content);
  }
  git(context.repo, ['add', '--', ...rules.files.keys()]);
  const commit = commitStaged(context.repo, stepMessage({
    scope: scopeOf(context.repo, context.packageRoot), packageRoot: context.packageRoot, rung: 'R4', index, group: 'boundaries', moves: new Map(), planSha256: context.planSha256,
    counts: { filesMoved: 0, specifierEdits: 0, filesEdited: 0 }, pinned: [], replans: 0, added: [...rules.files.keys()], summary: rules.summary,
  }));
  return { ...base, moves: rules.files.size, outcome: 'committed', commit, tree: treeOf(context.repo, commit), summary: rules.summary, antiVacuity, durationMs: elapsed(started) };
}

export interface LadderOptions {
  context: LadderContext;
  planFile: PlanFile;
  profile: Profile;
  /**
   * The recorded run, when there is one: each step's tree is compared with its, its pins stay pinned, a step it didn't
   * certify isn't executed, and R3 and R4 run only where it ran them. Without one every rung runs.
   */
  recorded: RunState | null;
  /** Stop after this many steps (null: all). */
  limit: number | null;
  /** The checkout whose node_modules R4's rules see. */
  environment: string;
  workDir: string;
  log(message: string): void;
}

export type LadderResult = Pick<DemoReport, 'steps' | 'renames' | 'boundaries' | 'stoppedAfter' | 'plannedSteps'>;

/** R1 and R2 from the plan, R3 computed after R2, R4 generated last: each step executed and committed in turn. */
export async function executeLadder(options: LadderOptions): Promise<LadderResult> {
  const { context, recorded, limit, log } = options;
  const recordedSteps = new Map((recorded?.steps ?? []).map((step) => [step.index, step]));
  const pinned = new Set((recorded?.pins ?? []).map((pin) => pin.file));
  const planned = planSteps(options.planFile);
  const recordedRenames = (recorded?.steps ?? []).filter((step) => step.rung === 'R3');
  const steps: StepEntry[] = [];
  let stoppedAfter: number | null = null;
  const limitReached = () => {
    if (limit === null || steps.length < limit) return false;
    stoppedAfter ??= steps.at(-1)?.index ?? 0;
    return true;
  };
  /** False when the ladder stops here. */
  const run = (step: StepRecord, total: number): boolean => {
    if (limitReached()) return false;
    const recordedStep = recordedSteps.get(step.index);
    if (recordedStep && recordedStep.status !== 'certified') {
      log(`step ${step.index} ${step.group}: ${recordedStep.status} in the recorded run, so not executed`);
      return true;
    }
    const moves = new Map(Object.entries(step.moves).filter(([from]) => !pinned.has(from)));
    const entry: StepEntry = { ...executeStep(context, { index: step.index, rung: step.rung, group: step.group, moves }), ...(recordedStep?.tree ? { recordedTree: recordedStep.tree } : {}) };
    steps.push(entry);
    const outcome = entry.outcome !== 'committed' ? `${entry.outcome}: ${entry.detail}`
      : !recorded ? `committed ${entry.commit?.slice(0, 10)}`
        : entry.tree === entry.recordedTree ? 'tree matches the recorded run' : `tree ${entry.tree?.slice(0, 10)}, recorded ${entry.recordedTree?.slice(0, 10) ?? 'none'}`;
    log(`step ${step.index}/${total} ${step.rung} ${step.group}: ${moves.size} moves, ${outcome} (${Math.round(entry.durationMs / 1000)} s)`);
    if (entry.outcome === 'committed') return true;
    // Later steps would run on another tree than the recorded run's (or the plan's): stop here.
    stoppedAfter = step.index;
    return false;
  };

  const total = planned.length + recordedRenames.length;
  let going = true;
  for (const step of planned) if (going) going = run(step, total);

  let renames: RenamePhase | null = null;
  const r3Requested = !recorded || recorded.rungs.find((rung) => rung.id === 'R3')?.status !== 'not-requested';
  if (going && r3Requested && !limitReached()) {
    log('R3: computing the renames on the tree after R2');
    try {
      // Numbered after the plan's steps, as `ac run` numbers them when R3 starts.
      const computed = computeRenameSteps(context, options.profile, Math.max(0, ...planned.map((step) => step.index)) + 1);
      const shape = (list: StepRecord[]) => JSON.stringify(list.map((step) => [step.index, step.group, step.moves]));
      const same = !recorded || shape(computed.steps) === shape(recordedRenames);
      renames = {
        outcome: !recorded ? 'skipped' : same ? 'match' : 'mismatch', steps: computed.steps.length, declined: computed.declined,
        renames: computed.steps.reduce((sum, step) => sum + Object.keys(step.moves).length, 0),
        ...(same ? {} : { detail: `${computed.steps.length} steps computed, ${recordedRenames.length} recorded; the computed ones run` }),
      };
      for (const step of computed.steps) if (going) going = run(step, planned.length + computed.steps.length);
    } catch (error) {
      renames = { outcome: 'failed', steps: 0, renames: 0, declined: 0, detail: `the renames could not be computed: ${(error as Error).message.split('\n')[0]}` };
      going = false;
    }
  }

  let boundaries: DemoReport['boundaries'] = null;
  const recordedBoundaries = recorded ? recorded.steps.find((step) => step.rung === 'R4' && step.status === 'certified') ?? null : undefined;
  if (going && recordedBoundaries !== null && !limitReached()) {
    log('R4: generating the boundary rules');
    const index = recordedBoundaries?.index ?? Math.max(0, ...steps.map((step) => step.index)) + 1;
    const executed = await commitBoundaryRules(context, index, { environment: options.environment, workDir: path.join(options.workDir, 'boundaries'), log });
    boundaries = { ...executed, ...(recordedBoundaries?.tree ? { recordedTree: recordedBoundaries.tree } : {}) };
    steps.push(boundaries);
    const outcome = boundaries.outcome !== 'committed' ? `${boundaries.outcome}: ${boundaries.detail}` : !recorded ? `committed, ${boundaries.antiVacuity?.fired}/${boundaries.antiVacuity?.rules} rules fired`
      : boundaries.tree === boundaries.recordedTree ? 'tree matches the recorded run' : `tree ${boundaries.tree?.slice(0, 10)}, recorded ${boundaries.recordedTree?.slice(0, 10)}`;
    log(`R4: ${outcome}`);
  }
  return { steps, renames, boundaries, stoppedAfter, plannedSteps: planned.length + (renames?.steps ?? recordedRenames.length) };
}

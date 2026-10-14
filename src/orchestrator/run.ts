// `ac run`: the step ladder on a branch of the target (plan §2.3, §3.2). R0 preflight and baseline; R1 module steps,
// R2 platform and shared/ steps, R3 filename normalization, each step moved, committed, certified statically against
// its parent and, on PASS, given the certificate trailers; each rung certified as a whole with the oracles; the whole
// PR certified at the end. On a FAIL the step is rolled back and replanned by pinning the offending plan entries, at
// most twice, else the whole step is pinned; every pin is a finding. State lives in the run directory (types.ts);
// a run resumes after its last certified commit.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Profile } from '../certificate/profile.js';
import { packageDirectory } from '../certificate/toolchain.js';
import { readPlanYaml } from '../planner/plan-file.js';
import { checkGroupKeys } from '../planner/steps.js';
import { branchExists, checkout, createBranch, currentBranch, git, headCommit, isAncestor, isClean, resetHard, resolveRevision, topLevel, treeOf } from './git.js';
import { preflight } from './preflight.js';
import { renderReport } from './report.js';
import { openRunDirectory, readRunState } from './run-directory.js';
import { addFinding, createRunner, defaultDependencies, elapsed, type RunDependencies, RunError, type Runner, rungOf } from './runner.js';
import { addRenameSteps, certifyRun, runBoundaryRung, runStepRung, writeStepFile } from './rungs.js';
import { planSteps } from './steps.js';
import { type RungId, rungIds, type RunState } from './types.js';

export { defaultDependencies, RunError, staticCheckIds, type RunDependencies } from './runner.js';

export interface RunPlanInput {
  /** plan.yaml bytes. */
  text: string;
  /** A plan.yaml path, or `planner`. */
  source: string;
  /** More files for <run-dir>/plan/: the planner's other outputs when it ran in-process (plan.md, plan.json). */
  files: Map<string, string>;
  recordedCostUsd: number | null;
}

export interface StartOptions {
  repo: string;
  environment: string;
  profile: Profile;
  plan: RunPlanInput;
  cost: { budgetRun: string | null; mode: RunState['cost']['mode']; llmUsd: number };
  runDirectory: string;
  branch: string;
  rungs: RungId[];
  /** Stop after this many steps in this invocation (a trial run); --resume continues. */
  maxSteps: number | null;
  jobs: number;
  injectFault: { step: string; operator: string } | null;
  log(message: string): void;
}

export interface ResumeOptions {
  runDirectory: string;
  /** When given, must be the run's repository. */
  repo?: string;
  maxSteps: number | null;
  /** Overrides the run's --jobs from here on. */
  jobs?: number;
  log(message: string): void;
}

export interface RunOutcome {
  state: RunState;
  /** The run directory (absolute). */
  directory: string;
  /** 0 completed or stopped, 1 failed, 3 declined. */
  exitCode: number;
}

const toolVersion = () => JSON.parse(fs.readFileSync(path.join(packageDirectory(), 'package.json'), 'utf8')).version as string;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

async function drive(runner: Runner): Promise<void> {
  const { state } = runner;
  for (const id of ['R1', 'R2', 'R3', 'R4'] as const) {
    const rung = rungOf(state, id);
    if (state.status !== 'running') break;
    if (rung.status !== 'pending' && rung.status !== 'running') continue;
    if (id === 'R4') {
      await runBoundaryRung(runner, rung);
      continue;
    }
    if (id === 'R3' && rung.status === 'pending' && !state.steps.some((step) => step.rung === 'R3')) addRenameSteps(runner);
    if ((await runStepRung(runner, rung)) === 'stopped') {
      if (state.status === 'running') state.status = 'stopped';
      break;
    }
  }
  if (state.status !== 'running') return;
  await certifyRun(runner);
  if (state.status === 'running') state.status = 'completed';
}

function finish(runner: Runner): RunOutcome {
  const { state } = runner;
  state.timeline.finishedAt = new Date().toISOString();
  runner.save();
  runner.event({ event: 'run-end', durationMs: state.timeline.durationMs, status: state.status, head: state.head, ...(state.error ? { detail: state.error } : {}) });
  const { findingsSection } = runner.dependencies;
  runner.directory.writeText('report.md', renderReport(state, findingsSection ? { findings: findingsSection } : {}));
  return { state, directory: runner.directory.root, exitCode: state.status === 'declined' ? 3 : state.status === 'failed' ? 1 : 0 };
}

/** Runs `body`; a crash becomes a failed run with the error recorded (the branch is left where it was, --resume can continue). */
async function guarded(runner: Runner, body: () => Promise<void>): Promise<RunOutcome> {
  try {
    await body();
  } catch (error) {
    runner.state.status = 'failed';
    runner.state.error = `crashed: ${(error as Error).stack ?? String(error)}`;
  }
  return finish(runner);
}

export async function startRun(options: StartOptions, overrides: Partial<RunDependencies> = {}): Promise<RunOutcome> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const repo = topLevelOf(options.repo);
  const planFile = readPlanYaml(options.plan.text);
  const groupIssues = checkGroupKeys(planFile).filter((issue) => issue.severity === 'error');
  if (groupIssues.length) throw new RunError(`the plan is invalid: ${groupIssues.map((issue) => `${issue.code}: ${issue.detail}`).join('; ')}`);
  if (fs.existsSync(path.join(options.runDirectory, 'run.json'))) throw new RunError(`${path.resolve(options.runDirectory)} already holds a run: continue it with --resume, or pick another --out`);
  if (!isClean(repo)) throw new RunError(`${repo} has tracked changes: commit or stash them first`);
  if (branchExists(repo, options.branch)) throw new RunError(`branch ${options.branch} already exists in ${repo}`);
  let base: string;
  try {
    base = resolveRevision(repo, planFile.sha);
  } catch {
    throw new RunError(`the plan's sha ${planFile.sha} is not a commit of ${repo}`);
  }
  const steps = planSteps(planFile);
  const directory = openRunDirectory(options.runDirectory);
  const now = new Date().toISOString();
  const state: RunState = {
    format: 'ac-run/1',
    status: 'running',
    tool: { name: 'architecture-cleaner', version: toolVersion() },
    repo,
    environment: path.resolve(options.environment),
    profile: options.profile,
    packageRoot: planFile.packageRoot,
    moduleRoot: planFile.moduleRoot,
    base,
    baseTree: treeOf(repo, base),
    branch: options.branch,
    head: base,
    plan: { file: 'plan/plan.yaml', source: options.plan.source, sha256: sha256(options.plan.text), steps: steps.length, moves: steps.reduce((sum, step) => sum + Object.keys(step.moves).length, 0) },
    rungsRequested: rungIds.filter((id) => options.rungs.includes(id)),
    options: { jobs: options.jobs, injectFault: options.injectFault },
    rungs: rungIds.map((id) => ({ id, status: options.rungs.includes(id) ? 'pending' : 'not-requested', durationMs: 0 })),
    steps,
    pins: [],
    findings: [],
    quarantine: [],
    fault: options.injectFault ? { ...options.injectFault } : null,
    cost: { budgetRun: options.cost.budgetRun, mode: options.cost.mode, llmUsd: options.cost.llmUsd, planRecordedUsd: options.plan.recordedCostUsd },
    timeline: { startedAt: now, durationMs: 0, preflightMs: 0, baselineMs: 0, stepsMs: 0, rungCertificationMs: 0, bisectMs: 0, runCertificationMs: 0, resumedAt: [] },
  };
  directory.writeText('plan/plan.yaml', options.plan.text);
  for (const [file, content] of options.plan.files) directory.writeText(`plan/${file}`, content);
  for (const step of steps) writeStepFile(directory, step);
  const runner = createRunner(state, directory, planFile, dependencies, options.maxSteps, options.log);
  runner.event({ event: 'run-start', repo, branch: options.branch, base, plan: options.plan.source, rungs: state.rungsRequested });
  runner.save();
  return guarded(runner, async () => {
    const r0 = rungOf(state, 'R0');
    let preflightRecord: Awaited<ReturnType<typeof preflight>>['preflight'] | null = null;
    if (r0.status === 'pending') {
      const started = performance.now();
      r0.status = 'running';
      r0.start = base;
      const outcome = await preflight({
        repo, environment: state.environment, profile: state.profile, packageRoot: state.packageRoot, planSha: planFile.sha, base, steps,
        workDir: directory.workDir('preflight'), runBaseline: dependencies.runBaseline, log: options.log,
      });
      fs.rmSync(directory.path('work', 'preflight'), { recursive: true, force: true });
      preflightRecord = outcome.preflight;
      directory.writeJson('preflight.json', preflightRecord);
      if (outcome.baseline) directory.writeJson('baseline.json', outcome.baseline);
      state.timeline.baselineMs = outcome.baseline?.durationMs ?? 0;
      state.timeline.preflightMs = elapsed(started) - state.timeline.baselineMs;
      r0.durationMs = elapsed(started);
      runner.event({ event: 'preflight', rung: 'R0', durationMs: state.timeline.preflightMs, declined: preflightRecord.declined, declines: preflightRecord.declines.length });
      if (outcome.baseline) runner.event({ event: 'baseline', rung: 'R0', durationMs: outcome.baseline.durationMs, green: outcome.baseline.green, flaky: outcome.baseline.flaky.length });
      if (preflightRecord.declined) {
        r0.status = 'declined';
        r0.note = preflightRecord.declines.slice(0, 5).map((decline) => `${decline.code}${decline.file ? ` ${decline.file}` : ''}: ${decline.detail}`).join('; ');
        state.status = 'declined';
        state.error = `preflight declines the run: ${r0.note}`;
        return;
      }
      r0.status = 'passed';
      state.quarantine = outcome.baseline?.flaky ?? [];
      for (const entry of state.quarantine) addFinding(runner, { kind: 'flaky-test', rung: 'R0', files: [entry.file], detail: `${entry.name ?? 'the whole file'}: ${entry.reason} (quarantined: K8 leaves it out)` });
    }
    createBranch(repo, options.branch, base);
    const head = headCommit(repo);
    runner.event({ event: 'branch', branch: options.branch, commit: head });
    if (preflightRecord) {
      preflightRecord.plan.matchesBranchStart = head === base;
      directory.writeJson('preflight.json', preflightRecord);
    }
    if (head !== base) throw new Error(`branch ${options.branch} starts at ${head}, not at the plan's sha ${base}`);
    runner.save();
    await drive(runner);
  });
}

const topLevelOf = (repo: string) => {
  try {
    return topLevel(repo);
  } catch {
    throw new RunError(`${repo} is not a git repository`);
  }
};

/** Puts the branch back at the last certified commit when what lies beyond it is the run's own uncertified work. */
function reconcile(runner: Runner): void {
  const { state } = runner;
  const repo = state.repo;
  if (currentBranch(repo) !== state.branch) {
    if (!isClean(repo)) throw new RunError(`${repo} has tracked changes and isn't on ${state.branch}`);
    checkout(repo, state.branch);
  }
  const inFlight = state.steps.flatMap((step) => step.attempts).filter((attempt) => attempt.state === 'executing' || attempt.state === 'committed' || attempt.state === 'certifying');
  const head = headCommit(repo);
  const treeOrNull = (commit: string) => {
    try {
      return treeOf(repo, commit);
    } catch {
      return null;
    }
  };
  const runTrees = new Set(state.steps.flatMap((step) => [step.tree, ...step.attempts.map((attempt) => (attempt.commit ? treeOrNull(attempt.commit) : null))]).filter(Boolean));
  if (head !== state.head && treeOf(repo, head) === treeOf(repo, state.head) && runTrees.has(treeOf(repo, head))) {
    // A message-only rewrite (the trailers) that saved its state but didn't move the branch yet.
    resetHard(repo, state.head);
    runner.event({ event: 'resume', detail: 'moved the branch to the rewritten commits (same trees)', from: head, to: state.head });
  } else if (head !== state.head) {
    if (!isAncestor(repo, state.head, head)) throw new RunError(`the branch head ${head.slice(0, 10)} doesn't descend from the run's last certified commit ${state.head.slice(0, 10)}`);
    const beyond = git(repo, ['rev-list', `${state.head}..${head}`]).split('\n').filter(Boolean);
    const foreign = beyond.filter((commit) => !runTrees.has(treeOf(repo, commit)));
    if (foreign.length) throw new RunError(`the branch head ${head.slice(0, 10)} isn't the run's last certified commit ${state.head.slice(0, 10)}: ${foreign.length} commits on top weren't made by this run`);
    resetHard(repo, state.head);
    runner.event({ event: 'resume', detail: `reset ${beyond.length} uncertified run commits`, from: head, to: state.head });
  } else if (!isClean(repo)) {
    if (!inFlight.some((attempt) => attempt.state === 'executing')) throw new RunError(`${repo} has tracked changes this run didn't make`);
    resetHard(repo, state.head);
    runner.event({ event: 'resume', detail: 'discarded an interrupted move', to: state.head });
  }
  for (const attempt of inFlight) {
    attempt.state = 'interrupted';
    attempt.detail = `${attempt.detail ? `${attempt.detail}; ` : ''}interrupted, found in flight by --resume`;
  }
}

export async function resumeRun(options: ResumeOptions, overrides: Partial<RunDependencies> = {}): Promise<RunOutcome> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const directory = openRunDirectory(options.runDirectory);
  const state = readRunState(directory.root);
  if (options.repo && topLevelOf(options.repo) !== state.repo) throw new RunError(`the run in ${directory.root} is on ${state.repo}, not ${options.repo}`);
  if (state.status === 'declined' || state.status === 'completed') throw new RunError(`nothing to resume: the run is ${state.status}`);
  const planText = fs.readFileSync(directory.path(state.plan.file), 'utf8');
  if (sha256(planText) !== state.plan.sha256) throw new RunError(`${state.plan.file} changed since the run started (sha256 differs)`);
  const runner = createRunner(state, directory, readPlanYaml(planText), dependencies, options.maxSteps, options.log);
  reconcile(runner);
  state.status = 'running';
  if (options.jobs) state.options.jobs = options.jobs;
  delete state.error;
  delete state.timeline.finishedAt;
  state.timeline.resumedAt.push(new Date().toISOString());
  runner.event({ event: 'resume', head: state.head });
  runner.save();
  return guarded(runner, () => drive(runner));
}

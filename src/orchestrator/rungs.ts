// Rungs (plan §2.3): R1–R3 run their steps, then a cumulative full certificate (oracles included) with one K8
// bisect on failure; R3's steps are computed after R2; R4 commits the injected boundary rules; the whole PR is
// certified at the end.
import fs from 'node:fs';
import path from 'node:path';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import { trailers } from '../certificate/report.js';
import type { Certificate } from '../certificate/types.js';
import { certificateOffenders, pinWholeStep } from './attempt.js';
import { scopeOf, stepMessage } from './commit-message.js';
import { amendMessage, commitStaged, git, resetHard, treeOf } from './git.js';
import { runPipelined, runSequential, writePendingTrailers } from './pipeline.js';
import type { RunDirectory } from './run-directory.js';
import { addFinding, certifyRange, elapsed, failingChecks, failRun, padded, type Runner, storeCertificate } from './runner.js';
import { renameSteps } from './steps.js';
import type { AttemptRecord, CertificateRecord, RungId, RungRecord, RunState, StepRecord } from './types.js';

const certifiedSteps = (state: RunState, rung: RungId) => state.steps.filter((step) => step.rung === rung && step.status === 'certified').sort((a, b) => a.index - b.index);

/**
 * K8 bisect of a rung whose cumulative certificate failed only its oracles: the first commit whose rung-start..commit
 * fails K8 is rolled back, its step pinned, and the rung's later steps set to run again. A probe whose K8 errored or
 * was skipped gives no evidence: the bisect stops there and pins nothing, a crash that --resume bisects again after.
 * True when a step was pinned.
 */
async function bisectRung(runner: Runner, rung: RungRecord): Promise<boolean> {
  const { state } = runner;
  const started = performance.now();
  const steps = certifiedSteps(state, rung.id);
  const probes = rung.bisect?.probes ?? [];
  const earlierMs = rung.bisect?.durationMs ?? 0;
  let low = 0;
  let high = steps.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const step = steps[middle]!;
    const probeStarted = performance.now();
    const certificate = await certifyRange(runner, rung.start!, step.commit!, `bisect-${rung.id}-${padded(step.index)}`, { only: ['K8'], oracles: true });
    const k8 = certificate.checks.find((check) => check.id === 'K8')?.status ?? 'skip';
    const record = storeCertificate(runner, `rungs/bisect/${rung.id}-${padded(step.index)}`, certificate);
    probes.push({ step: step.index, commit: step.commit!, k8, certificate: record.file, durationMs: elapsed(probeStarted) });
    runner.event({ event: 'bisect-probe', rung: rung.id, step: step.index, durationMs: elapsed(probeStarted), k8 });
    if (k8 === 'pass') low = middle + 1;
    else if (k8 === 'fail') high = middle;
    else {
      rung.bisect = { probes, firstFailingStep: null, durationMs: earlierMs + elapsed(started) };
      state.timeline.bisectMs += elapsed(started);
      failRun(runner, 'crash', `rung ${rung.id}'s K8 bisect probe at step ${step.index} gave no evidence (K8 ${k8}), so nothing is pinned; --resume bisects again: ${certificateOffenders(certificate).detail}`);
      runner.event({ event: 'bisect', rung: rung.id, durationMs: elapsed(started), step: step.index, detail: `no evidence (K8 ${k8})` });
      return false;
    }
  }
  const culprit = steps[low]!;
  rung.bisect = { probes, firstFailingStep: culprit.index, durationMs: earlierMs + elapsed(started) };
  state.timeline.bisectMs += elapsed(started);
  const rollbackTo = culprit.parent!;
  // State first, then the branch: a crash in between leaves the branch ahead by run commits, which --resume resets.
  for (const step of steps.filter((candidate) => candidate.index >= culprit.index)) {
    for (const field of ['commit', 'tree', 'parent', 'certificate', 'counts', 'pathMap'] as const) delete step[field];
    if (step !== culprit) Object.assign(step, { status: 'pending', round: step.round + 1 });
  }
  pinWholeStep(runner, culprit, 'bisect-pinned', `rung ${rung.id}'s oracles fail from this step on (K8 bisect over ${steps.length} commits, ${probes.length} probes)`);
  state.head = rollbackTo;
  runner.save();
  resetHard(state.repo, rollbackTo);
  runner.event({ event: 'bisect', rung: rung.id, durationMs: elapsed(started), step: culprit.index, rolledBackTo: rollbackTo });
  return true;
}

/** Moves a stored certificate pair aside (a rung certificate that a bisect superseded), never over a stored FAIL. */
function moveCertificate(runner: Runner, from: string, to: string): string {
  const target = runner.directory.certificateFile(to);
  for (const extension of ['.json', '.txt']) {
    fs.mkdirSync(path.dirname(runner.directory.path(`${target}${extension}`)), { recursive: true });
    fs.renameSync(runner.directory.path(`${from}${extension}`), runner.directory.path(`${target}${extension}`));
  }
  return `${target}.json`;
}

/**
 * 'no-evidence': the certificate has no verdict (every check that didn't pass errored), or its bisect stopped at a
 * probe without evidence; the run failed as a crash and the rung still runs, so --resume certifies it again.
 */
type RungCertification = 'certified' | 'bisected' | 'failed' | 'empty' | 'no-evidence';

/**
 * A FAIL in which no check failed: every check that didn't pass errored (a check crashed, an oracle couldn't run on
 * base). It says nothing about the change either way, like a step certificate that only errored: a crash that
 * --resume certifies again, never a verdict. A check that failed next to one that errored is a verdict.
 */
export const withoutVerdict = (certificate: Certificate) => certificate.verdict === 'fail' && !certificate.checks.some((check) => check.status === 'fail');

/**
 * The rung's cumulative full certificate (rung start..its last commit, oracles included); one K8 bisect on failure
 * (again when the last one stopped without evidence).
 */
async function certifyRung(runner: Runner, rung: RungRecord, partial: boolean): Promise<RungCertification> {
  const { state } = runner;
  if (state.head === rung.start) {
    rung.note = 'no commits: every step was pinned or skipped';
    return 'empty';
  }
  rung.end = state.head;
  const started = performance.now();
  runner.log(`rung ${rung.id}: full certificate of ${rung.start!.slice(0, 10)}..${state.head.slice(0, 10)}${partial ? ' (partial)' : ''}`);
  const certificate = await certifyRange(runner, rung.start!, state.head, `rung-${rung.id}`, { oracles: true });
  const durationMs = elapsed(started);
  state.timeline.rungCertificationMs += durationMs;
  rung.certificate = { ...storeCertificate(runner, `rungs/${rung.id}`, certificate), partial };
  runner.event({ event: 'rung-certify', rung: rung.id, durationMs, verdict: certificate.verdict, scope: certificate.scope, failing: failingChecks(certificate), partial });
  if (certificate.verdict === 'pass') return 'certified';
  const failing = failingChecks(certificate);
  if (withoutVerdict(certificate)) {
    failRun(runner, 'crash', `rung ${rung.id}'s certificate has no verdict: ${failing.join(', ')} errored and no check failed; --resume certifies the rung again: ${certificateOffenders(certificate).detail}`);
    return 'no-evidence';
  }
  const k8 = certificate.checks.find((check) => check.id === 'K8')?.status;
  if (failing.length === 1 && k8 === 'fail' && (!rung.bisect || rung.bisect.firstFailingStep === null)) {
    rung.certificate.file = moveCertificate(runner, rung.certificate.file.replace(/\.json$/, ''), `rungs/failed/${rung.id}`);
    runner.log(`rung ${rung.id}: K8 fails; bisecting its ${certifiedSteps(state, rung.id).length} commits`);
    return (await bisectRung(runner, rung)) ? 'bisected' : 'no-evidence';
  }
  failRun(runner, 'verdict', `rung ${rung.id}'s certificate FAILs (${failing.join(', ')})${rung.bisect ? ' after its K8 bisect' : ''}: ${certificateOffenders(certificate).detail}`);
  return 'failed';
}

/** R1, R2 or R3: every pending step, then the rung certificate (and its bisect). 'stopped' when --max-steps ran out. */
export async function runStepRung(runner: Runner, rung: RungRecord): Promise<'stopped' | 'done'> {
  const { state } = runner;
  if (rung.status === 'pending') {
    rung.status = 'running';
    rung.start = state.head;
    runner.event({ event: 'rung-start', rung: rung.id, commit: state.head });
    runner.save();
  }
  const started = performance.now();
  try {
    for (;;) {
      const steps = state.steps.filter((step) => step.rung === rung.id && (step.status === 'pending' || step.status === 'running'));
      const stepsStarted = performance.now();
      const stopped = state.options.jobs > 1 ? await runPipelined(runner, steps) : await runSequential(runner, steps);
      state.timeline.stepsMs += elapsed(stepsStarted);
      writePendingTrailers(runner);
      if (state.status !== 'running') return 'done';
      if (stopped) {
        if ((await certifyRung(runner, rung, true)) === 'failed') rung.status = 'failed';
        return 'stopped';
      }
      const outcome = await certifyRung(runner, rung, false);
      if (outcome === 'bisected') continue;
      // Without evidence the rung stays running: --resume certifies it again.
      if (outcome !== 'no-evidence') rung.status = outcome === 'certified' ? 'certified' : outcome === 'empty' ? 'skipped' : 'failed';
      return 'done';
    }
  } finally {
    rung.durationMs += elapsed(started);
    runner.save();
  }
}

/** R3's steps (contract C5), computed on the tree after R2 and numbered after every earlier step. */
export function addRenameSteps(runner: Runner): void {
  const { state } = runner;
  const { steps, declined } = runner.dependencies.normalizationSteps(gitRepoFs(state.repo), { packageRoot: state.packageRoot, moduleRoot: state.moduleRoot, profile: state.profile });
  const records = renameSteps(steps, Math.max(0, ...state.steps.map((step) => step.index)) + 1);
  state.steps.push(...records);
  for (const decline of declined) addFinding(runner, { kind: 'rename-declined', rung: 'R3', files: [decline.file], detail: `${decline.reason}: ${decline.file} -> ${decline.to}: ${decline.detail}` });
  for (const record of records) writeStepFile(runner.directory, record);
}

/** plan/steps/<NN>-<kind>-<name>.json, the file `ac move --map` reads (the shape `ac steps` writes). */
export function writeStepFile(directory: RunDirectory, step: StepRecord): void {
  const name = `${String(step.index).padStart(2, '0')}-${step.group.replace('/', '-')}.json`;
  directory.writeText(`plan/steps/${name}`, `${JSON.stringify({ step: step.index, rung: step.rung, group: step.group, moves: step.moves }, null, 1)}\n`);
}

/** R4 (contract C6): the injected hook's files in one commit, certified like a rung end; vacuous rules fail it. */
export async function runBoundaryRung(runner: Runner, rung: RungRecord): Promise<void> {
  const { state } = runner;
  const hook = runner.dependencies.boundaryRung;
  if (!hook) {
    rung.status = 'not-available';
    rung.note = 'no boundary-rules implementation is wired in (contract C6)';
    runner.event({ event: 'rung-skip', rung: 'R4', detail: rung.note });
    runner.save();
    return;
  }
  const started = performance.now();
  rung.status = 'running';
  rung.start = state.head;
  runner.event({ event: 'rung-start', rung: 'R4', commit: state.head });
  runner.save();
  try {
    const result = await hook({
      repo: state.repo, environment: state.environment, packageRoot: state.packageRoot, moduleRoot: state.moduleRoot, planFile: runner.planFile,
      workDir: runner.directory.workDir('boundaries'), log: runner.log,
    });
    runner.directory.writeJson('boundaries/report.json', result.report);
    const vacuous = result.antiVacuity.filter((entry) => !entry.fired);
    if (vacuous.length || !result.antiVacuity.length) {
      rung.status = 'failed';
      rung.note = vacuous.length ? `anti-vacuity: ${vacuous.map((entry) => `${entry.rule} never fired (${entry.detail})`).join('; ')}` : 'anti-vacuity: no rule was checked';
      addFinding(runner, { kind: 'vacuous-boundary-rule', rung: 'R4', files: [], detail: rung.note });
      failRun(runner, 'verdict', `R4 fails: ${rung.note}`);
      return;
    }
    for (const [file, content] of result.files) {
      fs.mkdirSync(path.dirname(path.join(state.repo, file)), { recursive: true });
      fs.writeFileSync(path.join(state.repo, file), content);
    }
    git(state.repo, ['add', '--', ...result.files.keys()]);
    // An earlier attempt whose certificate had no verdict left its step running: this attempt is its next.
    const earlier = state.steps.find((candidate) => candidate.rung === 'R4' && candidate.status === 'running');
    const step: StepRecord = earlier ?? {
      index: Math.max(0, ...state.steps.map((candidate) => candidate.index)) + 1, rung: 'R4', group: 'boundaries', moves: {}, entries: [], status: 'running', round: 1,
      attempts: [], durationMs: 0,
    };
    if (!earlier) state.steps.push(step);
    const messageInput = {
      scope: scopeOf(state.repo, state.packageRoot), packageRoot: state.packageRoot, rung: 'R4' as const, index: step.index, group: step.group, moves: new Map<string, string>(),
      planSha256: state.plan.sha256, counts: { filesMoved: 0, specifierEdits: 0, filesEdited: 0 }, pinned: [], replans: 0, added: [...result.files.keys()], summary: result.summary,
    };
    const attempt: AttemptRecord = {
      attempt: step.attempts.length + 1, round: 1, state: 'executing', parent: rung.start, moves: 0, offending: [], pinned: [], detail: result.summary, startedAt: new Date().toISOString(),
      durationMs: 0, timings: {},
    };
    step.attempts.push(attempt);
    let phase = performance.now();
    attempt.commit = commitStaged(state.repo, stepMessage(messageInput));
    attempt.timings.commitMs = elapsed(phase);
    attempt.state = 'certifying';
    runner.event({ event: 'commit', rung: 'R4', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.commitMs, commit: attempt.commit });
    runner.save();
    phase = performance.now();
    const certificate = await certifyRange(runner, rung.start, attempt.commit, 'rung-R4', { oracles: true });
    attempt.timings.certifyMs = elapsed(phase);
    state.timeline.rungCertificationMs += attempt.timings.certifyMs;
    rung.certificate = { ...storeCertificate(runner, 'rungs/R4', certificate), partial: false };
    attempt.certificate = rung.certificate;
    runner.event({ event: 'rung-certify', rung: 'R4', durationMs: attempt.timings.certifyMs, verdict: certificate.verdict, scope: certificate.scope, failing: failingChecks(certificate), partial: false });
    if (certificate.verdict === 'pass') {
      const amended = amendMessage(state.repo, stepMessage(messageInput, trailers(certificate)));
      attempt.state = 'passed';
      Object.assign(step, { status: 'certified', commit: amended, tree: treeOf(state.repo, amended), parent: rung.start, certificate: rung.certificate, pathMap: certificate.pathMap.entries });
      state.head = amended;
      rung.end = amended;
      rung.status = 'certified';
    } else if (withoutVerdict(certificate)) {
      // No evidence either way: the commit is rolled back and R4 starts over on --resume, as this step's next attempt.
      attempt.state = 'interrupted';
      rung.status = 'pending';
      failRun(runner, 'crash', `R4's certificate has no verdict: ${failingChecks(certificate).join(', ')} errored and no check failed; --resume generates and certifies the rules again: ${certificateOffenders(certificate).detail}`);
      runner.save();
      resetHard(state.repo, rung.start);
    } else {
      attempt.state = 'failed';
      step.status = 'pinned';
      rung.status = 'failed';
      failRun(runner, 'verdict', `R4's certificate FAILs (${failingChecks(certificate).join(', ')}): ${certificateOffenders(certificate).detail}`);
      // State first, then the branch: a crash in between leaves the verdict on record.
      runner.save();
      resetHard(state.repo, rung.start);
    }
    attempt.durationMs = elapsed(started);
  } finally {
    rung.durationMs += elapsed(started);
    runner.save();
  }
}

/** The whole PR, run base..final commit with the oracles; the last rung's certificate when it covers the same range. */
export async function certifyRun(runner: Runner): Promise<void> {
  const { state } = runner;
  if (state.head === state.base) return;
  const same = state.rungs.find((rung) => rung.certificate && !rung.certificate.partial && rung.start === state.base && rung.end === state.head);
  const started = performance.now();
  let record: CertificateRecord;
  let noVerdict = false;
  if (same?.certificate) {
    const target = runner.directory.certificateFile('certificate');
    for (const extension of ['.json', '.txt']) fs.copyFileSync(runner.directory.path(same.certificate.file.replace(/\.json$/, extension)), runner.directory.path(`${target}${extension}`));
    const { partial: _partial, ...certificate } = same.certificate;
    record = { ...certificate, file: `${target}.json` };
  } else {
    runner.log(`run: full certificate of ${state.base.slice(0, 10)}..${state.head.slice(0, 10)}`);
    const certificate = await certifyRange(runner, state.base, state.head, 'run', { oracles: true });
    noVerdict = withoutVerdict(certificate);
    record = storeCertificate(runner, 'certificate', certificate);
  }
  state.certificate = record;
  state.timeline.runCertificationMs += elapsed(started);
  if (noVerdict) failRun(runner, 'crash', `the whole-PR certificate has no verdict: ${record.failing.join(', ')} errored and no check failed; --resume certifies the PR again: see ${record.file}`);
  else if (record.verdict === 'fail') failRun(runner, 'verdict', `the whole-PR certificate FAILs (${record.failing.join(', ')}): see ${record.file}`);
  runner.event({ event: 'run-certify', durationMs: elapsed(started), verdict: record.verdict, failing: record.failing, reused: same?.id ?? null });
}

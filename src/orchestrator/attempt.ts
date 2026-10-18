// One step's attempts (plan §3.2 agent loop): move, commit, certify statically against the parent; on PASS the
// certificate trailers, on a decline or a FAIL a rollback and a replan that pins the offending plan entries, at most
// twice, else the whole step. Every pin is a finding.
import fs from 'node:fs';
import { analyzeRepo } from '../analyzer/analyze.js';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import type { Analysis } from '../analyzer/types.js';
import { trailers } from '../certificate/report.js';
import type { Certificate } from '../certificate/types.js';
import type { MoveResult } from '../executor/execute.js';
import { type MessageInput, scopeOf, stepMessage } from './commit-message.js';
import { buildFault } from './fault.js';
import { amendMessage, commitStaged, headCommit, resetHard } from './git.js';
import { addFinding, certificateName, certifyRange, elapsed, failingChecks, failRun, padded, type Runner, staticCheckIds, storeCertificate, withoutVerdict } from './runner.js';
import { attributeOffenders, effectiveMoves, type Offender } from './steps.js';
import type { AttemptRecord, StepRecord } from './types.js';

/** What an executor failure names, files at the parent's paths. */
function executorOffenders(result: MoveResult): { offenders: Offender[]; detail: string } {
  const inverse = new Map([...result.moves].map(([from, to]) => [to, from]));
  const atParent = (file: string) => inverse.get(file) ?? file;
  if (result.outcome === 'declined') {
    return {
      offenders: result.declines.map((decline) => ({ file: atParent(decline.file), detail: decline.detail })),
      detail: result.declines.slice(0, 5).map((decline) => `${decline.code} ${decline.file}: ${decline.detail}`).join('; '),
    };
  }
  if (result.outcome === 'unverified') {
    return {
      offenders: result.violations.map((violation) => ({ file: atParent(violation.file), detail: violation.detail })),
      detail: result.violations.slice(0, 5).map((violation) => `${violation.file}: ${violation.detail}`).join('; '),
    };
  }
  return { offenders: [], detail: '' };
}

/** What a failed certificate's violations name, files mapped back to the base through its pathMap. */
export function certificateOffenders(certificate: Certificate): { offenders: Offender[]; detail: string } {
  const inverse = new Map(Object.entries(certificate.pathMap.entries).map(([from, to]) => [to, from]));
  const failing = certificate.checks.filter((check) => check.status === 'fail' || check.status === 'error');
  const offenders = failing.flatMap((check) => check.violations.map((violation) => ({ ...(violation.file ? { file: inverse.get(violation.file) ?? violation.file } : {}), detail: violation.detail })));
  const detail = failing.map((check) => `${check.id} ${check.violations.slice(0, 3).map((violation) => `${violation.file ? `${violation.file}: ` : ''}${violation.detail.split('\n')[0]}`).join('; ')}`).join('; ');
  return { offenders, detail };
}

function pinFiles(runner: Runner, step: StepRecord, files: string[], reason: string, detail: string): void {
  const pinned = new Set(runner.state.pins.map((pin) => pin.file));
  const added = files.filter((file) => !pinned.has(file));
  for (const file of added) runner.state.pins.push({ file, step: step.index, group: step.group, reason });
  addFinding(runner, { kind: reason, step: step.index, rung: step.rung, files: added, detail });
  runner.event({ event: 'pin', step: step.index, group: step.group, rung: step.rung, files: added, reason, detail });
}

/** Pins every file the step still moves: after two replans, or when a failure names no file of the step. */
export function pinWholeStep(runner: Runner, step: StepRecord, reason: string, detail: string): void {
  const pinned = new Set(runner.state.pins.map((pin) => pin.file));
  pinFiles(runner, step, Object.keys(step.moves).filter((file) => !pinned.has(file)), reason, detail);
  step.status = 'pinned';
}

/**
 * After a failed attempt: replan by pinning the entries of the offending files (at most twice per round), else pin
 * the whole step. Returns true when the step should be attempted again.
 */
function replan(runner: Runner, step: StepRecord, attempt: AttemptRecord, offenders: Offender[], detail: string, effective: Map<string, string>, analysis: () => Analysis): boolean {
  attempt.offending = [...new Set(offenders.flatMap((offender) => (offender.file ? [offender.file] : [])))].sort();
  const failures = step.attempts.filter((candidate) => candidate.round === attempt.round && candidate.state !== 'interrupted' && candidate.state !== 'passed').length;
  if (failures > 2) {
    pinWholeStep(runner, step, 'step-pinned', `still failing after 2 replans: ${detail}`);
    attempt.pinned = Object.keys(step.moves).filter((file) => effective.has(file));
    return false;
  }
  const tracked = new Set(gitRepoFs(runner.state.repo).tracked());
  const { entries, unattributed } = attributeOffenders(step, effective, offenders, tracked, analysis);
  if (!entries.length) {
    pinWholeStep(runner, step, 'step-pinned', `the failure names no file the step moves${unattributed.length ? ` (${unattributed.slice(0, 5).join(', ')})` : ''}: ${detail}`);
    attempt.pinned = [...effective.keys()];
    return false;
  }
  const files = entries.flat();
  pinFiles(runner, step, files, 'pinned', `attempt ${attempt.attempt} (${attempt.state}): ${detail}`);
  attempt.pinned = files;
  return true;
}

/** A step's attempt that reached a commit, not yet certified. */
export interface Committed {
  step: StepRecord;
  attempt: AttemptRecord;
  attemptStarted: number;
  parent: string;
  commit: string;
  effective: Map<string, string>;
  messageInput: MessageInput;
  result: Extract<MoveResult, { outcome: 'applied' | 'verified' }>;
  analysis: () => Analysis;
}

export function finishAttempt(attempt: AttemptRecord, attemptStarted: number, outcome: AttemptRecord['state']): void {
  attempt.state = outcome;
  attempt.durationMs = elapsed(attemptStarted);
}

/** The executor's view of the repo at its current HEAD, computed once and only when a failure needs attributing. */
function lazyAnalysis(repo: string): () => Analysis {
  let analysis: Analysis | undefined;
  return () => (analysis ??= analyzeRepo(gitRepoFs(repo)));
}

/** The seeded wrong move (--inject-fault) replaces the step's first committed attempt. */
function injectFault(runner: Runner, committed: Committed): void {
  const { state } = runner;
  const { step, attempt } = committed;
  const fault = state.fault;
  if (!fault || fault.appliedTo !== undefined || fault.notApplied || (fault.step !== String(step.index) && fault.step !== step.group)) return;
  const started = performance.now();
  const work = `fault-${padded(step.index)}`;
  const built = buildFault({
    repo: state.repo, environment: state.environment, packageRoot: state.packageRoot, profile: state.profile, parent: committed.parent, commit: committed.commit,
    operator: fault.operator, message: stepMessage(committed.messageInput), workDir: runner.directory.workDir(work),
  });
  fs.rmSync(runner.directory.path('work', work), { recursive: true, force: true });
  attempt.timings.faultMs = elapsed(started);
  if ('mutant' in built) {
    resetHard(state.repo, built.mutant);
    committed.commit = built.mutant;
    attempt.commit = built.mutant;
    Object.assign(fault, { appliedTo: step.index, description: built.description, mutantCommit: built.mutant });
    attempt.injectedFault = { operator: fault.operator, description: built.description };
    addFinding(runner, { kind: 'injected-fault', step: step.index, rung: step.rung, files: [], detail: `seeded wrong move (--inject-fault): ${built.description}` });
  } else {
    fault.notApplied = built.notApplied;
    addFinding(runner, { kind: 'fault-not-applied', step: step.index, rung: step.rung, files: [], detail: built.notApplied });
  }
  runner.event({ event: 'fault', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.faultMs, operator: fault.operator, applied: 'mutant' in built, detail: 'mutant' in built ? built.description : built.notApplied });
  runner.save();
}

/**
 * A decline, an unverified move or an executor crash on a speculative parent (--jobs: a commit not yet certified) may
 * hold only on that tree: nothing is pinned or counted as a replan, and the step waits for certified ground.
 */
function park(runner: Runner, attempt: AttemptRecord, attemptStarted: number): 'parked' {
  attempt.detail = `${attempt.detail}; on an uncertified parent, so nothing is pinned: the step runs again once the certifications in flight conclude`;
  finishAttempt(attempt, attemptStarted, 'interrupted');
  runner.save();
  return 'parked';
}

/**
 * Attempts the step on top of HEAD until an attempt commits (executor declines are replanned in place). Null when the
 * step ends without a commit: skipped (nothing left to move) or pinned. 'parked' when HEAD is `speculative` and the
 * executor failed there (park).
 */
export function commitAttempt(runner: Runner, step: StepRecord, speculative?: false): Committed | null;
export function commitAttempt(runner: Runner, step: StepRecord, speculative: boolean): Committed | null | 'parked';
export function commitAttempt(runner: Runner, step: StepRecord, speculative = false): Committed | null | 'parked' {
  const { state } = runner;
  const repo = state.repo;
  for (;;) {
    const effective = effectiveMoves(step, new Set(state.pins.map((pin) => pin.file)));
    if (!effective.size) {
      step.status = 'skipped';
      addFinding(runner, { kind: 'step-skipped', step: step.index, rung: step.rung, files: [], detail: `every file of ${step.group} is pinned: nothing left to move` });
      return null;
    }
    const parent = headCommit(repo);
    const attempt: AttemptRecord = {
      attempt: step.attempts.length + 1, round: step.round, state: 'executing', parent, moves: effective.size, offending: [], pinned: [], detail: '',
      startedAt: new Date().toISOString(), durationMs: 0, timings: {},
    };
    step.attempts.push(attempt);
    runner.save();
    const attemptStarted = performance.now();
    const analysis = lazyAnalysis(repo);
    let started = performance.now();
    let result: MoveResult;
    try {
      result = runner.dependencies.executeMove(gitRepoFs(repo), effective);
    } catch (error) {
      resetHard(repo, parent);
      attempt.timings.moveMs = elapsed(started);
      attempt.detail = `executor crashed: ${(error as Error).message}`;
      runner.event({ event: 'move', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.moveMs, outcome: 'error', detail: attempt.detail });
      if (speculative) return park(runner, attempt, attemptStarted);
      finishAttempt(attempt, attemptStarted, 'error');
      pinWholeStep(runner, step, 'executor-error', attempt.detail);
      attempt.pinned = [...effective.keys()];
      return null;
    }
    attempt.timings.moveMs = elapsed(started);
    runner.event({ event: 'move', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.moveMs, outcome: result.outcome, moves: result.moves.size });
    if (result.outcome === 'declined' || result.outcome === 'unverified') {
      const { offenders, detail } = executorOffenders(result);
      attempt.detail = `${result.outcome}: ${detail}`;
      if (speculative) return park(runner, attempt, attemptStarted);
      finishAttempt(attempt, attemptStarted, result.outcome);
      if (!replan(runner, step, attempt, offenders, attempt.detail, effective, analysis)) return null;
      runner.save();
      continue;
    }
    if (result.outcome !== 'applied') throw new Error(`executor returned ${result.outcome} outside a dry run`);
    const messageInput: MessageInput = {
      scope: scopeOf(repo, state.packageRoot), packageRoot: state.packageRoot, rung: step.rung, index: step.index, group: step.group, moves: effective,
      planSha256: state.plan.sha256,
      counts: { filesMoved: result.moves.size, specifierEdits: result.edits.length, filesEdited: new Set(result.edits.map((edit) => edit.file)).size },
      pinned: state.pins.filter((pin) => pin.step === step.index).map((pin) => pin.file),
      replans: step.attempts.filter((candidate) => candidate.round === step.round && candidate !== attempt && candidate.state !== 'interrupted').length,
    };
    started = performance.now();
    const commit = commitStaged(repo, stepMessage(messageInput));
    attempt.timings.commitMs = elapsed(started);
    attempt.commit = commit;
    finishAttempt(attempt, attemptStarted, 'committed');
    runner.event({ event: 'commit', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.commitMs, commit });
    runner.save();
    const committed: Committed = { step, attempt, attemptStarted, parent, commit, effective, messageInput, result, analysis };
    injectFault(runner, committed);
    return committed;
  }
}

/** The static certificate of a committed attempt (parent..commit, every check but the oracles). */
export async function certifyAttempt(runner: Runner, committed: Committed): Promise<Certificate> {
  const { step, attempt } = committed;
  finishAttempt(attempt, committed.attemptStarted, 'certifying');
  runner.save();
  const started = performance.now();
  const certificate = await certifyRange(runner, committed.parent, committed.commit, `step-${padded(step.index)}-${attempt.attempt}`, { only: staticCheckIds(), oracles: false });
  attempt.timings.certifyMs = elapsed(started);
  runner.event({ event: 'certify', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.certifyMs, verdict: certificate.verdict, scope: certificate.scope, failing: failingChecks(certificate) });
  return certificate;
}

/**
 * A PASS is recorded, its trailers amended onto the commit now, or (`amend` false, certification pipelined) left to
 * the rewrite pass. A FAIL is rolled back and replanned: 'retry' when the step should be attempted again.
 */
export function concludeAttempt(runner: Runner, committed: Committed, certificate: Certificate, amend: boolean): 'done' | 'retry' {
  const { state } = runner;
  const { step, attempt } = committed;
  if (certificate.verdict === 'pass') {
    attempt.certificate = storeCertificate(runner, `certificates/${certificateName(step)}`, certificate);
    let commit = committed.commit;
    if (amend) {
      const started = performance.now();
      commit = amendMessage(state.repo, stepMessage(committed.messageInput, trailers(certificate)));
      attempt.timings.amendMs = elapsed(started);
      runner.event({ event: 'amend', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.amendMs, commit });
    } else step.pendingTrailers = trailers(certificate);
    finishAttempt(attempt, committed.attemptStarted, 'passed');
    for (const finding of committed.result.findings) addFinding(runner, { kind: finding.kind, step: step.index, rung: step.rung, files: finding.file ? [finding.file] : [], detail: finding.detail });
    Object.assign(step, {
      status: 'certified', commit, tree: certificate.headTree, parent: committed.parent, certificate: attempt.certificate, counts: committed.messageInput.counts,
      pathMap: certificate.pathMap.entries,
    });
    state.head = commit;
    return 'done';
  }
  attempt.certificate = storeCertificate(runner, `certificates/failed/${certificateName(step)}-attempt${attempt.attempt}`, certificate);
  const started = performance.now();
  resetHard(state.repo, committed.parent);
  attempt.timings.rollbackMs = elapsed(started);
  runner.event({ event: 'rollback', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.rollbackMs, to: committed.parent });
  const { offenders, detail } = certificateOffenders(certificate);
  attempt.detail = `certificate FAIL (${failingChecks(certificate).join(', ')}): ${detail}`;
  // A check that crashed gives no evidence about the step: stop (--resume retries it) rather than pin what may be fine.
  // An errored check that lists a violation does: the step is replanned as on a fail.
  if (withoutVerdict(certificate)) {
    finishAttempt(attempt, committed.attemptStarted, 'interrupted');
    failRun(runner, 'crash', `the certifier crashed on step ${step.index} (${failingChecks(certificate).join(', ')}): ${detail}`);
    return 'done';
  }
  finishAttempt(attempt, committed.attemptStarted, 'failed');
  return replan(runner, step, attempt, offenders, attempt.detail, committed.effective, committed.analysis) ? 'retry' : 'done';
}

export function beginStep(runner: Runner, step: StepRecord): number {
  step.status = 'running';
  runner.event({ event: 'step-start', step: step.index, group: step.group, rung: step.rung });
  runner.log(`step ${step.index} ${step.rung} ${step.group}`);
  return performance.now();
}

export function endStep(runner: Runner, step: StepRecord, started: number): void {
  step.durationMs += elapsed(started);
  runner.stepsThisInvocation++;
  runner.event({ event: 'step-end', step: step.index, group: step.group, rung: step.rung, durationMs: elapsed(started), status: step.status, commit: step.commit });
  runner.save();
}

/** One step at a time: move, commit, certify, amend the trailers (or roll back and replan). */
export async function processStep(runner: Runner, step: StepRecord): Promise<void> {
  const started = beginStep(runner, step);
  for (;;) {
    const committed = commitAttempt(runner, step);
    if (!committed) break;
    if (concludeAttempt(runner, committed, await certifyAttempt(runner, committed), true) === 'done') break;
    runner.save();
  }
  endStep(runner, step, started);
}

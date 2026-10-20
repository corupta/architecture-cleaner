// S3 (plan §2.3, off unless --rungs names it): after R3, one step that re-wraps the import lines the run's moves
// lengthened (src/rewrap: the target's prettier, touched declarations whose base counterparts were prettier-stable),
// committed and certified statically like every step (K2 accepts it as layout only, or the step is rolled back and
// pinned), then certified as a rung with the oracles. Every declaration it leaves alone is a finding with its reason.
import fs from 'node:fs';
import path from 'node:path';
import { trailers } from '../certificate/report.js';
import { rewrapSummary } from '../rewrap/rewrap.js';
import { beginStep, certificateOffenders, endStep, finishAttempt } from './attempt.js';
import { type MessageInput, scopeOf, stepMessage } from './commit-message.js';
import { amendMessage, commitStaged, git, headCommit, resetHard } from './git.js';
import { addFinding, certificateName, certifyRange, elapsed, failingChecks, failRun, padded, type Runner, staticCheckIds, storeCertificate, withoutVerdict } from './runner.js';
import { certifyRung } from './rungs.js';
import type { AttemptRecord, RungRecord, StepRecord } from './types.js';

/** The re-wrap step: computed on the branch's head, committed, certified against its parent. */
async function rewrapStep(runner: Runner, step: StepRecord): Promise<void> {
  const { state } = runner;
  const started = beginStep(runner, step);
  const parent = headCommit(state.repo);
  const attempt: AttemptRecord = {
    attempt: step.attempts.length + 1, round: step.round, state: 'executing', parent, moves: 0, offending: [], pinned: [], detail: '', startedAt: new Date().toISOString(), durationMs: 0, timings: {},
  };
  step.attempts.push(attempt);
  runner.save();
  const attemptStarted = performance.now();
  try {
    let phase = performance.now();
    let plan;
    try {
      // The branch's checkout is head (clean): the files' prettier configs are read there.
      plan = await runner.dependencies.rewrap({ repo: state.repo, base: state.base, head: parent, checkout: state.repo, environment: state.environment, packageRoot: state.packageRoot });
    } catch (error) {
      attempt.detail = `the re-wrap crashed: ${(error as Error).message}`;
      finishAttempt(attempt, attemptStarted, 'error');
      step.status = 'pinned';
      addFinding(runner, { kind: 'rewrap-error', step: step.index, rung: 'S3', files: [], detail: attempt.detail });
      return;
    }
    attempt.timings.moveMs = elapsed(phase);
    for (const skip of plan.skips) addFinding(runner, { kind: 'rewrap-skipped', step: step.index, rung: 'S3', files: [skip.file], detail: `${skip.line ? `line ${skip.line}: ` : ''}${skip.reason}` });
    runner.event({ event: 'move', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.moveMs, outcome: plan.files.size ? 'applied' : 'nothing', files: plan.files.size, declarations: plan.declarations.length, skips: plan.skips.length });
    if (!plan.files.size) {
      attempt.detail = `no import line needs a re-wrap (${plan.examined} changed source files examined, ${plan.skips.length} skipped)`;
      finishAttempt(attempt, attemptStarted, 'declined');
      step.status = 'skipped';
      addFinding(runner, { kind: 'step-skipped', step: step.index, rung: 'S3', files: [], detail: attempt.detail });
      return;
    }
    for (const [file, text] of plan.files) fs.writeFileSync(path.join(state.repo, file), text);
    git(state.repo, ['add', '--', ...plan.files.keys()]);
    const messageInput: MessageInput = {
      scope: scopeOf(state.repo, state.packageRoot), packageRoot: state.packageRoot, rung: 'S3', index: step.index, group: step.group, moves: new Map(), planSha256: state.plan.sha256,
      counts: { filesMoved: 0, specifierEdits: 0, filesEdited: plan.files.size }, pinned: [], replans: 0, summary: rewrapSummary(plan),
    };
    phase = performance.now();
    attempt.commit = commitStaged(state.repo, stepMessage(messageInput));
    attempt.timings.commitMs = elapsed(phase);
    finishAttempt(attempt, attemptStarted, 'certifying');
    runner.event({ event: 'commit', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.commitMs, commit: attempt.commit });
    runner.save();
    phase = performance.now();
    const certificate = await certifyRange(runner, parent, attempt.commit, `step-${padded(step.index)}-${attempt.attempt}`, { only: staticCheckIds(), oracles: false });
    attempt.timings.certifyMs = elapsed(phase);
    runner.event({ event: 'certify', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.certifyMs, verdict: certificate.verdict, scope: certificate.scope, failing: failingChecks(certificate) });
    if (certificate.verdict === 'pass') {
      attempt.certificate = storeCertificate(runner, `certificates/${certificateName(step)}`, certificate);
      phase = performance.now();
      const commit = amendMessage(state.repo, stepMessage(messageInput, trailers(certificate)));
      attempt.timings.amendMs = elapsed(phase);
      runner.event({ event: 'amend', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.amendMs, commit });
      finishAttempt(attempt, attemptStarted, 'passed');
      Object.assign(step, { status: 'certified', commit, tree: certificate.headTree, parent, certificate: attempt.certificate, counts: messageInput.counts, pathMap: certificate.pathMap.entries });
      state.head = commit;
      return;
    }
    attempt.certificate = storeCertificate(runner, `certificates/failed/${certificateName(step)}-attempt${attempt.attempt}`, certificate);
    phase = performance.now();
    resetHard(state.repo, parent);
    attempt.timings.rollbackMs = elapsed(phase);
    runner.event({ event: 'rollback', step: step.index, attempt: attempt.attempt, durationMs: attempt.timings.rollbackMs, to: parent });
    const { detail } = certificateOffenders(certificate);
    attempt.detail = `certificate FAIL (${failingChecks(certificate).join(', ')}): ${detail}`;
    // No evidence either way (every non-passing check errored): --resume re-wraps and certifies again.
    if (withoutVerdict(certificate)) {
      finishAttempt(attempt, attemptStarted, 'interrupted');
      failRun(runner, 'crash', `the certifier crashed on step ${step.index} (${failingChecks(certificate).join(', ')}): ${detail}`);
      return;
    }
    finishAttempt(attempt, attemptStarted, 'failed');
    step.status = 'pinned';
    addFinding(runner, { kind: 'rewrap-rejected', step: step.index, rung: 'S3', files: [...plan.files.keys()], detail: `the re-wrap was rolled back: ${attempt.detail}` });
  } finally {
    endStep(runner, step, started);
  }
}

/** S3: its one step (unless it already ran), then the rung's full certificate; a K8 bisect pins the step. */
export async function runRewrapRung(runner: Runner, rung: RungRecord): Promise<'stopped' | 'done'> {
  const { state } = runner;
  if (rung.status === 'pending') {
    rung.status = 'running';
    rung.start = state.head;
    runner.event({ event: 'rung-start', rung: 'S3', commit: state.head });
    runner.save();
  }
  const started = performance.now();
  try {
    let step = state.steps.find((candidate) => candidate.rung === 'S3');
    if (!step) {
      step = { index: Math.max(0, ...state.steps.map((candidate) => candidate.index)) + 1, rung: 'S3', group: 'rewrap', moves: {}, entries: [], status: 'pending', round: 1, attempts: [], durationMs: 0 };
      state.steps.push(step);
      runner.save();
    }
    if (step.status === 'pending' || step.status === 'running') {
      if (runner.maxSteps !== null && runner.stepsThisInvocation >= runner.maxSteps) return 'stopped';
      await rewrapStep(runner, step);
      if (state.status !== 'running') return 'done';
    }
    for (;;) {
      const outcome = await certifyRung(runner, rung, false);
      // A bisect pinned the step and rolled it back: the rung certifies as empty next.
      if (outcome === 'bisected') continue;
      if (outcome !== 'no-evidence') rung.status = outcome === 'certified' ? 'certified' : outcome === 'empty' ? 'skipped' : 'failed';
      return 'done';
    }
  } finally {
    rung.durationMs += elapsed(started);
    runner.save();
  }
}

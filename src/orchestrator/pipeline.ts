// How a rung's steps run: one at a time, or (--jobs n) pipelined, executing ahead of their certificates, with the
// trailers written afterwards by one message-only rewrite pass.
import type { Certificate } from '../certificate/types.js';
import { beginStep, certifyAttempt, type Committed, commitAttempt, concludeAttempt, endStep, finishAttempt, processStep } from './attempt.js';
import { commitMessage, git, resetHard } from './git.js';
import { elapsed, type Runner } from './runner.js';
import type { StepRecord } from './types.js';

/** True when --max-steps stops the run here. */
const stopsHere = (runner: Runner) => runner.maxSteps !== null && runner.stepsThisInvocation >= runner.maxSteps;

/** Steps one at a time. True when --max-steps stops the run. */
export async function runSequential(runner: Runner, steps: StepRecord[]): Promise<boolean> {
  for (const step of steps) {
    if (stopsHere(runner)) return true;
    await processStep(runner, step);
    if (runner.state.status !== 'running') return false;
  }
  return false;
}

type Settled = { certificate: Certificate } | { error: unknown };

/**
 * --jobs n: steps execute ahead of their certificates, with up to n certifications in flight (the certifier's runner
 * and runtime probes are child processes, so they overlap the next moves). Certificates are concluded in commit order;
 * a FAIL rolls back to the failing step's parent, which discards the speculative commits after it, and those steps
 * run again. A step the executor fails on a speculative parent is parked: it pins nothing and waits at the queue's
 * head until no certification is in flight. Trailers are written afterwards by one message-only rewrite pass. True
 * when --max-steps stops the run.
 */
export async function runPipelined(runner: Runner, steps: StepRecord[]): Promise<boolean> {
  const { state } = runner;
  const queue = [...steps];
  const inFlight: { committed: Committed; settled: Promise<Settled> }[] = [];
  const startedAt = new Map<StepRecord, number>();
  let stopped = false;
  let parked = false;
  for (;;) {
    while (!parked && inFlight.length < state.options.jobs && queue.length && state.status === 'running') {
      if (runner.maxSteps !== null && runner.stepsThisInvocation + inFlight.length >= runner.maxSteps) {
        stopped = true;
        break;
      }
      const step = queue[0]!;
      if (!startedAt.has(step)) startedAt.set(step, beginStep(runner, step));
      const committed = commitAttempt(runner, step, inFlight.length > 0);
      if (committed === 'parked') {
        parked = true;
        break;
      }
      queue.shift();
      if (committed) inFlight.push({ committed, settled: certifyAttempt(runner, committed).then((certificate) => ({ certificate }), (error: unknown) => ({ error })) });
      else endStep(runner, step, startedAt.get(step)!);
    }
    const next = inFlight.shift();
    if (!next) return stopped;
    const settled = await next.settled;
    if ('error' in settled) {
      // Let the other certifications finish (and remove their worktrees) before the run stops.
      await Promise.all(inFlight.map((other) => other.settled));
      throw settled.error;
    }
    const { step } = next.committed;
    const outcome = concludeAttempt(runner, next.committed, settled.certificate, false);
    if (settled.certificate.verdict === 'fail') {
      // The rollback discarded every later speculative commit: their certificates are moot, their steps run again.
      for (const discarded of inFlight.splice(0)) {
        await discarded.settled;
        finishAttempt(discarded.committed.attempt, discarded.committed.attemptStarted, 'interrupted');
        discarded.committed.attempt.detail = `discarded: step ${step.index}, committed before it, failed certification`;
        queue.unshift(discarded.committed.step);
      }
      queue.sort((a, b) => a.index - b.index);
    }
    if (outcome === 'retry') queue.unshift(step);
    else endStep(runner, step, startedAt.get(step)!);
    if (!inFlight.length) parked = false;
    runner.save();
    if (state.status !== 'running') return false;
  }
}

/** The author of a commit, to keep it through a rewrite. */
function authorOf(repo: string, commit: string): NodeJS.ProcessEnv {
  const [name, email, date] = git(repo, ['log', '-1', '--format=%an%x00%ae%x00%aI', commit]).trim().split('\0') as [string, string, string];
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date };
}

/**
 * One message-only rewrite pass: every certified step whose trailers are pending gets them, and the commits after the
 * first such step are re-parented. Trees are unchanged, so every certificate (about trees, contract C1) still holds.
 */
export function writePendingTrailers(runner: Runner): void {
  const { state } = runner;
  const chain = state.steps.filter((step) => step.status === 'certified').sort((a, b) => a.index - b.index);
  const first = chain.findIndex((step) => step.pendingTrailers);
  if (first < 0) return;
  const started = performance.now();
  let parent = chain[first]!.parent!;
  for (const step of chain.slice(first)) {
    const message = commitMessage(state.repo, step.commit!).trimEnd();
    const full = step.pendingTrailers ? `${message}\n\n${step.pendingTrailers.join('\n')}\n` : `${message}\n`;
    const commit = git(state.repo, ['commit-tree', step.tree!, '-p', parent, '-F', '-'], full, authorOf(state.repo, step.commit!)).trim();
    Object.assign(step, { commit, parent });
    delete step.pendingTrailers;
    parent = commit;
  }
  state.head = parent;
  // State first: a crash before the reset leaves HEAD a message-only rewrite away, which --resume recognizes.
  runner.save();
  resetHard(state.repo, parent);
  runner.event({ event: 'amend', durationMs: elapsed(started), commit: parent, detail: `trailers written to ${chain.length - first} commits in one rewrite pass` });
}

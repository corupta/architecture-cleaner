// `ac demo --full`: the whole ladder with `ac run` on the demo's clone, the plan replayed from the cassette: the
// preflight and baseline, every step certified, each rung and the whole PR certified with the oracles, the findings
// log with its narration replayed. About 2 h on immich; it needs an environment with the target's node_modules.
// Every step's tree and the whole-PR digest are compared with the recorded run's.
import path from 'node:path';
import { loadProfile } from '../certificate/profile.js';
import { runFindings } from '../findings/index.js';
import { branchExists, git } from '../orchestrator/git.js';
import { planInProcess } from '../orchestrator/plan-source.js';
import { readRunState } from '../orchestrator/run-directory.js';
import { rungIds, type StepRecord } from '../orchestrator/types.js';
import { startRun } from '../orchestrator/run.js';
import { prepareCheckout } from './checkout.js';
import type { CertifiedEntry, DemoReport, ModelCall, StepEntry } from './report.js';
import { countingGateway, notRerun, openWorkDir, replayGateway, type DemoOptions, type DemoResult } from './replay.js';
import { compareChecks, readCertificate } from './sample.js';

export const fullBranch = 'ac-demo/full';

/** A run's step as the demo reports it. */
function entryOf(step: StepRecord, recorded: StepRecord | undefined): StepEntry {
  const last = step.attempts.at(-1);
  return {
    index: step.index, rung: step.rung, group: step.group, moves: Object.keys(step.moves).length,
    outcome: step.status === 'certified' ? 'committed' : step.status === 'pinned' || step.status === 'skipped' ? 'declined' : 'error',
    parent: step.parent ?? last?.parent ?? '', ...(step.commit ? { commit: step.commit } : {}), ...(step.tree ? { tree: step.tree } : {}), ...(step.counts ? { counts: step.counts } : {}),
    ...(step.status === 'certified' ? {} : { detail: `${step.status}${last?.detail ? `: ${last.detail}` : ''}` }),
    ...(recorded?.tree ? { recordedTree: recorded.tree } : {}), durationMs: step.durationMs,
  };
}

export async function fullDemo(options: DemoOptions & { environment: string }): Promise<DemoResult> {
  const started = performance.now();
  const { target, log } = options;
  const workDir = openWorkDir(options.workDir, target.name);
  const recordedState = readRunState(target.recordedRun);
  const profile = loadProfile(target.profile);
  const checkout = prepareCheckout({ directory: path.join(workDir, target.name), sha: target.sha, url: target.url, ...(options.repo ? { repo: options.repo } : {}), log });
  if (branchExists(checkout.directory, fullBranch)) git(checkout.directory, ['branch', '-q', '-D', fullBranch]);
  const environment = path.resolve(options.environment);

  const planCalls: ModelCall[] = [];
  const findingsCalls: ModelCall[] = [];
  const gateway = replayGateway(target.cassette, workDir)();
  log(`plan: replaying ${path.basename(target.cassette)} in-process, as \`ac run --cassette\` does`);
  const planned = await planInProcess({ repo: checkout.directory, profile, cassette: target.cassette, mode: 'replay', run: null, gateway: countingGateway(gateway, planCalls) });
  const runDirectory = path.join(workDir, 'run');
  const outcome = await startRun({
    repo: checkout.directory, environment, profile, plan: planned.plan, cost: planned.cost, runDirectory, branch: fullBranch, rungs: [...rungIds], maxSteps: options.steps,
    jobs: 1, injectFault: null, log: (message) => log(`run: ${message}`),
  }, {
    findings: async (directory) => {
      const { reportSection, document } = await runFindings({ runDirectory: directory, gateway: countingGateway(gateway, findingsCalls), log });
      return { section: reportSection, narration: document.narration && { costUsd: document.narration.costUsd, calls: document.narration.calls, replayed: document.narration.replayed } };
    },
  });
  const { state } = outcome;
  const recorded = new Map(recordedState.steps.map((step) => [step.index, step]));
  const steps = state.steps.filter((step) => step.status !== 'pending').map((step) => entryOf(step, recorded.get(step.index)));
  const certified: CertifiedEntry[] = [];
  if (state.certificate) {
    const certificate = readCertificate(path.join(runDirectory, state.certificate.file))!;
    const recordedCertificate = recordedState.certificate ? readCertificate(path.join(target.recordedRun, recordedState.certificate.file)) : null;
    certified.push({
      subject: 'whole PR', reason: 'with the oracles, as `ac run` certifies it', verdict: certificate.verdict, scope: certificate.scope, checks: compareChecks(certificate, recordedCertificate),
      digest: certificate.digest, recordedDigest: recordedCertificate?.digest ?? null, file: path.relative(workDir, path.join(runDirectory, state.certificate.file)), durationMs: state.timeline.runCertificationMs,
    });
  }
  const report: DemoReport = {
    mode: 'full',
    target: { name: target.name, sha: target.sha, packageRoot: state.packageRoot, checkout: checkout.directory, source: checkout.source, environment, branch: fullBranch },
    recorded: { directory: target.recordedRun, branch: recordedState.branch, steps: recordedState.steps.length, head: recordedState.head, wholePrDigest: recordedState.certificate?.digest ?? null },
    plan: {
      outcome: state.plan.sha256 === recordedState.plan.sha256 ? 'match' : 'mismatch', sha256: state.plan.sha256, recordedSha256: recordedState.plan.sha256,
      groups: new Set(state.steps.filter((step) => step.rung === 'R1' || step.rung === 'R2').map((step) => step.group)).size, steps: state.plan.steps, files: [], calls: planCalls,
      recordedCostUsd: state.cost.planRecordedUsd, directory: path.join(runDirectory, 'plan'),
    },
    steps,
    plannedSteps: recordedState.steps.filter((step) => step.rung !== 'R4').length,
    stoppedAfter: state.status === 'stopped' ? steps.at(-1)?.index ?? 0 : null,
    renames: null,
    boundaries: steps.find((step) => step.rung === 'R4') ?? null,
    certified,
    findings: { outcome: 'skipped', findings: 0, narrated: 0, calls: findingsCalls, files: [], detail: `in ${path.join(runDirectory, 'findings')} (they name this run's commits, so they aren't compared byte for byte)` },
    run: { status: state.status, ...(state.error ? { error: state.error } : {}) },
    spentUsd: 0,
    notRerun: notRerun(profile, recordedState, { environment, oracles: true }).filter((line) => !line.startsWith('**The run loop**')),
    workDir,
    durationMs: Math.round(performance.now() - started),
  };
  log(`run: ${state.status}; report ${path.join(runDirectory, 'report.md')}`);
  return { report, head: state.head };
}

// `ac demo --live`: Nemotron plans the target afresh on the caller's own Token Factory key (the Ultra edit of the seeds
// draft and its critic review, the latest critic prompt), under a demo budget run whose ledger and cassette live in the
// work dir and whose cap is $1; then the steps are executed and a sample certified. The key comes from NEBIUS_API_KEY in
// the environment only, set for this command: no .env file is read, so the key in this package's .env (ours, on our
// machine, charged to budget/ledger.jsonl) is never spent here by accident. No key in the environment, no call.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { nodeModulesAbove } from '../certificate/hermetic.js';
import { loadProfile } from '../certificate/profile.js';
import { createGateway } from '../gateway/gateway.js';
import type { Gateway } from '../gateway/types.js';
import { git, headCommit } from '../orchestrator/git.js';
import { readRunState } from '../orchestrator/run-directory.js';
import { staticCheckIds } from '../orchestrator/runner.js';
import { readPlanYaml } from '../planner/plan-file.js';
import { prepareCheckout } from './checkout.js';
import { executeLadder } from './ladder.js';
import type { DemoReport, ModelCall, PlanPhase } from './report.js';
import { notRerun, openWorkDir, planInto, type DemoOptions, type DemoResult } from './replay.js';
import { certifySample } from './sample.js';

export const liveBranch = 'ac-demo/live';
/** The demo's budget run and its cap in USD (the plan costs about $0.20; the gateway refuses a call that could cross it). */
export const liveBudget = { run: 'demo', capUsd: 1 };

/** NEBIUS_API_KEY from the environment: setting it is the explicit opt-in to spend on that key. */
export function liveKey(environment: NodeJS.ProcessEnv = process.env): string | null {
  return environment.NEBIUS_API_KEY?.trim() || null;
}

export interface LiveOptions extends DemoOptions {
  /** The caller's Token Factory key (liveKey()); live mode refuses to start without one. */
  key: string | null;
  /** The live gateway (default: Token Factory on `key`, in record mode, under the work dir's budget). */
  gateway?: (paths: { cassette: string; ledger: string; runs: string }) => Gateway;
}

export async function liveDemo(options: LiveOptions): Promise<DemoResult> {
  const started = performance.now();
  const { target, log, key } = options;
  if (!key) throw new Error('no NEBIUS_API_KEY in the environment: live mode runs only on your own Token Factory key, set for the command');
  const workDir = openWorkDir(options.workDir, target.name);
  const profile = loadProfile(target.profile);
  const checkout = prepareCheckout({ directory: path.join(workDir, target.name), sha: target.sha, url: target.url, ...(options.repo ? { repo: options.repo } : {}), log });
  git(checkout.directory, ['checkout', '-q', '-B', liveBranch, target.sha]);
  const environment = options.environment ? path.resolve(options.environment) : null;
  const environmentOrCheckout = environment ?? checkout.directory;

  const paths = { cassette: path.join(workDir, 'live-cassette.jsonl'), ledger: path.join(workDir, 'budget', 'ledger.jsonl'), runs: path.join(workDir, 'budget', 'runs.json') };
  fs.mkdirSync(path.dirname(paths.runs), { recursive: true });
  fs.writeFileSync(paths.runs, `${JSON.stringify({ _doc: 'ac demo --live: this demo\'s own caps in USD, on your key', globalCap: liveBudget.capUsd, runs: { [liveBudget.run]: { cap: liveBudget.capUsd } } }, null, 1)}\n`);
  const gateway = options.gateway?.(paths)
    ?? createGateway({ runId: liveBudget.run, mode: 'record', cassettePath: paths.cassette, ledgerPath: paths.ledger, runsPath: paths.runs, apiKey: key });

  log(`plan: asking Nemotron on your key (cap $${liveBudget.capUsd.toFixed(2)}, ledger ${paths.ledger})`);
  const calls: ModelCall[] = [];
  let plan: PlanPhase;
  let planText: string | null = null;
  try {
    const { run, outputs, directory } = await planInto(checkout.directory, profile, gateway, calls, 'record', workDir);
    planText = run.validation.valid ? outputs.get('plan.yaml')! : null;
    const recordedGroups = new Set(readPlanYaml(fs.readFileSync(path.join(target.recordedRun, readRunState(target.recordedRun).plan.file), 'utf8')).groups.keys());
    const groups = [...readPlanYaml(outputs.get('plan.yaml')!).groups.keys()];
    plan = {
      outcome: run.validation.valid ? 'skipped' : 'failed', sha256: null, recordedSha256: null, groups: run.validation.metrics.groups,
      steps: [...outputs.keys()].filter((file) => file.startsWith('steps/')).length, files: [], calls, recordedCostUsd: run.editRun.costUsd + (run.criticRun?.costUsd ?? 0), directory,
      detail: run.validation.valid
        ? `${groups.filter((group) => recordedGroups.has(group)).length} of its ${groups.length} groups have a name the recorded plan has too (it has ${recordedGroups.size}): a new sample differs`
        : `the plan is invalid (plan.md lists the validator errors), so no step runs`,
    };
  } catch (error) {
    plan = { outcome: 'failed', sha256: null, recordedSha256: null, groups: 0, steps: 0, files: [], calls, recordedCostUsd: null, directory: path.join(workDir, 'plan'), detail: `the planner stopped: ${(error as Error).message.split('\n')[0]}` };
  }
  log(`plan: ${plan.detail}`);

  const planFile = planText ? readPlanYaml(planText) : null;
  const ladder = planFile && planText
    ? await executeLadder({
      context: { repo: checkout.directory, packageRoot: planFile.packageRoot, moduleRoot: planFile.moduleRoot, planSha256: createHash('sha256').update(planText).digest('hex') },
      planFile, profile, recorded: null, limit: options.steps, environment: environmentOrCheckout, workDir, log,
    })
    : { steps: [], renames: null, boundaries: null, stoppedAfter: null, plannedSteps: 0 };
  const certified = await certifySample({
    steps: ladder.steps, size: options.sample, checkout: checkout.directory, environment: environmentOrCheckout, profile, workDir, checks: staticCheckIds(), log, recorded: () => null,
  });

  const report: DemoReport = {
    mode: 'live',
    target: { name: target.name, sha: target.sha, packageRoot: profile.packageRoot, checkout: checkout.directory, source: checkout.source, environment, branch: liveBranch, environmentNodeModulesAbove: environment ? nodeModulesAbove(environment) : [] },
    recorded: null,
    plan,
    ...ladder,
    certified,
    findings: null,
    spentUsd: calls.filter((call) => !call.replayed).reduce((sum, call) => sum + call.costUsd, 0),
    notRerun: [
      ...notRerun(profile, null, { certified, environment, oraclesAsked: false }).filter((line) => !line.startsWith('**Nemotron itself**')),
      '**The findings narration** (Nemotron 3.5 Lightning): not asked in live mode; `ac demo --replay` replays the recorded one.',
    ],
    workDir,
    durationMs: Math.round(performance.now() - started),
  };
  return { report, head: headCommit(checkout.directory) };
}

// `ac demo --replay`: the recorded run reproduced on a fresh clone, with no key and no spend. The plan is replayed
// from the cassette (the planner's own code runs, Nemotron's answers come from the recording) and must give the plan
// the run executed; every step is executed again and its commit's tree must equal the recorded one; a sample of steps
// is certified again; the findings log is collected again with its narration replayed. What isn't re-run (the oracles,
// without an environment) is said, with the commands that do run it.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import { hermeticProblem, lookupEntriesOnPath, nodeModulesAbove, NotHermeticError, requireHermetic } from '../certificate/hermetic.js';
import { loadProfile, type Profile } from '../certificate/profile.js';
import type { CheckId } from '../certificate/types.js';
import { runFindings } from '../findings/index.js';
import { findingsMarkdown, prBodyMarkdown } from '../findings/render.js';
import { readRunData } from '../findings/run-data.js';
import type { FindingsDocument } from '../findings/types.js';
import { createGateway } from '../gateway/gateway.js';
import type { CassetteMode, Gateway } from '../gateway/types.js';
import { git, headCommit } from '../orchestrator/git.js';
import { readRunState } from '../orchestrator/run-directory.js';
import { staticCheckIds } from '../orchestrator/runner.js';
import type { RunState } from '../orchestrator/types.js';
import { criticSettingsFor } from '../planner/critic.js';
import { editSettingsFor } from '../planner/edit.js';
import { planOutputs } from '../planner/outputs.js';
import { readPlanYaml } from '../planner/plan-file.js';
import { planRepo } from '../planner/plan.js';
import { prepareCheckout } from './checkout.js';
import { executeLadder } from './ladder.js';
import type { CertifiedEntry, CheckComparison, DemoReport, FileComparison, FindingsPhase, ModelCall, PlanPhase } from './report.js';
import { certifyInto, certifySample, compareChecks, readCertificate } from './sample.js';
import type { DemoTarget } from './target.js';

export interface DemoOptions {
  target: DemoTarget;
  workDir: string;
  /** A local clone with the commit; default: fetch it from the target's URL. */
  repo?: string;
  /** A checkout with the target's node_modules: K3b, K3c and K6 run, and K8 with `oracles`. */
  environment: string | null;
  /** Stop after this many steps (null: every step). */
  steps: number | null;
  /** How many steps to certify again, or every one. */
  sample: number | 'all';
  /** Certify the whole PR with the oracles (needs `environment`). */
  oracles: boolean;
  log(message: string): void;
}

export interface ReplayOptions extends DemoOptions {
  /** The cassette's gateway (default: replay only, its ledger in the work dir). */
  gateway?: () => Gateway;
}

export const demoBranch = 'ac-demo/replay';
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const elapsed = (started: number) => Math.round(performance.now() - started);
const normalizeRoot = (root: string) => root.replace(/^\.\/?/, '').replace(/\/$/, '');

/** A gateway that lists every call it serves. */
export function countingGateway(gateway: Gateway, calls: ModelCall[]): Gateway {
  return {
    async structured(request) {
      const result = await gateway.structured(request);
      calls.push({ model: request.model, purpose: request.schemaName, replayed: result.replayed, costUsd: result.costUsd });
      return result;
    },
    spent: () => gateway.spent(),
  };
}

/** The cassette in replay mode: a miss fails, nothing is ever sent, the ledger (never written by a replay) sits in the work dir. */
export const replayGateway = (cassette: string, workDir: string) => () => createGateway({ runId: 'replay', mode: 'replay', cassettePath: cassette, ledgerPath: path.join(workDir, 'replay-ledger.jsonl') });

/** Byte comparison of `files` (relative) between two directories; a file missing on either side differs. */
export function compareFiles(directory: string, recordedDirectory: string, files: string[]): FileComparison[] {
  return files.map((file) => {
    const made = path.join(directory, file);
    const recorded = path.join(recordedDirectory, file);
    return { file, identical: fs.existsSync(made) && fs.existsSync(recorded) && fs.readFileSync(made).equals(fs.readFileSync(recorded)) };
  });
}

/** Files under `directory`, relative, sorted. */
const filesUnder = (directory: string): string[] => (fs.existsSync(directory)
  ? fs.readdirSync(directory, { recursive: true, encoding: 'utf8' }).filter((file) => fs.statSync(path.join(directory, file)).isFile()).sort()
  : []);

/** Marks a directory as a demo's work dir: only such a directory is ever emptied. */
const workDirMarker = '.ac-demo';

/**
 * The demo's work dir without --work: ./ac-demo when it is hermetic, else <tmp>/ac-demo. From a clone of this tool,
 * ./ac-demo sits below the tool's own node_modules and package.json, which the certificates made there would read.
 * `below` lists what ./ac-demo has on its path (empty when it is the one chosen).
 */
export function defaultWorkDir(currentDirectory: string = process.cwd(), temporaryDirectory: string = os.tmpdir()): { directory: string; below: string[] } {
  const local = path.resolve(currentDirectory, 'ac-demo');
  const below = lookupEntriesOnPath(local);
  if (!below.length) return { directory: local, below };
  const temporary = path.resolve(temporaryDirectory, 'ac-demo');
  const problem = hermeticProblem(temporary, 'the work dir', `./ac-demo isn't either (it has ${below.join(', ')} on its path): pick a --work with neither on its path.`);
  if (problem) throw new NotHermeticError(problem);
  return { directory: temporary, below };
}

/**
 * The work dir (its real path), emptied except for the target's clone (reused when it has the commit): a new directory,
 * or one a previous demo made. Anything else is refused, so a mistyped --work never deletes a user's files; so is a
 * directory that isn't hermetic, before anything is written there.
 */
export function openWorkDir(directory: string, keep: string): string {
  const workDir = requireHermetic(directory, 'the work dir', 'Pick a --work with neither on its path.');
  if (fs.existsSync(workDir) && fs.readdirSync(workDir).length && !fs.existsSync(path.join(workDir, workDirMarker))) {
    throw new Error(`${workDir} is not empty and no earlier demo made it: pick a new --work directory`);
  }
  fs.mkdirSync(workDir, { recursive: true });
  for (const entry of fs.readdirSync(workDir)) if (entry !== keep && entry !== workDirMarker) fs.rmSync(path.join(workDir, entry), { recursive: true, force: true });
  fs.writeFileSync(path.join(workDir, workDirMarker), 'made by ac demo: emptied by the next ac demo with this --work\n');
  return workDir;
}

/** Plans the checkout and writes the planner's outputs to <work>/plan/. */
export async function planInto(checkout: string, profile: Profile, gateway: Gateway, calls: ModelCall[], mode: CassetteMode, workDir: string) {
  const directory = path.join(workDir, 'plan');
  fs.rmSync(directory, { recursive: true, force: true });
  const edit = editSettingsFor(profile, mode);
  const critic = criticSettingsFor(profile, mode);
  const run = await planRepo(gitRepoFs(checkout), countingGateway(gateway, calls), {
    packageRoot: normalizeRoot(profile.packageRoot), moduleRoot: profile.plan?.moduleRoot ?? 'src', pins: profile.plan?.pins ?? [], edit, critic,
  });
  const outputs = planOutputs(run, { name: profile.name }, { edit, critic });
  for (const [file, content] of outputs) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
  }
  return { run, outputs, directory };
}

export interface PlannedSteps {
  phase: PlanPhase;
  /** plan.yaml as executed: the replayed one, else the recorded one (the phase says why). */
  planText: string;
}

/** The planner on the checkout, its Nemotron calls from `gateway`, compared with the plan the recorded run executed. */
export async function replayPlan(checkout: string, profile: Profile, state: RunState, recordedRun: string, gateway: Gateway, workDir: string): Promise<PlannedSteps> {
  const calls: ModelCall[] = [];
  const recordedText = fs.readFileSync(path.join(recordedRun, state.plan.file), 'utf8');
  try {
    const { run, outputs, directory } = await planInto(checkout, profile, gateway, calls, 'replay', workDir);
    const text = outputs.get('plan.yaml')!;
    const recordedPlanDirectory = path.join(recordedRun, path.dirname(state.plan.file));
    // The run directory keeps the planner's outputs but writes its own step files (R3's included).
    const files = compareFiles(directory, recordedPlanDirectory, filesUnder(recordedPlanDirectory).filter((file) => !file.startsWith('steps/')));
    const matches = sha256(text) === state.plan.sha256 && files.every((file) => file.identical);
    return {
      phase: {
        outcome: matches ? 'match' : 'mismatch', sha256: sha256(text), recordedSha256: state.plan.sha256, groups: run.validation.metrics.groups,
        steps: [...outputs.keys()].filter((file) => file.startsWith('steps/')).length, files, calls, recordedCostUsd: run.editRun.costUsd + (run.criticRun?.costUsd ?? 0), directory,
        ...(matches ? {} : { detail: `plan.yaml sha256 ${sha256(text).slice(0, 12)}…, recorded ${state.plan.sha256.slice(0, 12)}…; the steps run from the recorded plan.yaml` }),
      },
      planText: matches ? text : recordedText,
    };
  } catch (error) {
    return {
      phase: {
        outcome: 'failed', sha256: null, recordedSha256: state.plan.sha256, groups: 0, steps: 0, files: [], calls, recordedCostUsd: state.cost.planRecordedUsd,
        directory: path.join(workDir, 'plan'), detail: `the planner stopped: ${(error as Error).message.split('\n')[0]}; the steps run from the recorded plan.yaml`,
      },
      planText: recordedText,
    };
  }
}

/** The findings log collected again on a copy of the recorded run directory, narrated only if the recording was. */
export async function replayFindings(recordedRun: string, checkout: string, environment: string, gateway: Gateway, workDir: string, log: (message: string) => void): Promise<FindingsPhase> {
  const calls: ModelCall[] = [];
  const recordedFile = path.join(recordedRun, 'findings', 'findings.json');
  if (!fs.existsSync(recordedFile)) return { outcome: 'skipped', findings: 0, narrated: 0, calls, files: [], detail: 'the recorded run has no findings log' };
  const copy = path.join(workDir, 'recorded-run');
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(recordedRun, copy, { recursive: true });
  const recorded = JSON.parse(fs.readFileSync(recordedFile, 'utf8')) as FindingsDocument;
  try {
    const result = await runFindings({ runDirectory: copy, repo: checkout, environment, gateway: recorded.narration ? countingGateway(gateway, calls) : null, log });
    // A narration recorded live says so (`replayed: false`, "$… when recorded" in the prose); its replay says replayed.
    // The recorded log with only that flag set is what a replay must write, byte for byte.
    const asReplayed = recorded.narration && result.document.narration && recorded.narration.replayed !== result.document.narration.replayed
      ? { ...recorded, narration: { ...recorded.narration, replayed: result.document.narration.replayed } }
      : null;
    const expected = asReplayed
      ? new Map([['findings/findings.json', `${JSON.stringify(asReplayed, null, 1)}\n`], ['findings/findings.md', findingsMarkdown(asReplayed)], ['findings/pr-body.md', prBodyMarkdown(asReplayed, readRunData(copy))]])
      : new Map<string, string>();
    const files = compareFiles(copy, recordedRun, result.written).map((comparison) => {
      if (comparison.identical || !expected.has(comparison.file)) return comparison;
      const identical = fs.readFileSync(path.join(copy, comparison.file), 'utf8') === expected.get(comparison.file);
      return { ...comparison, identical, ...(identical ? { note: 'once the recorded narration\'s `replayed` flag reads true' } : {}) };
    });
    return {
      outcome: files.every((file) => file.identical) ? 'match' : 'mismatch', findings: result.document.findings.length, narrated: result.document.narration?.narrated ?? 0, calls, files,
      ...(result.document.narration?.error ? { detail: `the narration stopped: ${result.document.narration.error}` } : {}),
    };
  } catch (error) {
    return { outcome: 'failed', findings: 0, narrated: 0, calls, files: [], detail: `the findings log stopped: ${(error as Error).message.split('\n')[0]}` };
  }
}

const ranHere = (check: CheckComparison) => check.status === 'pass' || check.status === 'fail';
const skipReasons = (checks: CheckComparison[]) => [...new Set(checks.flatMap((check) => (check.status === 'skip' && check.skipReason ? [check.skipReason] : [])))].join('; ');

/**
 * What the demo leaves to the recorded run, and the command that runs each. Read from the checks the certificates made
 * here actually ran, never from the flags: an --env that lacks node_modules, or --oracles whose K8 skipped, leaves the
 * line in, with the reason.
 */
export function notRerun(profile: Profile, recorded: RunState | null, ran: { certified: CertifiedEntry[]; environment: string | null; oraclesAsked: boolean }): string[] {
  const lines: string[] = [];
  const checksOf = (id: CheckId) => ran.certified.flatMap((entry) => entry.checks.filter((check) => check.id === id));
  const k8 = checksOf('K8');
  if (!k8.some(ranHere)) {
    const oracles = (profile.oracles ?? []).map((oracle) => oracle.name).join(', ');
    const wholePr = recorded?.certificate ? ` (the recorded whole-PR certificate: \`${recorded.certificate.file}\`, digest \`${recorded.certificate.digest.slice(0, 19)}…\`)` : '';
    const attempt = k8.length ? ` Asked for, but K8 ${[...new Set(k8.map((check) => (check.status === 'skip' ? 'skipped' : 'errored')))].join(' and ')} here${skipReasons(k8) ? `: ${skipReasons(k8)}` : ''}.`
      : ran.oraclesAsked ? ' Asked for, but the whole PR is certified with them only after every step ran.' : '';
    lines.push(`**The oracles (K8)**: the target's own commands (${oracles || 'none in the profile'}) on base and head, for every rung and the whole PR${wholePr}.${attempt} They need the target's node_modules and its Node version: \`ac demo --env <checkout with node_modules> --oracles\` certifies the whole PR with them.`);
  }
  const skipped = (['K3b', 'K3c', 'K6'] as const).filter((id) => checksOf(id).some((check) => check.status === 'skip'));
  if (!ran.certified.length) lines.push('**The certificates**: none was made here (`--sample 0`, or no step committed).');
  else if (skipped.length) {
    const named = skipped.length === 1 ? skipped[0] : `${skipped.slice(0, -1).join(', ')} and ${skipped.at(-1)}`;
    const reasons = skipReasons(skipped.flatMap(checksOf));
    lines.push(`**${named}** (resolution under the test runner and the runtime, the test inventory) skipped here${reasons ? ` (${reasons})` : ''}: `
      + `${ran.environment ? `the environment ${ran.environment} lacks what they need` : 'they need node_modules'}; give \`--env <checkout with node_modules>\`.`);
  }
  lines.push('**The run loop**: the baseline with its flaky-test quarantine, the preflight envelope, a certificate for every step, the rung certificates, rollback and replan. `ac demo --full --env <checkout>` runs `ac run` end to end (about 2 h on a quiet machine).');
  lines.push('**Nemotron itself**: its answers come from the cassette. `ac demo --live` asks it again, on your own Token Factory key.');
  return lines;
}

export interface DemoResult {
  report: DemoReport;
  /** The checkout's head after the last step (the demo's branch). */
  head: string;
}

export async function replayDemo(options: ReplayOptions): Promise<DemoResult> {
  const started = performance.now();
  const { target, log } = options;
  if (options.oracles && !options.environment) throw new Error('--oracles needs an environment: a checkout with the target\'s node_modules');
  const workDir = openWorkDir(options.workDir, target.name);
  const state = readRunState(target.recordedRun);
  const profile = loadProfile(target.profile);
  if (state.base !== target.sha) throw new Error(`the recorded run ${target.recordedRun} starts at ${state.base}, not at ${target.sha}`);
  const checkout = prepareCheckout({ directory: path.join(workDir, target.name), sha: target.sha, url: target.url, ...(options.repo ? { repo: options.repo } : {}), log });
  git(checkout.directory, ['checkout', '-q', '-B', demoBranch, target.sha]);
  const environment = options.environment ? path.resolve(options.environment) : null;
  const environmentOrCheckout = environment ?? checkout.directory;
  const gateway = (options.gateway ?? replayGateway(target.cassette, workDir))();

  log(`plan: replaying ${path.basename(target.cassette)}`);
  const planned = await replayPlan(checkout.directory, profile, state, target.recordedRun, gateway, workDir);
  log(`plan: ${planned.phase.outcome}${planned.phase.detail ? ` (${planned.phase.detail})` : ''}`);
  const planFile = readPlanYaml(planned.planText);

  const ladder = await executeLadder({
    context: { repo: checkout.directory, packageRoot: planFile.packageRoot, moduleRoot: planFile.moduleRoot, planSha256: sha256(planned.planText) },
    planFile, profile, recorded: state, limit: options.steps, environment: environmentOrCheckout, workDir, log,
  });

  const recordedCertificate = (file: string | undefined) => (file ? readCertificate(path.join(target.recordedRun, file)) : null);
  const certified: CertifiedEntry[] = await certifySample({
    steps: ladder.steps, size: options.sample, checkout: checkout.directory, environment: environmentOrCheckout, profile, workDir, checks: staticCheckIds(), log,
    recorded: (index) => recordedCertificate(state.steps.find((step) => step.index === index)?.certificate?.file),
  });

  const head = headCommit(checkout.directory);
  const complete = ladder.stoppedAfter === null && ladder.steps.length > 0 && ladder.steps.every((step) => step.outcome === 'committed');
  if (options.oracles) {
    if (!environment || !complete) log('--oracles certifies the whole PR only after every step ran: not certified');
    else {
      log('certifying the whole PR with the oracles (K8)');
      const { certificate, file, durationMs } = await certifyInto({ checkout: checkout.directory, environment, profile, workDir, base: target.sha, head, oracles: true, name: 'whole-pr' });
      const recorded = recordedCertificate(state.certificate?.file);
      certified.push({
        subject: 'whole PR', reason: 'with the oracles', verdict: certificate.verdict, scope: certificate.scope, checks: compareChecks(certificate, recorded),
        digest: certificate.digest, recordedDigest: recorded?.digest ?? null, file, durationMs,
      });
      log(`whole PR: ${certificate.verdict.toUpperCase()} (${certificate.scope}, ${Math.round(durationMs / 1000)} s)`);
    }
  }

  log('findings: collecting again on a copy of the recorded run directory');
  const findings = await replayFindings(target.recordedRun, checkout.directory, environmentOrCheckout, gateway, workDir, log);
  log(`findings: ${findings.outcome}${findings.detail ? ` (${findings.detail})` : ''}`);

  const report: DemoReport = {
    mode: 'replay',
    target: { name: target.name, sha: target.sha, packageRoot: planFile.packageRoot, checkout: checkout.directory, source: checkout.source, environment, branch: demoBranch, environmentNodeModulesAbove: environment ? nodeModulesAbove(environment) : [] },
    recorded: { directory: target.recordedRun, branch: state.branch, steps: state.steps.length, head: state.head, wholePrDigest: state.certificate?.digest ?? null },
    plan: planned.phase,
    ...ladder,
    certified,
    findings,
    spentUsd: 0,
    notRerun: notRerun(profile, state, { certified, environment, oraclesAsked: options.oracles }),
    workDir,
    durationMs: elapsed(started),
  };
  return { report, head };
}

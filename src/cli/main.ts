#!/usr/bin/env node
// `ac` CLI: `ac analyze <repo>`, `ac plan <repo>`, `ac steps <plan.yaml>`, `ac move <repo> --map <pathmap.json> [--dry-run]`,
// `ac certify <repo> <base>..<head>`, `ac normalize <repo>`, `ac run <repo> --profile <name>`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeRepo } from '../analyzer/analyze.js';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import { benchCommand, benchUsage } from '../bench/command.js';
import { boundariesCommand } from '../boundaries/command.js';
import { demoCommand, demoUsage } from '../demo/command.js';
import { certify } from '../certificate/certify.js';
import { hermeticProblem } from '../certificate/hermetic.js';
import { loadProfile } from '../certificate/profile.js';
import { summarize, trailers } from '../certificate/report.js';
import { cacheDirFromEnvironment } from '../certificate/tree-cache.js';
import type { CheckId } from '../certificate/types.js';
import { packageDirectory } from '../certificate/toolchain.js';
import { executeMove } from '../executor/execute.js';
import { normalizeCommand } from '../filename-normalization/command.js';
import { findingsCommand, findingsUsage } from '../findings/command.js';
import { reportCommand, reportUsage } from '../report/command.js';
import { siteCommand, siteUsage } from '../site/command.js';
import { runFindings } from '../findings/index.js';
import { scrambleCommand, scrambleUsage } from '../scramble/command.js';
import { rewrapCommand, rewrapUsage } from '../rewrap/command.js';
import { createGateway } from '../gateway/gateway.js';
import type { CassetteMode, Gateway } from '../gateway/types.js';
import { defaultPlannerConfiguration, isPlannerConfigurationName, plannerConfigurationNames } from '../planner/configurations.js';
import { criticSettingsFor, defaultCriticSettings } from '../planner/critic.js';
import { defaultEditSettings, editSettingsFor } from '../planner/edit.js';
import { defaultSummarySettings } from '../planner/summaries.js';
import { planRepo } from '../planner/plan.js';
import { planOutputs } from '../planner/outputs.js';
import { readPlanYaml } from '../planner/plan-file.js';
import { checkGroupKeys, stepFileName, stepJson, stepsOf, type Step } from '../planner/steps.js';
import { operatorIds } from '../orchestrator/fault.js';
import { planFromFile, planInProcess } from '../orchestrator/plan-source.js';
import { requireStartable, resumeRun, RunError, startRun } from '../orchestrator/run.js';
import { ladderRungIds, rungIds, type RungId } from '../orchestrator/types.js';

const usage = `usage:
  ac analyze <repo> [--json]
  ac plan <repo> [--root <package-dir>] [--profile <name|file>] [--module-root src] [--out <dir>]
          [--mode replay|record|auto] [--run <budget run id>] [--cassette <file.jsonl>] [--samples 3] [--no-critic] [--summaries]
          [--planner ${plannerConfigurationNames.join('|')}]
          (replay is the default and spends nothing; record and auto need --run; --planner picks the models that edit and
          review, ${defaultPlannerConfiguration} by default; the profile's replay pins hold for ${defaultPlannerConfiguration} only)
  ac steps <plan.yaml> [--out <dir>]
  ac normalize <repo> [--profile <name|file>] [--root <package-dir>] [--module-root src] [--out <dir>] [--json]
  ac move <repo> --map <pathmap.json> [--dry-run] [--json]
  ac certify <repo> <base>..<head> [--profile <name|file>] [--oracles] [--root <package-dir>] [--env <checkout>]
             [--only K1,K2,...] [--out <certificate.json>] [--work-dir <dir>] [--keep] [--json]
             (AC_CERTIFY_CACHE=<dir> keeps per-tree results between certifications)
  ac run <repo> --profile <name|file> [--plan <plan.yaml> | --cassette <file.jsonl> [--mode replay|record|auto] [--run <budget run>]]
         [--env <checkout with node_modules>] [--out <run-dir>] [--branch <name>] [--rungs R0,R1,R2,R3,R4 (and S3: re-wrap import lines)]
         [--max-steps <n>] [--inject-fault <step>:<operator>] [--jobs <n>] [--no-narration]
  ac run [<repo>] --resume --out <run-dir> [--max-steps <n>] [--jobs <n>] [--cassette <file.jsonl> [--mode ...] [--run ...]]
         (exit 0 completed or stopped, 1 failed, 2 usage, 3 declined by the preflight; the findings log is written at the
         end, its narration replayed from the cassette, recorded with --mode auto --run, off without a cassette)
  ac boundaries <repo> [--profile <name|file>] [--root <package-dir>] [--module-root src] [--env <checkout>] [--out <dir>] [--check]
  ${findingsUsage}
  ${rewrapUsage}
  ${scrambleUsage}
  ${benchUsage}
  ${demoUsage}
  ${reportUsage}
  ${siteUsage}`;

function analyzeCommand(repoPath: string, json: boolean) {
  const analysis = analyzeRepo(gitRepoFs(repoPath));
  const counts: Record<string, number> = {};
  let hazards = 0;
  for (const file of analysis.files.values()) {
    hazards += file.hazards.length;
    for (const site of file.sites) counts[`${site.kind}:${site.resolution.type}`] = (counts[`${site.kind}:${site.resolution.type}`] ?? 0) + 1;
  }
  if (json) console.log(JSON.stringify({ files: [...analysis.files.values()] }, null, 1));
  else console.log(JSON.stringify({ files: analysis.files.size, hazards, sites: counts }, null, 1));
}

function moveCommand(repoPath: string, mapFile: string, dryRun: boolean, json: boolean): number {
  const pathMap = JSON.parse(fs.readFileSync(mapFile, 'utf8')) as { moves: Record<string, string> };
  const result = executeMove(gitRepoFs(repoPath), new Map(Object.entries(pathMap.moves)), { dryRun });
  if (json) {
    console.log(JSON.stringify({ ...result, moves: Object.fromEntries(result.moves), before: undefined, after: undefined }, null, 1));
  } else {
    console.log(`${result.outcome}: ${result.moves.size} files`);
    if (result.outcome === 'declined') for (const decline of result.declines) console.log(`  ${decline.code} ${decline.file}: ${decline.detail}`);
    else if (result.outcome === 'unverified') for (const violation of result.violations) console.log(`  ${violation.file}: ${violation.detail}`);
    else console.log(`  ${result.edits.length} specifier edits in ${new Set(result.edits.map((edit) => edit.file)).size} files`);
  }
  return result.outcome === 'applied' || result.outcome === 'verified' ? 0 : 1;
}

function writeSteps(outDirectory: string, steps: Step[]) {
  const directory = path.join(outDirectory, 'steps');
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  for (const step of steps) fs.writeFileSync(path.join(directory, stepFileName(step, steps.length)), stepJson(step));
}

interface PlanFlags {
  root?: string;
  profile?: string;
  'module-root'?: string;
  out?: string;
  mode?: string;
  run?: string;
  cassette?: string;
  samples?: string;
  'no-critic': boolean;
  summaries: boolean;
  planner?: string;
}

async function planCommand(repo: string, flags: PlanFlags): Promise<number> {
  const mode = (flags.mode ?? 'replay') as CassetteMode;
  if (!['replay', 'record', 'auto'].includes(mode)) {
    console.error(usage);
    return 2;
  }
  const configuration = flags.planner ?? defaultPlannerConfiguration;
  if (!isPlannerConfigurationName(configuration)) {
    console.error(`--planner is ${plannerConfigurationNames.join(', ')}`);
    return 2;
  }
  const profile = flags.profile ? loadProfile(flags.profile) : null;
  const packageRoot = (flags.root ?? profile?.packageRoot ?? '').replace(/^\.\/?/, '').replace(/\/$/, '');
  const moduleRoot = flags['module-root'] ?? profile?.plan?.moduleRoot ?? 'src';
  // Live calls are charged to a budget run (budget/runs.json); a replay spends nothing and only needs its cassette.
  if (mode !== 'replay' && !flags.run) {
    console.error('--run <id from budget/runs.json> is required for record and auto modes');
    return 2;
  }
  if (!flags.run && !flags.cassette) {
    console.error('--cassette <file.jsonl> (or --run <id> for cassettes/<id>.jsonl) is required');
    return 2;
  }
  const runId = flags.run ?? 'replay';
  const out = path.resolve(flags.out ?? 'ac-plan');
  const gateway = createGateway({ runId, mode, cassettePath: path.resolve(flags.cassette ?? path.join(packageDirectory(), 'cassettes', `${runId}.jsonl`)) });
  const edit = { ...editSettingsFor(profile, mode, configuration), samples: Number(flags.samples ?? defaultEditSettings.samples) };
  const critic = flags['no-critic'] ? null : criticSettingsFor(profile, mode, configuration);
  const summaries = flags.summaries ? defaultSummarySettings : null;
  let run;
  try {
    run = await planRepo(gitRepoFs(repo), gateway, { packageRoot, moduleRoot, pins: profile?.plan?.pins ?? [], edit, critic, summaries });
  } catch (error) {
    console.error(`ac plan: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const outputs = planOutputs(run, { name: profile?.name ?? path.basename(path.resolve(repo)) }, { edit, critic, summaries });
  for (const directory of ['steps', 'candidates']) fs.rmSync(path.join(out, directory), { recursive: true, force: true });
  for (const [file, content] of outputs) {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.writeFileSync(path.join(out, file), content);
  }
  const steps = [...outputs.keys()].filter((file) => file.startsWith('steps/'));
  const spent = gateway.spent();
  console.log(`plan: ${run.validation.metrics.groups} groups, ${run.facts.files.length} files, ${run.facts.pins.length} pinned, ${steps.length} steps → ${out}`);
  if (critic) console.log(`critic prompt: version ${critic.prompt}${critic.prompt === defaultCriticSettings.prompt ? '' : ` (pinned by the profile for the replay of its recording; a recording uses version ${defaultCriticSettings.prompt})`}`);
  console.log(`planner rules: version ${edit.rules}${edit.rules === defaultEditSettings.rules ? '' : ` (pinned by the profile for the replay of its recording; a recording uses version ${defaultEditSettings.rules})`}`);
  const cost = `cost of this plan: $${(run.editRun.costUsd + (run.criticRun?.costUsd ?? 0)).toFixed(4)}`;
  console.log(mode === 'replay' ? `${cost} when recorded; this replay spent $0` : `${cost}; ledger: run ${runId} $${spent.run.toFixed(4)}, global $${spent.global.toFixed(4)}`);
  if (run.validation.valid) return 0;
  console.error(`the plan is invalid, so no steps were written (plan.md lists the validator errors); fix ${path.join(out, 'plan.yaml')}, then run ac steps on it`);
  return 1;
}

function stepsCommand(planYaml: string, outFlag: string | undefined): number {
  const planFile = readPlanYaml(fs.readFileSync(planYaml, 'utf8'));
  const issues = checkGroupKeys(planFile);
  if (issues.length) {
    for (const issue of issues) console.error(`${issue.severity} ${issue.code}: ${issue.detail}`);
    console.error('no steps written');
    return 1;
  }
  const steps = stepsOf(planFile);
  const out = path.resolve(outFlag ?? path.dirname(planYaml));
  writeSteps(out, steps);
  console.log(`${steps.length} steps, ${steps.reduce((sum, step) => sum + step.moves.size, 0)} moves → ${path.join(out, 'steps')}`);
  return 0;
}

interface CertifyFlags {
  root?: string;
  env?: string;
  profile?: string;
  oracles: boolean;
  only?: string;
  out?: string;
  'work-dir'?: string;
  keep: boolean;
  json: boolean;
}

async function certifyCommand(repo: string, range: string, flags: CertifyFlags): Promise<number> {
  const [base, head] = range.split('..');
  if (!base || !head) {
    console.error(usage);
    return 2;
  }
  const profile = flags.profile ? loadProfile(flags.profile) : null;
  if (flags.oracles && !profile?.oracles?.length) {
    console.error('--oracles needs a --profile with oracle commands');
    return 2;
  }
  // The default work dir is a new directory in the system's temporary directory: both checked before anything is made.
  const notHermetic = flags['work-dir']
    ? hermeticProblem(flags['work-dir'], 'the work dir', 'Pick a --work-dir with neither on its path.')
    : hermeticProblem(os.tmpdir(), 'the temporary directory', 'Give a --work-dir with neither on its path.');
  if (notHermetic) {
    console.error(`ac certify: ${notHermetic}`);
    return 2;
  }
  const certificate = await certify({
    repo,
    base,
    head,
    packageRoot: (flags.root ?? profile?.packageRoot ?? '').replace(/^\.\/?/, '').replace(/\/$/, ''),
    environment: flags.env ?? repo,
    profile,
    oracles: flags.oracles,
    ...(flags.only ? { only: flags.only.split(',').map((id) => id.trim()) as CheckId[] } : {}),
    workDir: flags['work-dir'] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ac-certify-')),
    ...(cacheDirFromEnvironment() ? { cacheDir: cacheDirFromEnvironment()! } : {}),
    keep: flags.keep,
  });
  if (flags.out) fs.writeFileSync(flags.out, `${JSON.stringify(certificate, null, 1)}\n`);
  if (flags.json) console.log(JSON.stringify(certificate, null, 1));
  else console.log(`${summarize(certificate)}\n\n${trailers(certificate).join('\n')}`);
  return certificate.verdict === 'pass' ? 0 : 1;
}

interface RunFlags {
  profile?: string;
  plan?: string;
  cassette?: string;
  mode?: string;
  run?: string;
  env?: string;
  out?: string;
  branch?: string;
  rungs?: string;
  resume: boolean;
  jobs?: string;
  'inject-fault'?: string;
  'max-steps'?: string;
  'no-narration': boolean;
}

/** The findings log's narration: replayed (or recorded, with --mode auto|record --run) from the run's cassette; off without one. */
function narrationGateway(flags: RunFlags, mode: CassetteMode): Gateway | null {
  if (flags['no-narration'] || (!flags.cassette && !flags.run)) return null;
  return createGateway({ runId: flags.run ?? 'replay', mode, cassettePath: path.resolve(flags.cassette ?? path.join(packageDirectory(), 'cassettes', `${flags.run}.jsonl`)) });
}

const findingsStep = (gateway: Gateway | null, log: (message: string) => void) => async (runDirectory: string) => {
  const { reportSection, document } = await runFindings({ runDirectory, gateway, log });
  return { section: reportSection, narration: document.narration && { costUsd: document.narration.costUsd, calls: document.narration.calls, replayed: document.narration.replayed } };
};

const timestamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');

async function runCommand(repo: string | undefined, flags: RunFlags): Promise<number> {
  const log = (message: string) => process.stderr.write(`[run] ${message}\n`);
  const fail = (message: string) => {
    console.error(`ac run: ${message}`);
    return 2;
  };
  const maxSteps = flags['max-steps'] === undefined ? null : Number(flags['max-steps']);
  if (maxSteps !== null && !(Number.isInteger(maxSteps) && maxSteps >= 0)) return fail('--max-steps takes a whole number');
  let outcome;
  try {
    if (flags.resume) {
      if (!flags.out) return fail('--resume needs --out <run-dir>');
      const jobs = flags.jobs === undefined ? undefined : Number(flags.jobs);
      if (jobs !== undefined && !(Number.isInteger(jobs) && jobs >= 1)) return fail('--jobs takes a whole number from 1 (one step at a time) up');
      const mode = (flags.mode ?? 'replay') as CassetteMode;
      if (!['replay', 'record', 'auto'].includes(mode)) return fail('--mode is replay, record or auto');
      if (mode !== 'replay' && !flags.run) return fail('--run <id from budget/runs.json> is required for record and auto modes');
      outcome = await resumeRun({ runDirectory: flags.out, ...(repo ? { repo } : {}), ...(jobs ? { jobs } : {}), maxSteps, log },
        { findings: findingsStep(narrationGateway(flags, mode), log) });
    } else {
      if (!repo || !flags.profile) {
        console.error(usage);
        return 2;
      }
      const rungs = (flags.rungs ?? rungIds.join(',')).split(',').map((rung) => rung.trim()) as RungId[];
      const unknownRung = rungs.find((rung) => !ladderRungIds.includes(rung));
      if (unknownRung) return fail(`unknown rung ${unknownRung} (rungs: ${ladderRungIds.join(', ')})`);
      const jobs = Number(flags.jobs ?? 1);
      if (!(Number.isInteger(jobs) && jobs >= 1)) return fail('--jobs takes a whole number from 1 (one step at a time) up');
      let injectFault = null;
      if (flags['inject-fault']) {
        const separator = flags['inject-fault'].lastIndexOf(':');
        const step = flags['inject-fault'].slice(0, separator);
        const operator = flags['inject-fault'].slice(separator + 1);
        if (separator <= 0 || !operatorIds().includes(operator)) return fail(`--inject-fault takes <step index or group>:<operator> (operators: ${operatorIds().join(', ')})`);
        injectFault = { step, operator };
      }
      const profile = loadProfile(flags.profile);
      const mode = (flags.mode ?? 'replay') as CassetteMode;
      if (!['replay', 'record', 'auto'].includes(mode)) return fail('--mode is replay, record or auto');
      if (mode !== 'replay' && !flags.run) return fail('--run <id from budget/runs.json> is required for record and auto modes');
      if (!flags.plan && !flags.cassette && !flags.run) return fail('give the plan: --plan <plan.yaml>, or --cassette <file.jsonl> to plan in-process');
      const branch = flags.branch ?? `ac/run-${timestamp()}`;
      const runDirectory = flags.out ?? path.join('ac-runs', branch.replace(/[^\w.-]+/g, '-'));
      // Before the planner, which may spend: a run that can't start doesn't get a plan.
      requireStartable({ repo, runDirectory, branch });
      let planned;
      try {
        planned = flags.plan
          ? planFromFile(flags.plan)
          : await planInProcess({ repo, profile, mode, run: flags.run ?? null, cassette: flags.cassette ?? path.join(packageDirectory(), 'cassettes', `${flags.run}.jsonl`) });
      } catch (error) {
        return fail(`no plan: ${error instanceof Error ? error.message : String(error)}`);
      }
      outcome = await startRun({
        repo,
        environment: flags.env ?? repo,
        profile,
        plan: planned.plan,
        cost: planned.cost,
        runDirectory,
        branch,
        rungs,
        maxSteps,
        jobs,
        injectFault,
        log,
      }, { findings: findingsStep(narrationGateway(flags, mode), log) });
    }
  } catch (error) {
    if (error instanceof RunError) return fail(error.message);
    throw error;
  }
  const { state, directory } = outcome;
  console.log(`${state.status}: ${state.steps.filter((step) => step.status === 'certified').length} certified commits on ${state.branch} (${state.base.slice(0, 10)}..${state.head.slice(0, 10)}), ${state.pins.length} files pinned`);
  console.log(`report: ${path.join(directory, 'report.md')}`);
  if (state.error) console.error(state.error.split('\n').slice(0, 3).join('\n'));
  return outcome.exitCode;
}

/** The shared flags, or the parser's complaint (an unknown flag, a missing value) as one line. */
function parseFlags(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        map: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        root: { type: 'string' },
        env: { type: 'string' },
        profile: { type: 'string' },
        oracles: { type: 'boolean', default: false },
        only: { type: 'string' },
        out: { type: 'string' },
        'work-dir': { type: 'string' },
        keep: { type: 'boolean', default: false },
        'module-root': { type: 'string' },
        mode: { type: 'string' },
        run: { type: 'string' },
        cassette: { type: 'string' },
        samples: { type: 'string' },
        'no-critic': { type: 'boolean', default: false },
        summaries: { type: 'boolean', default: false },
        planner: { type: 'string' },
        plan: { type: 'string' },
        branch: { type: 'string' },
        rungs: { type: 'string' },
        resume: { type: 'boolean', default: false },
        jobs: { type: 'string' },
        'inject-fault': { type: 'string' },
        'max-steps': { type: 'string' },
        'no-narration': { type: 'boolean', default: false },
        check: { type: 'boolean', default: false },
        repo: { type: 'string' },
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS_')) return (error as Error).message.split('\n')[0]!;
    throw error;
  }
}

/** The sub-commands with their own parser and usage. */
const subCommands: Record<string, { run(argv: string[]): number | Promise<number>; usage: string }> = {
  rewrap: { run: rewrapCommand, usage: rewrapUsage },
  scramble: { run: scrambleCommand, usage: scrambleUsage },
  bench: { run: benchCommand, usage: benchUsage },
  demo: { run: demoCommand, usage: demoUsage },
  report: { run: reportCommand, usage: reportUsage },
  site: { run: siteCommand, usage: siteUsage },
};

/** --help or -h among the flags (an argument after `--` is a positional). */
const asksForHelp = (argv: string[]) => argv.slice(0, argv.includes('--') ? argv.indexOf('--') : argv.length).some((argument) => argument === '--help' || argument === '-h');

async function main(argv: string[]): Promise<number> {
  const subCommand = Object.hasOwn(subCommands, argv[0] ?? '') ? subCommands[argv[0]!]! : null;
  if (subCommand && asksForHelp(argv.slice(1))) {
    console.log(subCommand.usage);
    return 0;
  }
  if (subCommand) return subCommand.run(argv.slice(1));
  if (asksForHelp(argv)) {
    console.log(usage);
    return 0;
  }
  const parsed = parseFlags(argv);
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${usage}`);
    return 2;
  }
  const { positionals, values } = parsed;
  const [command, repo, range] = positionals;
  // The shared table carries --planner for ac plan (ac bench parses its own): any other command refuses it, as it refuses an unknown flag.
  if (values.planner !== undefined && command !== 'plan') {
    console.error(`Option '--planner' is for ac plan and ac bench only\n${usage}`);
    return 2;
  }
  if (command === 'analyze' && repo) {
    analyzeCommand(repo, values.json);
    return 0;
  }
  if (command === 'plan' && repo) return planCommand(repo, values);
  if (command === 'steps' && repo) return stepsCommand(repo, values.out);
  if (command === 'normalize' && repo) return normalizeCommand(repo, values);
  if (command === 'move' && repo && values.map) return moveCommand(repo, values.map, values['dry-run'], values.json);
  if (command === 'certify' && repo && range) return certifyCommand(repo, range, values);
  if (command === 'run') return runCommand(repo, values);
  if (command === 'boundaries' && repo) return boundariesCommand(repo, values);
  if (command === 'findings' && repo) return findingsCommand(repo, values);
  console.error(usage);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));

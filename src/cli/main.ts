#!/usr/bin/env node
// `ac` CLI: `ac analyze <repo>`, `ac plan <repo>`, `ac steps <plan.yaml>`, `ac move <repo> --map <pathmap.json> [--dry-run]`,
// `ac certify <repo> <base>..<head>`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeRepo } from '../analyzer/analyze.js';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import { certify } from '../certificate/certify.js';
import { loadProfile } from '../certificate/profile.js';
import { summarize, trailers } from '../certificate/report.js';
import type { CheckId } from '../certificate/types.js';
import { packageDirectory } from '../certificate/toolchain.js';
import { executeMove } from '../executor/execute.js';
import { createGateway } from '../gateway/gateway.js';
import type { CassetteMode } from '../gateway/types.js';
import { defaultCriticSettings } from '../planner/critic.js';
import { defaultEditSettings } from '../planner/edit.js';
import { planRepo } from '../planner/plan.js';
import { planOutputs } from '../planner/outputs.js';
import { readPlanYaml } from '../planner/plan-file.js';
import { stepFileName, stepJson, stepsOf, type Step } from '../planner/steps.js';

const usage = `usage:
  ac analyze <repo> [--json]
  ac plan <repo> [--root <package-dir>] [--profile <name|file>] [--module-root src] [--out <dir>]
          [--mode replay|record|auto] [--run <budget run id>] [--cassette <file.jsonl>] [--samples 3] [--no-critic]
          (replay is the default and spends nothing; record and auto need --run)
  ac steps <plan.yaml> [--out <dir>]
  ac move <repo> --map <pathmap.json> [--dry-run] [--json]
  ac certify <repo> <base>..<head> [--profile <name|file>] [--oracles] [--root <package-dir>] [--env <checkout>]
             [--only K1,K2,...] [--out <certificate.json>] [--work-dir <dir>] [--keep] [--json]`;

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
  for (const step of steps) fs.writeFileSync(path.join(directory, stepFileName(step)), stepJson(step));
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
}

async function planCommand(repo: string, flags: PlanFlags): Promise<number> {
  const mode = (flags.mode ?? 'replay') as CassetteMode;
  if (!['replay', 'record', 'auto'].includes(mode)) {
    console.error(usage);
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
  const edit = { ...defaultEditSettings, samples: Number(flags.samples ?? defaultEditSettings.samples) };
  const critic = flags['no-critic'] ? null : defaultCriticSettings;
  const run = await planRepo(gitRepoFs(repo), gateway, { packageRoot, moduleRoot, pins: profile?.plan?.pins ?? [], edit, critic });

  const outputs = planOutputs(run, { name: profile?.name ?? path.basename(path.resolve(repo)) }, { edit, critic });
  fs.rmSync(path.join(out, 'steps'), { recursive: true, force: true });
  for (const [file, content] of outputs) {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.writeFileSync(path.join(out, file), content);
  }
  const steps = [...outputs.keys()].filter((file) => file.startsWith('steps/'));
  const spent = gateway.spent();
  console.log(`plan: ${run.validation.metrics.groups} groups, ${run.facts.files.length} files, ${run.facts.pins.length} pinned, ${steps.length} steps → ${out}`);
  const cost = `cost of this plan: $${(run.editRun.costUsd + (run.criticRun?.costUsd ?? 0)).toFixed(4)}`;
  console.log(mode === 'replay' ? `${cost} when recorded; this replay spent $0` : `${cost}; ledger: run ${runId} $${spent.run.toFixed(4)}, global $${spent.global.toFixed(4)}`);
  return run.validation.valid ? 0 : 1;
}

function stepsCommand(planYaml: string, outFlag: string | undefined): number {
  const steps = stepsOf(readPlanYaml(fs.readFileSync(planYaml, 'utf8')));
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
    keep: flags.keep,
  });
  if (flags.out) fs.writeFileSync(flags.out, `${JSON.stringify(certificate, null, 1)}\n`);
  if (flags.json) console.log(JSON.stringify(certificate, null, 1));
  else console.log(`${summarize(certificate)}\n\n${trailers(certificate).join('\n')}`);
  return certificate.verdict === 'pass' ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
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
    },
  });
  const [command, repo, range] = positionals;
  if (command === 'analyze' && repo) {
    analyzeCommand(repo, values.json);
    return 0;
  }
  if (command === 'plan' && repo) return planCommand(repo, values);
  if (command === 'steps' && repo) return stepsCommand(repo, values.out);
  if (command === 'move' && repo && values.map) return moveCommand(repo, values.map, values['dry-run'], values.json);
  if (command === 'certify' && repo && range) return certifyCommand(repo, range, values);
  console.error(usage);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));

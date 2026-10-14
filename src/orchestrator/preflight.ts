// R0, preflight and baseline (plan §2.3, §2.5): the plan matches the repo, the certifier's K0 envelope holds over
// every planned move, the inventory, then the profile's oracles twice on the base with a flaky quarantine (contract
// C2). Any failure declines the run with reasons before a branch or a commit exists. Reads commits only.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { BaselineOptions, BaselineResult } from '../certificate/baseline.js';
import { createContext } from '../certificate/certify.js';
import { checkEnvelope } from '../certificate/envelope.js';
import type { Profile } from '../certificate/profile.js';
import { withCoMoves } from '../executor/move-set.js';
import { git } from './git.js';
import type { Preflight, StepRecord } from './types.js';

export interface PreflightInput {
  repo: string;
  environment: string;
  profile: Profile;
  packageRoot: string;
  /** The plan's sha as written, and the commit it resolves to (the run's base). */
  planSha: string;
  base: string;
  /** R1 and R2 steps of the plan. */
  steps: StepRecord[];
  workDir: string;
  /** Run the baseline (skipped when an earlier preflight check already declines). */
  runBaseline: (options: BaselineOptions) => Promise<BaselineResult>;
  log(message: string): void;
}

const identity = {
  GIT_AUTHOR_NAME: 'ac-preflight', GIT_AUTHOR_EMAIL: 'preflight@ac.invalid', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'ac-preflight', GIT_COMMITTER_EMAIL: 'preflight@ac.invalid', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

function plumbing(repo: string, args: string[], { input, env }: { input?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const run = spawnSync('git', ['-C', repo, ...args], { input, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
  return run.stdout;
}

/** A dangling commit on top of `base` whose tree is base's with every move applied as a pure rename (no ref, no checkout). */
function renamesCommit(repo: string, base: string, moves: ReadonlyMap<string, string>): string {
  const index = path.join(plumbing(repo, ['rev-parse', '--absolute-git-dir']).trim(), `ac-preflight-index-${process.pid}`);
  const env = { ...identity, GIT_INDEX_FILE: index };
  try {
    plumbing(repo, ['read-tree', base], { env });
    const entries = new Map(plumbing(repo, ['ls-tree', '-r', '-z', base]).split('\0').filter(Boolean).map((line) => {
      const [meta, file] = line.split('\t') as [string, string];
      const [mode, , oid] = meta.split(' ') as [string, string, string];
      return [file, { mode, oid }];
    }));
    const moved = [...moves].filter(([from]) => entries.has(from));
    if (moved.length) {
      plumbing(repo, ['update-index', '-z', '--force-remove', '--stdin'], { env, input: `${moved.map(([from]) => from).join('\0')}\0` });
      plumbing(repo, ['update-index', '-z', '--index-info'], { env, input: `${moved.map(([from, to]) => `${entries.get(from)!.mode} ${entries.get(from)!.oid}\t${to}`).join('\0')}\0` });
    }
    const tree = plumbing(repo, ['write-tree'], { env }).trim();
    return plumbing(repo, ['commit-tree', tree, '-p', base, '-m', 'ac run preflight: every planned move as a pure rename'], { env }).trim();
  } finally {
    fs.rmSync(index, { force: true });
  }
}

export async function preflight(input: PreflightInput): Promise<{ preflight: Preflight; baseline: BaselineResult | null }> {
  const started = performance.now();
  const { repo, base, packageRoot, profile } = input;
  const declines: Preflight['declines'] = [];
  const tracked = new Set(git(repo, ['ls-tree', '-r', '-z', '--name-only', base]).split('\0').filter(Boolean));

  const missingFiles = [...new Set(input.steps.flatMap((step) => step.entries.flat()))].filter((file) => !tracked.has(file)).sort();
  for (const file of missingFiles) declines.push({ code: 'plan-mismatch', file, detail: `the plan names ${file}, which isn't tracked at ${base.slice(0, 10)}` });

  // K0 over base..(every planned move as a pure rename): the envelope as the certifier will see the moves.
  const plannedMoves = withCoMoves(new Map(input.steps.flatMap((step) => Object.entries(step.moves)).filter(([from]) => tracked.has(from))), tracked);
  input.log(`preflight: K0 envelope over ${plannedMoves.size} planned moves`);
  const planned = renamesCommit(repo, base, plannedMoves);
  const { context, cleanup } = createContext({
    repo, base, head: planned, packageRoot, environment: input.environment, profile, oracles: false, workDir: path.join(input.workDir, 'envelope'), keep: false,
  });
  let envelope: Preflight['envelope'];
  let inventory: Preflight['inventory'];
  try {
    const { violations, metrics } = checkEnvelope(context);
    envelope = { plannedMoves: plannedMoves.size, violations, metrics };
    const analysis = context.analyses().base;
    const hazards: Record<string, number> = {};
    let sites = 0;
    for (const file of analysis.files.values()) {
      sites += file.sites.length;
      for (const hazard of file.hazards) hazards[hazard.kind] = (hazards[hazard.kind] ?? 0) + 1;
    }
    inventory = {
      trackedFiles: tracked.size,
      packageFiles: [...tracked].filter((file) => !packageRoot || file.startsWith(`${packageRoot}/`)).length,
      analyzedFiles: analysis.files.size,
      sites,
      hazards,
    };
  } finally {
    cleanup();
  }
  for (const violation of envelope.violations) declines.push({ code: 'envelope', ...violation });

  let baseline: BaselineResult | null = null;
  if (!profile.oracles?.length) declines.push({ code: 'no-oracles', detail: `profile ${profile.name} names no oracles: no baseline, no rung certificates` });
  else if (!declines.length) {
    input.log(`preflight: baseline, every oracle twice on ${base.slice(0, 10)}`);
    baseline = await input.runBaseline({
      repo, commit: base, packageRoot, environment: input.environment, profile, runs: 2, workDir: path.join(input.workDir, 'baseline'), log: input.log,
    });
    for (const oracle of baseline.oracles.filter((candidate) => !candidate.ok)) {
      declines.push({ code: 'baseline-not-green', detail: `${oracle.name} (${oracle.kind}): ${oracle.detail}` });
    }
    if (!baseline.green && !declines.some((decline) => decline.code === 'baseline-not-green')) declines.push({ code: 'baseline-not-green', detail: 'the baseline is not green' });
  }
  return {
    preflight: {
      format: 'ac-preflight/1',
      base,
      plan: { sha: input.planSha, resolved: base, matchesBranchStart: false, missingFiles },
      inventory,
      envelope,
      baseline: baseline ? { green: baseline.green, flaky: baseline.flaky.length, durationMs: baseline.durationMs } : null,
      declines,
      declined: declines.length > 0,
      durationMs: Math.round(performance.now() - started),
    },
    baseline,
  };
}

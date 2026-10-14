// `ac boundaries <repo> [--profile <name|file>] [--root <package-dir>] [--module-root src] [--env <checkout>] [--out <dir>]`:
// R4's boundary rules for the tree at HEAD, written to <out>/ (the two dependency-cruiser files to add at the package
// root, and report.json); the repo is not written. With --check, runs the rules the package already has, with their
// baseline, on the working tree instead: every new violation is printed, and any fails (exit 1).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProfile } from '../certificate/profile.js';
import { checkWithBaseline } from './dependency-cruiser.js';
import { normalizeDirectory } from './folder-graph.js';
import { buildBoundaryRules } from './index.js';
import { configFileName, knownViolationsFileName } from './rules.js';

export interface BoundariesFlags {
  profile?: string;
  root?: string;
  'module-root'?: string;
  env?: string;
  out?: string;
  check: boolean;
}

export async function boundariesCommand(repo: string, flags: BoundariesFlags): Promise<number> {
  const profile = flags.profile ? loadProfile(flags.profile) : null;
  const packageRoot = normalizeDirectory(flags.root ?? profile?.packageRoot ?? '');
  const moduleRoot = normalizeDirectory(flags['module-root'] ?? profile?.plan?.moduleRoot ?? 'src');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-boundaries-'));
  try {
    return flags.check ? await check(repo, packageRoot, moduleRoot, workDir) : await generate(repo, flags, packageRoot, moduleRoot, workDir);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function generate(repo: string, flags: BoundariesFlags, packageRoot: string, moduleRoot: string, workDir: string): Promise<number> {
  const result = await buildBoundaryRules({
    repo, environment: flags.env ?? repo, packageRoot, moduleRoot, workDir, log: (message) => console.error(message),
  });
  if (flags.out) {
    const out = path.resolve(flags.out);
    fs.mkdirSync(out, { recursive: true });
    for (const [file, content] of result.files) fs.writeFileSync(path.join(out, path.posix.basename(file)), content);
    fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(result.report, null, 1)}\n`);
    console.log(`wrote ${[...result.files.keys()].map((file) => path.posix.basename(file)).join(', ')} (add them at ${packageRoot || 'the repository root'}/) and report.json to ${out}`);
  }
  console.log(result.summary);
  for (const entry of result.antiVacuity) console.log(`  ${entry.fired ? 'fired' : 'VACUOUS'} ${entry.rule}: ${entry.detail}`);
  for (const violation of result.unexpected) console.log(`  unexpected ${violation.rule.name}: ${violation.from} -> ${violation.to}`);
  const { timings } = result;
  console.log(`timings: worktree ${timings.worktreeMs} ms, analysis ${timings.analysisMs} ms, baseline ${timings.baselineMs} ms, check ${timings.checkMs} ms, anti-vacuity ${timings.antiVacuityMs} ms, total ${timings.totalMs} ms`);
  return result.antiVacuity.every((entry) => entry.fired) ? 0 : 1;
}

async function check(repo: string, packageRoot: string, moduleRoot: string, workDir: string): Promise<number> {
  const packageDirectory = path.join(path.resolve(repo), packageRoot);
  const missing = [configFileName, knownViolationsFileName].filter((file) => !fs.existsSync(path.join(packageDirectory, file)));
  if (missing.length) {
    console.error(`${packageDirectory} has no ${missing.join(' or ')}: generate the rules first (ac boundaries without --check)`);
    return 2;
  }
  const outcome = await checkWithBaseline(packageDirectory, [moduleRoot || '.'], path.join(workDir, 'check.json'));
  for (const violation of outcome.errors) {
    const cycle = violation.cycle ? ` (cycle: ${violation.cycle.map((step) => step.name).join(' -> ')})` : '';
    console.log(`${violation.rule.name}: ${violation.from} -> ${violation.to}${cycle}`);
  }
  console.log(`${outcome.errors.length} new violations, ${outcome.known} known, over ${outcome.modules} modules (${Math.round(outcome.durationMs)} ms)`);
  return outcome.errors.length ? 1 : 0;
}

// `ac normalize <repo> [--profile <name|file>] [--root <package-dir>] [--module-root src] [--out <dir>] [--json]`:
// R3's steps for the tree as it is (after R1/R2), written the way `ac steps` writes R1/R2's (<out>/steps/NN-<kind>-<name>.json,
// applied with `ac move`), and every declined rename with its reason.
import fs from 'node:fs';
import path from 'node:path';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import { loadProfile } from '../certificate/profile.js';
import { normalizationSteps } from './index.js';

export interface NormalizeFlags {
  root?: string;
  profile?: string;
  'module-root'?: string;
  out?: string;
  json: boolean;
}

export function normalizeCommand(repo: string, flags: NormalizeFlags): number {
  const profile = flags.profile ? loadProfile(flags.profile) : null;
  const packageRoot = (flags.root ?? profile?.packageRoot ?? '').replace(/^\.\/?/, '').replace(/\/$/, '');
  const moduleRoot = flags['module-root'] ?? profile?.plan?.moduleRoot ?? 'src';
  const { steps, declined } = normalizationSteps(gitRepoFs(repo), { packageRoot, moduleRoot, profile });
  if (flags.out) {
    const directory = path.join(path.resolve(flags.out), 'steps');
    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: true });
    const width = Math.max(2, String(steps.length).length);
    for (const step of steps) {
      const name = `${String(step.index).padStart(width, '0')}-${step.group.replace('/', '-')}.json`;
      fs.writeFileSync(path.join(directory, name), `${JSON.stringify({ step: step.index, rung: step.rung, group: step.group, moves: Object.fromEntries(step.moves) }, null, 1)}\n`);
    }
  }
  if (flags.json) {
    console.log(JSON.stringify({ steps: steps.map((step) => ({ ...step, moves: Object.fromEntries(step.moves) })), declined }, null, 1));
    return 0;
  }
  const renames = steps.reduce((sum, step) => sum + step.moves.size, 0);
  console.log(`R3: ${steps.length} steps, ${renames} renames, ${declined.length} declined${flags.out ? ` → ${path.join(path.resolve(flags.out), 'steps')}` : ''}`);
  for (const step of steps) {
    console.log(`  ${step.index} ${step.group}`);
    for (const [from, to] of step.moves) console.log(`    ${from} -> ${path.posix.basename(to)}`);
  }
  for (const decline of declined) console.log(`  declined ${decline.reason} ${decline.file}${decline.to !== decline.file ? ` -> ${path.posix.basename(decline.to)}` : ''}: ${decline.detail}`);
  return 0;
}

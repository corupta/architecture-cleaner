// H2 for R0's baseline: runBaseline cleans its work dir as the certifier does (openWorkDir), deleting only what it
// made. The work dir is used by its real path (hermetic), so a recursive delete of it went through a symlinked work dir
// and removed the link's target with the user's files in it. What the work dir held stays, and so do a link and its
// target.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBaseline } from '../../src/certificate/baseline.js';
import type { Profile } from '../../src/certificate/profile.js';
import { before, moved, typecheck } from './oracle-tools.js';
import { twoCommits } from './two-commit-repo.js';

const scratches: string[] = [];
beforeAll(() => {
  process.env.AC_ORACLE_CACHE = scratch();
});
afterAll(() => {
  delete process.env.AC_ORACLE_CACHE;
  for (const directory of scratches) fs.rmSync(directory, { recursive: true, force: true });
});
function scratch(): string {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-baseline-cleanup-')));
  scratches.push(directory);
  return directory;
}

describe('runBaseline\'s cleanup', () => {
  const repo = twoCommits(before, moved);
  scratches.push(repo.root);
  const profile: Profile = { name: 'fake', packageRoot: '', node: 'system', env: {}, oracles: [typecheck] };
  const baselineIn = async (workDir: string, keep = false) => {
    const result = await runBaseline({ repo: repo.root, commit: repo.base, packageRoot: '', environment: repo.root, profile, runs: 1, workDir, keep, log: () => {} });
    expect(result.green).toBe(true);
  };
  const userFiles = (directory: string) => {
    fs.mkdirSync(path.join(directory, 'drafts'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'mine\n');
    fs.writeFileSync(path.join(directory, 'drafts', 'plan.md'), 'mine too\n');
  };

  it('keeps a symlinked work dir\'s link, its target and the files it didn\'t make', async () => {
    const root = scratch();
    const target = path.join(root, 'data', 'scratch');
    userFiles(target);
    fs.symlinkSync(target, path.join(root, 'scratch'));
    await baselineIn(path.join(root, 'scratch'));
    expect(fs.lstatSync(path.join(root, 'scratch')).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(target).sort()).toEqual(['drafts', 'notes.txt']);
    expect(fs.readFileSync(path.join(target, 'drafts', 'plan.md'), 'utf8')).toBe('mine too\n');
  });

  it('keeps an empty symlinked work dir and its link', async () => {
    const root = scratch();
    fs.mkdirSync(path.join(root, 'empty'));
    fs.symlinkSync(path.join(root, 'empty'), path.join(root, 'link'));
    await baselineIn(path.join(root, 'link'));
    expect(fs.lstatSync(path.join(root, 'link')).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(path.join(root, 'empty'))).toEqual([]);
  });

  it('keeps the files an existing work dir held', async () => {
    const root = scratch();
    userFiles(path.join(root, 'work'));
    await baselineIn(path.join(root, 'work'));
    expect(fs.readdirSync(path.join(root, 'work')).sort()).toEqual(['drafts', 'notes.txt']);
  });

  it('removes a work dir it made, and with keep leaves its runs (never the worktree)', async () => {
    const root = scratch();
    await baselineIn(path.join(root, 'made', 'work'));
    expect(fs.readdirSync(path.join(root, 'made'))).toEqual([]);
    await baselineIn(path.join(root, 'kept'), true);
    expect(fs.readdirSync(path.join(root, 'kept'))).toContain('runs');
    expect(fs.readdirSync(path.join(root, 'kept'))).not.toContain('worktree');
  });
});

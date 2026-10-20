// H2: the certifier's cleanup deletes only what the certifier made. The work dir is used by its real path (hermetic
// certificates), so a recursive delete of it went through a symlinked work dir and removed the link's target with the
// user's files in it. What the work dir held when the certifier opened it stays, and so do a link and its target.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { certify } from '../../src/certificate/certify.js';
import type { CheckId } from '../../src/certificate/types.js';
import { twoCommits } from './two-commit-repo.js';

const scratches: string[] = [];
afterAll(() => {
  for (const directory of scratches) fs.rmSync(directory, { recursive: true, force: true });
});
const scratch = () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-work-dir-cleanup-')));
  scratches.push(directory);
  return directory;
};

describe('the certifier\'s cleanup', () => {
  const repo = twoCommits(
    { 'src/services/greeter.ts': 'export const greet = () => 1;\n', 'src/main.ts': "import { greet } from './services/greeter.js';\nexport const main = greet;\n" },
    { 'src/modules/greeter/greeter.ts': 'export const greet = () => 1;\n', 'src/main.ts': "import { greet } from './modules/greeter/greeter.js';\nexport const main = greet;\n" },
  );
  scratches.push(repo.root);
  // K3c materializes a worktree in the work dir as well as the shadow root.
  const only: CheckId[] = ['K0', 'K1', 'K3c'];
  const certifyIn = async (workDir: string, keep = false) => {
    const certificate = await certify({ repo: repo.root, base: repo.base, head: repo.head, packageRoot: '', environment: repo.root, profile: null, oracles: false, only, workDir, keep });
    expect(certificate.checks.map((check) => check.status)).not.toContain('error');
    return certificate;
  };
  const userFiles = (directory: string) => {
    fs.mkdirSync(path.join(directory, 'drafts'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'mine\n');
    fs.writeFileSync(path.join(directory, 'drafts', 'plan.md'), 'mine too\n');
  };

  it('keeps a symlinked work dir\'s link, its target and the files the certifier didn\'t make', async () => {
    const root = scratch();
    const target = path.join(root, 'data', 'scratch');
    userFiles(target);
    fs.symlinkSync(target, path.join(root, 'scratch'));
    const certificate = await certifyIn(path.join(root, 'scratch'));
    expect(certificate.workDir).toBe(target);
    expect(fs.lstatSync(path.join(root, 'scratch')).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(target).sort()).toEqual(['drafts', 'notes.txt']);
    expect(fs.readFileSync(path.join(target, 'drafts', 'plan.md'), 'utf8')).toBe('mine too\n');
  });

  it('keeps an empty symlinked work dir and its link', async () => {
    const root = scratch();
    fs.mkdirSync(path.join(root, 'empty'));
    fs.symlinkSync(path.join(root, 'empty'), path.join(root, 'link'));
    await certifyIn(path.join(root, 'link'));
    expect(fs.readdirSync(path.join(root, 'link'))).toEqual([]);
  });

  it('keeps the files an existing work dir held', async () => {
    const root = scratch();
    userFiles(path.join(root, 'work'));
    await certifyIn(path.join(root, 'work'));
    expect(fs.readdirSync(path.join(root, 'work')).sort()).toEqual(['drafts', 'notes.txt']);
  });

  it('removes a work dir it made, or one that was empty (`ac certify`\'s temporary directory), and nothing with --keep', async () => {
    const root = scratch();
    await certifyIn(path.join(root, 'made', 'work'));
    fs.mkdirSync(path.join(root, 'empty'));
    await certifyIn(path.join(root, 'empty'));
    expect(fs.readdirSync(root).sort()).toEqual(['made']);
    expect(fs.readdirSync(path.join(root, 'made'))).toEqual([]);

    await certifyIn(path.join(root, 'kept'), true);
    expect(fs.readdirSync(path.join(root, 'kept'))).toContain('shadow');
  });
});

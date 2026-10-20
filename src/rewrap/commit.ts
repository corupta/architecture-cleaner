// Where the re-wrap reads head's files and how its commit is made: in the checkout itself when it is clean at head
// and resolves packages as the environment does, else in a temporary worktree of head with the environment's
// node_modules linked in (so a prettier config's shared config, or a module a JS config imports, resolves from the
// config's directory); the commit is built with git plumbing on a private index, so the checkout's own branch,
// index and files are never touched unless the caller names its current branch.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function git(repo: string, args: string[], { input, env }: { input?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const run = spawnSync('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', ...args], { input, encoding: 'utf8', maxBuffer: 1 << 30, ...(env ? { env: { ...process.env, ...env } } : {}) });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(run.stderr || run.stdout).trim()}`);
  return run.stdout;
}

export const resolveCommit = (repo: string, revision: string) => git(repo, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).trim();

/** The working tree's top level: a package directory names its repository. */
export const topLevelOf = (repo: string) => git(repo, ['rev-parse', '--show-toplevel']).trim();

/** The real path of `<root>/<directory>/node_modules`, or null when there is none. */
function installedIn(root: string, directory: string): string | null {
  try {
    return fs.realpathSync(path.join(root, directory, 'node_modules'));
  } catch {
    return null;
  }
}

const isCleanAt = (repo: string, commit: string) => {
  const head = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
  return head.status === 0 && head.stdout.trim() === commit && git(repo, ['status', '--porcelain', '--untracked-files=no']).trim() === '';
};

/**
 * A directory holding `head`'s files where packages resolve as in the environment: the checkout when it is clean at
 * head and the node_modules of the root and of every package directory are the environment's (it is the environment,
 * or links to it), else a temporary worktree of head with the environment's linked in.
 */
export function headCheckout(repo: string, head: string, environment: string): { directory: string; cleanup(): void } {
  const topLevel = topLevelOf(repo);
  const manifests = git(repo, ['ls-tree', '-r', '-z', '--name-only', head]).split('\0').filter((file) => path.posix.basename(file) === 'package.json');
  const packages = [...new Set(['.', ...manifests.map((file) => path.posix.dirname(file))])];
  if (isCleanAt(topLevel, head) && packages.every((directory) => installedIn(topLevel, directory) === installedIn(environment, directory))) return { directory: topLevel, cleanup: () => {} };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-rewrap-'));
  git(repo, ['worktree', 'add', '--detach', '--force', directory, head]);
  for (const directoryOfPackage of packages) {
    const installed = path.join(path.resolve(environment), directoryOfPackage, 'node_modules');
    const link = path.join(directory, directoryOfPackage, 'node_modules');
    if (fs.existsSync(installed) && !fs.existsSync(link)) fs.symlinkSync(installed, link);
  }
  return {
    directory,
    cleanup() {
      spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', directory], { stdio: 'ignore' });
      fs.rmSync(directory, { recursive: true, force: true });
      spawnSync('git', ['-C', repo, 'worktree', 'prune'], { stdio: 'ignore' });
    },
  };
}

/** `files` (repo path → text) committed on top of `parent` with the ambient identity; the checkout is not touched. */
export function commitOnto(repo: string, parent: string, files: ReadonlyMap<string, string>, message: string): string {
  const index = path.join(git(repo, ['rev-parse', '--absolute-git-dir']).trim(), `ac-rewrap-index-${process.pid}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    git(repo, ['read-tree', parent], { env });
    const modes = new Map(git(repo, ['ls-tree', '-z', parent, '--', ...files.keys()]).split('\0').filter(Boolean).map((entry) => [entry.slice(entry.indexOf('\t') + 1), entry.split(' ')[0]!]));
    const records = [...files].map(([file, text]) => `${modes.get(file) ?? '100644'} ${git(repo, ['hash-object', '-w', '--stdin'], { input: text }).trim()}\t${file}`);
    git(repo, ['update-index', '-z', '--index-info'], { env, input: `${records.join('\0')}\0` });
    const tree = git(repo, ['write-tree'], { env }).trim();
    return git(repo, ['commit-tree', tree, '-p', parent, '-F', '-'], { input: message }).trim();
  } finally {
    fs.rmSync(index, { force: true });
  }
}

/**
 * How `branch` can take a commit on top of `head`: as a new branch, or as the checkout's current branch when it is
 * clean at head (moved forward with its files). Any other existing branch is refused, before anything is made.
 */
export function branchMode(repo: string, branch: string, head: string): 'create' | 'advance' {
  if (spawnSync('git', ['-C', repo, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status !== 0) {
    git(repo, ['check-ref-format', '--branch', branch]);
    return 'create';
  }
  const current = spawnSync('git', ['-C', repo, 'symbolic-ref', '-q', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  if (current !== branch || !isCleanAt(repo, head)) throw new Error(`branch ${branch} already exists; name a new one, or the checkout's current branch when it is clean at the head commit`);
  return 'advance';
}

export function placeBranch(repo: string, branch: string, commit: string, mode: 'create' | 'advance'): void {
  if (mode === 'create') git(repo, ['branch', branch, commit]);
  else git(repo, ['merge', '-q', '--ff-only', commit]);
}

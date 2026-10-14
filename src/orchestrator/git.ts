// Git on the target repository: the run's branch, its commits, message-only amends and rollbacks. Hooks never run
// (core.hooksPath=/dev/null, --no-verify): the target's code runs only inside the certifier's oracles.
import { spawnSync } from 'node:child_process';

export function git(repo: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): string {
  const run = spawnSync('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', ...args], { input, encoding: 'utf8', maxBuffer: 1 << 30, ...(env ? { env: { ...process.env, ...env } } : {}) });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(run.stderr || run.stdout).trim()}`);
  return run.stdout;
}

export const headCommit = (repo: string) => git(repo, ['rev-parse', 'HEAD']).trim();
export const treeOf = (repo: string, revision: string) => git(repo, ['rev-parse', `${revision}^{tree}`]).trim();
export const resolveRevision = (repo: string, revision: string) => git(repo, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).trim();
export const topLevel = (repo: string) => git(repo, ['rev-parse', '--show-toplevel']).trim();

/** Tracked changes only (staged or not): untracked files never block a run. */
export const isClean = (repo: string) => git(repo, ['status', '--porcelain', '--untracked-files=no']).trim() === '';

export function currentBranch(repo: string): string | null {
  const run = spawnSync('git', ['-C', repo, 'symbolic-ref', '-q', '--short', 'HEAD'], { encoding: 'utf8' });
  return run.status === 0 ? run.stdout.trim() : null;
}

export function branchExists(repo: string, branch: string): boolean {
  return spawnSync('git', ['-C', repo, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
}

/** Creates `branch` at `commit` and checks it out. */
export const createBranch = (repo: string, branch: string, commit: string) => git(repo, ['checkout', '-q', '-b', branch, commit]);
export const checkout = (repo: string, branch: string) => git(repo, ['checkout', '-q', branch]);

/** Commits what is staged with the ambient identity; returns the new HEAD. */
export function commitStaged(repo: string, message: string): string {
  git(repo, ['commit', '-q', '--no-verify', '-F', '-'], message);
  return headCommit(repo);
}

/** Replaces HEAD's message, tree and parents unchanged; returns the new HEAD. */
export function amendMessage(repo: string, message: string): string {
  git(repo, ['commit', '-q', '--amend', '--no-verify', '--allow-empty', '--only', '-F', '-'], message);
  return headCommit(repo);
}

export const resetHard = (repo: string, commit: string) => git(repo, ['reset', '-q', '--hard', commit]);

export const commitMessage = (repo: string, commit: string) => git(repo, ['log', '-1', '--format=%B', commit]);

/** Is `ancestor` reachable from `commit` (or equal to it)? */
export const isAncestor = (repo: string, ancestor: string, commit: string) => spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', ancestor, commit]).status === 0;

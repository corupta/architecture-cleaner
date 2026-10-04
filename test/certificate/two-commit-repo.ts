// Tiny git repos with a base commit and a head commit, and a certify context over them.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext } from '../../src/certificate/certify.js';
import type { CertifyContext, CertifyOptions } from '../../src/certificate/types.js';

/** Path → text, or a symlink. */
export type Tree = Record<string, string | { link: string }>;

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function writeTree(root: string, tree: Tree) {
  for (const entry of fs.readdirSync(root)) if (entry !== '.git') fs.rmSync(path.join(root, entry), { recursive: true, force: true });
  for (const [file, content] of Object.entries(tree)) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (typeof content === 'object') fs.symlinkSync(content.link, absolute);
    else fs.writeFileSync(absolute, content);
  }
}

/**
 * Commits `base`, then `head` on top. `installed` (and whatever `install` does) comes afterwards, untracked (e.g.
 * node_modules): the environment both commits resolve packages from.
 */
export function twoCommits(base: Tree, head: Tree, installed: Record<string, string> = {}, install?: (root: string) => void): { root: string; base: string; head: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-k3a-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'k3a@ac.invalid');
  git(root, 'config', 'user.name', 'k3a');
  git(root, 'config', 'core.autocrlf', 'false');
  writeTree(root, base);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'base');
  const baseCommit = git(root, 'rev-parse', 'HEAD');
  writeTree(root, head);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'head');
  for (const [file, text] of Object.entries(installed)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  install?.(root);
  return { root, base: baseCommit, head: git(root, 'rev-parse', 'HEAD') };
}

/** A tree read from a directory on disk (fixtures' before/ and after/). */
export function treeOf(directory: string): Tree {
  const tree: Tree = {};
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else tree[path.relative(directory, absolute).split(path.sep).join('/')] = fs.readFileSync(absolute, 'utf8');
    }
  };
  walk(directory);
  return tree;
}

export function withContext<T>(base: Tree, head: Tree, body: (context: CertifyContext) => T,
  options: Partial<CertifyOptions> & { installed?: Record<string, string>; install?: (root: string) => void } = {}): T {
  const { installed, install, ...overrides } = options;
  const repo = twoCommits(base, head, installed, install);
  const { context, cleanup } = createContext({
    repo: repo.root, base: repo.base, head: repo.head, packageRoot: '', environment: repo.root, profile: null, oracles: false,
    workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ac-k3a-work-')), keep: false, ...overrides,
  });
  try {
    return body(context);
  } finally {
    cleanup();
    fs.rmSync(repo.root, { recursive: true, force: true });
  }
}

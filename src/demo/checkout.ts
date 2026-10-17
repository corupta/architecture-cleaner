// The demo's own clone of the target at the pinned commit: fetched shallowly from the target's URL, or cloned from a
// local clone (`--repo`) that it shares objects with and never writes to. A clone a previous demo left in the work
// directory is reused when it has the commit. Only the demo writes here: its commits land on its own branch.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface CheckoutOptions {
  /** Where the clone goes (inside the demo's work directory). */
  directory: string;
  sha: string;
  url: string;
  /** A local clone that has the commit; default: fetch it from `url`. */
  repo?: string;
  log(message: string): void;
}

export interface Checkout {
  directory: string;
  /** How the commit got here. */
  source: string;
  durationMs: number;
}

function git(cwd: string, args: string[]): string {
  const run = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(run.stderr || run.stdout || String(run.error ?? '')).trim()}`);
  return run.stdout.trim();
}

const hasCommit = (directory: string, sha: string) => spawnSync('git', ['-C', directory, 'cat-file', '-e', `${sha}^{commit}`]).status === 0;
const isOwnClone = (directory: string) => fs.existsSync(path.join(directory, '.git')) && spawnSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim() === fs.realpathSync(directory);

/** A clean, detached checkout of `sha` at `directory`, with a local identity for the demo's commits. */
export function prepareCheckout(options: CheckoutOptions): Checkout {
  const started = performance.now();
  const directory = path.resolve(options.directory);
  let source: string;
  if (fs.existsSync(directory) && isOwnClone(directory) && hasCommit(directory, options.sha)) {
    source = `reused ${directory}`;
  } else {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    if (options.repo) {
      const repo = path.resolve(options.repo);
      if (!hasCommit(repo, options.sha)) throw new Error(`${repo} doesn't have the commit ${options.sha}: fetch it there, or leave out --repo to fetch it from ${options.url}`);
      options.log(`cloning ${repo} (objects shared, the clone is never written back)`);
      git(path.dirname(directory), ['clone', '-q', '--shared', '--no-checkout', repo, directory]);
      source = `cloned from ${repo}`;
    } else {
      options.log(`fetching ${options.url} at ${options.sha.slice(0, 12)} (depth 1)`);
      fs.mkdirSync(directory);
      git(directory, ['init', '-q']);
      git(directory, ['fetch', '-q', '--depth', '1', '--no-tags', options.url, options.sha]);
      source = `fetched from ${options.url} (depth 1)`;
    }
  }
  const settings: [string, string][] = [['user.name', 'ac demo'], ['user.email', 'ac-demo@localhost'], ['core.autocrlf', 'false'], ['advice.detachedHead', 'false']];
  for (const [key, value] of settings) git(directory, ['config', key, value]);
  git(directory, ['checkout', '-q', '-f', '--detach', options.sha]);
  git(directory, ['clean', '-q', '-f', '-d', '-x']);
  return { directory, source, durationMs: Math.round(performance.now() - started) };
}

// The S3 bug-hunt corpus (test/certificate/hunt/, see its README): every bad executor output must be rejected by
// the static checks (no K8); the identity commit and the hand-written correct moves must certify PASS.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { certify } from '../../src/certificate/certify.js';
import type { Certificate, CheckId, CheckStatus } from '../../src/certificate/types.js';
import { jestNodeModules, localNodeModules } from './runner-repos.js';

interface HuntCase {
  id: string;
  report: string;
  title: string;
  applicable: boolean;
  expectedChecks: { check: CheckId; reason: string }[];
  identityControl?: boolean;
  /** The test runner the case needs installed: vitest comes from this repo, jest from AC_HUNT_JEST_NODE_MODULES. */
  runner?: 'vitest' | 'jest';
  directory: string;
}

const corpus = path.join(import.meta.dirname, 'hunt');
// Jest isn't a dependency of this package; runner-repos.ts points at an installed one.
const runnerNodeModules = {
  vitest: localNodeModules,
  jest: process.env.AC_HUNT_JEST_NODE_MODULES ?? (fs.existsSync(path.join(jestNodeModules, 'jest')) ? jestNodeModules : undefined),
};
// AC_HUNT_CHECKS=K3a,K3c narrows the run to some checks (while developing one).
const staticChecks = (process.env.AC_HUNT_CHECKS?.split(',') ?? ['K0', 'K1', 'K2', 'K3a', 'K3b', 'K3c', 'K4', 'K6', 'K7']) as CheckId[];
const storedDirectoryNames = new Map([['_node_modules', 'node_modules'], ['_dist', 'dist']]);

const cases: HuntCase[] = fs.readdirSync(corpus, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(corpus, entry.name, 'case.json')))
  .map((entry) => ({ ...JSON.parse(fs.readFileSync(path.join(corpus, entry.name, 'case.json'), 'utf8')), directory: path.join(corpus, entry.name) }))
  .sort((a, b) => a.id.localeCompare(b.id));

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Copies a stored tree byte for byte: symlinks verbatim, modes kept, `_node_modules`/`_dist` restored. */
function copyTree(from: string, to: string) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(source), path.join(to, entry.name));
    else if (entry.isDirectory()) copyTree(source, path.join(to, storedDirectoryNames.get(entry.name) ?? entry.name));
    else {
      fs.copyFileSync(source, path.join(to, entry.name));
      fs.chmodSync(path.join(to, entry.name), fs.statSync(source).mode);
    }
  }
}

function commitTree(root: string, tree: string, message: string): string {
  for (const entry of fs.readdirSync(root)) if (entry !== '.git') fs.rmSync(path.join(root, entry), { recursive: true, force: true });
  copyTree(tree, root);
  // -f: every stored file was tracked, even where the case's own .gitignore matches it.
  git(root, 'add', '-A', '-f');
  git(root, 'commit', '-q', '--allow-empty', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

/** `before/` committed, then `head` (after/, good/ or before/ again) on top, with the case's environment installed. */
function materializeCase(huntCase: HuntCase, head: 'after' | 'good' | 'before') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ac-hunt-${huntCase.id}-`));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'hunt@ac.invalid');
  git(root, 'config', 'user.name', 'hunt');
  git(root, 'config', 'core.autocrlf', 'false');
  const base = commitTree(root, path.join(huntCase.directory, 'before'), 'before');
  const headCommit = commitTree(root, path.join(huntCase.directory, head), head);
  const environment = path.join(huntCase.directory, 'environment');
  if (fs.existsSync(environment)) copyTree(environment, root);
  const installed = huntCase.runner && runnerNodeModules[huntCase.runner];
  if (installed) fs.symlinkSync(path.resolve(installed), path.join(root, 'node_modules'));
  return { root, base, head: headCommit };
}

async function certifyCase(huntCase: HuntCase, head: 'after' | 'good' | 'before'): Promise<Certificate> {
  const repo = materializeCase(huntCase, head);
  try {
    return await certify({
      repo: repo.root, base: repo.base, head: repo.head, packageRoot: '', environment: repo.root, profile: null, oracles: false, only: staticChecks,
      workDir: fs.mkdtempSync(path.join(os.tmpdir(), `ac-hunt-work-${huntCase.id}-`)), keep: false,
    });
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true });
  }
}

const statuses = (certificate: Certificate) => certificate.checks.map((check) => `${check.id}:${check.status}`).join(' ');
const idsWith = (certificate: Certificate, status: CheckStatus) => certificate.checks.filter((check) => check.status === status).map((check) => check.id);
const violationsOf = (certificate: Certificate) => certificate.checks
  .filter((check) => check.status === 'fail' || check.status === 'error')
  .flatMap((check) => check.violations.slice(0, 3).map((violation) => `${check.id} ${violation.file ?? ''}: ${violation.detail.split('\n')[0]}`));

const killers = new Map<string, string>();
afterAll(() => {
  if (!killers.size) return;
  const rows = cases.filter((huntCase) => killers.has(huntCase.id))
    .map((huntCase) => `${huntCase.id.padEnd(16)} expected ${huntCase.expectedChecks.map((entry) => entry.check).join(',').padEnd(12)} killed by ${killers.get(huntCase.id)}`);
  console.log(`[hunt] corpus summary\n${rows.join('\n')}`);
});

describe.each(cases.filter((huntCase) => huntCase.applicable))('hunt case $id', (huntCase) => {
  it('is rejected by the static checks', async () => {
    const certificate = await certifyCase(huntCase, 'after');
    const failed = idsWith(certificate, 'fail');
    const crashed = idsWith(certificate, 'error');
    killers.set(huntCase.id, [...failed, ...crashed.map((id) => `${id}(error)`)].join(',') || 'NOTHING');
    console.log([`[hunt] ${huntCase.id}: failed ${failed.join(',') || 'none'}${crashed.length ? `, crashed ${crashed.join(',')}` : ''}; ${statuses(certificate)}`, ...violationsOf(certificate)].join('\n'));
    const expected = huntCase.expectedChecks.map((entry) => `${entry.check} (${entry.reason})`).join('; ');
    expect(failed, `${huntCase.id} "${huntCase.title}" was not rejected by any check${crashed.length ? ` (only crashes: ${crashed.join(',')})` : ''}. Expected: ${expected}. Statuses: ${statuses(certificate)}`).not.toEqual([]);
    expect(certificate.verdict).toBe('fail');
  }, 180_000);
});

describe.each(cases.filter((huntCase) => huntCase.identityControl))('hunt control $id', (huntCase) => {
  it('certifies the identity commit (before -> before)', async () => {
    const certificate = await certifyCase(huntCase, 'before');
    expect(certificate.verdict, `${huntCase.id} identity: ${statuses(certificate)}\n${violationsOf(certificate).join('\n')}`).toBe('pass');
  }, 180_000);
});

describe.each(cases.filter((huntCase) => fs.existsSync(path.join(huntCase.directory, 'good'))))('hunt control $id', (huntCase) => {
  it('certifies the correct move (before -> good)', async () => {
    const certificate = await certifyCase(huntCase, 'good');
    expect(certificate.verdict, `${huntCase.id} correct move: ${statuses(certificate)}\n${violationsOf(certificate).join('\n')}`).toBe('pass');
  }, 180_000);
});

it('hunt index.json matches the case directories', () => {
  const index = JSON.parse(fs.readFileSync(path.join(corpus, 'index.json'), 'utf8')) as Record<string, { applicable: boolean; expectedChecks: string[] }>;
  expect(Object.keys(index).sort()).toEqual(cases.map((huntCase) => huntCase.id).sort());
  for (const huntCase of cases) {
    expect(index[huntCase.id]!.applicable, huntCase.id).toBe(huntCase.applicable);
    expect(index[huntCase.id]!.expectedChecks, huntCase.id).toEqual(huntCase.expectedChecks.map((entry) => entry.check));
    expect(fs.existsSync(path.join(huntCase.directory, 'after')), huntCase.id).toBe(huntCase.applicable);
  }
});

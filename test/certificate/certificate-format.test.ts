// Certificate v2 (S6 contract C1): it names the two trees, its digest leaves out commit ids, machine paths and
// durations, and its trailers name trees, so amending the certified commit's message keeps all of it true.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalForm, certify, digestOf } from '../../src/certificate/certify.js';
import { trailers } from '../../src/certificate/report.js';
import type { Certificate } from '../../src/certificate/types.js';
import { twoCommits } from './two-commit-repo.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const tsconfig = JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true }, include: ['src'] });
const repo = twoCommits(
  { 'tsconfig.json': tsconfig, 'src/a.ts': "import { b } from './b';\nexport const a = b;\n", 'src/b.ts': 'export const b = 1;\n' },
  { 'tsconfig.json': tsconfig, 'src/a.ts': "import { b } from './lib/b';\nexport const a = b;\n", 'src/lib/b.ts': 'export const b = 1;\n' },
);
afterAll(() => fs.rmSync(repo.root, { recursive: true, force: true }));

const certifyHead = (head: string) => certify({
  repo: repo.root, base: repo.base, head, packageRoot: '', environment: repo.root, profile: null, oracles: false, only: ['K0', 'K1', 'K2', 'K3a'],
  workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ac-format-work-')), keep: false,
});

describe('certificate v2', () => {
  it('names the trees, and an amended commit message keeps the trees, the digest and the trailers', async () => {
    const first = await certifyHead(repo.head);
    expect(first.format).toBe('ac-certificate/2');
    expect(first.verdict).toBe('pass');
    expect(first.baseTree).toBe(git(repo.root, 'rev-parse', `${repo.base}^{tree}`));
    expect(first.headTree).toBe(git(repo.root, 'rev-parse', `${repo.head}^{tree}`));
    expect(trailers(first)).toEqual([
      'Ac-Certificate: pass (static) K0=pass K1=pass K2=pass K3=pass',
      `Ac-Certificate-Base-Tree: ${first.baseTree}`,
      `Ac-Certificate-Tree: ${first.headTree}`,
      `Ac-Certificate-Digest: ${first.digest}`,
    ]);
    expect(first.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    git(repo.root, 'checkout', '-q', '--detach', repo.head);
    git(repo.root, 'commit', '-q', '--amend', '-m', `head\n\n${trailers(first).join('\n')}`);
    const amended = git(repo.root, 'rev-parse', 'HEAD');
    const second = await certifyHead(amended);
    expect(second.head).toBe(amended);
    expect(second.head).not.toBe(first.head);
    expect(second.workDir).not.toBe(first.workDir);
    expect(second.headTree).toBe(first.headTree);
    expect(second.digest).toBe(first.digest);
    expect(trailers(second)).toEqual(trailers(first));
  });

  it('recomputes from the stored JSON; covers what was certified, not where, when or how long', async () => {
    const certificate = await certifyHead(repo.head);
    const stored = JSON.parse(JSON.stringify(certificate)) as Certificate;
    const { digest, ...rest } = stored;
    expect(digestOf(rest)).toBe(digest);
    const elsewhere = {
      ...rest, repo: '/other/clone', base: 'f'.repeat(40), head: 'e'.repeat(40), workDir: '/other/work',
      environment: { ...rest.environment, checkout: '/other/clone', node: 'v0.0.0' },
      checks: rest.checks.map((check) => ({ ...check, durationMs: check.durationMs + 1234, run: { seconds: 99, logs: '/other/work/logs' } })),
    };
    expect(digestOf(elsewhere)).toBe(digest);
    expect(canonicalForm(rest)).not.toContain(rest.workDir);
    for (const changed of [{ ...rest, headTree: '0'.repeat(40) }, { ...rest, profile: 'immich' }, { ...rest, verdict: 'fail' as const },
      { ...rest, checks: rest.checks.map((check) => ({ ...check, status: 'fail' as const })) }, { ...rest, pathMap: { ...rest.pathMap, entries: {} } }]) {
      expect(digestOf(changed)).not.toBe(digest);
    }
  });

  it('stands a placeholder in for the work dir, the environment and the repository wherever a check names them', () => {
    const fields = { workDir: '/tmp/ac-work-1', repo: '/home/u/repo', environment: { checkout: '/home/u/repo', node: 'v1', linkedNodeModules: [] } };
    const certificateWith = (overrides: typeof fields) => ({
      format: 'ac-certificate/2' as const, tool: { name: 'architecture-cleaner', version: '0' }, base: 'a', head: 'b', baseTree: 'c', headTree: 'd', packageRoot: '', profile: null,
      pathMap: { moves: 0, unchanged: 0, editedInPlace: 0, deleted: [], added: [], ambiguousGroups: 0, entries: {} }, verdict: 'pass' as const, scope: 'full' as const, residualRisk: [],
      checks: [{ id: 'K8' as const, title: 'Oracles', status: 'pass' as const, summary: 'ok', metrics: {}, violations: [], durationMs: 1,
        findings: [{ kind: 'network-attempt', detail: `see ${overrides.workDir}/oracles/head and ${overrides.repo}/server` }] }],
      ...overrides,
    });
    const one = certificateWith(fields);
    const two = certificateWith({ workDir: '/var/tmp/ac-work-2', repo: '/srv/repo', environment: { checkout: '/srv/repo', node: 'v2', linkedNodeModules: [] } });
    expect(canonicalForm(one)).toContain('see {workDir}/oracles/head and {environment}/server');
    expect(digestOf(one)).toBe(digestOf(two));
  });
});

// K8's oracle runs in the per-tree cache: a run of either side is reused wherever its tree is certified again (the
// next range's base, the whole PR's base and head), the certificate is byte-identical to a fresh one and says which
// runs came from the cache, a damaged entry or a changed oracle misses, and the baseline seeds the base.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBaseline } from '../../src/certificate/baseline.js';
import { canonicalForm, certify } from '../../src/certificate/certify.js';
import type { OracleSpec, Profile } from '../../src/certificate/profile.js';
import { openTreeCache, type ToolIdentity } from '../../src/certificate/tree-cache.js';
import type { Certificate, CheckResult } from '../../src/certificate/types.js';
import { before, moved, typecheck, unit } from './oracle-tools.js';
import { commitChain } from './two-commit-repo.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-oracle-tree-cache-'));
let previous: string | undefined;
beforeAll(() => {
  // The commit-keyed base cache stays out of these tests: every hit here is the per-tree cache's.
  previous = process.env.AC_ORACLE_CACHE;
  process.env.AC_ORACLE_CACHE = 'off';
});
afterAll(() => {
  if (previous === undefined) delete process.env.AC_ORACLE_CACHE;
  else process.env.AC_ORACLE_CACHE = previous;
  fs.rmSync(scratch, { recursive: true, force: true });
});
let counter = 0;
const fresh = (name: string) => {
  const directory = path.join(scratch, `${name}-${counter++}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
};

/** An artifact oracle without a reference blob: base runs whenever head runs. */
const names: OracleSpec = {
  name: 'names', kind: 'artifact-identical', cwd: '{scratch}/run', command: ['node', '{worktree}/tools/produce.mjs', '{scratch}/out/names.txt', '{worktree}/src'],
  artifact: '{scratch}/out/names.txt',
};
const profileOf = (oracles: OracleSpec[], fields: Partial<Profile> = {}): Profile => ({ name: 'fixture', packageRoot: '', node: 'system', oracles, ...fields });

/** Three commits: base, the user module moved, then the main file moved as well. */
function chain() {
  const third = { ...moved, 'src/app/main.ts': "import { user } from '../users/user';\nexport const main = user;\n" };
  delete (third as Record<string, string>)['src/main.ts'];
  return commitChain([before, moved, third]);
}

async function certifyK8(repo: string, base: string, head: string, profile: Profile, cacheDir?: string): Promise<Certificate> {
  return certify({ repo, base, head, packageRoot: '', environment: repo, profile, oracles: true, only: ['K8'], workDir: fresh('work'), keep: false, ...(cacheDir ? { cacheDir } : {}) });
}

const k8 = (certificate: Certificate): CheckResult => certificate.checks.find((check) => check.id === 'K8')!;
const cachedFacts = (certificate: Certificate) => Object.fromEntries(Object.entries(k8(certificate).run ?? {}).filter(([key]) => key.endsWith('.cached')));

describe('K8 runs in the per-tree cache', () => {
  it('reuses a head run as the next range\'s base and both ends for the whole range, with the certificate a fresh run gives', async () => {
    const { root, commits } = chain();
    const [first, second, third] = commits as [string, string, string];
    const profile = profileOf([typecheck, unit, names]);
    const cacheDir = fresh('cache');
    const step1 = await certifyK8(root, first, second, profile, cacheDir);
    expect(step1.verdict).toBe('pass');
    expect(cachedFacts(step1)).toEqual({
      'typecheck.head.cached': false, 'unit.head.cached': false, 'unit.base.cached': false, 'names.head.cached': false, 'names.base.cached': false,
    });
    const step2 = await certifyK8(root, second, third, profile, cacheDir);
    expect(cachedFacts(step2)).toMatchObject({ 'unit.base.cached': true, 'names.base.cached': true, 'unit.head.cached': false });
    const whole = await certifyK8(root, first, third, profile, cacheDir);
    expect(cachedFacts(whole)).toEqual({
      'typecheck.head.cached': true, 'unit.head.cached': true, 'unit.base.cached': true, 'names.head.cached': true, 'names.base.cached': true,
    });
    expect(k8(whole).run?.cache).toBe(`per tree: ${cacheDir}`);

    const uncached = await certifyK8(root, first, third, profile);
    expect(cachedFacts(uncached)).toMatchObject({ 'unit.head.cached': false, 'unit.base.cached': false });
    expect(canonicalForm(whole)).toBe(canonicalForm(uncached));
    expect(whole.digest).toBe(uncached.digest);
    expect(k8(whole).summary).toBe(k8(uncached).summary);
  });

  it('gives a cached failure the texts of a fresh one: the logs are copied to where the run would have written them', async () => {
    const broken = { ...moved, 'src/users/user.ts': 'export const user = 1; // ERROR\n' };
    const { root, commits } = commitChain([before, broken]);
    const [base, head] = commits as [string, string];
    const profile = profileOf([typecheck]);
    const cacheDir = fresh('cache');
    await certifyK8(root, base, head, profile, cacheDir);
    const cached = await certifyK8(root, base, head, profile, cacheDir);
    expect(cachedFacts(cached)).toMatchObject({ 'typecheck.head.cached': true, 'typecheck.base.cached': true });
    expect(cached.verdict).toBe('fail');
    const log = k8(cached).violations[0]!.detail;
    expect(log).toContain(path.join(cached.workDir, 'oracles', 'head', 'typecheck', 'step-1.log'));
    expect(fs.existsSync(path.join(cacheDir, 'K8-run'))).toBe(true);
    const uncached = await certifyK8(root, base, head, profile);
    expect(canonicalForm(cached)).toBe(canonicalForm(uncached));
  });

  it('misses when the oracle or the variables its steps see change, and ignores a damaged entry', async () => {
    const { root, commits } = chain();
    const [first, second] = commits as [string, string];
    const cacheDir = fresh('cache');
    await certifyK8(root, first, second, profileOf([unit]), cacheDir);
    const again = await certifyK8(root, first, second, profileOf([unit]), cacheDir);
    expect(cachedFacts(again)).toEqual({ 'unit.head.cached': true, 'unit.base.cached': true });
    const otherCommand = await certifyK8(root, first, second, profileOf([{ ...unit, timeoutSeconds: 600 }]), cacheDir);
    expect(cachedFacts(otherCommand)).toEqual({ 'unit.head.cached': false, 'unit.base.cached': false });
    const otherEnvironment = await certifyK8(root, first, second, profileOf([unit], { env: { TZ: 'UTC' } }), cacheDir);
    expect(cachedFacts(otherEnvironment)).toEqual({ 'unit.head.cached': false, 'unit.base.cached': false });

    for (const entry of fs.readdirSync(path.join(cacheDir, 'K8-run'))) {
      const report = path.join(cacheDir, 'K8-run', entry, 'files', 'report.json');
      if (fs.existsSync(report)) fs.writeFileSync(report, '{"testResults": []}');
    }
    const damaged = await certifyK8(root, first, second, profileOf([unit]), cacheDir);
    expect(cachedFacts(damaged)).toEqual({ 'unit.head.cached': false, 'unit.base.cached': false });
    expect(damaged.verdict).toBe('pass');
    const repaired = await certifyK8(root, first, second, profileOf([unit]), cacheDir);
    expect(cachedFacts(repaired)).toEqual({ 'unit.head.cached': true, 'unit.base.cached': true });
  });

  it('is seeded by the baseline: the first range certified after it reads its base runs', async () => {
    const { root, commits } = chain();
    const [first, second] = commits as [string, string];
    const profile = profileOf([typecheck, unit, names]);
    const cacheDir = fresh('cache');
    const baseline = await runBaseline({ repo: root, commit: first, packageRoot: '', environment: root, profile, runs: 2, workDir: fresh('baseline'), cacheDir, log: () => {} });
    expect(baseline.green).toBe(true);
    const certificate = await certifyK8(root, first, second, profile, cacheDir);
    expect(cachedFacts(certificate)).toMatchObject({ 'unit.base.cached': true, 'names.base.cached': true, 'unit.head.cached': false });
    expect(certificate.verdict).toBe('pass');
  });
});

describe('tree cache file entries', () => {
  const tool: ToolIdentity = { version: '1.0.0', code: 'c'.repeat(64) };
  const tree = 'a'.repeat(40);

  it('copies a directory in and out, leaving out what the filter excludes, and misses on another key or damage', () => {
    const checkout = fresh('checkout');
    const cache = openTreeCache(fresh('cache'), { packageRoot: '', environment: { checkout, linked: [] }, tool });
    const source = fresh('source');
    fs.mkdirSync(path.join(source, 'scratch'), { recursive: true });
    fs.mkdirSync(path.join(source, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(source, 'run.json'), '{"root": "/somewhere"}');
    fs.writeFileSync(path.join(source, 'nested', 'step-1.log'), 'log');
    fs.writeFileSync(path.join(source, 'scratch', 'big.bin'), 'scratch');
    cache.writeFiles('kind', tree, { oracle: 'unit' }, source, (relative) => relative.startsWith('scratch'));
    const target = path.join(fresh('target'), 'run');
    expect(cache.readFiles('kind', tree, { oracle: 'unit' }, target)).toBe(true);
    expect(fs.readdirSync(target, { recursive: true }).sort()).toEqual(['nested', path.join('nested', 'step-1.log'), 'run.json']);
    expect(fs.readFileSync(path.join(target, 'run.json'), 'utf8')).toBe('{"root": "/somewhere"}');
    expect(cache.readFiles('kind', tree, { oracle: 'tsc' }, target)).toBe(false);
    expect(fs.existsSync(target)).toBe(false);

    const [entry] = fs.readdirSync(path.join(cache.directory, 'kind'));
    fs.appendFileSync(path.join(cache.directory, 'kind', entry!, 'files', 'nested', 'step-1.log'), ' changed');
    expect(cache.readFiles('kind', tree, { oracle: 'unit' }, target)).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
    cache.writeFiles('kind', tree, { oracle: 'unit' }, source, (relative) => relative.startsWith('scratch'));
    expect(cache.readFiles('kind', tree, { oracle: 'unit' }, target)).toBe(true);
  });
});

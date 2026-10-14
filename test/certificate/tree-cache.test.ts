// The per-tree result cache: keys that change with everything a result depends on, relocated machine paths, entries
// that are ignored when damaged, and K6 inventories reused across certifications with byte-identical certificates.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { canonicalForm, certify, createContext } from '../../src/certificate/certify.js';
import type { Profile } from '../../src/certificate/profile.js';
import { inventoryKey } from '../../src/certificate/test-inventory.js';
import { cacheDirFromEnvironment, codeHash, openTreeCache, type Places, type ToolIdentity } from '../../src/certificate/tree-cache.js';
import type { Certificate, CertifyOptions, CheckId } from '../../src/certificate/types.js';
import { checkOf, localNodeModules, variant, vitestRepo, vitestRepoMoved } from './runner-repos.js';
import { commitChain } from './two-commit-repo.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-tree-cache-test-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));
let counter = 0;
const fresh = (name: string) => {
  const directory = path.join(scratch, `${name}-${counter++}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
};

/** An environment checkout: `<checkout>/node_modules` links to a real directory with a pnpm marker, and a lockfile. */
function environmentOf(name: string) {
  const checkout = fresh(`${name}-checkout`);
  const installed = fresh(`${name}-installed`);
  fs.writeFileSync(path.join(installed, '.modules.yaml'), 'layoutVersion: 5\n');
  fs.symlinkSync(installed, path.join(checkout, 'node_modules'));
  fs.writeFileSync(path.join(checkout, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  return { checkout, installed, environment: { checkout, linked: [''] } };
}

const tool: ToolIdentity = { version: '1.0.0', code: 'a'.repeat(64) };
const tree = 'f'.repeat(40);
const places = (root: string): Places => [['root-real', root], ['root', root]];

describe('tree cache entries', () => {
  it('relocates the paths of the certification that wrote an entry to the one that reads it, in keys and values', () => {
    const { environment } = environmentOf('relocate');
    const cache = openTreeCache(fresh('cache'), { packageRoot: '', environment, tool });
    const value = { file: '/w/one/worktree-head/src/a.test.ts', '/w/one/worktree-head/x': 'key', note: 'nothing to move', nested: ['/w/one/worktree-head-other'] };
    cache.write('kind', tree, { runner: 'vitest' }, places('/w/one/worktree-head'), value);
    expect(cache.read('kind', tree, { runner: 'vitest' }, places('/v/two/worktree-base'))).toEqual({
      file: '/v/two/worktree-base/src/a.test.ts', '/v/two/worktree-base/x': 'key', note: 'nothing to move', nested: ['/v/two/worktree-base-other'],
    });
    expect(fs.readFileSync(path.join(cache.directory, 'kind', fs.readdirSync(path.join(cache.directory, 'kind'))[0]!), 'utf8')).not.toContain('/w/one');
  });

  it('misses when any key component differs: tree, kind, the check\'s key, package root, tool version or code', () => {
    const { environment } = environmentOf('components');
    const directory = fresh('cache');
    const key = { runner: { kind: 'vitest', config: 'vitest.config.mjs' } };
    openTreeCache(directory, { packageRoot: 'server', environment, tool }).write('kind', tree, key, [], { stored: true });
    const read = (scope: { packageRoot?: string; tool?: ToolIdentity }, kind = 'kind', treeId = tree, readKey: unknown = key) =>
      openTreeCache(directory, { packageRoot: scope.packageRoot ?? 'server', environment, tool: scope.tool ?? tool }).read(kind, treeId, readKey, []);
    expect(read({})).toEqual({ stored: true });
    expect(read({}, 'other-kind')).toBeUndefined();
    expect(read({}, 'kind', 'e'.repeat(40))).toBeUndefined();
    expect(read({}, 'kind', tree, { runner: { kind: 'vitest', config: 'test/vitest.config.mjs' } })).toBeUndefined();
    expect(read({ packageRoot: '' })).toBeUndefined();
    expect(read({ tool: { ...tool, version: '1.0.1' } })).toBeUndefined();
    expect(read({ tool: { ...tool, code: 'b'.repeat(64) } })).toBeUndefined();
  });

  it('misses when the environment differs: another checkout, node_modules retargeted, reinstalled, or another lockfile', () => {
    const first = environmentOf('environment');
    const directory = fresh('cache');
    const scope = () => ({ packageRoot: '', environment: first.environment, tool });
    openTreeCache(directory, scope()).write('kind', tree, {}, [], 1);
    const read = (environment = first.environment) => openTreeCache(directory, { packageRoot: '', environment, tool }).read('kind', tree, {}, []);
    expect(read()).toBe(1);
    expect(read(environmentOf('other').environment)).toBeUndefined();

    const marker = path.join(first.installed, '.modules.yaml');
    const stat = fs.statSync(marker);
    fs.utimesSync(marker, stat.atime, new Date(stat.mtimeMs + 5000));
    expect(read()).toBeUndefined();
    openTreeCache(directory, scope()).write('kind', tree, {}, [], 2);
    expect(read()).toBe(2);

    fs.writeFileSync(path.join(first.checkout, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\npackages: {}\n");
    expect(read()).toBeUndefined();
    openTreeCache(directory, scope()).write('kind', tree, {}, [], 3);
    expect(read()).toBe(3);

    const reinstalled = fresh('reinstalled');
    fs.cpSync(first.installed, reinstalled, { recursive: true, preserveTimestamps: true });
    fs.rmSync(path.join(first.checkout, 'node_modules'));
    fs.symlinkSync(reinstalled, path.join(first.checkout, 'node_modules'));
    expect(read()).toBeUndefined();
  });

  it('ignores a damaged entry, recomputes and overwrites it', () => {
    const { environment } = environmentOf('damaged');
    const cache = openTreeCache(fresh('cache'), { packageRoot: '', environment, tool });
    cache.write('kind', tree, {}, [], { files: ['a', 'b'] });
    const [name] = fs.readdirSync(path.join(cache.directory, 'kind'));
    const file = path.join(cache.directory, 'kind', name!);
    const good = fs.readFileSync(file, 'utf8');
    const damages = [
      good.slice(0, good.length - 5),
      good.replace('"a"', '"c"'),
      good.split('\n')[0]!,
      good.replace('"format":1', '"format":0'),
      `garbage\n${good.split('\n')[1]}`,
      '',
    ];
    for (const damaged of damages) {
      fs.writeFileSync(file, damaged);
      expect(cache.read('kind', tree, {}, [])).toBeUndefined();
    }
    cache.write('kind', tree, {}, [], { files: ['a', 'b'] });
    expect(cache.read('kind', tree, {}, [])).toEqual({ files: ['a', 'b'] });
    expect(fs.readdirSync(path.join(cache.directory, 'kind'))).toEqual([name]);
  });

  it('hashes the tool\'s code: an edited or added file changes it', () => {
    const code = fresh('code');
    fs.writeFileSync(path.join(code, 'check.js'), 'export const a = 1;\n');
    const preload = path.join(fresh('preload'), 'block-net.cjs');
    fs.writeFileSync(preload, 'module.exports = {};\n');
    const first = codeHash([code], [preload]);
    expect(codeHash([code], [preload])).toBe(first);
    fs.writeFileSync(path.join(code, 'check.js'), 'export const a = 2;\n');
    const edited = codeHash([code], [preload]);
    expect(edited).not.toBe(first);
    fs.writeFileSync(path.join(code, 'other.js'), '\n');
    expect(codeHash([code], [preload])).not.toBe(edited);
    fs.writeFileSync(preload, 'module.exports = { blocked: true };\n');
    expect(codeHash([code], [preload])).not.toBe(edited);
  });

  it('is off unless AC_CERTIFY_CACHE names a directory', () => {
    expect(cacheDirFromEnvironment({})).toBeUndefined();
    expect(cacheDirFromEnvironment({ AC_CERTIFY_CACHE: '' })).toBeUndefined();
    expect(cacheDirFromEnvironment({ AC_CERTIFY_CACHE: 'off' })).toBeUndefined();
    expect(cacheDirFromEnvironment({ AC_CERTIFY_CACHE: 'cache' })).toBe(path.resolve('cache'));
  });
});

describe('the K6 inventory key', () => {
  const profile = (fields: Partial<Profile> = {}): Profile => ({ name: 'fixture', packageRoot: '', node: 'system', ...fields });
  const runner = { kind: 'vitest' as const, cwd: 'server', config: 'server/vitest.config.mjs', origin: 'profile' as const, environment: {} };
  const keyOf = (fields: Partial<Profile> = {}, runnerFields: Partial<typeof runner> = {}) =>
    JSON.stringify(inventoryKey({ options: { profile: profile(fields) } as CertifyOptions }, { ...runner, ...runnerFields }));

  it('changes with the runner spec, its script environment and the probe\'s environment', () => {
    const base = keyOf();
    expect(keyOf()).toBe(base);
    const variants = [
      keyOf({}, { cwd: '' }),
      keyOf({}, { config: 'server/test/vitest.config.mjs' }),
      keyOf({}, { kind: 'jest' as never }),
      keyOf({}, { args: ['--project', 'unit'] } as never),
      keyOf({}, { environment: { NODE_PATH: 'src' } }),
      keyOf({ env: { TZ: 'UTC' } }),
    ];
    for (const variant of variants) expect(variant).not.toBe(base);
    expect(new Set(variants).size).toBe(variants.length);
  });

  it.skipIf(!fs.existsSync(path.join(os.homedir(), 'ac-targets/.node/node-v24.21.0-linux-arm64')) && !fs.existsSync(path.join(os.homedir(), 'ac-targets/.node/node-v24.21.0-linux-x64')))(
    'changes with the target Node',
    () => {
      expect(keyOf({ node: '24.21.0' })).not.toBe(keyOf());
    },
  );
});

/** Three commits under vitest (this package's install): the billing move, then an unreferenced module moved. */
function vitestChain() {
  const third = variant(vitestRepoMoved, { 'src/legacy/clock.ts': 'src/old/clock.ts' });
  return commitChain([vitestRepo, vitestRepoMoved, third], (root) => fs.symlinkSync(localNodeModules, path.join(root, 'node_modules')));
}

async function certifyK6(repo: string, base: string, head: string, fields: Partial<CertifyOptions> = {}, only: CheckId[] = ['K6']): Promise<Certificate> {
  return certify({
    repo, base, head, packageRoot: '', environment: repo, profile: null, oracles: false, only,
    workDir: fs.mkdtempSync(path.join(scratch, 'work-')), keep: false, ...fields,
  });
}

describe('K6 with a tree cache', () => {
  it('reads step k\'s head inventory as step k+1\'s base, with the certificate a fresh run gives', async () => {
    const { root, commits } = vitestChain();
    const [first, second, third] = commits as [string, string, string];
    const cacheDir = fresh('k6-cache');
    const step1 = await certifyK6(root, first, second, { cacheDir });
    expect(checkOf(step1, 'K6').run).toMatchObject({ 'base.cached': false, 'head.cached': false });
    expect(step1.verdict).toBe('pass');
    const step2 = await certifyK6(root, second, third, { cacheDir });
    expect(checkOf(step2, 'K6').run).toMatchObject({ 'base.cached': true, 'head.cached': false });
    const uncached = await certifyK6(root, second, third);
    expect(Object.keys(checkOf(uncached, 'K6').run ?? {})).toEqual(['base.ms', 'head.ms']);
    expect(canonicalForm(step2)).toBe(canonicalForm(uncached));
    expect(step2.digest).toBe(uncached.digest);
    expect(checkOf(step2, 'K6').metrics).toMatchObject({ baseFiles: 1, baseTests: 2, headTests: 2 });

    const again = await certifyK6(root, first, second, { cacheDir });
    expect(checkOf(again, 'K6').run).toMatchObject({ 'base.cached': true, 'head.cached': true });
    expect(again.digest).toBe(step1.digest);
  });

  it('misses when the probe would run with another environment', async () => {
    const { root, commits } = vitestChain();
    const [first, second] = commits as [string, string];
    const cacheDir = fresh('k6-cache');
    await certifyK6(root, first, second, { cacheDir });
    const profile: Profile = { name: 'fixture', packageRoot: '', node: 'system', env: { AC_TREE_CACHE_TEST: '1' } };
    const other = await certifyK6(root, first, second, { cacheDir, profile });
    expect(checkOf(other, 'K6').run).toMatchObject({ 'base.cached': false, 'head.cached': false });
  });

  it('puts the reading certification\'s worktree into cached failure texts', async () => {
    const broken = variant(vitestRepo, { 'src/services/billing.ts': 'src/modules/billing/billing.ts' }, {
      'src/modules/billing/billing.ts': [["'../lib/clock.js'", "'../../lib/clock.js'"]],
    });
    const { root, commits } = commitChain([vitestRepo, broken], (directory) => fs.symlinkSync(localNodeModules, path.join(directory, 'node_modules')));
    const [base, head] = commits as [string, string];
    const cacheDir = fresh('k6-cache');
    const uncached = await certifyK6(root, base, head);
    await certifyK6(root, base, head, { cacheDir });
    const cached = await certifyK6(root, base, head, { cacheDir });
    expect(checkOf(cached, 'K6').run).toMatchObject({ 'base.cached': true, 'head.cached': true });
    const detail = checkOf(cached, 'K6').violations[0]!.detail;
    expect(detail).toContain('loads in base, fails to load in head');
    expect(detail).toContain(path.join(cached.workDir, 'worktree-head'));
    expect(canonicalForm(cached)).toBe(canonicalForm(uncached));
  });
});

describe('the analyzer pass with a tree cache', () => {
  const treeChecks: CheckId[] = ['K0', 'K1', 'K2', 'K3a', 'K4', 'K7'];

  it('is read back for a tree met again, and the certificate stays byte-identical', async () => {
    const { root, commits } = vitestChain();
    const [first, second, third] = commits as [string, string, string];
    const cacheDir = fresh('analysis-cache');
    await certifyK6(root, first, second, { cacheDir }, treeChecks);
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (lines.push(String(chunk)), true));
    let cached: Certificate;
    try {
      cached = await certifyK6(root, second, third, { cacheDir }, treeChecks);
    } finally {
      spy.mockRestore();
    }
    expect(lines).toContain('[certify] analysis of base from the tree cache\n');
    expect(lines).not.toContain('[certify] analysis of head from the tree cache\n');
    const uncached = await certifyK6(root, second, third, {}, treeChecks);
    expect(cached.verdict).toBe('pass');
    expect(cached.digest).toBe(uncached.digest);
  });

  it('gives checks the analysis a fresh pass gives', () => {
    const { root, commits } = vitestChain();
    const cacheDir = fresh('analysis-cache');
    const contextOf = (fields: Partial<CertifyOptions>) => createContext({
      repo: root, base: commits[1]!, head: commits[2]!, packageRoot: '', environment: root, profile: null, oracles: false, workDir: fresh('context'), keep: false, ...fields,
    });
    const analysesOf = (fields: Partial<CertifyOptions>) => {
      const { context, cleanup } = contextOf(fields);
      try {
        return context.analyses();
      } finally {
        cleanup();
      }
    };
    const uncached = analysesOf({});
    analysesOf({ cacheDir });
    const cached = analysesOf({ cacheDir });
    expect(fs.readdirSync(path.join(cacheDir, 'analysis'))).toHaveLength(2);
    expect(isDeepStrictEqual(cached, uncached)).toBe(true);
    expect(cached.base.files.size).toBeGreaterThan(3);
  });
});

describe('certify with a relative work dir', () => {
  it('runs the runner probes (they start inside a worktree, where a relative path names another directory)', async () => {
    const { root, commits } = vitestChain();
    const workDir = path.relative(process.cwd(), fs.mkdtempSync(path.join(scratch, 'relative-')));
    const certificate = await certifyK6(root, commits[0]!, commits[1]!, { workDir });
    expect(checkOf(certificate, 'K6').status).toBe('pass');
    expect(certificate.workDir).toBe(path.resolve(workDir));
  });

  it('gives checks the absolute work dir', () => {
    const { root, commits } = vitestChain();
    const { context, cleanup } = createContext({ repo: root, base: commits[0]!, head: commits[1]!, packageRoot: '', environment: root, profile: null, oracles: false, workDir: path.relative(process.cwd(), fresh('context')), keep: false });
    try {
      expect(path.isAbsolute(context.options.workDir)).toBe(true);
    } finally {
      cleanup();
    }
  });
});

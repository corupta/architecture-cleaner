import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturesDirectory } from '../helpers.js';
import {
  certifyFiles, checkOf, type Files, filesOf, installed, jestNodeModules, localNodeModules, mochaNodeModules, variant, vitestRepo, vitestRepoMoved,
} from './runner-repos.js';

const k6 = async (base: Files, head: Files, nodeModules?: string) => checkOf(await certifyFiles(base, head, { only: ['K6'], ...(nodeModules ? { nodeModules } : {}) }), 'K6');

describe('K6 under vitest (globTestSpecifications + collect)', () => {
  it('passes a correct move with per-file names and modes equal', async () => {
    const check = await k6(vitestRepo, vitestRepoMoved, localNodeModules);
    expect(check.violations).toEqual([]);
    expect(check.metrics).toMatchObject({ runner: 'vitest', baseFiles: 1, headFiles: 1, baseTests: 2, headTests: 2, baseUnloadable: 0, headUnloadable: 0 });
    expect(String(check.metrics.snapshots)).toContain('K8');
  });

  it('fails a test file moved out of the include globs', async () => {
    const head = variant(vitestRepo, { 'src/services/billing.test.ts': 'tests/billing.test.ts' }, {
      'tests/billing.test.ts': [["'./billing.js'", "'../src/services/billing.js'"], ["vi.mock('./gateway.js')", "vi.mock('../src/services/gateway.js')"]],
    });
    const check = await k6(vitestRepo, head, localNodeModules);
    expect(check.status).toBe('fail');
    expect(check.metrics).toMatchObject({ droppedFiles: 1, lostTests: 2 });
    expect(check.violations[0]!.detail).toBe('no longer in the vitest test list (now at tests/billing.test.ts)');
  });

  it('fails a test file that no longer loads, even though no test fails', async () => {
    const head = variant(vitestRepo, { 'src/services/billing.ts': 'src/modules/billing/billing.ts' }, {
      'src/modules/billing/billing.ts': [["'../lib/clock.js'", "'../../lib/clock.js'"]],
    });
    const check = await k6(vitestRepo, head, localNodeModules);
    expect(check.status).toBe('fail');
    expect(check.metrics).toMatchObject({ loadRegressions: 1, headUnloadable: 1, lostTests: 2 });
    expect(check.violations[0]).toMatchObject({ file: 'src/services/billing.test.ts', detail: expect.stringContaining('loads in base, fails to load in head') });
    expect(check.summary).toContain('1 of 1 test files fail to load (base: 0)');
  });

  it('fails changed test names and modes', async () => {
    const head = variant(vitestRepo, {}, { 'src/services/billing.test.ts': [["it.todo('refunds')", "it.skip('refunds', () => {})"]] });
    const check = await k6(vitestRepo, head, localNodeModules);
    expect(check.metrics.caseChanges).toBe(1);
    expect(check.violations[0]!.detail).toBe("2 tests in base, 2 in head; case 2: base 'billing > refunds' (todo), head 'billing > refunds' (skip)");
  });

  it('applied executor fixture vitest-mocks passes', async () => {
    const fixture = path.join(fixturesDirectory, 'vitest-mocks');
    const check = await k6(filesOf(path.join(fixture, 'before')), filesOf(path.join(fixture, 'after')), localNodeModules);
    expect(check.violations).toEqual([]);
    expect(check.metrics).toMatchObject({ baseFiles: 2, baseTests: 2 });
  });

  it('records a file that fails to load on both sides with a different error as a finding, not a violation', async () => {
    const broken = variant(vitestRepo, {}, { 'src/services/billing.test.ts': [["import { bill } from './billing.js';", "import { bill } from './billing.js';\nimport './missing-a.js';"]] });
    const head = variant(broken, {}, { 'src/services/billing.test.ts': [["'./missing-a.js'", "'./missing-b.js'"]] });
    const check = await k6(broken, head, localNodeModules);
    expect(check.violations).toEqual([]);
    expect(check.metrics).toMatchObject({ baseUnloadable: 1, headUnloadable: 1 });
    expect(check.findings).toEqual([expect.objectContaining({ kind: 'load-error-changed', file: 'src/services/billing.test.ts' })]);
  });

  it('errors instead of ignoring CI arguments it does not apply', async () => {
    const profile = { name: 'fixture', packageRoot: '', node: 'system', runner: { kind: 'vitest' as const, cwd: '', args: ['--project', 'unit'] } };
    const check = checkOf(await certifyFiles(vitestRepo, vitestRepoMoved, { only: ['K6'], nodeModules: localNodeModules, profile }), 'K6');
    expect(check.status).toBe('error');
    expect(check.summary).toContain('applied for mocha only');
  });

  it('skips when the runner is not installed', async () => {
    const check = await k6(vitestRepo, vitestRepoMoved);
    expect(check.status).toBe('skip');
  });
});

describe.skipIf(!installed(jestNodeModules, 'jest'))('K6 under jest (--listTests, never-matching --testNamePattern, haste mock map)', () => {
  const fixture = path.join(fixturesDirectory, 'jest-mocks');
  const before = filesOf(path.join(fixture, 'before'));
  const after = filesOf(path.join(fixture, 'after'));

  it('passes the applied jest-mocks fixture', async () => {
    const check = await k6(before, after, jestNodeModules);
    expect(check.violations).toEqual([]);
    expect(check.metrics).toMatchObject({ runner: 'jest', baseFiles: 2, baseTests: 4, manualMocks: 2, newDuplicateMockNames: 0 });
  });

  it('fails a renamed manual mock that collides with another mock name', async () => {
    const head = variant(before, { 'src/services/__mocks__/user.repository.ts': 'src/services/__mocks__/mailer.ts' });
    const check = await k6(before, head, jestNodeModules);
    expect(check.status).toBe('fail');
    const details = check.violations.map((violation) => violation.detail);
    expect(details).toContainEqual(expect.stringMatching(/^jest manual mock 'project 0: user\.repository' is src\/services\/__mocks__\/mailer\.ts mapped from base, gone in head/));
    expect(details).toContainEqual(expect.stringMatching(/^new duplicate jest manual mock name 'project 0: mailer'/));
  }, 120_000);
});

describe.skipIf(!installed(mochaNodeModules, 'mocha') || !installed(mochaNodeModules, 'tsx'))('K6 under mocha + tsx (mocha loads each file itself)', () => {
  const repo = {
    'package.json': JSON.stringify({ name: 'mocha-fixture', private: true, scripts: { test: 'mocha --require tsx tests/unit/**/*.ts' } }),
    'src/clock.ts': 'export const now = () => 1;\n',
    'tests/unit/a/clock.test.ts': "import assert from 'node:assert';\nimport { now } from '../../../src/clock';\n\ndescribe('clock', () => {\n  it('ticks', () => assert.equal(now(), 1));\n  it.skip('stops');\n});\n",
    'tests/unit/b/other.test.ts': "describe('other', () => {\n  it('works', () => {});\n});\n",
  };

  it('passes a correct move, and fails a test moved one level deeper than the unquoted glob reaches', async () => {
    const good = await k6(repo, variant(repo, { 'src/clock.ts': 'src/lib/clock.ts' }, { 'tests/unit/a/clock.test.ts': [["'../../../src/clock'", "'../../../src/lib/clock'"]] }), mochaNodeModules);
    expect(good.violations).toEqual([]);
    expect(good.metrics).toMatchObject({ runner: 'mocha', baseFiles: 2, baseTests: 3 });
    const deeper = variant(repo, { 'tests/unit/a/clock.test.ts': 'tests/unit/a/deep/clock.test.ts' }, { 'tests/unit/a/deep/clock.test.ts': [["'../../../src/clock'", "'../../../../src/clock'"]] });
    const dropped = await k6(repo, deeper, mochaNodeModules);
    expect(dropped.metrics).toMatchObject({ droppedFiles: 1, lostTests: 2 });
  });
});

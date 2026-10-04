import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mochaArguments } from '../../src/certificate/runner-probe.js';
import { fixturesDirectory } from '../helpers.js';
import {
  certifyFiles, checkOf, filesOf, installed, jestNodeModules, localNodeModules, mochaNodeModules, variant, vitestRepo, vitestRepoMoved,
} from './runner-repos.js';

const k3b = async (base: Parameters<typeof certifyFiles>[0], head: Parameters<typeof certifyFiles>[1], nodeModules?: string) =>
  checkOf(await certifyFiles(base, head, { only: ['K3b'], ...(nodeModules ? { nodeModules } : {}) }), 'K3b');

describe('K3b under vitest (its own Vite resolver)', () => {
  it('passes a correct move, sites resolved by the installed vitest', async () => {
    const check = await k3b(vitestRepo, vitestRepoMoved, localNodeModules);
    expect(check.violations).toEqual([]);
    expect(check.status).toBe('pass');
    expect(check.metrics).toMatchObject({ runner: 'vitest', runnerVersion: expect.stringMatching(/^\d/), dangling: 0 });
    expect(Number(check.metrics.sites)).toBeGreaterThan(5);
  });

  it('fails a rewrite to a same-basename file that the test inventory cannot see', async () => {
    const head = variant(vitestRepoMoved, {}, { 'src/modules/billing/billing.ts': [["'../../lib/clock.js'", "'../../legacy/clock.js'"]] });
    const check = await k3b(vitestRepo, head, localNodeModules);
    expect(check.status).toBe('fail');
    expect(check.metrics.retargeted).toBe(1);
    expect(check.violations[0]!.detail).toContain('base src/lib/clock.ts, head src/legacy/clock.ts');
  });

  it('fails a dangling specifier and an alias that no longer reaches its file', async () => {
    const head = variant(vitestRepo, { 'src/services/gateway.ts': 'src/platform/gateway.ts', 'src/services/__mocks__/gateway.ts': 'src/platform/__mocks__/gateway.ts' }, {
      'src/services/billing.test.ts': [["vi.mock('./gateway.js')", "vi.mock('../platform/gateway.js')"]],
    });
    const check = await k3b(vitestRepo, head, localNodeModules);
    expect(check.status).toBe('fail');
    expect(check.violations.map((violation) => violation.detail)).toEqual([expect.stringMatching(/^site 1 '@\/services\/gateway' \(import\): base src\/platform\/gateway\.ts, head unresolved \(src\/services\/gateway does not exist\)$/)]);
  });

  it('fails a manual mock left behind (vitest redirects vi.mock to __mocks__ beside the module)', async () => {
    const head = variant(vitestRepo, { 'src/services/gateway.ts': 'src/platform/gateway.ts' }, {
      'src/services/billing.ts': [["'@/services/gateway'", "'@/platform/gateway'"]],
      'src/services/billing.test.ts': [["vi.mock('./gateway.js')", "vi.mock('../platform/gateway.js')"]],
    });
    const check = await k3b(vitestRepo, head, localNodeModules);
    expect(check.status).toBe('fail');
    expect(check.metrics.mockChanged).toBe(1);
    expect(check.violations[0]!.detail).toContain('manual mock base src/services/__mocks__/gateway.ts, head unresolved');
  });

  it('fails an unresolved mock whose text changed (a virtual mock must keep its id)', async () => {
    const head = variant(vitestRepo, {}, { 'src/services/billing.test.ts': [["'./virtual-only.js'", "'../virtual-only.js'"]] });
    const check = await k3b(vitestRepo, head, localNodeModules);
    expect(check.metrics.unresolvedTextChanged).toBe(1);
  });

  it('applied executor fixture vitest-mocks passes', async () => {
    const fixture = path.join(fixturesDirectory, 'vitest-mocks');
    const check = await k3b(filesOf(path.join(fixture, 'before')), filesOf(path.join(fixture, 'after')), localNodeModules);
    expect(check.violations).toEqual([]);
    expect(check.status).toBe('pass');
  });

  it('skips when the runner is not installed', async () => {
    const check = await k3b(vitestRepo, vitestRepoMoved);
    expect(check.status).toBe('skip');
    expect(check.skipReason).toContain('vitest is not installed');
  });

  it('skips a repo without a test runner', async () => {
    const check = await k3b({ 'src/a.ts': 'export const a = 1;\n' }, { 'src/b.ts': 'export const a = 1;\n' }, localNodeModules);
    expect(check.status).toBe('skip');
  });
});

describe.skipIf(!installed(jestNodeModules, 'jest'))('K3b under jest (jest-config, haste map, jest-resolve)', () => {
  const fixture = path.join(fixturesDirectory, 'jest-mocks');
  const before = filesOf(path.join(fixture, 'before'));
  const after = filesOf(path.join(fixture, 'after'));

  it('passes the applied jest-mocks fixture', async () => {
    const check = await k3b(before, after, jestNodeModules);
    expect(check.violations).toEqual([]);
    expect(check.metrics).toMatchObject({ runner: 'jest', dangling: 0 });
  });

  it('fails a module moved without its sibling __mocks__ file', async () => {
    const head = { ...after };
    delete head['src/modules/user/__mocks__/user.repository.ts'];
    head['src/services/__mocks__/user.repository.ts'] = before['src/services/__mocks__/user.repository.ts']!;
    const check = await k3b(before, head, jestNodeModules);
    expect(check.status).toBe('fail');
    expect(check.violations.some((violation) => violation.detail.includes('sibling __mocks__ file base src/services/__mocks__/user.repository.ts, head unresolved'))).toBe(true);
  });

  it('fails, without erroring, a test moved out of the roots (hunt B06: the only file it had to compare)', async () => {
    const directory = path.join(import.meta.dirname, 'hunt/B06');
    const check = await k3b(filesOf(path.join(directory, 'before')), filesOf(path.join(directory, 'after')), jestNodeModules);
    expect(check.status).toBe('fail');
    expect(check.violations).toEqual([{ file: 'tests/sum.test.ts', detail: "moved from in to outside the roots of jest project 'project 0' (was src/sum.test.ts)" }]);
  });
});

describe.skipIf(!installed(mochaNodeModules, 'mocha') || !installed(mochaNodeModules, 'tsx'))('K3b under mocha + tsx (Node resolution with tsx registered)', () => {
  const repo = {
    'package.json': JSON.stringify({ name: 'mocha-fixture', private: true, scripts: { test: 'mocha --require tsx tests/**/*.test.ts' } }),
    'src/clock.ts': 'export const now = () => 1;\n',
    'src/billing.ts': "import { now } from './clock';\nexport const bill = () => now();\n",
    'tests/billing.test.ts': "import assert from 'node:assert';\nimport { bill } from '../src/billing';\n\ndescribe('billing', () => {\n  it('bills', () => assert.equal(bill(), 1));\n});\n",
  };

  it('passes a correct move and fails a dangling require', async () => {
    const moved = variant(repo, { 'src/clock.ts': 'src/lib/clock.ts' }, { 'src/billing.ts': [["'./clock'", "'./lib/clock'"]] });
    const good = await k3b(repo, moved, mochaNodeModules);
    expect(good.violations).toEqual([]);
    expect(good.metrics.runner).toBe('mocha');
    const broken = await k3b(repo, variant(repo, { 'src/clock.ts': 'src/lib/clock.ts' }), mochaNodeModules);
    expect(broken.metrics.dangling).toBe(1);
  });
});

describe('mocha argv as /bin/sh hands it over', () => {
  const tree = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-mocha-argv-'));
    for (const file of ['tests/unit/a/one.test.ts', 'tests/unit/a/b/two.test.ts']) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), '');
    }
    return root;
  };

  it('expands an unquoted ** like dash (one directory level) and keeps a quoted glob for mocha', () => {
    const root = tree();
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: "mocha --require tsx tests/unit/**/*.ts && mocha 'tests/unit/**/*.ts'" } }));
    expect(mochaArguments(root, { kind: 'mocha', cwd: '' })).toEqual(['--require', 'tsx', 'tests/unit/a/one.test.ts']);
    expect(mochaArguments(root, { kind: 'mocha', cwd: '', args: ['--recursive', 'tests/unit/**/*.ts'] })).toEqual(['--recursive', 'tests/unit/a/one.test.ts']);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: "mocha 'tests/unit/**/*.ts'" } }));
    expect(mochaArguments(root, { kind: 'mocha', cwd: '' })).toEqual(['tests/unit/**/*.ts']);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

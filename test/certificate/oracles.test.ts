// K8: report parsing and comparison on canned jest/vitest/mocha/tsc outputs, then the check end to end on tiny repos
// whose oracles are node scripts tracked in the repo (exit-zero, tests, artifact-identical, the base cache).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContext } from '../../src/certificate/certify.js';
import {
  compareDiagnostics, compareTestReports, effectiveExit, excludeTests, flakyTests, mapPathTokens, parseTestReport, parseTscDiagnostics, selectTests, totalsOf,
} from '../../src/certificate/oracle-reports.js';
import { oracles } from '../../src/certificate/oracles.js';
import type { OracleSpec, Profile } from '../../src/certificate/profile.js';
import type { QuarantineEntry } from '../../src/certificate/baseline.js';
import type { CertifyContext, CheckResult } from '../../src/certificate/types.js';
import { before, moved, spec, typecheck, unit } from './oracle-tools.js';
import { type Tree, twoCommits } from './two-commit-repo.js';

const root = '/work/tree';
const identity = (file: string) => file;

const jestFile = (name: string, cases: [string[], string, string][], message = '') => ({
  name: `${root}/${name}`,
  status: cases.some(([, , status]) => status === 'failed') || (message && !cases.length) ? 'failed' : 'passed',
  message,
  assertionResults: cases.map(([ancestorTitles, title, status]) => ({ ancestorTitles, title, fullName: [...ancestorTitles, title].join(' '), status })),
});
const snapshot = (fields: Record<string, number> = {}) => ({ added: 0, filesAdded: 0, updated: 0, filesUpdated: 0, total: 2, matched: 2, unmatched: 0, unchecked: 0, filesUnmatched: 0, filesRemoved: 0, ...fields });

describe('test reports', () => {
  it('parses jest/vitest reports with load failures, duplicate names and raw statuses', () => {
    const report = parseTestReport('vitest', {
      success: false,
      snapshot: snapshot(),
      testResults: [
        jestFile('src/a.spec.ts', [[['A'], 'works', 'passed'], [['A'], 'works', 'failed'], [['A', 'b'], 'skips', 'skipped'], [[], 'later', 'todo']]),
        jestFile('src/broken.spec.ts', [], 'SyntaxError: Unexpected token'),
      ],
    }, root);
    const a = report.files.get('src/a.spec.ts')!;
    expect(a.loaded).toBe(true);
    expect(a.cases.map((testCase) => [testCase.id, testCase.status])).toEqual([
      ['["A","works"]#0', 'passed'], ['["A","works"]#1', 'failed'], ['["A","b","skips"]#0', 'skipped'], ['["later"]#0', 'todo'],
    ]);
    expect(report.files.get('src/broken.spec.ts')!.loaded).toBe(false);
    expect(totalsOf(report)).toEqual({ files: 2, loaded: 1, cases: 4, passed: 1, failed: 1, skipped: 2 });
    expect(report.success).toBe(false);
  });

  it('parses mocha reports: pending from the pending list, hook failures as failed cases', () => {
    const test = (file: string, fullTitle: string, err: object = {}) => ({ title: fullTitle.split(' ').pop(), fullTitle, file: `${root}/${file}`, err });
    const report = parseTestReport('mocha', {
      tests: [test('t/a.test.ts', 'A one'), test('t/a.test.ts', 'A two', { message: 'boom' }), test('t/a.test.ts', 'A three'), test('t/b.test.ts', 'B one')],
      pending: [test('t/a.test.ts', 'A three')],
      failures: [test('t/a.test.ts', 'A two', { message: 'boom' }), test('t/b.test.ts', 'B "after all" hook', { message: 'hook' })],
    }, root);
    expect(report.files.get('t/a.test.ts')!.cases.map((testCase) => testCase.status)).toEqual(['passed', 'failed', 'pending']);
    expect(report.files.get('t/b.test.ts')!.cases.map((testCase) => [testCase.name, testCase.status])).toEqual([['B one', 'passed'], ['B "after all" hook', 'failed']]);
    expect(report.files.get('t/b.test.ts')!.status).toBe('failed');
  });

  it('compares per file under the pathMap: equal moves pass, every kind of difference is reported', () => {
    const cases: [string[], string, string][] = [[['S'], 'x', 'passed'], [['S'], 'x', 'passed'], [['S'], 'y', 'passed']];
    const base = parseTestReport('jest', { success: true, snapshot: snapshot(), testResults: [jestFile('old/a.test.ts', cases), jestFile('keep.test.ts', cases), jestFile('gone.test.ts', cases)] }, root);
    const map = (file: string) => (file === 'old/a.test.ts' ? 'new/a.test.ts' : file);
    const equal = parseTestReport('jest', { success: true, snapshot: snapshot(), testResults: [jestFile('new/a.test.ts', cases), jestFile('keep.test.ts', cases), jestFile('gone.test.ts', cases)] }, root);
    expect(compareTestReports(base, equal, map)).toEqual({ differences: [], equalFiles: 3, equalCases: 9, snapshotProblems: [] });

    const changed = parseTestReport('jest', {
      success: true,
      snapshot: snapshot({ added: 1, unchecked: 1 }),
      testResults: [
        jestFile('new/a.test.ts', [], 'Cannot find module'),
        jestFile('keep.test.ts', [[['S'], 'x', 'passed'], [['S'], 'x', 'failed'], [['S'], 'z', 'passed']]),
        jestFile('extra.test.ts', cases),
      ],
    }, root);
    const comparison = compareTestReports(base, changed, map);
    expect(comparison.differences.map((difference) => difference.file)).toEqual(['extra.test.ts', 'gone.test.ts', 'keep.test.ts', 'new/a.test.ts']);
    const detail = (file: string) => comparison.differences.find((difference) => difference.file === file)!.detail;
    expect(detail('new/a.test.ts')).toContain('failed to load on head');
    expect(detail('new/a.test.ts')).toContain('base old/a.test.ts');
    expect(detail('keep.test.ts')).toContain('passed → failed: S x (#2)');
    expect(detail('keep.test.ts')).toContain('missing on head: S y');
    expect(detail('keep.test.ts')).toContain('only on head: S z');
    expect(detail('gone.test.ts')).toContain('not on head');
    expect(detail('extra.test.ts')).toContain('head only');
    expect(comparison.snapshotProblems).toEqual(['snapshot.added is 1 on head (must be 0 in CI mode)', 'snapshot.unchecked is 1 on head, 0 on base']);
  });

  it('reports the same cases in another order', () => {
    const base = parseTestReport('jest', { testResults: [jestFile('a.test.ts', [[[], 'x', 'passed'], [[], 'y', 'passed']])] }, root);
    const head = parseTestReport('jest', { testResults: [jestFile('a.test.ts', [[[], 'y', 'passed'], [[], 'x', 'passed']])] }, root);
    expect(compareTestReports(base, head, identity).differences[0]!.detail).toContain('different order');
  });

  it('merges a file reported twice (several runner projects) into one outcome with continuing ordinals', () => {
    const report = parseTestReport('vitest', {
      testResults: [jestFile('a.spec.ts', [[['A'], 'x', 'passed']]), jestFile('b.spec.ts', [[[], 'y', 'passed']]), jestFile('a.spec.ts', [[['A'], 'x', 'failed']])],
    }, root);
    const merged = report.files.get('a.spec.ts')!;
    expect(merged.status).toBe('failed');
    expect(merged.cases.map((testCase) => [testCase.id, testCase.status])).toEqual([['["A","x"]#0', 'passed'], ['["A","x"]#1', 'failed']]);
    expect(totalsOf(report)).toMatchObject({ files: 2, cases: 3 });
  });
});

describe('flaky and excluded tests', () => {
  const report = (files: [string, [string, string][], string?][], fields: Record<string, unknown> = {}) =>
    parseTestReport('jest', { success: true, snapshot: snapshot(), ...fields, testResults: files.map(([name, cases, message]) => jestFile(name, cases.map(([title, status]) => [['S'], title, status]), message)) }, root);

  it('finds cases whose status changes between runs, and files whose shape does', () => {
    const first = report([['a.test.ts', [['x', 'passed'], ['y', 'passed']]], ['b.test.ts', [['z', 'passed']]], ['c.test.ts', [['w', 'passed']]]]);
    const second = report([['a.test.ts', [['x', 'passed'], ['y', 'failed']]], ['b.test.ts', [], 'Error: boom'], ['c.test.ts', [['w', 'passed']]]]);
    expect(flakyTests([first, second])).toEqual([
      { file: 'a.test.ts', name: 'S > y', outcomes: ['passed', 'failed'] },
      { file: 'b.test.ts', outcomes: ['1 cases', 'failed to load'] },
    ]);
    expect(flakyTests([first])).toEqual([]);
    expect(flakyTests([first, first])).toEqual([]);
  });

  it('leaves out whole files and named cases, and taints a report that loses a failure', () => {
    const failing = report([['a.test.ts', [['x', 'passed'], ['y', 'failed']]], ['b.test.ts', [['z', 'passed']]]], { success: false });
    const { report: withoutCase, removed } = excludeTests(failing, selectTests([{ file: 'a.test.ts', name: 'S > y' }]));
    expect(removed).toBe(1);
    expect(withoutCase.files.get('a.test.ts')).toMatchObject({ status: 'passed', cases: [expect.objectContaining({ fullName: 'S > x' })] });
    expect(withoutCase.tainted).toBe(true);
    const withoutFile = excludeTests(failing, selectTests([{ file: 'b.test.ts' }]));
    expect([...withoutFile.report.files.keys()]).toEqual(['a.test.ts']);
    expect(withoutFile.report.tainted).toBeUndefined();
    // A tainted side's run-level outcome isn't compared; per-case differences still are.
    const passing = report([['a.test.ts', [['x', 'passed']]], ['b.test.ts', [['z', 'passed']]]]);
    expect(compareTestReports(passing, withoutCase, identity)).toMatchObject({ differences: [], snapshotProblems: [] });
  });

  it('counts a runner exit as 0 only when excluded tests are the only failures', () => {
    const failing = report([['a.test.ts', [['x', 'passed'], ['y', 'failed']]]]);
    expect(effectiveExit(1, failing, selectTests([{ file: 'a.test.ts', name: 'S > y' }]))).toBe(0);
    expect(effectiveExit(1, failing, selectTests([{ file: 'a.test.ts', name: 'S > x' }]))).toBe(1);
    expect(effectiveExit(1, report([['a.test.ts', [['x', 'passed']]]]), selectTests([{ file: 'a.test.ts', name: 'S > x' }]))).toBe(1);
    expect(effectiveExit(1, report([['a.test.ts', [], 'Error']]), selectTests([{ file: 'a.test.ts' }]))).toBe(0);
  });
});

describe('tsc diagnostics', () => {
  const baseOutput = [
    'src/old/user.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.',
    'src/main.ts(1,20): error TS2305: Module \'"/base/tree/src/old/user"\' has no exported member \'Missing\'.',
    'error TS5083: Cannot read file \'/base/tree/tsconfig.extra.json\'.',
    'src/main.ts(9,1): error TS2345: Argument of type',
    '  with a continuation line.',
  ].join('\n');
  const headOutput = [
    'src/main.ts(1,24): error TS2305: Module \'"/head/tree/src/users/user"\' has no exported member \'Missing\'.',
    'src/users/user.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.',
    'error TS5083: Cannot read file \'/head/tree/tsconfig.extra.json\'.',
    'src/main.ts(9,1): error TS2345: Argument of type',
    '  with a continuation line.',
  ].join('\n');
  const moves = new Map([['src/old/user.ts', 'src/users/user.ts']]);
  const map = (file: string) => moves.get(file) ?? file;

  it('parses file, code and message, drops positions and the worktree root, joins continuation lines', () => {
    const diagnostics = parseTscDiagnostics(baseOutput, '/base/tree', '/base/tree');
    expect(diagnostics).toEqual([
      { file: 'src/old/user.ts', code: 'TS2322', message: 'Type \'string\' is not assignable to type \'number\'.' },
      { file: 'src/main.ts', code: 'TS2305', message: 'Module \'"src/old/user"\' has no exported member \'Missing\'.' },
      { file: '', code: 'TS5083', message: 'Cannot read file \'tsconfig.extra.json\'.' },
      { file: 'src/main.ts', code: 'TS2345', message: 'Argument of type with a continuation line.' },
    ]);
  });

  it('equal modulo the pathMap, in any order; a new or a gone diagnostic is a difference', () => {
    const base = parseTscDiagnostics(baseOutput, '/base/tree', '/base/tree');
    const head = parseTscDiagnostics(headOutput, '/head/tree', '/head/tree');
    expect(compareDiagnostics(base, head, map, moves)).toEqual({ onlyHead: [], onlyBase: [] });
    const extra = parseTscDiagnostics(`${headOutput}\nsrc/users/user.ts(4,1): error TS2307: Cannot find module './x'.`, '/head/tree', '/head/tree');
    expect(compareDiagnostics(base, extra.slice(1), map, moves)).toEqual({
      onlyHead: [{ file: 'src/users/user.ts', code: 'TS2307', message: 'Cannot find module \'./x\'.' }],
      onlyBase: [{ file: 'src/main.ts', code: 'TS2305', message: 'Module \'"src/users/user"\' has no exported member \'Missing\'.' }],
    });
  });

  it('says {artifacts} for the run directory, which differs between base, head and cached runs', () => {
    const output = "error TS5083: Cannot read file '/work/base/oracles/base/tests/scratch/tsconfig.tests.json'.";
    expect(parseTscDiagnostics(output, '/tree', '/tree', '/work/base/oracles/base/tests')).toEqual([
      { file: '', code: 'TS5083', message: "Cannot read file '{artifacts}/scratch/tsconfig.tests.json'." },
    ]);
  });

  it('maps path tokens with or without extension, also relative to a package root', () => {
    const packageMoves = new Map([['server/src/services/album.service.ts', 'server/src/modules/album/album.service.ts']]);
    expect(mapPathTokens('import("server/src/services/album.service") and \'src/services/album.service.js\' but not src/services/album.service.spec', packageMoves))
      .toBe('import("server/src/modules/album/album.service") and \'src/modules/album/album.service.js\' but not src/services/album.service.spec');
  });
});

const repos: string[] = [];
afterAll(() => {
  for (const repo of repos) fs.rmSync(repo, { recursive: true, force: true });
});

function commits(base: Tree, head: Tree) {
  const repo = twoCommits(base, head);
  repos.push(repo.root);
  return repo;
}

interface CertifyOptions {
  enabled?: boolean;
  offline?: boolean;
  quarantine?: QuarantineEntry[];
  flakyRetries?: number;
  env?: Record<string, string>;
  /** Runs before K8, like an earlier check that uses the worktrees. */
  earlier?: (context: CertifyContext) => void;
}

async function certifyRepo(repo: ReturnType<typeof twoCommits>, oracleSpecs: OracleSpec[], { enabled = true, offline = false, earlier, quarantine, flakyRetries, env }: CertifyOptions = {}): Promise<CheckResult> {
  const profile: Profile = { name: 'fake', packageRoot: '', node: 'system', offline, oracles: oracleSpecs, ...(env ? { env } : {}) };
  const { context, cleanup } = createContext({
    repo: repo.root, base: repo.base, head: repo.head, packageRoot: '', environment: repo.root, profile, oracles: enabled,
    workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ac-oracles-work-')), keep: false,
    ...(quarantine ? { quarantine } : {}), ...(flakyRetries !== undefined ? { flakyRetries } : {}),
  });
  try {
    earlier?.(context);
    return await oracles.run(context);
  } finally {
    cleanup();
  }
}

const certifyK8 = (base: Tree, head: Tree, oracleSpecs: OracleSpec[], options: CertifyOptions = {}) => certifyRepo(commits(base, head), oracleSpecs, options);

describe('K8 on tiny repos', () => {
  let cache: string;
  beforeEach(() => {
    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-oracle-cache-'));
    process.env.AC_ORACLE_CACHE = cache;
  });
  afterEach(() => {
    delete process.env.AC_ORACLE_CACHE;
    fs.rmSync(cache, { recursive: true, force: true });
  });

  it('skips unless requested, and when the environment lacks a prerequisite', async () => {
    expect((await certifyK8(before, moved, [typecheck], { enabled: false })).status).toBe('skip');
    const missing = await certifyK8(before, moved, [{ ...typecheck, requires: ['node_modules/.bin/tsc'] }]);
    expect(missing.status).toBe('skip');
    expect(missing.skipReason).toContain('node_modules/.bin/tsc');
  });

  it('passes a pure move: exit 0, equal tests per file under the pathMap, artifact equal to the base blob', async () => {
    const check = await certifyK8(before, moved, [typecheck, unit, spec]);
    expect(check.violations).toEqual([]);
    expect(check.status).toBe('pass');
    expect(check.summary).toBe('typecheck exit 0; unit 1/1 files and 3/3 cases equal to base (head: 1/1 files load, 2 passed, 0 failed, 1 skipped); spec byte-identical to the base\'s names.txt (10 bytes)');
    expect(check.metrics['spec.comparedWith']).toBe('base tree blob names.txt');
    expect(check.run?.['spec.base.cached']).toBeUndefined();
    expect(check.run?.['unit.base.cached']).toBe(false);
    expect(check.metrics.hooksBypassed).toContain('HUSKY=0');
  });

  it('fails when head breaks what base passes, with the diagnostics', async () => {
    const check = await certifyK8(before, { ...moved, 'src/users/user.ts': 'export const user = 1; // ERROR\n' }, [typecheck]);
    expect(check.status).toBe('fail');
    expect(check.violations[0]!.detail).toContain('exited 2 on head (1 diagnostics), exit 0 on base');
    expect(check.violations[1]).toMatchObject({ file: 'src/users/user.ts', detail: expect.stringContaining('TS9999') });
  });

  it('accepts a head that fails exactly like base modulo the pathMap, as a pre-existing failure', async () => {
    const broken = { ...before, 'src/old/user.ts': 'export const user = 1; // ERROR\n' };
    const check = await certifyK8(broken, { ...moved, 'src/users/user.ts': 'export const user = 1; // ERROR\n' }, [typecheck]);
    expect(check.violations).toEqual([]);
    expect(check.status).toBe('pass');
    expect(check.findings).toEqual([expect.objectContaining({ kind: 'pre-existing-failure' })]);
    const worse = await certifyK8(broken, { ...moved, 'src/users/user.ts': 'export const user = 1; // ERROR\n', 'src/main.ts': "import { user } from './users/user';\nexport const main = user; // ERROR\n" }, [typecheck]);
    expect(worse.status).toBe('fail');
    expect(worse.violations.map((violation) => violation.detail)).toContainEqual(expect.stringContaining('new on head: TS9999'));
  });

  it('fails on test differences: a file that no longer loads, a case that changed status, a dropped file', async () => {
    const check = await certifyK8(
      { ...before, 'tests/other.cases.json': '[["three", "passed"]]', 'tests/gone.cases.json': '[["four", "passed"]]' },
      { ...moved, 'tests/users/user.cases.json.broken': '', 'tests/other.cases.json': '[["three", "failed"]]' },
      [unit],
    );
    expect(check.status).toBe('fail');
    expect(check.violations.map((violation) => [violation.file, violation.detail])).toEqual([
      [undefined, 'unit: the runner exited 1 on head (3 runs), 0 on base (3 runs)'],
      ['tests/gone.cases.json', 'unit: test file ran on base (1 cases) but not on head'],
      ['tests/other.cases.json', 'unit: 2 differences: file status passed → failed; passed → failed: suite three'],
      ['tests/users/user.cases.json', 'unit: test file (base tests/old/user.cases.json) failed to load on head (base: 3 cases)'],
      [undefined, 'unit: run success is false on head, true on base'],
    ]);
  });

  it('reuses the cached base run on the next certification of the same base', async () => {
    const repo = commits(before, moved);
    const first = await certifyRepo(repo, [unit]);
    expect(first.run?.['unit.base.cached']).toBe(false);
    expect(fs.readdirSync(cache)).toHaveLength(1);
    expect(fs.existsSync(path.join(cache, fs.readdirSync(cache)[0]!, 'report.json'))).toBe(true);
    const second = await certifyRepo(repo, [unit]);
    expect(second.run?.['unit.base.cached']).toBe(true);
    expect(second.status).toBe('pass');
    expect(second.summary).toBe(first.summary);
  });

  it('compares the artifact with the base run when the tracked reference is stale, and fails a real difference', async () => {
    const stale = await certifyK8({ ...before, 'names.txt': 'outdated\n' }, { ...moved, 'names.txt': 'outdated\n' }, [spec]);
    expect(stale.status).toBe('pass');
    expect(stale.metrics['spec.comparedWith']).toBe('base run');
    expect(stale.findings).toEqual([expect.objectContaining({ kind: 'stale-tracked-artifact', file: 'names.txt' })]);
    const changed = await certifyK8(before, { ...moved, 'src/users/user.ts': 'export const account = 1;\n' }, [spec]);
    expect(changed.status).toBe('fail');
    expect(changed.violations[0]!.detail).toContain('first difference at byte 0');
  });

  it('fails a setup step that fails on head only, even when the artifact is identical', async () => {
    const setup = { cwd: '', command: ['node', '-e', "process.exit(require('fs').existsSync('src/users') ? 4 : 0)"] };
    const check = await certifyK8(before, moved, [{ ...spec, setup: [setup] }]);
    expect(check.status).toBe('fail');
    expect(check.violations).toEqual([expect.objectContaining({ detail: expect.stringMatching(/^spec: `node -e .*` exited 4 on head, exit 0 on base/) })]);
    expect(check.summary).toContain('byte-identical to the base\'s names.txt (10 bytes), but 1 step failed on head');
  });

  it('refuses an artifact or report path a stale or tracked file could stand in for', async () => {
    await expect(certifyK8(before, moved, [{ ...spec, artifact: '{worktree}/names.txt' }])).rejects.toThrow('under {scratch} or {artifacts}');
    await expect(certifyK8(before, moved, [{ ...unit, report: 'report.json' }])).rejects.toThrow('under {scratch} or {artifacts}');
  });

  it('is an error, never a pass, when head and base both fail without diagnostics to compare', async () => {
    const failing: OracleSpec = { name: 'crash', kind: 'exit-zero', cwd: '', command: ['node', '-e', 'process.exit(3)'], diagnostics: 'tsc' };
    const check = await certifyK8(before, moved, [failing]);
    expect(check.status).toBe('error');
    expect(check.violations[0]!.detail).toContain('without diagnostics to compare');
  });

  it('fails a head step that times out or cannot start, without running base', async () => {
    const check = await certifyK8(before, moved, [
      { name: 'slow', kind: 'exit-zero', cwd: '', command: ['node', '-e', 'setTimeout(() => {}, 60000)'], timeoutSeconds: 1 },
      { name: 'missing', kind: 'exit-zero', cwd: '', command: ['node_modules/.bin/absent'] },
    ]);
    expect(check.status).toBe('fail');
    expect(check.violations.map((violation) => violation.detail)).toEqual([
      expect.stringMatching(/^slow: `node -e .*` timed out after 1 s on head/),
      expect.stringMatching(/^missing: `node_modules\/.bin\/absent` failed to start \(spawn .* ENOENT\) on head/),
    ]);
    expect(check.metrics['slow.base.exit']).toBeUndefined();
  });

  it('accepts a test that fails on base and head alike, and records it', async () => {
    const failing = '[["one", "passed"], ["one", "failed"], ["two", "skipped"]]';
    const check = await certifyK8({ ...before, 'tests/old/user.cases.json': failing }, { ...moved, 'tests/users/user.cases.json': failing }, [unit]);
    expect(check.status).toBe('pass');
    expect(check.findings).toEqual([expect.objectContaining({ kind: 'pre-existing-failure', detail: expect.stringContaining('1 cases fail and 0 files fail to load') })]);
  });

  it('is an error, never a vacuous pass, when no test case ran on base', async () => {
    const check = await certifyK8({ ...before, 'tests/old/user.cases.json': '[]' }, { ...moved, 'tests/users/user.cases.json': '[]' }, [unit]);
    expect(check.status).toBe('error');
    expect(check.violations).toEqual([expect.objectContaining({ detail: expect.stringContaining('no test case ran on base') })]);
  });

  it('runs every oracle on the commit: what earlier checks or oracles left in the worktree is removed first', async () => {
    // 'dirty' modifies a tracked file and leaves an untracked one; 'clean' fails if it sees either.
    const dirty: OracleSpec = { name: 'dirty', kind: 'exit-zero', cwd: '', command: ['node', '-e', "require('fs').writeFileSync('names.txt', 'x'); require('fs').writeFileSync('left.txt', 'x')"] };
    const clean: OracleSpec = {
      name: 'clean', kind: 'exit-zero', cwd: '',
      command: ['node', '-e', "const fs = require('fs'); process.exit(fs.existsSync('left.txt') || fs.existsSync('dist') || fs.readFileSync('names.txt', 'utf8') !== 'main\\nuser\\n' ? 1 : 0)"],
    };
    const earlier = (context: CertifyContext) => {
      fs.mkdirSync(path.join(context.materialize('head'), 'dist'));
      fs.writeFileSync(path.join(context.materialize('head'), 'dist', 'main.js'), '');
    };
    const check = await certifyK8(before, moved, [clean, dirty, { ...clean, name: 'clean-again' }], { earlier });
    expect(check.violations).toEqual([]);
    expect(check.status).toBe('pass');
    expect(check.run?.leftoversRemoved).toBe(2);
    expect(check.findings).toEqual([
      expect.objectContaining({ kind: 'worktree-modified', detail: 'the dirty oracle modified tracked files of the head worktree (restored before the clean-again oracle): names.txt' }),
    ]);
  });

  it('runs offline and records refused network attempts as findings', async () => {
    const dialer = "import dns from 'node:dns';\ndns.lookup('example.com', (error) => process.exit(error ? 0 : 1));\n";
    const check = await certifyK8({ ...before, 'tools/dial.mjs': dialer }, { ...moved, 'tools/dial.mjs': dialer }, [{ name: 'dial', kind: 'exit-zero', cwd: '', command: ['node', 'tools/dial.mjs'] }], { offline: true });
    expect(check.status).toBe('pass');
    expect(check.metrics['dial.head.networkAttempts']).toBe(1);
    expect(check.findings).toEqual([expect.objectContaining({ kind: 'network-attempt' })]);
  });

  describe('quarantined and flaky tests', () => {
    let state: string;
    beforeEach(() => {
      state = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-flaky-state-'));
    });
    afterEach(() => fs.rmSync(state, { recursive: true, force: true }));
    const casesOf = (cases: unknown[]) => JSON.stringify(cases);
    const flakyOnHead = { head: ['failed', 'passed'], base: ['skipped'] };
    const flakyOnBase = { head: ['passed'], base: ['failed', 'passed'] };
    const withCases = (cases: unknown[]) => ({ base: { ...before, 'tests/old/user.cases.json': casesOf(cases) }, head: { ...moved, 'tests/users/user.cases.json': casesOf(cases) } });
    const crashingRunner = { 'tools/run-tests.mjs': (before['tools/run-tests.mjs'] as string).replace('process.exit(failed ? 1 : 0);', "process.exit(fs.existsSync('crash') ? 1 : failed ? 1 : 0);") };

    it('leaves quarantined tests out on both sides (base paths mapped to head) and records each', async () => {
      // The same file on both sides (a pure move); its case 'two' runs on head only.
      const cases = casesOf([['one', 'passed'], ['one', 'passed'], ['two', { head: ['passed'], base: ['skipped'] }]]);
      const base = { ...before, 'tests/old/user.cases.json': cases };
      const head = { ...moved, 'tests/users/user.cases.json': cases };
      const env = { FLAKY_STATE: state };
      expect((await certifyK8(base, head, [unit], { env })).status).toBe('fail');
      const quarantine = [{ file: 'tests/old/user.cases.json', name: 'suite > two', reason: 'flaky in the baseline' }];
      const check = await certifyK8(base, head, [unit], { quarantine, env });
      expect(check.violations).toEqual([]);
      expect(check.status).toBe('pass');
      expect(check.findings).toEqual([{ kind: 'quarantined-test', file: 'tests/users/user.cases.json', detail: "unit: 'suite > two' left out of the comparison on both sides: flaky in the baseline" }]);
      expect(check.summary).toContain('1/1 files and 2/2 cases equal to base (1 cases left out: 0 flaky, 1 quarantined)');
    });

    it('leaves a whole quarantined file out, even one that fails to load', async () => {
      const other = { 'tests/other.cases.json': casesOf([['three', 'passed']]) };
      const head = { ...moved, ...other, 'tests/users/user.cases.json.broken': '' };
      const quarantine = [{ file: 'tests/old/user.cases.json', reason: 'network-dependent' }];
      const check = await certifyK8({ ...before, ...other, 'tests/old/user.cases.json.broken': '' }, head, [unit], { quarantine });
      expect(check.violations).toEqual([]);
      expect(check.status).toBe('pass');
      expect(check.findings).toEqual([expect.objectContaining({ kind: 'quarantined-test', detail: 'unit: every test in the file left out of the comparison on both sides: network-dependent' })]);
      // One that fails to load on head only is left out as well, but then nothing but it accounts for head's exit 1.
      const headOnly = await certifyK8({ ...before, ...other }, head, [unit], { quarantine });
      expect(headOnly.status).toBe('error');
      expect(headOnly.violations).toEqual([{ detail: expect.stringMatching(/^error: unit: the runner exited 1 on head \(3 runs\), 0 on base \(3 runs\), and only failures of left-out tests/) }]);
    });

    it('re-runs both commits on a mismatch and reports a case whose outcome changes between runs of base as flaky, not a violation', async () => {
      const { base, head } = withCases([['one', 'passed'], ['one', 'passed'], ['two', flakyOnBase]]);
      const check = await certifyK8(base, head, [unit], { env: { FLAKY_STATE: state } });
      expect(check.violations).toEqual([]);
      expect(check.status).toBe('pass');
      expect(check.metrics['unit.runs']).toBe(2);
      expect(check.metrics['unit.flaky']).toBe(1);
      expect(check.findings).toEqual([{ kind: 'flaky-test', file: 'tests/users/user.cases.json', detail: "unit: 'suite > two' changed outcome between runs of base (failed, passed); left out of the comparison" }]);
    });

    it('leaves out a case flaky on both commits: the instability was there before the change', async () => {
      const { base, head } = withCases([['one', 'passed'], ['two', { head: ['failed', 'passed'], base: ['passed', 'failed'] }]]);
      const check = await certifyK8(base, head, [unit], { env: { FLAKY_STATE: state } });
      expect(check.violations).toEqual([]);
      expect(check.status).toBe('pass');
      expect(check.findings.map((finding) => finding.kind)).toEqual(['flaky-test']);
    });

    it('fails a case stable on base whose outcome changes between runs of head: an intermittent difference, not flakiness', async () => {
      // 'two' passes in every base run and fails in two of three head runs: with base's instability unshown, nothing excuses it.
      const { base, head } = withCases([['one', 'passed'], ['two', { head: ['failed', 'failed', 'passed'], base: ['passed'] }]]);
      const check = await certifyK8(base, head, [unit], { env: { FLAKY_STATE: state } });
      expect(check.status).toBe('fail');
      expect(check.metrics['unit.runs']).toBe(3);
      expect(check.violations).toEqual([
        { file: 'tests/users/user.cases.json', detail: 'unit: 2 differences (base tests/old/user.cases.json): file status passed → failed; passed → failed: suite two' },
        { file: 'tests/users/user.cases.json', detail: "unit: 'suite > two' changed outcome between runs of head (failed, failed, passed) but not in base's 3 complete runs: an intermittent difference, not flakiness" },
        { detail: 'unit: run success is false on head, true on base' },
      ]);
      expect(check.findings).toEqual([]);
      // A case skipped on base that runs on head, failing or passing, is a difference too.
      const skipped = withCases([['one', 'passed'], ['two', flakyOnHead]]);
      const toRunning = await certifyK8(skipped.base, skipped.head, [unit], { env: { FLAKY_STATE: fs.mkdtempSync(path.join(state, 'skipped-')) } });
      expect(toRunning.status).toBe('fail');
      expect(toRunning.violations.map((violation) => violation.detail)).toContainEqual("unit: 'suite > two' changed outcome between runs of head (failed, passed, passed) but not in base's 3 complete runs: an intermittent difference, not flakiness");
    });

    it('neither compares nor reads for flaky tests a head run that stopped short of the file list', async () => {
      const other = casesOf([['three', 'passed']]);
      const base = { ...before, 'tests/other.cases.json': other };
      const head = { ...moved, 'tests/other.cases.json': other, 'tests/other.cases.json.omit': JSON.stringify({ head: [1], base: [] }) };
      const check = await certifyK8(base, head, [unit], { env: { FLAKY_STATE: state } });
      expect(check.violations).toEqual([]);
      expect(check.status).toBe('pass');
      expect(check.metrics['unit.flaky']).toBe(0);
      expect(check.findings).toEqual([]);
    });

    it('fails an oracle whose flaky tests sit in more files than the cap allows', async () => {
      const flaky = casesOf([['one', 'passed'], ['two', flakyOnBase]]);
      const files = (prefix: string) => Object.fromEntries(['a', 'b', 'c'].map((name) => [`tests/${prefix}/${name}.cases.json`, flaky]));
      const check = await certifyK8({ ...before, ...files('old') }, { ...moved, ...files('old') }, [unit], { env: { FLAKY_STATE: state } });
      expect(check.status).toBe('fail');
      expect(check.violations.map((violation) => violation.detail)).toContain('unit: not reproducible here: flaky tests in 3 files (at most 2 allowed), so leaving them out would certify too little');
    });

    it('still fails a real difference next to a flaky case, after the retries', async () => {
      const { base, head } = withCases([['one', { head: ['failed'], base: ['passed'] }], ['one', 'passed'], ['two', { head: ['passed'], base: ['skipped', 'passed'] }]]);
      const check = await certifyK8(base, head, [unit], { env: { FLAKY_STATE: state } });
      expect(check.status).toBe('fail');
      expect(check.metrics['unit.runs']).toBe(3);
      expect(check.violations.map((violation) => violation.detail)).toEqual([
        'unit: the runner exited 1 on head (3 runs), 0 on base (3 runs)',
        'unit: 2 differences (base tests/old/user.cases.json): file status passed → failed; passed → failed: suite one',
        'unit: run success is false on head, true on base',
      ]);
      expect(check.findings.map((finding) => finding.kind)).toEqual(['flaky-test']);
    });

    it('treats a flaky case as a difference without retries', async () => {
      const { base, head } = withCases([['one', 'passed'], ['one', 'passed'], ['two', flakyOnHead]]);
      const check = await certifyK8(base, head, [unit], { env: { FLAKY_STATE: state }, flakyRetries: 0 });
      expect(check.status).toBe('fail');
      expect(check.findings).toEqual([]);
    });

    it('fails a runner exit the excluded tests do not explain', async () => {
      // Head exits 1 with every case passing (an unhandled error) and a quarantined case: the quarantine can't excuse it.
      const quarantine = [{ file: 'tests/old/user.cases.json', name: 'suite > two', reason: 'flaky in the baseline' }];
      const check = await certifyK8({ ...before, ...crashingRunner }, { ...moved, ...crashingRunner, crash: '' }, [unit], { quarantine });
      expect(check.status).toBe('fail');
      expect(check.violations[0]!.detail).toBe('unit: the runner exited 1 with no test failing on head (3 runs), 0 on base (3 runs)');
    });

    it('is an error, never a pass, when only a left-out failure could account for head\'s runner exit', async () => {
      // Quarantined 'two' fails on head and passes on base. The exit code can't tell that failure from an unhandled
      // error in the same run (head's 'crash' marker), so neither run certifies.
      const { base, head } = withCases([['one', 'passed'], ['one', 'passed'], ['two', { head: ['failed'], base: ['passed'] }]]);
      const quarantine = [{ file: 'tests/old/user.cases.json', name: 'suite > two', reason: 'flaky in the baseline' }];
      const env = { FLAKY_STATE: state };
      for (const crash of [{ crash: '' }, {}] as Tree[]) {
        const check = await certifyK8({ ...base, ...crashingRunner }, { ...head, ...crashingRunner, ...crash }, [unit], { quarantine, env });
        expect(check.status).toBe('error');
        expect(check.metrics['unit.runs']).toBe(3);
        expect(check.violations).toEqual([{ detail: "error: unit: the runner exited 1 on head (3 runs), 0 on base (3 runs), and only failures of left-out tests account for that, which an exit code can't tell from an unattributed failure (an unhandled error)" }]);
      }
      // Once a head run passes the quarantined case, its exit code speaks for itself.
      const flaky = withCases([['one', 'passed'], ['two', { head: ['failed', 'passed'], base: ['passed'] }]]);
      const settled = await certifyK8(flaky.base, flaky.head, [unit], { quarantine, env: { FLAKY_STATE: fs.mkdtempSync(path.join(state, 'settled-')) } });
      expect(settled.violations).toEqual([]);
      expect(settled.status).toBe('pass');
      expect(settled.metrics['unit.runs']).toBe(2);
    });

    it('fails a head exit with no failing test against a base exit a left-out failure explains', async () => {
      // Head crashes with every case passing; base's first run exits 1 too, but because its flaky 'two' failed.
      const { base, head } = withCases([['one', 'passed'], ['two', flakyOnBase]]);
      const check = await certifyK8({ ...base, ...crashingRunner }, { ...head, ...crashingRunner, crash: '' }, [unit], { env: { FLAKY_STATE: state } });
      expect(check.status).toBe('fail');
      expect(check.violations[0]!.detail).toBe('unit: the runner exited 1 with no test failing on head (3 runs), 1 or 0 on base (3 runs)');
    });
  });
});

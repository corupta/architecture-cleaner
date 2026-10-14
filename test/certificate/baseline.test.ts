// R0's baseline (S6 contract C2): every oracle run N times on one commit, flaky tests found run to run and handed to
// K8 as quarantine entries, green when everything passes in every run but the flaky tests; its runs seed K8's cache.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBaseline } from '../../src/certificate/baseline.js';
import { createContext } from '../../src/certificate/certify.js';
import { oracles } from '../../src/certificate/oracles.js';
import type { OracleSpec, Profile } from '../../src/certificate/profile.js';
import { before, moved, spec, typecheck, unit } from './oracle-tools.js';
import { type Tree, twoCommits } from './two-commit-repo.js';

let scratch: string;
const temporary = (prefix: string) => fs.mkdtempSync(path.join(scratch, prefix));
beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-baseline-test-'));
  process.env.AC_ORACLE_CACHE = path.join(scratch, 'cache');
});
afterEach(() => {
  delete process.env.AC_ORACLE_CACHE;
  fs.rmSync(scratch, { recursive: true, force: true });
});

const profileOf = (oracleSpecs: OracleSpec[]): Profile => ({ name: 'fake', packageRoot: '', node: 'system', env: { FLAKY_STATE: temporary('state-') }, oracles: oracleSpecs });

async function baselineOf(base: Tree, oracleSpecs: OracleSpec[], runs = 2) {
  const repo = twoCommits(base, moved);
  const profile = profileOf(oracleSpecs);
  const result = await runBaseline({ repo: repo.root, commit: repo.base, packageRoot: '', environment: repo.root, profile, runs, workDir: temporary('work-'), log: () => {} });
  return { repo, profile, result };
}

const withCases = (tree: Tree, cases: unknown[]) => ({ ...tree, 'tests/old/user.cases.json': JSON.stringify(cases) });

describe('runBaseline', () => {
  it('is green when every oracle passes in every run but a flaky case, which becomes a quarantine entry', async () => {
    const base = withCases(before, [['one', 'passed'], ['two', { head: ['passed'], base: ['passed', 'failed'] }]]);
    const { result } = await baselineOf(base, [typecheck, unit, spec]);
    expect(result.green).toBe(true);
    expect(result.flaky).toEqual([{ file: 'tests/old/user.cases.json', name: 'suite > two', reason: 'flaky in the baseline: unit gave passed, failed in 2 complete runs' }]);
    expect(result.oracles.map((oracle) => [oracle.name, oracle.ok, oracle.detail])).toEqual([
      ['typecheck', true, 'exit 0 in 2 runs'],
      ['unit', true, "green in 2 complete runs; 1 flaky (tests/old/user.cases.json 'suite > two')"],
      ['spec', true, 'byte-identical in 2 runs; byte-identical to the tracked names.txt'],
    ]);
    const unitRuns = result.oracles[1]!.runs;
    expect(unitRuns.map((run) => [run.ok, run.exitCode])).toEqual([[true, 0], [true, 1]]);
    expect(unitRuns[1]!.summary).toBe('exit 1: 1/1 files load, 1 passed, 1 failed, 0 skipped');
    expect(result.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('replaces a run that stopped short of the others\' file list instead of reading its missing files as flaky', async () => {
    // Under load (S6, immich) vitest exited 0 with a report of 54 of 105 files; the baseline then quarantined 61 files.
    const base = { ...before, 'tests/old/other.cases.json': '[["three", "passed"]]', 'tests/old/other.cases.json.omit': JSON.stringify({ head: [], base: [1] }) };
    const { result } = await baselineOf(base, [unit]);
    expect(result.green).toBe(true);
    expect(result.flaky).toEqual([]);
    expect(result.oracles[0]!.detail).toBe('green in 2 complete runs; 1 run stopped short and replaced; no flaky test');
    expect(result.oracles[0]!.runs.map((run) => run.ok)).toEqual([false, true, true]);
    expect(result.oracles[0]!.runs[0]!.summary).toContain('stopped short of another run\'s file list');
  });

  it('declines a suite whose flaky tests sit in more files than the cap allows, quarantining nothing', async () => {
    const flaky = '[["one", "passed"], ["two", { "head": ["passed"], "base": ["passed", "failed"] }]]';
    const base = { ...before, 'tests/old/user.cases.json': flaky, 'tests/old/a.cases.json': flaky, 'tests/old/b.cases.json': flaky };
    const { result } = await baselineOf(base, [unit]);
    expect(result.green).toBe(false);
    expect(result.flaky).toEqual([]);
    expect(result.oracles[0]!.detail).toMatch(/^not reproducible: flaky tests in 3 of 3 files \(at most 2 allowed\); 3 flaky/);
  });

  it('seeds the base cache K8 reads, and its flaky entries are what K8 quarantines', async () => {
    // 'two' passed, then failed in the baseline; K8's base run (the third) fails it, head passes it.
    const base = withCases(before, [['one', 'passed'], ['two', { head: ['passed'], base: ['passed', 'failed'] }]]);
    const { repo, profile, result } = await baselineOf(base, [unit]);
    expect(fs.readdirSync(process.env.AC_ORACLE_CACHE!)).toHaveLength(1);
    const certifyRepo = twoCommits(base, { ...moved, 'tests/users/user.cases.json': base['tests/old/user.cases.json']! });
    const { context, cleanup } = createContext({
      repo: certifyRepo.root, base: certifyRepo.base, head: certifyRepo.head, packageRoot: '', environment: certifyRepo.root, profile, oracles: true,
      workDir: temporary('certify-'), keep: false, quarantine: result.flaky,
    });
    try {
      const check = await oracles.run(context);
      expect(check.status).toBe('pass');
      expect(check.findings.map((finding) => finding.kind)).toEqual(['quarantined-test']);
    } finally {
      cleanup();
    }
    // Seeded under the baseline's repository: K8 on that repository reads it instead of running base.
    const { context: same, cleanup: cleanupSame } = createContext({
      repo: repo.root, base: repo.base, head: repo.head, packageRoot: '', environment: repo.root, profile, oracles: true, workDir: temporary('same-'), keep: false, quarantine: result.flaky,
    });
    try {
      expect((await oracles.run(same)).run?.['unit.base.cached']).toBe(true);
    } finally {
      cleanupSame();
    }
  });

  it('is not green when a test fails in every run, a typecheck fails, or an artifact is not reproducible', async () => {
    const unstableProducer = "import fs from 'node:fs';\nfs.mkdirSync(process.argv[2].replace(/\\/[^/]*$/, ''), { recursive: true });\nfs.writeFileSync(process.argv[2], String(process.hrtime.bigint()));\n";
    const base = { ...withCases(before, [['one', 'passed'], ['two', 'failed']]), 'src/broken.ts': '// ERROR\n', 'tools/produce.mjs': unstableProducer };
    const { result } = await baselineOf(base, [typecheck, unit, spec]);
    expect(result.green).toBe(false);
    expect(result.flaky).toEqual([]);
    expect(result.oracles.map((oracle) => [oracle.name, oracle.ok])).toEqual([['typecheck', false], ['unit', false], ['spec', false]]);
    expect(result.oracles[0]!.runs[0]!.summary).toBe('`node tools/check.mjs` exited 2');
    expect(result.oracles[1]!.detail).toBe('not green in 2 of 2 complete runs; no flaky test');
    expect(result.oracles[2]!.detail).toBe('not reproducible: 2 different artifacts in 2 runs');
  });

  it('reports an oracle whose prerequisites the environment lacks, and refuses zero runs', async () => {
    const { result } = await baselineOf(before, [{ ...typecheck, requires: ['node_modules/.bin/tsc'] }], 1);
    expect(result.green).toBe(false);
    expect(result.oracles[0]).toMatchObject({ ok: false, runs: [], detail: 'not run: the environment lacks node_modules/.bin/tsc (prerequisite builds)' });
    await expect(baselineOf(before, [typecheck], 0)).rejects.toThrow('runs must be a positive integer');
  });
});

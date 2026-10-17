// A profile oracle's own quarantine (`oracle.quarantine`, the files its runner leaves out through `{quarantine}`) is
// written at the target's original layout. On a later range, whose base already moved those files, K8 takes them at the
// range's base paths from tagged quarantine entries (the baseline hands them out; the orchestrator maps them through
// every certified step); without those, a quarantined file the base lacks is an error, never a test run against intent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type QuarantineEntry, runBaseline } from '../../src/certificate/baseline.js';
import { createContext } from '../../src/certificate/certify.js';
import { oracles, quarantinedFiles } from '../../src/certificate/oracles.js';
import type { OracleSpec, Profile } from '../../src/certificate/profile.js';
import type { CheckResult } from '../../src/certificate/types.js';
import { before, moved, runner, unit } from './oracle-tools.js';
import { commitChain, type Tree } from './two-commit-repo.js';

let scratch: string;
const temporary = (prefix: string) => fs.mkdtempSync(path.join(scratch, prefix));
beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-oracle-quarantine-'));
});
afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

// The test-runner stand-in, leaving out the files its `{quarantine}` patterns match (as jest --testPathIgnorePatterns).
const quarantineRunner = runner.replace("file.endsWith('.cases.json') && !omitted(file)", "file.endsWith('.cases.json') && !omitted(file) && !process.argv.slice(3).some((pattern) => new RegExp(pattern).test('/' + file))");
const network: OracleSpec = { ...unit, command: [...unit.command, '{quarantine}'], quarantine: ['tests/old/net.cases.json'] };
// A network-dependent test: it fails on head and passes on base whenever it runs.
const net = JSON.stringify([['fetch', { head: ['failed'], base: ['passed'] }]]);
const withNet = (tree: Tree, directory: string): Tree => ({ ...tree, 'tools/run-tests.mjs': quarantineRunner, [`tests/${directory}/net.cases.json`]: net });
// The original layout, a first move (the R1 step), then a second (R2): net.cases.json moves in both.
const layouts = [withNet(before, 'old'), withNet(moved, 'mid'), withNet(moved, 'net')];

function chain() {
  const repo = commitChain(layouts);
  const profile: Profile = { name: 'fake', packageRoot: '', node: 'system', env: { FLAKY_STATE: temporary('state-') }, oracles: [network] };
  return { ...repo, profile };
}

async function k8(repo: ReturnType<typeof chain>, base: number, head: number, quarantine?: QuarantineEntry[]): Promise<CheckResult> {
  const { context, cleanup } = createContext({
    repo: repo.root, base: repo.commits[base]!, head: repo.commits[head]!, packageRoot: '', environment: repo.root, profile: repo.profile, oracles: true,
    workDir: temporary('certify-'), keep: false, ...(quarantine ? { quarantine } : {}),
  });
  try {
    return await oracles.run(context);
  } finally {
    cleanup();
  }
}

/** The orchestrator's quarantineAt: entries carried through the pathMap of the step from `base` to `head`. */
function mapThrough(repo: ReturnType<typeof chain>, base: number, head: number, entries: QuarantineEntry[]): QuarantineEntry[] {
  const { context, cleanup } = createContext({
    repo: repo.root, base: repo.commits[base]!, head: repo.commits[head]!, packageRoot: '', environment: repo.root, profile: null, oracles: false, workDir: temporary('map-'), keep: false,
  });
  try {
    return entries.map((entry) => ({ ...entry, file: context.pathMap.map(entry.file) }));
  } finally {
    cleanup();
  }
}

describe("a profile oracle's quarantine on ranges after the first", () => {
  it('leaves the file out on both sides of the original range, as the profile writes it', async () => {
    const repo = chain();
    const check = await k8(repo, 0, 1);
    expect(check.violations).toEqual([]);
    expect(check.status).toBe('pass');
    expect(check.metrics['unit.quarantined']).toBe(1);
  });

  it('takes the baseline\'s entries, mapped to a later base, as the files the runner leaves out on that range', async () => {
    const repo = chain();
    const baseline = await runBaseline({ repo: repo.root, commit: repo.commits[0]!, packageRoot: '', environment: repo.root, profile: repo.profile, runs: 1, workDir: temporary('baseline-'), log: () => {} });
    expect(baseline.quarantined).toEqual([{ file: 'tests/old/net.cases.json', reason: "the profile's unit oracle leaves it out of its runs", oracle: 'unit' }]);
    const atBase = mapThrough(repo, 0, 1, [...baseline.flaky, ...baseline.quarantined!]);
    expect(atBase.map((entry) => entry.file)).toEqual(['tests/mid/net.cases.json']);
    expect(quarantinedFiles(network, atBase)).toEqual(['tests/mid/net.cases.json']);
    const check = await k8(repo, 1, 2, atBase);
    expect(check.violations).toEqual([]);
    expect(check.status).toBe('pass');
    expect(check.findings).toEqual([{ kind: 'quarantined-test', file: 'tests/net/net.cases.json', detail: "unit: every test in the file left out of the comparison on both sides: the profile's unit oracle leaves it out of its runs" }]);
  });

  it('is an error, not a run of the quarantined test, when the base lacks the files the quarantine names', async () => {
    const repo = chain();
    const check = await k8(repo, 1, 2);
    expect(check.status).toBe('error');
    expect(check.summary).toBe('unit not run: its quarantine is not at the base\'s paths');
    expect(check.violations).toEqual([{ file: 'tests/old/net.cases.json', detail: 'error: unit: the quarantine names tests/old/net.cases.json, which is not a file of the base commit, so the runner would not leave it out; pass the quarantine at this range\'s paths (quarantine entries tagged with the oracle)' }]);
    // Entries for another oracle don't stand for this one's, and entries for it stand for the whole list or nothing.
    expect((await k8(repo, 1, 2, [{ file: 'tests/mid/net.cases.json', reason: 'e2e only', oracle: 'e2e' }])).status).toBe('error');
    const twice = { ...repo, profile: { ...repo.profile, oracles: [{ ...network, quarantine: ['tests/old/net.cases.json', 'tests/old/user.cases.json'] }] } };
    const partial = await k8(twice, 1, 2, [{ file: 'tests/mid/net.cases.json', reason: 'network', oracle: 'unit' }]);
    expect(partial.status).toBe('error');
    expect(partial.violations).toEqual([{ detail: "error: unit: 1 quarantine entries tagged with the oracle stand for the profile's 2 quarantined files" }]);
    // The baseline at that commit says so too.
    const baseline = await runBaseline({ repo: repo.root, commit: repo.commits[1]!, packageRoot: '', environment: repo.root, profile: repo.profile, runs: 1, workDir: temporary('baseline-'), log: () => {} });
    expect(baseline.green).toBe(false);
    expect(baseline.oracles[0]!.detail).toBe(`not run: its quarantine names tests/old/net.cases.json, not files of ${repo.commits[1]!.slice(0, 12)} (written at another layout)`);
  });

  it('leaves out only what the entries name: a quarantine at the wrong file lets the network test run and fail', async () => {
    const repo = chain();
    const check = await k8(repo, 1, 2, [{ file: 'tests/users/user.cases.json', reason: 'mapped wrong', oracle: 'unit' }]);
    expect(check.status).toBe('fail');
    expect(check.violations.map((violation) => violation.file)).toContain('tests/net/net.cases.json');
  });
});

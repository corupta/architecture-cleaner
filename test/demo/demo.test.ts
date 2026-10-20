// `ac demo` on the orchestrator's fixture repo: a run is recorded once (plan and narration through a fake transport
// into a cassette, then `ac run` R0–R4), and the demo reproduces it: the plan replayed byte for byte, every step's tree
// equal, R3 and R4 recomputed, a sample certified again, the findings replayed; a tampered recording is caught; --live
// refuses without a key and plans through its own budget; --full runs `ac run` again.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../../src/certificate/profile.js';
import { packageDirectory } from '../../src/certificate/toolchain.js';
import type { Certificate, CheckId } from '../../src/certificate/types.js';
import { demoCommand } from '../../src/demo/command.js';
import { fullDemo } from '../../src/demo/full.js';
import { liveDemo, liveKey } from '../../src/demo/live.js';
import { demoMarkdown, differences, type CertifiedEntry, type CheckComparison, type DemoReport, type StepEntry } from '../../src/demo/report.js';
import { defaultWorkDir, notRerun, openWorkDir, replayDemo } from '../../src/demo/replay.js';
import { compareChecks, readCertificate, sampleSteps } from '../../src/demo/sample.js';
import type { DemoTarget } from '../../src/demo/target.js';
import { runFindings } from '../../src/findings/index.js';
import { createGateway } from '../../src/gateway/gateway.js';
import type { RequestBody } from '../../src/gateway/request.js';
import type { Transport } from '../../src/gateway/transport.js';
import { planInProcess } from '../../src/orchestrator/plan-source.js';
import { startRun } from '../../src/orchestrator/run.js';
import type { RunState } from '../../src/orchestrator/types.js';
import { fixtureRepo, profileOf } from '../orchestrator/fixture.js';

const quiet = () => {};
const scratches: string[] = [];
let oracleCache: string;
afterAll(() => {
  delete process.env.AC_ORACLE_CACHE;
  for (const directory of [...scratches, oracleCache]) fs.rmSync(directory, { recursive: true, force: true });
});

/** Answers no schema accepts: every edit candidate errors (the seeds draft wins, no critic call), no narration passes. */
const unusable: Transport = async (body: RequestBody) => {
  const choices = Array.from({ length: (body as { n?: number }).n ?? 1 }, (_, index) => ({ index, finish_reason: 'stop', message: { role: 'assistant', content: '{}', reasoning_content: '' } }));
  return { status: 200, headers: {}, bodyText: JSON.stringify({ id: 'fake', object: 'chat.completion', choices, usage: { prompt_tokens: 10, completion_tokens: 3 } }) };
};

function budgetIn(directory: string) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'runs.json'), JSON.stringify({ globalCap: 1, runs: { test: { cap: 1 } } }));
  return { ledgerPath: path.join(directory, 'ledger.jsonl'), runsPath: path.join(directory, 'runs.json') };
}

interface Recording {
  repo: string;
  scratch: string;
  target: DemoTarget;
  state: RunState;
}

let recording: Recording;
const packageLedger = path.join(packageDirectory(), 'budget', 'ledger.jsonl');
const ledgerBytes = () => (fs.existsSync(packageLedger) ? fs.readFileSync(packageLedger) : Buffer.alloc(0));
let ledgerBefore: Buffer;

beforeAll(async () => {
  ledgerBefore = ledgerBytes();
  oracleCache = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-demo-oracle-cache-'));
  process.env.AC_ORACLE_CACHE = oracleCache;
  const fixture = fixtureRepo();
  scratches.push(fixture.scratch);
  const profile = profileOf();
  const profileFile = path.join(fixture.scratch, 'fixture-profile.json');
  fs.writeFileSync(profileFile, JSON.stringify(profile));
  const cassette = path.join(fixture.scratch, 'cassette.jsonl');
  const gateway = createGateway({ runId: 'test', mode: 'record', cassettePath: cassette, ...budgetIn(path.join(fixture.scratch, 'budget')), transport: unusable, apiKey: 'test-key' });
  const planned = await planInProcess({ repo: fixture.repo, profile, cassette, mode: 'record', run: 'test', gateway });
  const runDirectory = path.join(fixture.scratch, 'recorded');
  const outcome = await startRun({
    repo: fixture.repo, environment: fixture.repo, profile, plan: planned.plan, cost: planned.cost, runDirectory, branch: 'ac/recorded',
    rungs: ['R0', 'R1', 'R2', 'R3', 'R4'], maxSteps: null, jobs: 1, injectFault: null, log: quiet,
  }, {
    findings: async (directory) => {
      const { reportSection, document } = await runFindings({ runDirectory: directory, gateway, log: quiet });
      return { section: reportSection, narration: document.narration && { costUsd: document.narration.costUsd, calls: document.narration.calls, replayed: document.narration.replayed } };
    },
  });
  expect(outcome.state.status).toBe('completed');
  recording = {
    repo: fixture.repo, scratch: fixture.scratch, state: outcome.state,
    target: { name: 'fixture', url: 'file:///nowhere', sha: fixture.base, profile: profileFile, cassette, recordedRun: runDirectory },
  };
}, 600_000);

const workDir = (name: string) => path.join(recording.scratch, `work-${name}`);
const replay = (name: string, fields: Partial<Parameters<typeof replayDemo>[0]> = {}) => replayDemo({
  target: recording.target, workDir: workDir(name), repo: recording.repo, environment: null, steps: null, sample: 3, oracles: false, log: quiet, ...fields,
});

describe('ac demo --replay', () => {
  it('reproduces the recorded run: the plan byte for byte, every step\'s tree, R3, R4, a certified sample, the findings', async () => {
    const { report, head } = await replay('replay');
    expect(differences(report)).toEqual([]);
    expect(report.plan).toMatchObject({ outcome: 'match', sha256: recording.state.plan.sha256 });
    expect(report.plan.files.length).toBeGreaterThan(2);
    expect(report.plan.calls).toEqual([expect.objectContaining({ model: 'ultra', purpose: 'plan_edit', replayed: true })]);
    const recordedTrees = recording.state.steps.map((step) => [step.index, step.rung, step.tree]);
    expect(report.steps.map((step) => [step.index, step.rung, step.tree])).toEqual(recordedTrees);
    expect(report.steps.every((step) => step.tree === step.recordedTree)).toBe(true);
    expect(report.stoppedAfter).toBeNull();
    expect(report.boundaries).toMatchObject({ outcome: 'committed', rung: 'R4' });
    expect(report.certified.length).toBeGreaterThan(0);
    expect(report.certified.every((entry) => entry.verdict === 'pass' && entry.scope === 'static')).toBe(true);
    expect(report.certified[0]).toMatchObject({ subject: 1, reason: 'the first step' });
    for (const entry of report.certified) expect(fs.existsSync(path.join(report.workDir, entry.file))).toBe(true);
    expect(report.findings).toMatchObject({ outcome: 'match' });
    expect(head).not.toBe(recording.target.sha);
    expect(report.spentUsd).toBe(0);

    const markdown = demoMarkdown(report);
    expect(markdown).toContain('**Everything compared matches the recorded run**');
    expect(markdown).toContain(`**${report.steps.length - 1} of ${report.steps.length - 1} trees equal the recorded run's.**`);
    expect(markdown).toContain('## Replayed from the cassette (no key, $0)');
    expect(markdown).toContain('## Not re-run here');
    expect(markdown).toContain('**The oracles (K8)**');
    expect(fs.existsSync(path.join(report.workDir, 'replay-ledger.jsonl'))).toBe(false);
    expect(ledgerBytes().equals(ledgerBefore)).toBe(true);
  }, 600_000);

  it('reuses its clone, stops after --steps, and certifies the whole PR with the oracles only when every step ran', async () => {
    const first = await replay('steps', { steps: 1, sample: 1 });
    expect(first.report.steps.map((step) => step.index)).toEqual([1]);
    expect(first.report.stoppedAfter).toBe(1);
    expect(first.report.boundaries).toBeNull();
    expect(first.report.certified.map((entry) => entry.subject)).toEqual([1]);
    expect(differences(first.report)).toEqual([]);
    expect(demoMarkdown(first.report)).toContain('(stopped after step 1 by --steps)');

    const again = await replay('steps', { steps: null, sample: 1, oracles: true, environment: recording.repo });
    expect(again.report.target.source).toMatch(/^reused /);
    const whole = again.report.certified.find((entry) => entry.subject === 'whole PR')!;
    expect(whole).toMatchObject({ verdict: 'pass', scope: 'full' });
    expect(whole.recordedDigest).toBe(recording.state.certificate!.digest);
    expect(whole.digest).toBe(whole.recordedDigest);
    expect(whole.checks.find((check) => check.id === 'K8')).toMatchObject({ status: 'pass', recorded: 'pass', identical: true });
    expect(whole.checks.every((check) => check.identical === true || (check.status === 'skip' && check.recorded === 'skip'))).toBe(true);
    expect(differences(again.report)).toEqual([]);
    expect(again.report.notRerun.some((line) => line.startsWith('**The oracles (K8)**'))).toBe(false);
  }, 600_000);

  it('reports a recorded tree that the re-executed step does not reproduce', async () => {
    const tampered = path.join(recording.scratch, 'tampered');
    fs.cpSync(recording.target.recordedRun, tampered, { recursive: true });
    const state = JSON.parse(fs.readFileSync(path.join(tampered, 'run.json'), 'utf8')) as RunState;
    state.steps[1]!.tree = '0'.repeat(40);
    fs.writeFileSync(path.join(tampered, 'run.json'), JSON.stringify(state));
    const { report } = await replay('tampered', { target: { ...recording.target, recordedRun: tampered }, sample: 0 });
    // The findings log reads run.json too: its certificate of step 2 no longer belongs to a recorded tree.
    expect(differences(report)).toEqual([
      expect.stringMatching(/^step 2 \(module\/[a-z-]+\): tree [0-9a-f]{10}, recorded 0000000000$/),
      expect.stringMatching(/^findings: findings\/findings.json differs/),
    ]);
    expect(demoMarkdown(report)).toContain('**2 differences from the recorded run**');
  }, 600_000);

  it('never empties a directory an earlier demo did not make', () => {
    const directory = path.join(recording.scratch, 'not-a-demo');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'mine\n');
    expect(() => openWorkDir(directory, 'fixture')).toThrow('is not empty and no earlier demo made it');
    expect(fs.readFileSync(path.join(directory, 'notes.txt'), 'utf8')).toBe('mine\n');
  });
});

describe('ac demo --live', () => {
  it('takes the key from the environment only, never from a .env file, and refuses to start without one', async () => {
    expect(liveKey({ NEBIUS_API_KEY: ' from-env ' })).toBe('from-env');
    expect(liveKey({ NEBIUS_API_KEY: '' })).toBeNull();
    // Even with a key in this package's .env (ours, on our machine) or the working directory's: neither is read.
    expect(liveKey({})).toBeNull();
    const saved = process.env.NEBIUS_API_KEY;
    delete process.env.NEBIUS_API_KEY;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const refused = workDir('live-command');
      expect(await demoCommand(['--live', '--work', refused])).toBe(2);
      expect(errors.mock.calls.flat().join('\n')).toContain('`NEBIUS_API_KEY=<your key> npx ac demo --live`. It reads no .env file.');
      expect(fs.existsSync(refused)).toBe(false);
    } finally {
      errors.mockRestore();
      if (saved !== undefined) process.env.NEBIUS_API_KEY = saved;
    }
    const work = workDir('live-refused');
    await expect(liveDemo({ target: recording.target, workDir: work, repo: recording.repo, environment: null, steps: null, sample: 1, oracles: false, log: quiet, key: null }))
      .rejects.toThrow('no NEBIUS_API_KEY in the environment');
    expect(fs.existsSync(work)).toBe(false);
  });

  it('plans afresh through its own budget run, cassette and ledger in the work dir, then executes and certifies a sample', async () => {
    const { report } = await liveDemo({
      target: recording.target, workDir: workDir('live'), repo: recording.repo, environment: null, steps: null, sample: 2, oracles: false, log: quiet, key: 'test-key',
      gateway: (paths) => createGateway({ runId: 'demo', mode: 'record', cassettePath: paths.cassette, ledgerPath: paths.ledger, runsPath: paths.runs, transport: unusable, apiKey: 'test-key' }),
    });
    expect(report.mode).toBe('live');
    expect(report.plan.calls).toEqual([expect.objectContaining({ model: 'ultra', purpose: 'plan_edit', replayed: false })]);
    expect(report.spentUsd).toBeGreaterThan(0);
    expect(JSON.parse(fs.readFileSync(path.join(report.workDir, 'budget', 'runs.json'), 'utf8'))).toMatchObject({ globalCap: 1, runs: { demo: { cap: 1 } } });
    expect(fs.readFileSync(path.join(report.workDir, 'budget', 'ledger.jsonl'), 'utf8')).toContain('"runId":"demo"');
    expect(fs.existsSync(path.join(report.workDir, 'live-cassette.jsonl'))).toBe(true);
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.steps.every((step) => step.outcome === 'committed')).toBe(true);
    expect(report.certified.map((entry) => entry.verdict)).toEqual(['pass', 'pass']);
    expect(differences(report)).toEqual([]);
    const markdown = demoMarkdown(report);
    expect(markdown).toContain('# ac demo --live');
    expect(markdown).toContain('## Live calls on your key');
    expect(ledgerBytes().equals(ledgerBefore)).toBe(true);
  }, 600_000);
});

describe('ac demo --full', () => {
  it('runs `ac run` on the replayed plan and gives the recorded trees and whole-PR digest', async () => {
    const { report } = await fullDemo({ target: recording.target, workDir: workDir('full'), repo: recording.repo, environment: recording.repo, steps: null, sample: 3, oracles: false, log: quiet });
    expect(report.mode).toBe('full');
    expect(report.plan).toMatchObject({ outcome: 'match' });
    expect(report.steps.map((step) => step.tree)).toEqual(recording.state.steps.map((step) => step.tree));
    expect(report.certified).toEqual([expect.objectContaining({ subject: 'whole PR', verdict: 'pass', scope: 'full', digest: recording.state.certificate!.digest })]);
    expect(differences(report)).toEqual([]);
  }, 900_000);
});

describe('the sample', () => {
  const step = (index: number, rung: StepEntry['rung'], moves: number): StepEntry => ({ index, rung, group: `module/g${index}`, moves, outcome: 'committed', parent: 'p', commit: `c${index}`, durationMs: 0 });
  const ladder = [step(1, 'R1', 3), step(2, 'R1', 9), step(3, 'R1', 2), step(4, 'R2', 9), step(5, 'R2', 1), step(6, 'R3', 2), step(7, 'R3', 1), step(8, 'R4', 2)];

  it('takes the first step, the largest, an R3 rename, then spreads over the rest; never R4', () => {
    expect(sampleSteps(ladder, 3)).toEqual([
      { index: 1, reason: 'the first step' }, { index: 2, reason: 'the largest step, 9 moves' }, { index: 6, reason: 'an R3 rename' },
    ]);
    expect(sampleSteps(ladder, 1)).toEqual([{ index: 1, reason: 'the first step' }]);
    expect(sampleSteps(ladder, 5).map((pick) => pick.index)).toEqual([1, 2, 4, 6, 7].filter((index) => sampleSteps(ladder, 5).some((pick) => pick.index === index)));
    expect(sampleSteps(ladder, 5)).toHaveLength(5);
    expect(sampleSteps(ladder, 'all').map((pick) => pick.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sampleSteps(ladder, 0)).toEqual([]);
    expect(sampleSteps([{ ...ladder[0]!, outcome: 'declined' }], 3)).toEqual([]);
  });
});

describe('the summary', () => {
  it('lists every difference: a plan mismatch, a step that did not commit, a FAIL, a check that disagrees with the recording', () => {
    const report = {
      mode: 'replay', target: { name: 't', sha: 'a'.repeat(40), packageRoot: '', checkout: '/c', source: 'fetched', environment: null, branch: 'b', environmentNodeModulesAbove: [] },
      recorded: { directory: 'runs/x', branch: 'ac/x', steps: 2, head: 'h', wholePrDigest: null },
      plan: { outcome: 'mismatch', sha256: 'b'.repeat(64), recordedSha256: 'c'.repeat(64), groups: 2, steps: 2, files: [{ file: 'plan.md', identical: false }], calls: [], recordedCostUsd: 0, directory: '/p' },
      steps: [{ index: 1, rung: 'R1', group: 'module/a', moves: 2, outcome: 'declined', parent: 'p', detail: 'location-sensitive', durationMs: 0 }],
      plannedSteps: 2, stoppedAfter: 1, renames: null, boundaries: null,
      certified: [{ subject: 1, rung: 'R1', group: 'module/a', reason: 'the first step', verdict: 'fail', scope: 'static', digest: 'd', recordedDigest: 'e', file: 'certificates/x.json', durationMs: 0,
        checks: [{ id: 'K2', status: 'fail', recorded: 'pass', identical: false }, { id: 'K6', status: 'skip', recorded: 'pass', identical: null }] }],
      findings: null, spentUsd: 0, notRerun: ['x'], workDir: '/w', durationMs: 0,
    } as DemoReport;
    expect(differences(report)).toEqual([
      'plan: plan.md differs',
      'step 1 (module/a): declined: location-sensitive',
      'step 1: certificate FAIL (K2)',
      'step 1: K2 fail, recorded pass',
    ]);
    expect(demoMarkdown(report)).toContain('**4 differences from the recorded run**');
    expect(differences({ ...report, mode: 'full', run: { status: 'declined', error: 'preflight declines the run: baseline-not-green\nmore' } })[0])
      .toBe('`ac run` ended declined: preflight declines the run: baseline-not-green');
    expect(differences({ ...report, mode: 'full', run: { status: 'stopped' } })).toHaveLength(4);
  });

  /** A replay that matched everywhere but in its certificates; `checks` are the one sample certificate's. */
  const certifiedReport = (environment: string | null, entries: Partial<CertifiedEntry>[]): DemoReport => ({
    mode: 'replay', target: { name: 't', sha: 'a'.repeat(40), packageRoot: '', checkout: '/c', source: 'fetched', environment, branch: 'b', environmentNodeModulesAbove: [] },
    recorded: { directory: 'runs/x', branch: 'ac/x', steps: 1, head: 'h', wholePrDigest: null },
    plan: { outcome: 'match', sha256: 'b'.repeat(64), recordedSha256: 'b'.repeat(64), groups: 1, steps: 1, files: [], calls: [], recordedCostUsd: 0, directory: '/p' },
    steps: [], plannedSteps: 1, stoppedAfter: null, renames: null, boundaries: null,
    certified: entries.map((entry) => ({
      subject: 1, rung: 'R1', group: 'module/a', reason: 'the first step', verdict: 'pass', scope: 'static', digest: `sha256:${'1'.repeat(64)}`, recordedDigest: `sha256:${'1'.repeat(64)}`,
      file: 'certificates/x.json', durationMs: 0, checks: [], ...entry,
    })),
    findings: null, spentUsd: 0, notRerun: [], workDir: '/w', durationMs: 0,
  });
  const same = (id: CheckId) => ({ id, status: 'pass', recorded: 'pass', identical: true }) as CheckComparison;
  const skippedHere = (id: CheckId, reason: string) => ({ id, status: 'skip', recorded: 'pass', identical: null, skipReason: reason }) as CheckComparison;
  const vitestMissing = "vitest is not installed in the environment (no node_modules/vitest at or above 'server')";
  const profile = { name: 't', packageRoot: '', node: 'system', oracles: [{ name: 'tsc' }] } as unknown as Profile;

  it('counts a digest that differs while every check ran on both sides, and a check whose content differs under the same status', () => {
    const digest = certifiedReport('/env', [{ checks: [same('K0'), same('K4')], digest: `sha256:${'2'.repeat(64)}` }]);
    expect(differences(digest)).toEqual([`step 1: digest sha256:222222222222… differs from the recorded sha256:111111111111… with the same checks run`]);
    expect(demoMarkdown(digest)).toContain('**1 difference from the recorded run**');
    expect(demoMarkdown(digest)).toContain('status as recorded: K0, K4; content as recorded, byte for byte: K0, K4; digest sha256:222222222222… differs from the recorded sha256:111111111111…');

    const content = certifiedReport('/env', [{ checks: [same('K0'), { ...same('K4'), identical: false }], digest: `sha256:${'2'.repeat(64)}` }]);
    expect(differences(content)).toEqual(['step 1: K4 pass as recorded, but its content differs from the recorded check\'s']);

    const equal = certifiedReport('/env', [{ checks: [same('K0'), same('K4')] }]);
    expect(differences(equal)).toEqual([]);
    expect(demoMarkdown(equal)).toContain('**Everything compared matches the recorded run** (`runs/x`, branch `ac/x`).\n');
    expect(demoMarkdown(equal)).toContain('digest sha256:111111111111… identical to the recorded certificate\'s');
  });

  it('counts a check that skips under --env where the recording ran it, and says it did not run', () => {
    const report = certifiedReport('/env', [{ checks: [same('K0'), skippedHere('K3b', vitestMissing), same('K4')], digest: `sha256:${'2'.repeat(64)}` }]);
    expect(differences(report)).toEqual([`step 1: K3b skipped here (${vitestMissing}), recorded pass`]);
    const lines = notRerun(profile, null, { certified: report.certified, environment: '/env', oraclesAsked: false });
    expect(lines).toContainEqual(`**K3b** (resolution under the test runner and the runtime, the test inventory) skipped here (${vitestMissing}): the environment /env lacks what they need; give \`--env <checkout with node_modules>\`.`);
  });

  it('counts a whole PR whose K8 skipped under --oracles, and keeps the oracles in "not re-run"', () => {
    const lacks = 'the environment /env lacks packages/plugin-sdk/node_modules/@immich/sdk/build/index.js (prerequisite builds)';
    const report = certifiedReport('/env', [{ subject: 'whole PR', reason: 'with the oracles', checks: [same('K0'), same('K6'), skippedHere('K8', lacks)], digest: `sha256:${'2'.repeat(64)}` }]);
    expect(differences(report)).toEqual([`the whole PR: K8 skipped here (${lacks}), recorded pass`]);
    const lines = notRerun(profile, null, { certified: report.certified, environment: '/env', oraclesAsked: true });
    expect(lines.find((line) => line.startsWith('**The oracles (K8)**'))).toContain(`Asked for, but K8 skipped here: ${lacks}.`);
    expect(lines.some((line) => line.startsWith('**K3b'))).toBe(false);
  });

  it('reports the checks a missing --env skips as not compared, never as matching, and the content and digest with them', () => {
    const skipped = [skippedHere('K3b', vitestMissing), skippedHere('K3c', 'no runtime could be modeled'), skippedHere('K6', vitestMissing)];
    // Without --env, K3a and K7 read whatever node_modules sit above the checkout (the judges' path: this tool's own).
    const report = certifiedReport(null, [{ checks: [same('K0'), { ...same('K3a'), identical: false }, ...skipped, same('K4')], digest: `sha256:${'2'.repeat(64)}` }]);
    expect(differences(report)).toEqual([]);
    const markdown = demoMarkdown(report);
    expect(markdown).toContain('**Everything compared matches the recorded run** (`runs/x`, branch `ac/x`). Not compared: K3b, K3c, K6 on 1 certificate (skipped here); '
      + 'the checks\' content and the digest of 1 certificate, without --env (the recording had the target\'s node_modules).');
    expect(markdown).toContain('ran K0 pass, K3a pass, K4 pass; skipped K3b, K3c, K6; status as recorded: K0, K3a, K4; not compared: K3b, K3c, K6; content and digest not compared without --env.');
    expect(markdown).not.toContain('digest sha256:222222222222…');
    // The same certificate under --env: K3a's content is a difference, and so are the skips.
    expect(differences({ ...report, target: { ...report.target, environment: '/env' } })).toEqual([
      'step 1: K3a pass as recorded, but its content differs from the recorded check\'s',
      `step 1: K3b skipped here (${vitestMissing}), recorded pass; K3c skipped here (no runtime could be modeled), recorded pass; K6 skipped here (${vitestMissing}), recorded pass`,
    ]);
    const lines = notRerun(profile, null, { certified: report.certified, environment: null, oraclesAsked: false });
    expect(lines).toContainEqual(`**K3b, K3c and K6** (resolution under the test runner and the runtime, the test inventory) skipped here (${vitestMissing}; no runtime could be modeled): they need node_modules; give \`--env <checkout with node_modules>\`.`);
    expect(lines.some((line) => line.startsWith('**The oracles (K8)**'))).toBe(true);
    expect(notRerun(profile, null, { certified: [], environment: '/env', oraclesAsked: false })).toContainEqual('**The certificates**: none was made here (`--sample 0`, or no step committed).');
    // A check that skips without --env but needs none is a difference.
    expect(differences(certifiedReport(null, [{ checks: [skippedHere('K4', 'no reason'), same('K0')] }]))).toEqual(['step 1: K4 skipped here (no reason), recorded pass']);
  });
});

describe('the work dir', () => {
  /** A scratch tree: `<root>/<path>` for each planted path (a directory, or a file when it ends in .json). */
  const planted = (...paths: string[]) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-demo-work-'));
    scratches.push(root);
    for (const entry of paths) {
      fs.mkdirSync(path.join(root, entry.endsWith('.json') ? path.dirname(entry) : entry), { recursive: true });
      if (entry.endsWith('.json')) fs.writeFileSync(path.join(root, entry), '{"type":"module"}\n');
    }
    return root;
  };

  it('defaults to ./ac-demo when it is hermetic, else to <tmp>/ac-demo (inside a clone of this tool), and refuses when neither is', () => {
    const root = planted('elsewhere', 'tool/node_modules/@types/node', 'tool/package.json', 'tmp', 'bad-tmp/node_modules');
    expect(defaultWorkDir(path.join(root, 'elsewhere'), path.join(root, 'tmp'))).toEqual({ directory: path.join(root, 'elsewhere', 'ac-demo'), below: [] });
    expect(defaultWorkDir(path.join(root, 'tool'), path.join(root, 'tmp'))).toEqual({
      directory: path.join(root, 'tmp', 'ac-demo'), below: [path.join(root, 'tool', 'node_modules'), path.join(root, 'tool', 'package.json')],
    });
    // A package.json alone is enough: the nearest one above a file sets its module format.
    const packageOnly = planted('tool/package.json', 'tmp');
    expect(defaultWorkDir(path.join(packageOnly, 'tool'), path.join(packageOnly, 'tmp')).directory).toBe(path.join(packageOnly, 'tmp', 'ac-demo'));
    expect(() => defaultWorkDir(path.join(root, 'tool'), path.join(root, 'bad-tmp'))).toThrow(
      `the work dir ${path.join(root, 'bad-tmp', 'ac-demo')} is not hermetic: ${path.join(root, 'bad-tmp', 'node_modules')} is on its path`);
    expect(() => defaultWorkDir(path.join(root, 'tool'), path.join(root, 'bad-tmp'))).toThrow(
      `./ac-demo isn't either (it has ${path.join(root, 'tool', 'node_modules')}, ${path.join(root, 'tool', 'package.json')} on its path): pick a --work with neither on its path.`);
    expect(fs.existsSync(path.join(root, 'tmp', 'ac-demo'))).toBe(false);
  });

  it('refuses a --work below a node_modules or a package.json before writing anything, a symlink to one too', async () => {
    const root = planted('tool/node_modules', 'other/package.json', 'outside');
    const below = path.join(root, 'tool', 'ac-demo');
    expect(() => openWorkDir(below, 'fixture')).toThrow(`the work dir ${below} is not hermetic: ${path.join(root, 'tool', 'node_modules')} is on its path`);
    expect(() => openWorkDir(path.join(root, 'other', 'work'), 'fixture')).toThrow(`${path.join(root, 'other', 'package.json')} is on its path`);
    // A link from a hermetic directory into the tool's clone is followed: its real path is what the certifier walks up from.
    fs.mkdirSync(path.join(root, 'tool', 'work'));
    fs.symlinkSync(path.join(root, 'tool', 'work'), path.join(root, 'outside', 'link'));
    expect(() => openWorkDir(path.join(root, 'outside', 'link', 'demo'), 'fixture')).toThrow(`the work dir ${path.join(root, 'tool', 'work', 'demo')} is not hermetic`);
    expect(fs.existsSync(below)).toBe(false);
    expect(fs.existsSync(path.join(root, 'tool', 'work', 'demo'))).toBe(false);
    // A hermetic --work opens at its real path.
    fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'outside-link'));
    expect(openWorkDir(path.join(root, 'outside-link', 'demo'), 'fixture')).toBe(path.join(root, 'outside', 'demo'));

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await demoCommand(['--work', below])).toBe(2);
      expect(errors.mock.calls.flat().join('\n')).toContain(`ac demo: the work dir ${below} is not hermetic: ${path.join(root, 'tool', 'node_modules')} is on its path, `
        + 'and TypeScript and Node look node_modules and package.json up from every tree certified there, so the certificate would depend on it. Pick a --work with neither on its path.');
    } finally {
      errors.mockRestore();
    }
    expect(fs.existsSync(below)).toBe(false);
  });

  it('refuses a work dir another user owns or this user can\'t write, naming --work, and one another demo is using', async () => {
    // <tmp>/ac-demo, the fallback every clone of the tool shares, left by an earlier demo.
    const shared = path.join(planted('tmp'), 'tmp', 'ac-demo');
    fs.mkdirSync(shared);
    fs.writeFileSync(path.join(shared, '.ac-demo'), 'made by ac demo\n');
    fs.writeFileSync(path.join(shared, 'demo.md'), 'theirs\n');
    const remedy = 'pick another with --work <dir> (one with neither node_modules nor package.json on its path)';
    const otherUser = process.getuid!() + 1;
    const uid = vi.spyOn(process, 'getuid').mockReturnValue(otherUser);
    try {
      expect(() => openWorkDir(shared, 'fixture')).toThrow(`the work dir ${shared} belongs to another user (uid ${fs.statSync(shared).uid}): ${remedy}`);
    } finally {
      uid.mockRestore();
    }
    fs.chmodSync(shared, 0o000);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => openWorkDir(shared, 'fixture')).toThrow(`the work dir ${shared} can't be written by this user (EACCES: permission denied, scandir '${shared}'): ${remedy}`);
      expect(await demoCommand(['--work', shared])).toBe(2);
      expect(errors.mock.calls.flat().join('\n')).toBe(`ac demo: the work dir ${shared} can't be written by this user (EACCES: permission denied, scandir '${shared}'): ${remedy}`);
    } finally {
      errors.mockRestore();
      fs.chmodSync(shared, 0o755);
    }
    expect(fs.readFileSync(path.join(shared, 'demo.md'), 'utf8')).toBe('theirs\n');

    // A demo whose process still runs (here: the test's parent) holds it; one whose process exited doesn't.
    const lock = path.join(shared, '.ac-demo.lock');
    fs.writeFileSync(lock, `${process.ppid}\n`);
    expect(() => openWorkDir(shared, 'fixture')).toThrow(`another ac demo (process ${process.ppid}) is using the work dir ${shared}: wait for it to finish, or pick another --work`);
    expect(fs.readFileSync(path.join(shared, 'demo.md'), 'utf8')).toBe('theirs\n');
    const exited = spawnSync(process.execPath, ['-e', '']).pid!;
    fs.writeFileSync(lock, `${exited}\n`);
    expect(openWorkDir(shared, 'fixture')).toBe(shared);
    expect(fs.readdirSync(shared).sort()).toEqual(['.ac-demo', '.ac-demo.lock']);
    expect(fs.readFileSync(lock, 'utf8')).toBe(`${process.pid}\n`);
  });

  it('says when the environment checkout has node_modules above it, and still compares the digests', () => {
    const report: DemoReport = {
      mode: 'replay', target: { name: 't', sha: 'a'.repeat(40), packageRoot: '', checkout: '/c', source: 'fetched', environment: '/home/me/immich', branch: 'b', environmentNodeModulesAbove: ['/home/me/node_modules'] },
      recorded: { directory: 'runs/x', branch: 'ac/x', steps: 1, head: 'h', wholePrDigest: null },
      plan: { outcome: 'match', sha256: 'b'.repeat(64), recordedSha256: 'b'.repeat(64), groups: 1, steps: 1, files: [], calls: [], recordedCostUsd: 0, directory: '/p' },
      steps: [], plannedSteps: 1, stoppedAfter: null, renames: null, boundaries: null,
      certified: [{ subject: 1, rung: 'R1', group: 'module/a', reason: 'the first step', verdict: 'pass', scope: 'static', digest: `sha256:${'2'.repeat(64)}`, recordedDigest: `sha256:${'1'.repeat(64)}`,
        file: 'certificates/x.json', durationMs: 0, checks: [{ id: 'K0', status: 'pass', recorded: 'pass', identical: true }, { id: 'K3c', status: 'pass', recorded: 'pass', identical: false }] }],
      findings: null, spentUsd: 0, notRerun: [], workDir: '/tmp/ac-demo', durationMs: 0,
    };
    expect(demoMarkdown(report)).toContain('The environment `/home/me/immich` has `/home/me/node_modules` above it. Node resolves an installed package\'s own imports from the package\'s real path, '
      + 'so an import the environment doesn\'t satisfy is looked up there. What the target\'s tools load (K3b, K3c, K6, K8) can then differ from the recording.');
    expect(differences(report)).toEqual(['step 1: K3c pass as recorded, but its content differs from the recorded check\'s']);
    expect(demoMarkdown({ ...report, target: { ...report.target, environmentNodeModulesAbove: [] } })).not.toContain('above it');
  });
});

describe('the certificate comparison', () => {
  const recordedFile = path.join(packageDirectory(), 'runs/immich-ladder/certificates/001-R1-module-activity.json');
  const recorded = () => readCertificate(recordedFile)!;

  it('compares each check\'s content as the digest reads it: paths of another checkout are equal, a changed metric is not, a skip is not compared', () => {
    const elsewhere = JSON.parse(JSON.stringify(recorded()).replaceAll(recorded().repo, '/elsewhere/immich').replaceAll(recorded().workDir, '/elsewhere/work')) as Certificate;
    expect(compareChecks(elsewhere, recorded()).every((check) => check.identical === true)).toBe(true);
    const changed = structuredClone(elsewhere);
    changed.checks.find((check) => check.id === 'K4')!.metrics.extra = 1;
    changed.checks.find((check) => check.id === 'K3b')!.status = 'skip';
    expect(Object.fromEntries(compareChecks(changed, recorded()).map((check) => [check.id, check.identical]))).toEqual({
      K0: true, K1: true, K2: true, K3a: true, K3b: null, K3c: true, K4: false, K6: true, K7: true,
    });
    expect(compareChecks(recorded(), null).every((check) => check.identical === null && check.recorded === null)).toBe(true);
  });
});

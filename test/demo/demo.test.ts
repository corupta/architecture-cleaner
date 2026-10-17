// `ac demo` on the orchestrator's fixture repo: a run is recorded once (plan and narration through a fake transport
// into a cassette, then `ac run` R0–R4), and the demo reproduces it: the plan replayed byte for byte, every step's tree
// equal, R3 and R4 recomputed, a sample certified again, the findings replayed; a tampered recording is caught; --live
// refuses without a key and plans through its own budget; --full runs `ac run` again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageDirectory } from '../../src/certificate/toolchain.js';
import { fullDemo } from '../../src/demo/full.js';
import { liveDemo, liveKey } from '../../src/demo/live.js';
import { demoMarkdown, differences, type DemoReport, type StepEntry } from '../../src/demo/report.js';
import { openWorkDir, replayDemo } from '../../src/demo/replay.js';
import { sampleSteps } from '../../src/demo/sample.js';
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
    expect(markdown).toContain('**Everything that ran matches the recorded run**');
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
    expect(whole.checks.find((check) => check.id === 'K8')).toMatchObject({ status: 'pass', recorded: 'pass' });
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
  it('takes the key from the environment, else from .env files, and refuses to start without one', async () => {
    const envFile = path.join(recording.scratch, 'key.env');
    fs.writeFileSync(envFile, 'NEBIUS_API_KEY="from-file"\n');
    expect(liveKey({ NEBIUS_API_KEY: 'from-env' }, [envFile])).toBe('from-env');
    expect(liveKey({}, [path.join(recording.scratch, 'none.env'), envFile])).toBe('from-file');
    expect(liveKey({}, [path.join(recording.scratch, 'none.env')])).toBeNull();
    const work = workDir('live-refused');
    await expect(liveDemo({ target: recording.target, workDir: work, repo: recording.repo, environment: null, steps: null, sample: 1, oracles: false, log: quiet, key: null }))
      .rejects.toThrow('no NEBIUS_API_KEY');
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
      mode: 'replay', target: { name: 't', sha: 'a'.repeat(40), packageRoot: '', checkout: '/c', source: 'fetched', environment: null, branch: 'b' },
      recorded: { directory: 'runs/x', branch: 'ac/x', steps: 2, head: 'h', wholePrDigest: null },
      plan: { outcome: 'mismatch', sha256: 'b'.repeat(64), recordedSha256: 'c'.repeat(64), groups: 2, steps: 2, files: [{ file: 'plan.md', identical: false }], calls: [], recordedCostUsd: 0, directory: '/p' },
      steps: [{ index: 1, rung: 'R1', group: 'module/a', moves: 2, outcome: 'declined', parent: 'p', detail: 'location-sensitive', durationMs: 0 }],
      plannedSteps: 2, stoppedAfter: 1, renames: null, boundaries: null,
      certified: [{ subject: 1, rung: 'R1', group: 'module/a', reason: 'the first step', verdict: 'fail', scope: 'static', digest: 'd', recordedDigest: 'e', file: 'certificates/x.json', durationMs: 0,
        checks: [{ id: 'K2', status: 'fail', recorded: 'pass' }, { id: 'K6', status: 'skip', recorded: 'pass' }] }],
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
});

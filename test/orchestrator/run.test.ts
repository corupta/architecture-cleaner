// `ac run` end to end on a small fixture repo: the ladder with trailers on every commit and rung certificates, a
// declined step replanned by pinning, a seeded wrong move rolled back and replanned, the replan bound, declined
// preflights, a crash and --resume, verdicts --resume refuses, --max-steps, a K8 bisect (and one stopped without
// evidence), speculative parents under --jobs, and the run directory's shapes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBaseline } from '../../src/certificate/baseline.js';
import { certify } from '../../src/certificate/certify.js';
import type { Certificate, CertifyOptions } from '../../src/certificate/types.js';
import { executeMove } from '../../src/executor/execute.js';
import { resumeRun, type RunDependencies, type StartOptions, startRun } from '../../src/orchestrator/run.js';
import type { RunEvent, RunState } from '../../src/orchestrator/types.js';
import { type Files, fixtureRepo, gitOf, groups, planYaml, profileOf, sources, typecheck, unit, userPaths } from './fixture.js';

const scratches: string[] = [];
let oracleCache: string;
beforeAll(() => {
  oracleCache = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-run-oracle-cache-'));
  process.env.AC_ORACLE_CACHE = oracleCache;
});
afterAll(() => {
  delete process.env.AC_ORACLE_CACHE;
  for (const directory of [...scratches, oracleCache]) fs.rmSync(directory, { recursive: true, force: true });
});

const quiet = () => {};
/** No R3 renames unless a test gives some. */
const noRenames: Partial<RunDependencies> = { normalizationSteps: () => ({ steps: [], declined: [] }) };

function setup(files: Files = sources, planGroups = groups) {
  const fixture = fixtureRepo(files);
  scratches.push(fixture.scratch);
  const options = (overrides: Partial<StartOptions> = {}): StartOptions => ({
    repo: fixture.repo,
    environment: fixture.repo,
    profile: profileOf(),
    plan: { text: planYaml(fixture.base, planGroups), source: 'fixture/plan.yaml', files: new Map(), recordedCostUsd: 0.1961 },
    cost: { budgetRun: null, mode: null, llmUsd: 0 },
    runDirectory: path.join(fixture.scratch, 'run'),
    branch: 'ac/run-test',
    rungs: ['R0', 'R1', 'R2', 'R3', 'R4'],
    maxSteps: null,
    jobs: 1,
    injectFault: null,
    log: quiet,
    ...overrides,
  });
  const git = (...args: string[]) => gitOf(fixture.repo, ...args);
  const runDirectory = path.join(fixture.scratch, 'run');
  const read = (file: string) => fs.readFileSync(path.join(runDirectory, file), 'utf8');
  return { ...fixture, options, git, runDirectory, read, state: () => JSON.parse(read('run.json')) as RunState, events: () => read('events.jsonl').trim().split('\n').map((line) => JSON.parse(line) as RunEvent) };
}

/** Commit subjects and messages of the run's branch, oldest first. */
const branchLog = (git: (...args: string[]) => string, base: string) => git('log', '--reverse', '--format=%H%x00%B%x01', `${base}..HEAD`).split('\x01').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
  const [sha, message] = entry.split('\0') as [string, string];
  return { sha, message };
});

describe('ac run: the ladder', () => {
  const renames: Partial<RunDependencies> = {
    normalizationSteps: () => ({
      steps: [{ index: 1, rung: 'R3', group: 'module/album', moves: new Map([['server/src/modules/album/AlbumStore.ts', 'server/src/modules/album/album-store.ts']]) }],
      declined: [{ file: 'server/src/modules/user/user.controller.ts', to: 'server/src/modules/user/user.controller.ts', reason: 'already-normal', detail: 'test decline' }],
    }),
  };

  it('moves, commits and certifies every step, with trailers on every commit, rung certificates and a whole-PR certificate', async () => {
    const run = setup();
    const outcome = await startRun(run.options(), renames);
    expect(outcome.state.error).toBeUndefined();
    expect(outcome.exitCode).toBe(0);
    const state = run.state();
    expect(state.status).toBe('completed');
    expect(run.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('ac/run-test');
    expect(run.git('rev-parse', 'HEAD')).toBe(state.head);

    const log = branchLog(run.git, run.base);
    expect(log.map((commit) => commit.message.split('\n')[0])).toEqual([
      'refactor(server): move album into src/modules/album',
      'refactor(server): move user into src/modules/user',
      'refactor(server): move shared into src/shared',
      'refactor(server): normalize file names in src/modules/album',
      'chore(server): add boundary rules with a frozen baseline',
    ]);
    for (const commit of log.slice(0, 4)) {
      expect(commit.message).toMatch(/^Ac-Certificate: pass \(static\) K0=pass /m);
      expect(commit.message).toContain(`of plan sha256 ${state.plan.sha256.slice(0, 12)}`);
      expect(commit.message).toMatch(/^Ac-Certificate-Digest: sha256:[0-9a-f]{64}$/m);
    }
    expect(log[4]!.message).toMatch(/^Ac-Certificate: pass \(full\) K0=pass /m);
    expect(log[0]!.message).toContain('4 files moved; ');
    expect(run.git('ls-tree', '-r', '--name-only', 'HEAD', 'server/src').split('\n')).toEqual([
      'server/src/main.ts',
      'server/src/modules/album/album-store.ts',
      'server/src/modules/album/album.controller.ts',
      'server/src/modules/album/album.repository.ts',
      'server/src/modules/album/album.service.ts',
      'server/src/modules/user/user.controller.ts',
      'server/src/modules/user/user.repository.ts',
      'server/src/modules/user/user.service.spec.ts',
      'server/src/modules/user/user.service.ts',
      'server/src/shared/format.ts',
    ]);

    // Steps: certified once each, with their certificates on disk; the digest in the trailer is the stored one.
    expect(state.steps.map((step) => [step.index, step.rung, step.group, step.status, step.attempts.length])).toEqual([
      [1, 'R1', 'module/album', 'certified', 1], [2, 'R1', 'module/user', 'certified', 1], [3, 'R2', 'shared/shared', 'certified', 1], [4, 'R3', 'module/album', 'certified', 1],
      [5, 'R4', 'boundaries', 'certified', 1],
    ]);
    for (const step of state.steps.filter((candidate) => candidate.rung !== 'R4')) {
      const certificate = JSON.parse(run.read(step.certificate!.file)) as Certificate;
      expect(certificate.verdict).toBe('pass');
      expect(certificate.scope).toBe('static');
      expect(certificate.checks.map((check) => check.id)).not.toContain('K8');
      expect(run.read(step.certificate!.file.replace(/\.json$/, '.txt'))).toContain('verdict: PASS');
      expect(log[step.index - 1]!.message).toContain(`Ac-Certificate-Digest: ${certificate.digest}`);
      expect(step.commit).toBe(log[step.index - 1]!.sha);
    }
    expect(fs.readdirSync(path.join(run.runDirectory, 'certificates')).sort()).toEqual([
      '001-R1-module-album.json', '001-R1-module-album.txt', '002-R1-module-user.json', '002-R1-module-user.txt',
      '003-R2-shared-shared.json', '003-R2-shared-shared.txt', '004-R3-module-album.json', '004-R3-module-album.txt',
    ]);

    // Rungs: each certified as a whole with the oracles; R4 (the real dependency-cruiser rules) is its one commit.
    expect(state.rungs.map((rung) => [rung.id, rung.status])).toEqual([['R0', 'passed'], ['R1', 'certified'], ['R2', 'certified'], ['R3', 'certified'], ['R4', 'certified']]);
    expect(run.git('ls-tree', '--name-only', 'HEAD', 'server/').split('\n')).toEqual(expect.arrayContaining(['server/.dependency-cruiser-known-violations.json', 'server/.dependency-cruiser.json']));
    expect(JSON.parse(run.read('boundaries/report.json'))).toMatchObject({ version: 1, packageRoot: 'server', moduleRoot: 'src' });
    for (const id of ['R1', 'R2', 'R3', 'R4']) {
      const certificate = JSON.parse(run.read(`rungs/${id}.json`)) as Certificate;
      expect(certificate).toMatchObject({ verdict: 'pass', scope: 'full' });
      expect(certificate.checks.find((check) => check.id === 'K8')!.status).toBe('pass');
    }
    expect(state.rungs[1]).toMatchObject({ start: state.base, end: state.steps[1]!.commit });
    expect(JSON.parse(run.read('certificate.json'))).toMatchObject({ verdict: 'pass', scope: 'full', base: state.base, head: state.head });
    expect(state.certificate).toMatchObject({ file: 'certificate.json', verdict: 'pass' });

    // R0: the preflight and the baseline.
    const preflight = JSON.parse(run.read('preflight.json'));
    expect(preflight).toMatchObject({ format: 'ac-preflight/1', declined: false, declines: [], plan: { matchesBranchStart: true, missingFiles: [] } });
    expect(preflight.envelope.plannedMoves).toBe(9);
    expect(preflight.inventory.analyzedFiles).toBeGreaterThan(9);
    expect(JSON.parse(run.read('baseline.json'))).toMatchObject({ green: true, flaky: [] });

    // Findings: R3's decline; plan files and step files.
    expect(state.findings).toEqual([expect.objectContaining({ kind: 'rename-declined', rung: 'R3' })]);
    expect(run.read('plan/plan.yaml')).toBe(planYaml(run.base));
    expect(fs.readdirSync(path.join(run.runDirectory, 'plan', 'steps')).sort()).toEqual(['01-module-album.json', '02-module-user.json', '03-shared-shared.json', '04-module-album.json']);

    // run.json and events.jsonl shapes.
    expect(state).toMatchObject({
      format: 'ac-run/1', repo: fs.realpathSync(run.repo), branch: 'ac/run-test', base: run.base, packageRoot: 'server', moduleRoot: 'src',
      plan: { file: 'plan/plan.yaml', source: 'fixture/plan.yaml', steps: 3, moves: 9 }, rungsRequested: ['R0', 'R1', 'R2', 'R3', 'R4'],
      cost: { budgetRun: null, mode: null, llmUsd: 0, planRecordedUsd: 0.1961 }, pins: [], quarantine: [], fault: null,
    });
    expect(state.timeline.durationMs).toBeGreaterThan(0);
    expect(state.timeline.stepsMs).toBeGreaterThan(0);
    expect(state.steps[0]!.attempts[0]).toMatchObject({ state: 'passed', round: 1, parent: state.base, moves: 4, offending: [], pinned: [] });
    expect(Object.keys(state.steps[0]!.attempts[0]!.timings).sort()).toEqual(['amendMs', 'certifyMs', 'commitMs', 'moveMs']);
    expect(state.steps[0]!.counts).toEqual({ filesMoved: 4, specifierEdits: expect.any(Number), filesEdited: expect.any(Number) });
    expect(state.steps[0]!.pathMap).toEqual({
      'server/src/controllers/album.controller.ts': 'server/src/modules/album/album.controller.ts',
      'server/src/repositories/AlbumStore.ts': 'server/src/modules/album/AlbumStore.ts',
      'server/src/repositories/album.repository.ts': 'server/src/modules/album/album.repository.ts',
      'server/src/services/album.service.ts': 'server/src/modules/album/album.service.ts',
    });
    const events = run.events();
    expect(events[0]!.event).toBe('run-start');
    expect(events.at(-1)).toMatchObject({ event: 'run-end', status: 'completed' });
    for (const event of events) expect(event.ts).toMatch(/^\d{4}-\d\d-\d\dT/);
    const kinds = new Set(events.map((event) => event.event));
    for (const kind of ['preflight', 'baseline', 'branch', 'rung-start', 'step-start', 'move', 'commit', 'certify', 'amend', 'step-end', 'rung-certify', 'run-certify']) expect(kinds).toContain(kind);
    for (const event of events.filter((candidate) => ['move', 'commit', 'certify', 'amend', 'rung-certify'].includes(candidate.event))) expect(event.durationMs).toBeGreaterThanOrEqual(0);

    const report = run.read('report.md');
    expect(report).toContain('- Status: **completed** (exit 0)');
    expect(report).toContain('| 1 | R1 | module/album | certified | 1 | 4 |');
    expect(report).toMatch(/\| R4 \| certified \|/);
    expect(report).toContain('the plan cost $0.1961 when it was recorded');
    expect(report).toContain('## Findings');
  });

  it('replans a declined step by pinning the offending entry, and says so in the commit', async () => {
    const run = setup({ ...sources, ...userPaths }, {
      ...groups,
      'module/user': [...groups['module/user']!, { path: 'src/services/user-paths.ts' }],
    });
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1'] }));
    expect(outcome.state.error).toBeUndefined();
    const state = run.state();
    expect(state.status).toBe('completed');
    const user = state.steps.find((step) => step.group === 'module/user')!;
    expect(user.status).toBe('certified');
    expect(user.attempts.map((attempt) => attempt.state)).toEqual(['declined', 'passed']);
    expect(user.attempts[0]!.detail).toContain('location-sensitive server/src/services/user-paths.ts');
    expect(user.attempts[0]!.offending).toEqual(['server/src/services/user-paths.ts']);
    expect(state.pins).toEqual([{ file: 'server/src/services/user-paths.ts', step: 2, group: 'module/user', reason: 'pinned' }]);
    expect(state.findings).toEqual([expect.objectContaining({ kind: 'pinned', step: 2, files: ['server/src/services/user-paths.ts'] })]);
    const message = run.git('log', '-1', '--format=%B', user.commit!);
    expect(message).toContain('Pinned (left in place): src/services/user-paths.ts.');
    expect(message).toContain('Replanned 1 time.');
    expect(message).toContain('Ac-Certificate: pass (static)');
    expect(run.git('ls-tree', '-r', '--name-only', 'HEAD', 'server/src/services').split('\n')).toEqual(['server/src/services/user-paths.ts']);
    expect(state.rungs.find((rung) => rung.id === 'R2')!.status).toBe('not-requested');
  });

  it('rolls back a seeded wrong move (--inject-fault) whose certificate FAILs, and replans the step', async () => {
    const run = setup();
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1'], injectFault: { step: 'module/album', operator: 'M2' } }));
    expect(outcome.state.error).toBeUndefined();
    const state = run.state();
    expect(state.status).toBe('completed');
    const album = state.steps[0]!;
    expect(album.attempts.map((attempt) => attempt.state)).toEqual(['failed', 'passed']);
    expect(album.attempts[0]!.injectedFault).toMatchObject({ operator: 'M2' });
    expect(album.attempts[0]!.certificate).toMatchObject({ verdict: 'fail', file: 'certificates/failed/001-R1-module-album-attempt1.json' });
    // M2 left album.controller's specifier as in base: the replan pins that entry alone.
    expect(album.attempts[0]!.injectedFault!.description).toContain('server/src/modules/album/album.controller.ts');
    expect(state.pins).toEqual([{ file: 'server/src/controllers/album.controller.ts', step: 1, group: 'module/album', reason: 'pinned' }]);
    expect(state.fault).toMatchObject({ step: 'module/album', operator: 'M2', appliedTo: 1, mutantCommit: album.attempts[0]!.commit });
    expect(state.findings.map((finding) => finding.kind)).toEqual(['injected-fault', 'pinned']);
    // The mutant commit is gone from the branch; the replanned step is certified.
    expect(run.git('rev-list', `${run.base}..HEAD`).split('\n')).not.toContain(album.attempts[0]!.commit);
    expect(album.status).toBe('certified');
    expect(state.rungs.find((rung) => rung.id === 'R1')!.status).toBe('certified');
    const events = run.events();
    expect(events.filter((event) => event.event === 'fault')).toEqual([expect.objectContaining({ step: 1, applied: true })]);
    expect(events.filter((event) => event.event === 'rollback')).toEqual([expect.objectContaining({ step: 1, to: state.base })]);
    expect(run.read('report.md')).toContain('Injected fault');
  });

  it('pins the whole step after two replans that still fail', async () => {
    const run = setup();
    // Every static certificate of the user step FAILs, naming the first file the step still moves.
    const failUser = async (options: CertifyOptions) => {
      const certificate = await certify(options);
      const moved = Object.values(certificate.pathMap.entries).filter((file) => file.includes('/modules/user/')).sort();
      if (options.oracles || !moved.length) return certificate;
      const k2 = certificate.checks.find((check) => check.id === 'K2')!;
      k2.status = 'fail';
      k2.violations.push({ file: moved[0]!, detail: 'injected by the test' });
      return { ...certificate, verdict: 'fail' as const };
    };
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1'] }), { certify: failUser });
    expect(outcome.state.error).toBeUndefined();
    const state = run.state();
    const user = state.steps[1]!;
    expect(user.status).toBe('pinned');
    expect(user.attempts.map((attempt) => [attempt.state, attempt.moves])).toEqual([['failed', 4], ['failed', 3], ['failed', 2]]);
    expect(state.findings.map((finding) => finding.kind)).toEqual(['pinned', 'pinned', 'step-pinned']);
    expect(state.findings[2]!.detail).toContain('still failing after 2 replans');
    expect(state.pins.map((pin) => pin.file).sort()).toEqual(['server/src/controllers/user.controller.ts', 'server/src/repositories/user.repository.ts', 'server/src/services/user.service.spec.ts', 'server/src/services/user.service.ts']);
    expect(branchLog(run.git, run.base).map((commit) => commit.message.split('\n')[0])).toEqual(['refactor(server): move album into src/modules/album']);
    expect(state.status).toBe('completed');
  });
});

describe('ac run: refusals that change nothing', () => {
  it('refuses a dirty worktree, an existing branch, a plan of another commit and a used run directory', async () => {
    const run = setup();
    fs.appendFileSync(path.join(run.repo, 'server/src/main.ts'), '// edit\n');
    await expect(startRun(run.options(), noRenames)).rejects.toThrow('has tracked changes');
    expect(fs.existsSync(run.runDirectory)).toBe(false);
    run.git('checkout', '-q', '--', '.');
    run.git('branch', 'ac/run-test');
    await expect(startRun(run.options(), noRenames)).rejects.toThrow('branch ac/run-test already exists');
    const other = run.options({ branch: 'ac/run-other' });
    await expect(startRun({ ...other, plan: { ...other.plan, text: planYaml('f'.repeat(40)) } }, noRenames)).rejects.toThrow("the plan's sha ffffffffff");
    await expect(startRun({ ...other, plan: { ...other.plan, text: other.plan.text.replace('module/album:', 'module/Album:') } }, noRenames)).rejects.toThrow();
    fs.mkdirSync(run.runDirectory, { recursive: true });
    fs.writeFileSync(path.join(run.runDirectory, 'run.json'), '{}');
    await expect(startRun(other, noRenames)).rejects.toThrow('already holds a run');
    expect(run.git('rev-parse', '--abbrev-ref', 'HEAD')).not.toBe('ac/run-other');
  });
});

describe('ac run: preflight declines', () => {
  it('declines a run whose baseline is not green: exit 3, no branch, no commit', async () => {
    const run = setup({ ...sources, 'server/src/utils/format.ts': 'export const title = (text: string) => text; // ERROR\n' });
    const outcome = await startRun(run.options(), noRenames);
    expect(outcome.exitCode).toBe(3);
    const state = run.state();
    expect(state.status).toBe('declined');
    expect(state.rungs[0]).toMatchObject({ id: 'R0', status: 'declined' });
    const preflight = JSON.parse(run.read('preflight.json'));
    expect(preflight.declined).toBe(true);
    expect(preflight.declines).toEqual([expect.objectContaining({ code: 'baseline-not-green', detail: expect.stringContaining('tsc') })]);
    expect(JSON.parse(run.read('baseline.json')).green).toBe(false);
    expect(run.git('branch', '--list', 'ac/run-test')).toBe('');
    expect(run.git('rev-parse', 'HEAD')).toBe(run.base);
    expect(run.read('report.md')).toContain('**declined** (exit 3)');
  });

  it('declines a plan naming files the repo does not track, before running the baseline', async () => {
    const run = setup(sources, { ...groups, 'module/ghost': [{ path: 'src/services/ghost.service.ts' }] });
    const outcome = await startRun(run.options(), noRenames);
    expect(outcome.exitCode).toBe(3);
    const preflight = JSON.parse(run.read('preflight.json'));
    expect(preflight.declines).toEqual([expect.objectContaining({ code: 'plan-mismatch', file: 'server/src/services/ghost.service.ts' })]);
    expect(preflight.baseline).toBeNull();
    expect(fs.existsSync(path.join(run.runDirectory, 'baseline.json'))).toBe(false);
  });

  it('declines a profile without oracles', async () => {
    const run = setup();
    const outcome = await startRun(run.options({ profile: profileOf([]) }), noRenames);
    expect(outcome.exitCode).toBe(3);
    expect(JSON.parse(run.read('preflight.json')).declines).toEqual([expect.objectContaining({ code: 'no-oracles' })]);
  });
});

describe('ac run: crash, stop and resume', () => {
  it('resumes after a crash between commit and certificate: the uncertified commit is reset and the step redone', async () => {
    const run = setup();
    let calls = 0;
    const crashOnUser = async (options: CertifyOptions) => {
      calls++;
      if (!options.oracles && calls === 2) throw new Error('simulated crash');
      return certify(options);
    };
    const crashed = await startRun(run.options({ rungs: ['R0', 'R1', 'R2'] }), { certify: crashOnUser });
    expect(crashed.exitCode).toBe(1);
    const atCrash = run.state();
    expect(atCrash.status).toBe('failed');
    expect(atCrash.error).toContain('simulated crash');
    expect(atCrash.steps[1]!.attempts[0]!.state).toBe('certifying');
    const uncertified = atCrash.steps[1]!.attempts[0]!.commit!;
    expect(run.git('rev-parse', 'HEAD')).toBe(uncertified);
    expect(atCrash.head).toBe(atCrash.steps[0]!.commit);

    const resumed = await resumeRun({ runDirectory: run.runDirectory, repo: run.repo, maxSteps: null, log: quiet });
    expect(resumed.state.error).toBeUndefined();
    expect(resumed.exitCode).toBe(0);
    const state = run.state();
    expect(state.status).toBe('completed');
    expect(state.steps[1]!.attempts.map((attempt) => attempt.state)).toEqual(['interrupted', 'passed']);
    expect(state.timeline.resumedAt).toHaveLength(1);
    const log = branchLog(run.git, run.base);
    expect(log).toHaveLength(3);
    for (const commit of log) expect(commit.message).toContain('Ac-Certificate: pass (static)');
    expect(log.map((commit) => commit.sha)).not.toContain(uncertified);
    expect(run.events().filter((event) => event.event === 'resume').map((event) => event.detail ?? null)).toEqual(['reset 1 uncertified run commits', null]);
  });

  it('stops when a check crashes (no evidence either way) instead of pinning the step, and --resume retries it', async () => {
    const run = setup();
    let calls = 0;
    const crashingCheck = async (options: CertifyOptions) => {
      const certificate = await certify(options);
      if (options.oracles || ++calls !== 2) return certificate;
      const k3a = certificate.checks.find((check) => check.id === 'K3a')!;
      Object.assign(k3a, { status: 'error', summary: 'crashed: boom', violations: [{ detail: 'Error: boom' }] });
      return { ...certificate, verdict: 'fail' as const };
    };
    const stopped = await startRun(run.options({ rungs: ['R0', 'R1'] }), { certify: crashingCheck });
    expect(stopped.exitCode).toBe(1);
    let state = run.state();
    expect(state.error).toContain('the certifier crashed on step 2 (K3a)');
    expect(state.steps[1]).toMatchObject({ status: 'running', attempts: [expect.objectContaining({ state: 'interrupted' })] });
    expect(state.pins).toEqual([]);
    expect(run.git('rev-parse', 'HEAD')).toBe(state.steps[0]!.commit);
    expect(run.git('status', '--porcelain', '--untracked-files=no')).toBe('');

    const resumed = await resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet });
    expect(resumed.exitCode).toBe(0);
    state = run.state();
    expect(state.steps[1]!.attempts.map((attempt) => attempt.state)).toEqual(['interrupted', 'passed']);
    expect(state.steps[1]!.commit).toBe(state.head);
  });

  it('stops after --max-steps with a partial rung certificate, and --resume finishes the ladder', async () => {
    const run = setup();
    const stopped = await startRun(run.options({ rungs: ['R0', 'R1', 'R2'], maxSteps: 1 }));
    expect(stopped.exitCode).toBe(0);
    let state = run.state();
    expect(state.status).toBe('stopped');
    expect(state.steps.map((step) => step.status)).toEqual(['certified', 'pending', 'pending']);
    expect(state.rungs[1]).toMatchObject({ id: 'R1', status: 'running', certificate: { verdict: 'pass', scope: 'full', partial: true } });
    expect(state.certificate).toBeUndefined();

    await expect(resumeRun({ runDirectory: run.runDirectory, repo: path.join(run.scratch, 'elsewhere'), maxSteps: null, log: quiet })).rejects.toThrow('not a git repository');
    const resumed = await resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet });
    expect(resumed.exitCode).toBe(0);
    state = run.state();
    expect(state.status).toBe('completed');
    expect(state.rungs.slice(1, 3).map((rung) => [rung.id, rung.status, rung.certificate?.partial])).toEqual([['R1', 'certified', false], ['R2', 'certified', false]]);
    expect(branchLog(run.git, run.base)).toHaveLength(3);
    await expect(resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet })).rejects.toThrow('nothing to resume: the run is completed');
  });

  it('refuses --resume after the whole-PR certificate FAILs (a verdict is final), and keeps the FAIL on record', async () => {
    const run = setup();
    let failed = false;
    const wholePrFailsOnce = async (options: CertifyOptions) => {
      const certificate = await certify(options);
      if (failed || path.basename(options.workDir) !== 'run') return certificate;
      failed = true;
      Object.assign(certificate.checks.find((check) => check.id === 'K8')!, { status: 'fail', summary: 'injected by the test', violations: [{ detail: 'test X failed' }] });
      return { ...certificate, verdict: 'fail' as const };
    };
    const first = await startRun(run.options({ rungs: ['R0', 'R1', 'R2'] }), { ...noRenames, certify: wholePrFailsOnce });
    expect(first.exitCode).toBe(1);
    expect(run.state()).toMatchObject({ status: 'failed', failure: 'verdict', certificate: { file: 'certificate.json', verdict: 'fail' } });
    await expect(resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet }, { ...noRenames, certify: wholePrFailsOnce })).rejects.toThrow('failed on a verdict');
    expect(run.state()).toMatchObject({ status: 'failed', failure: 'verdict', certificate: { file: 'certificate.json', verdict: 'fail' } });
    expect(JSON.parse(run.read('certificate.json')).verdict).toBe('fail');
  });

  it('resumes across a message-only rewrite that saved its state but did not move the branch', async () => {
    const run = setup();
    await startRun(run.options({ rungs: ['R0', 'R1'], maxSteps: 1 }));
    const certified = run.state().head;
    // What the trailer rewrite pass leaves when killed between saving run.json and resetting the branch.
    run.git('commit', '-q', '--amend', '--only', '-m', 'the message before the rewrite');
    expect(run.git('rev-parse', 'HEAD')).not.toBe(certified);
    const resumed = await resumeRun({ runDirectory: run.runDirectory, maxSteps: 0, log: quiet });
    expect(resumed.state.error).toBeUndefined();
    expect(run.git('rev-parse', 'HEAD')).toBe(certified);
    expect(run.events().filter((event) => event.event === 'resume')[0]!.detail).toBe('moved the branch to the rewritten commits (same trees)');
  });

  it('refuses to resume when the branch moved under the run', async () => {
    const run = setup();
    await startRun(run.options({ rungs: ['R0', 'R1'], maxSteps: 1 }));
    fs.writeFileSync(path.join(run.repo, 'server/notes.md'), 'hand edit\n');
    run.git('add', '-A');
    run.git('commit', '-q', '-m', 'by hand');
    await expect(resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet })).rejects.toThrow("1 commits on top weren't made by this run");
  });
});

describe('ac run: oracle runs cached per tree', () => {
  it('seeds R1\'s base from the baseline, R2\'s base from R1\'s head, and the whole PR from both ends, with digests a fresh run gives', async () => {
    const run = setup();
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1', 'R2'] }), noRenames);
    expect(outcome.exitCode).toBe(0);
    const facts = (file: string) => {
      const certificate = JSON.parse(run.read(file)) as Certificate;
      return Object.fromEntries(Object.entries(certificate.checks.find((check) => check.id === 'K8')!.run ?? {}).filter(([key]) => key.endsWith('.cached')));
    };
    expect(facts('rungs/R1.json')).toEqual({ 'tsc.head.cached': false, 'unit.head.cached': false, 'unit.base.cached': true });
    expect(facts('rungs/R2.json')).toEqual({ 'tsc.head.cached': false, 'unit.head.cached': false, 'unit.base.cached': true });
    expect(facts('certificate.json')).toEqual({ 'tsc.head.cached': true, 'unit.head.cached': true, 'unit.base.cached': true });
    const state = run.state();
    const fresh = await certify({
      repo: run.repo, base: state.base, head: state.head, packageRoot: 'server', environment: run.repo, profile: profileOf(), oracles: true,
      workDir: fs.mkdtempSync(path.join(run.scratch, 'fresh-')), keep: false, quarantine: [],
    });
    expect(fresh.digest).toBe(state.certificate!.digest);
  });
});

describe('ac run: certificates without a verdict', () => {
  /** K8 errors (no check fails) in the certifications whose work dir is named `work`, `times` times. */
  const k8Errors = (work: string, times = 1) => {
    let left = times;
    return async (options: CertifyOptions) => {
      const certificate = await certify(options);
      if (path.basename(options.workDir) !== work || left <= 0) return certificate;
      left--;
      Object.assign(certificate.checks.find((check) => check.id === 'K8')!, { status: 'error', summary: 'crashed: the runner was killed', violations: [{ detail: 'error: unit on base: no report' }] });
      return { ...certificate, verdict: 'fail' as const };
    };
  };

  it('stops on a rung certificate whose checks only errored, keeps it on record, and --resume certifies the rung again', async () => {
    const run = setup();
    const errors = k8Errors('rung-R1');
    const stopped = await startRun(run.options({ rungs: ['R0', 'R1'] }), { ...noRenames, certify: errors });
    expect(stopped.exitCode).toBe(1);
    let state = run.state();
    expect(state).toMatchObject({ status: 'failed', failure: 'crash', pins: [] });
    expect(state.error).toContain("rung R1's certificate has no verdict: K8 errored and no check failed");
    expect(state.rungs[1]).toMatchObject({ id: 'R1', status: 'running', certificate: { file: 'rungs/R1.json', verdict: 'fail', failing: ['K8'] } });
    expect(state.rungs[1]!.bisect).toBeUndefined();
    expect(state.steps.map((step) => step.status)).toEqual(['certified', 'certified', 'pending']);

    const resumed = await resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet }, { ...noRenames, certify: errors });
    expect(resumed.exitCode).toBe(0);
    state = run.state();
    expect(state.status).toBe('completed');
    expect(state.rungs[1]).toMatchObject({ status: 'certified', certificate: { file: 'rungs/R1-2.json', verdict: 'pass' } });
    expect(JSON.parse(run.read('rungs/R1.json')).verdict).toBe('fail');
    expect(branchLog(run.git, run.base)).toHaveLength(2);
  });

  it('keeps a rung certificate with a failing check next to an errored one a verdict', async () => {
    const run = setup();
    const failAndError = async (options: CertifyOptions) => {
      const certificate = await certify(options);
      if (path.basename(options.workDir) !== 'rung-R1') return certificate;
      Object.assign(certificate.checks.find((check) => check.id === 'K8')!, { status: 'error', summary: 'crashed', violations: [{ detail: 'error: boom' }] });
      Object.assign(certificate.checks.find((check) => check.id === 'K4')!, { status: 'fail', summary: 'injected', violations: [{ detail: 'an old path' }] });
      return { ...certificate, verdict: 'fail' as const };
    };
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1'] }), { ...noRenames, certify: failAndError });
    expect(outcome.exitCode).toBe(1);
    expect(run.state()).toMatchObject({ status: 'failed', failure: 'verdict', rungs: expect.arrayContaining([expect.objectContaining({ id: 'R1', status: 'failed' })]) });
    await expect(resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet }, noRenames)).rejects.toThrow('failed on a verdict');
  });

  it('makes a rung certificate whose K3b fails next to a runner\'s error a verdict that --resume refuses', async () => {
    const run = setup();
    const errorAndViolation = async (options: CertifyOptions) => {
      const certificate = await certify(options);
      if (path.basename(options.workDir) !== 'rung-R1') return certificate;
      // K3b's shape when one runner errors and another finds a retargeted import: fail, the marked error first.
      Object.assign(certificate.checks.find((check) => check.id === 'K3b')!, {
        status: 'fail', summary: 'vitest: error; vitest 4.0.0: 1 violations (1 retargeted)',
        violations: [{ detail: 'error: vitest-1: vitest could not resolve in base: killed' }, { file: 'server/src/modules/user/user.service.ts', detail: "site 0 './user.repository' resolves elsewhere" }],
      });
      return { ...certificate, verdict: 'fail' as const };
    };
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1'] }), { ...noRenames, certify: errorAndViolation });
    expect(outcome.exitCode).toBe(1);
    expect(run.state()).toMatchObject({ status: 'failed', failure: 'verdict', rungs: expect.arrayContaining([expect.objectContaining({ id: 'R1', status: 'failed' })]) });
    expect(run.state().error).toContain("rung R1's certificate FAILs (K3b)");
    await expect(resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet }, noRenames)).rejects.toThrow('failed on a verdict');
  });

  it('replans a step whose K6 fails next to a runner\'s error, pinning what the violation names and not what the error names', async () => {
    const run = setup();
    let calls = 0;
    const errorAndViolation = async (options: CertifyOptions) => {
      const certificate = await certify(options);
      if (options.oracles || ++calls !== 2) return certificate;
      const moved = certificate.pathMap.entries['server/src/repositories/user.repository.ts']!;
      // The error names a file the step moves: read as an offender, it would pin user.service.ts's entry too.
      Object.assign(certificate.checks.find((check) => check.id === 'K6')!, {
        status: 'fail', summary: 'vitest: error; vitest 4.0.0: 1 violations (1 files that no longer load)',
        violations: [{ detail: 'error: vitest-0: vitest could not list or load the tests of base: server/src/services/user.service.ts timed out' }, { file: moved, detail: 'listed by vitest-1 in base and head, but collected only in base' }],
      });
      return { ...certificate, verdict: 'fail' as const };
    };
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1'] }), { ...noRenames, certify: errorAndViolation });
    expect(outcome.exitCode).toBe(0);
    const state = run.state();
    expect(state.failure).toBeUndefined();
    expect(state.steps[1]).toMatchObject({ group: 'module/user', status: 'certified' });
    expect(state.steps[1]!.attempts.map((attempt) => attempt.state)).toEqual(['failed', 'passed']);
    expect(state.pins.map((pin) => pin.file)).toEqual(['server/src/repositories/user.repository.ts']);
  });

  it('rolls back R4 when its certificate only errored, and --resume commits the rules again as the same step\'s next attempt', async () => {
    const run = setup();
    const rules: Partial<RunDependencies> = {
      ...noRenames,
      boundaryRung: async () => ({
        files: new Map([['server/.dependency-cruiser.json', '{}\n']]), report: { rules: [] }, antiVacuity: [{ rule: 'shared-is-a-leaf', fired: true, detail: 'fired' }], summary: '1 rule',
      }),
    };
    const stopped = await startRun(run.options({ rungs: ['R0', 'R1', 'R4'] }), { ...rules, certify: k8Errors('rung-R4') });
    expect(stopped.exitCode).toBe(1);
    let state = run.state();
    expect(state).toMatchObject({ status: 'failed', failure: 'crash' });
    expect(state.error).toContain("R4's certificate has no verdict");
    expect(state.rungs[4]).toMatchObject({ id: 'R4', status: 'pending' });
    const r4 = state.steps.find((step) => step.rung === 'R4')!;
    expect(r4).toMatchObject({ index: 4, status: 'running', attempts: [expect.objectContaining({ attempt: 1, state: 'interrupted' })] });
    expect(run.git('rev-parse', 'HEAD')).toBe(state.steps[1]!.commit);
    expect(fs.existsSync(path.join(run.repo, 'server/.dependency-cruiser.json'))).toBe(false);

    const resumed = await resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet }, rules);
    expect(resumed.exitCode).toBe(0);
    state = run.state();
    expect(state.status).toBe('completed');
    expect(state.steps.filter((step) => step.rung === 'R4')).toEqual([expect.objectContaining({
      index: 4, status: 'certified', attempts: [expect.objectContaining({ attempt: 1, state: 'interrupted' }), expect.objectContaining({ attempt: 2, state: 'passed' })],
    })]);
    expect(state.rungs[4]).toMatchObject({ status: 'certified', certificate: { file: 'rungs/R4-2.json', verdict: 'pass' } });
    expect(branchLog(run.git, run.base).map((commit) => commit.message.split('\n')[0])).toEqual([
      'refactor(server): move album into src/modules/album', 'refactor(server): move user into src/modules/user', 'chore(server): add boundary rules with a frozen baseline',
    ]);
  });

  it('stops on a whole-PR certificate that only errored, and --resume certifies the PR again', async () => {
    const run = setup();
    const errors = k8Errors('run');
    const stopped = await startRun(run.options({ rungs: ['R0', 'R1', 'R2'] }), { ...noRenames, certify: errors });
    expect(stopped.exitCode).toBe(1);
    expect(run.state()).toMatchObject({ status: 'failed', failure: 'crash', certificate: { file: 'certificate.json', verdict: 'fail' } });
    expect(run.state().error).toContain('the whole-PR certificate has no verdict');
    const resumed = await resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet }, { ...noRenames, certify: errors });
    expect(resumed.exitCode).toBe(0);
    expect(run.state()).toMatchObject({ status: 'completed', certificate: { file: 'certificate-2.json', verdict: 'pass' } });
    expect(JSON.parse(run.read('certificate.json')).verdict).toBe('fail');
  });
});

describe('ac run: the baseline quarantine', () => {
  it('records flaky tests and hands K8 the quarantine at each certified range\'s base paths', async () => {
    const run = setup();
    const flaky = { file: 'server/src/services/user.service.spec.ts', name: 'user > finds', reason: 'passed, then failed' };
    const quarantines: { base: string; files: string[] }[] = [];
    const recording = async (options: CertifyOptions) => {
      if (options.oracles) quarantines.push({ base: options.base, files: (options.quarantine ?? []).map((entry) => entry.file) });
      else expect(options.quarantine).toBeUndefined();
      return certify(options);
    };
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1', 'R2'] }), {
      ...noRenames,
      certify: recording,
      runBaseline: async (options) => ({ ...(await runBaseline(options)), flaky: [flaky] }),
    });
    expect(outcome.state.error).toBeUndefined();
    const state = run.state();
    expect(state.quarantine).toEqual([flaky]);
    expect(state.findings).toEqual([expect.objectContaining({ kind: 'flaky-test', rung: 'R0', files: [flaky.file] })]);
    expect(quarantines).toEqual([
      { base: state.base, files: ['server/src/services/user.service.spec.ts'] },
      { base: state.steps[1]!.commit, files: ['server/src/modules/user/user.service.spec.ts'] },
      { base: state.base, files: ['server/src/services/user.service.spec.ts'] },
    ]);
  });
});

describe('ac run: the profile\'s oracle quarantine', () => {
  it('follows the moves into later ranges like the flaky entries, without a flaky-test finding', async () => {
    const run = setup();
    const quarantined = { file: 'server/src/services/user.service.spec.ts', reason: "the profile's unit oracle leaves it out of its runs", oracle: 'unit' };
    const quarantines: { base: string; files: string[] }[] = [];
    const recording = async (options: CertifyOptions) => {
      if (options.oracles) quarantines.push({ base: options.base, files: (options.quarantine ?? []).map((entry) => entry.file) });
      return certify(options);
    };
    const profile = profileOf([typecheck, { ...unit, quarantine: [quarantined.file] }]);
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1', 'R2'], profile }), { ...noRenames, certify: recording });
    expect(outcome.state.error).toBeUndefined();
    const state = run.state();
    expect(state.quarantine).toEqual([quarantined]);
    expect(state.findings.filter((finding) => finding.kind === 'flaky-test')).toEqual([]);
    expect(quarantines).toEqual([
      { base: state.base, files: ['server/src/services/user.service.spec.ts'] },
      { base: state.steps[1]!.commit, files: ['server/src/modules/user/user.service.spec.ts'] },
      { base: state.base, files: ['server/src/services/user.service.spec.ts'] },
    ]);
  });
});

describe('ac run: rung oracles', () => {
  it('bisects a rung whose oracles fail, pins the first failing step, re-executes the rest and certifies the rung', async () => {
    const run = setup();
    // An oracle that reads a path: the static checks can't see it, the rung's K8 does.
    const pathReader = { name: 'path-reader', kind: 'exit-zero' as const, cwd: 'server', command: ['node', '-e', "process.exit(require('fs').existsSync('src/services/album.service.ts') ? 0 : 1)"] };
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1'], profile: profileOf([typecheck, unit, pathReader]) }));
    expect(outcome.state.error).toBeUndefined();
    const state = run.state();
    expect(state.status).toBe('completed');
    const r1 = state.rungs[1]!;
    expect(r1.status).toBe('certified');
    expect(r1.bisect).toMatchObject({ firstFailingStep: 1, probes: [expect.objectContaining({ step: 1, k8: 'fail' })] });
    expect(state.steps.map((step) => [step.group, step.status, step.round])).toEqual([['module/album', 'pinned', 1], ['module/user', 'certified', 2], ['shared/shared', 'pending', 1]]);
    expect(state.findings).toEqual([expect.objectContaining({ kind: 'bisect-pinned', step: 1 })]);
    expect(fs.existsSync(path.join(run.runDirectory, 'rungs', 'failed', 'R1.json'))).toBe(true);
    expect(JSON.parse(run.read('rungs/R1.json'))).toMatchObject({ verdict: 'pass', base: state.base, head: state.head });
    const log = branchLog(run.git, run.base);
    expect(log.map((commit) => commit.message.split('\n')[0])).toEqual(['refactor(server): move user into src/modules/user']);
    expect(run.events().filter((event) => event.event === 'bisect')).toEqual([expect.objectContaining({ rung: 'R1', step: 1, rolledBackTo: state.base })]);
  });
});

describe('ac run: a K8 bisect probe without evidence', () => {
  it('stops the bisect at a probe whose K8 errored, pins nothing, and --resume bisects again without overwriting a FAIL', async () => {
    const run = setup();
    // Step 2 (module/user) is the real culprit: the oracle reads user.service.ts at its old path.
    const pathReader = { name: 'path-reader', kind: 'exit-zero' as const, cwd: 'server', command: ['node', '-e', "process.exit(require('fs').existsSync('src/services/user.service.ts') ? 0 : 1)"] };
    const profile = profileOf([typecheck, unit, pathReader]);
    const probeErrors = async (options: CertifyOptions) => {
      const certificate = await certify(options);
      if (path.basename(options.workDir) !== 'bisect-R1-001') return certificate;
      Object.assign(certificate.checks.find((check) => check.id === 'K8')!, { status: 'error', summary: 'crashed: the runner was killed', violations: [{ detail: 'unit on base: no report' }] });
      return { ...certificate, verdict: 'fail' as const };
    };
    const stopped = await startRun(run.options({ rungs: ['R0', 'R1'], profile }), { ...noRenames, certify: probeErrors });
    expect(stopped.exitCode).toBe(1);
    let state = run.state();
    expect(state).toMatchObject({ status: 'failed', failure: 'crash', pins: [], findings: [] });
    expect(state.error).toContain("rung R1's K8 bisect probe at step 1 gave no evidence (K8 error)");
    expect(state.rungs[1]).toMatchObject({ status: 'running', bisect: { firstFailingStep: null, probes: [expect.objectContaining({ step: 1, k8: 'error' })] } });
    expect(state.steps.map((step) => step.status)).toEqual(['certified', 'certified', 'pending']);
    expect(run.git('rev-parse', 'HEAD')).toBe(state.steps[1]!.commit);
    expect(run.read('report.md')).toContain('K8 bisect: no evidence at step 1');

    const resumed = await resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet }, noRenames);
    expect(resumed.state.error).toBeUndefined();
    state = run.state();
    expect(state.status).toBe('completed');
    expect(state.rungs[1]).toMatchObject({ status: 'certified', bisect: { firstFailingStep: 2, probes: [expect.objectContaining({ k8: 'error' }), expect.objectContaining({ k8: 'pass' })] } });
    expect(state.steps.map((step) => [step.group, step.status])).toEqual([['module/album', 'certified'], ['module/user', 'pinned'], ['shared/shared', 'pending']]);
    expect(state.findings).toEqual([expect.objectContaining({ kind: 'bisect-pinned', step: 2 })]);
    expect(branchLog(run.git, run.base).map((commit) => commit.message.split('\n')[0])).toEqual(['refactor(server): move album into src/modules/album']);
    // Neither the rung certificate the bisects superseded nor the errored probe is overwritten.
    expect(fs.readdirSync(path.join(run.runDirectory, 'rungs', 'failed')).sort()).toEqual(['R1-2.json', 'R1-2.txt', 'R1.json', 'R1.txt']);
    expect(JSON.parse(run.read('rungs/bisect/R1-001.json')).checks.find((check: { id: string }) => check.id === 'K8').status).toBe('error');
    expect(JSON.parse(run.read('rungs/bisect/R1-001-2.json')).verdict).toBe('pass');
    expect(state.rungs[1]!.bisect!.probes.map((probe) => probe.certificate)).toEqual(['rungs/bisect/R1-001.json', 'rungs/bisect/R1-001-2.json']);
  });
});

describe('ac run: R4 through the injected boundary-rules hook (contract C6)', () => {
  const rules = (files: Map<string, string>, fired = true): Partial<RunDependencies> => ({
    ...noRenames,
    boundaryRung: async (input) => ({
      files,
      report: { rules: ['shared-is-a-leaf'], moduleRoot: input.moduleRoot, planGroups: input.planFile.groups.size },
      antiVacuity: [{ rule: 'shared-is-a-leaf', fired, detail: 'synthetic shared -> module import' }],
      summary: '1 rule, 0 known violations',
    }),
  });

  it('fails R4 without committing when a rule never fires on its synthetic violation', async () => {
    const run = setup();
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1', 'R4'] }), rules(new Map([['server/.dependency-cruiser.json', '{}\n']]), false));
    expect(outcome.exitCode).toBe(1);
    const state = run.state();
    expect(state.rungs[4]).toMatchObject({ id: 'R4', status: 'failed', note: expect.stringContaining('shared-is-a-leaf never fired') });
    expect(state.error).toContain('anti-vacuity');
    expect(JSON.parse(run.read('boundaries/report.json'))).toEqual({ rules: ['shared-is-a-leaf'], moduleRoot: 'src', planGroups: 3 });
    expect(branchLog(run.git, run.base)).toHaveLength(2);
    expect(state.steps.some((step) => step.rung === 'R4')).toBe(false);

    // A verdict is final: --resume refuses it rather than skip R4 and certify the rest.
    expect(state.failure).toBe('verdict');
    await expect(resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet }, rules(new Map(), true))).rejects.toThrow('failed on a verdict');
    expect(run.state()).toMatchObject({ status: 'failed', failure: 'verdict', rungs: expect.arrayContaining([expect.objectContaining({ id: 'R4', status: 'failed' })]) });
    // A run.json that says crash while a rung failed: the ladder still stops at the failed rung.
    fs.writeFileSync(path.join(run.runDirectory, 'run.json'), JSON.stringify({ ...run.state(), failure: 'crash' }));
    const resumed = await resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet }, rules(new Map(), true));
    expect(resumed.exitCode).toBe(1);
    expect(run.state()).toMatchObject({ status: 'failed', failure: 'verdict', error: expect.stringContaining('rung R4 failed') });
    expect(run.state().certificate).toBeUndefined();
    expect(fs.existsSync(path.join(run.runDirectory, 'certificate.json'))).toBe(false);
    expect(run.read('report.md')).toContain('- Status: **failed** (exit 1');
  });

  it('commits the rules, certifies the commit like a rung end, and rolls it back on a FAIL', async () => {
    const run = setup();
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1', 'R4'] }), rules(new Map([['server/boundaries.txt', 'not a tool config\n']])));
    expect(outcome.exitCode).toBe(1);
    const state = run.state();
    const r4 = state.steps.find((step) => step.rung === 'R4')!;
    expect(r4).toMatchObject({ index: 4, group: 'boundaries', status: 'pinned' });
    expect(r4.attempts[0]).toMatchObject({ state: 'failed', certificate: { file: 'rungs/R4.json', verdict: 'fail', scope: 'full' } });
    expect(r4.attempts[0]!.certificate!.failing).toContain('K1');
    expect(state.rungs[4]).toMatchObject({ id: 'R4', status: 'failed' });
    expect(run.git('rev-parse', 'HEAD')).toBe(state.steps[1]!.commit);
    expect(fs.existsSync(path.join(run.repo, 'server/boundaries.txt'))).toBe(false);
    expect(state.failure).toBe('verdict');
    await expect(resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet }, noRenames)).rejects.toThrow('failed on a verdict');
  });
});

describe('ac run --jobs: pipelined certification', () => {
  it('executes ahead of the certificates and writes every trailer in one message-only rewrite pass', async () => {
    const run = setup();
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1', 'R2'], jobs: 3 }), noRenames);
    expect(outcome.state.error).toBeUndefined();
    const state = run.state();
    expect(state.status).toBe('completed');
    const log = branchLog(run.git, run.base);
    expect(log).toHaveLength(3);
    for (const [index, commit] of log.entries()) {
      const step = state.steps[index]!;
      expect(step).toMatchObject({ status: 'certified', commit: commit.sha });
      expect(step.pendingTrailers).toBeUndefined();
      expect(commit.message).toContain(`Ac-Certificate-Digest: ${JSON.parse(run.read(step.certificate!.file)).digest}`);
      expect(run.git('rev-parse', `${commit.sha}^{tree}`)).toBe(step.tree);
      // The certificate is about the trees: the rewrite gave the commit a new id, not a new tree.
      expect(JSON.parse(run.read(step.certificate!.file)).headTree).toBe(step.tree);
    }
    expect(state.steps[1]!.parent).toBe(state.steps[0]!.commit);
    expect(run.events().filter((event) => event.event === 'amend').map((event) => event.detail)).toEqual([
      'trailers written to 2 commits in one rewrite pass', 'trailers written to 1 commits in one rewrite pass',
    ]);
    expect(state.rungs.slice(1, 3).map((rung) => rung.status)).toEqual(['certified', 'certified']);
    expect(JSON.parse(run.read('rungs/R1.json'))).toMatchObject({ verdict: 'pass', head: state.steps[1]!.commit });
  });

  it('resumes a pipelined run that crashed with trailers still pending', async () => {
    const run = setup();
    let calls = 0;
    const crashOnSecond = async (options: CertifyOptions) => {
      if (!options.oracles && ++calls === 2) throw new Error('simulated crash');
      return certify(options);
    };
    const crashed = await startRun(run.options({ rungs: ['R0', 'R1'], jobs: 2 }), { ...noRenames, certify: crashOnSecond });
    expect(crashed.exitCode).toBe(1);
    const atCrash = run.state();
    expect(atCrash.steps[0]).toMatchObject({ status: 'certified', pendingTrailers: [expect.stringMatching(/^Ac-Certificate: pass/), expect.any(String), expect.any(String), expect.any(String)] });
    expect(run.git('log', '-1', '--format=%B', atCrash.steps[0]!.commit!)).not.toContain('Ac-Certificate');

    const resumed = await resumeRun({ runDirectory: run.runDirectory, maxSteps: null, log: quiet });
    expect(resumed.state.error).toBeUndefined();
    const state = run.state();
    expect(state.status).toBe('completed');
    expect(state.steps[1]!.attempts.map((attempt) => attempt.state)).toEqual(['interrupted', 'passed']);
    const log = branchLog(run.git, run.base);
    expect(log.map((commit) => commit.sha)).toEqual([state.steps[0]!.commit, state.steps[1]!.commit]);
    for (const commit of log) expect(commit.message).toContain('Ac-Certificate: pass (static)');
  });

  it('discards the speculative commits after a FAIL and runs those steps again', async () => {
    const run = setup();
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1'], jobs: 2, injectFault: { step: '1', operator: 'M2' } }), noRenames);
    expect(outcome.state.error).toBeUndefined();
    const state = run.state();
    expect(state.status).toBe('completed');
    expect(state.steps[0]!.attempts.map((attempt) => attempt.state)).toEqual(['failed', 'passed']);
    expect(state.steps[1]!.attempts.map((attempt) => attempt.state)).toEqual(['interrupted', 'passed']);
    expect(state.steps[1]!.attempts[0]!.detail).toContain('discarded: step 1, committed before it, failed certification');
    expect(state.steps[1]!.attempts[0]!.parent).toBe(state.steps[0]!.attempts[0]!.commit);
    const log = branchLog(run.git, run.base);
    expect(log.map((commit) => commit.sha)).toEqual([state.steps[0]!.commit, state.steps[1]!.commit]);
    for (const commit of log) expect(commit.message).toContain('Ac-Certificate: pass (static)');
  });

  // The executor fails only on the seeded wrong move's tree: what it says there may not hold once that commit is gone.
  const onMutant = (run: ReturnType<typeof setup>) => run.git('rev-parse', 'HEAD') === run.state().fault?.mutantCommit;
  const userRepository = 'server/src/repositories/user.repository.ts';

  it('pins nothing on an uncertified parent: a step declined there waits for certified ground, like --jobs 1', async () => {
    const run = setup();
    const declinesOnMutant: RunDependencies['executeMove'] = (repoFs, moves, ...rest) => (onMutant(run) && moves.has(userRepository)
      ? { outcome: 'declined', moves: new Map(moves), declines: [{ code: 'destination-exists', file: moves.get(userRepository)!, detail: 'only on the mutant' }] }
      : executeMove(repoFs, moves, ...rest));
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1'], jobs: 2, injectFault: { step: '1', operator: 'M2' } }), { ...noRenames, executeMove: declinesOnMutant });
    expect(outcome.state.error).toBeUndefined();
    const state = run.state();
    expect(state.status).toBe('completed');
    expect(state.pins).toEqual([{ file: 'server/src/controllers/album.controller.ts', step: 1, group: 'module/album', reason: 'pinned' }]);
    expect(state.findings.map((finding) => finding.kind)).toEqual(['injected-fault', 'pinned']);
    const user = state.steps[1]!;
    expect(user.status).toBe('certified');
    expect(user.attempts.map((attempt) => attempt.state)).toEqual(['interrupted', 'passed']);
    expect(user.attempts[0]).toMatchObject({ parent: state.fault!.mutantCommit, pinned: [], detail: expect.stringContaining('uncertified parent') });
    expect(run.git('ls-tree', '-r', '--name-only', 'HEAD', 'server/src/modules/user').split('\n')).toContain('server/src/modules/user/user.repository.ts');
    expect(run.git('log', '-1', '--format=%B', user.commit!)).not.toContain('Replanned');
  });

  it('pins nothing on an uncertified parent when the executor crashes there either', async () => {
    const run = setup();
    const crashesOnMutant: RunDependencies['executeMove'] = (repoFs, moves, ...rest) => {
      if (onMutant(run)) throw new Error('only on the mutant');
      return executeMove(repoFs, moves, ...rest);
    };
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1'], jobs: 2, injectFault: { step: '1', operator: 'M2' } }), { ...noRenames, executeMove: crashesOnMutant });
    expect(outcome.state.error).toBeUndefined();
    const state = run.state();
    expect(state.pins.map((pin) => pin.file)).toEqual(['server/src/controllers/album.controller.ts']);
    expect(state.steps[1]).toMatchObject({ status: 'certified' });
    expect(state.steps[1]!.attempts.map((attempt) => attempt.state)).toEqual(['interrupted', 'passed']);
    expect(state.findings.map((finding) => finding.kind)).toEqual(['injected-fault', 'pinned']);
  });
});

describe('ac run: R3 with the real filename normalization (contract C5)', () => {
  it('renames what R1 placed, after R2, as certified steps numbered after the plan', async () => {
    const files: Files = {
      ...sources,
      'server/src/repositories/albumCover.repository.ts': 'export class AlbumCoverRepository {\n  cover(id: string) { return id; }\n}\n',
      'server/src/services/album.service.ts': sources['server/src/services/album.service.ts']!.replace("import { title } from '../utils/format.js';\n", "import { title } from '../utils/format.js';\nimport { AlbumCoverRepository } from '../repositories/albumCover.repository.js';\nexport const covers = AlbumCoverRepository;\n"),
    };
    const run = setup(files, { ...groups, 'module/album': [...groups['module/album']!, { path: 'src/repositories/albumCover.repository.ts' }] });
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1', 'R2', 'R3'] }));
    expect(outcome.state.error).toBeUndefined();
    const state = run.state();
    expect(state.status).toBe('completed');
    const r3 = state.steps.filter((step) => step.rung === 'R3');
    expect(r3.map((step) => [step.index, step.group, step.status, step.moves])).toEqual([
      [4, 'module/album', 'certified', { 'server/src/modules/album/albumCover.repository.ts': 'server/src/modules/album/album-cover.repository.ts' }],
    ]);
    expect(run.git('log', '-1', '--format=%s')).toBe('refactor(server): normalize file names in src/modules/album');
    expect(state.rungs[3]).toMatchObject({ id: 'R3', status: 'certified', certificate: { verdict: 'pass', scope: 'full' } });
    expect(run.read('plan/steps/04-module-album.json')).toContain('album-cover.repository.ts');
  });
});

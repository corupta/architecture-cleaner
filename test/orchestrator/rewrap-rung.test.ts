// S3 in `ac run`: off unless --rungs names it (the run, its run.json and the re-wrap untouched); when on, one step
// after R3 re-wraps the import line the moves lengthened, certified statically (K2: layout only) and as a rung with
// the oracles, before R4; nothing to re-wrap skips it; a re-wrap K2 rejects is rolled back and pinned. A re-wrap
// inside a file R1 moved certifies as part of the whole PR (base..final head), and a prettier config whose shared
// config and plugins only the environment holds is read as prettier reads it (the run's checkout has no node_modules).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Certificate } from '../../src/certificate/types.js';
import { type RunDependencies, type StartOptions, startRun } from '../../src/orchestrator/run.js';
import type { RunState } from '../../src/orchestrator/types.js';
import { planRewrap } from '../../src/rewrap/rewrap.js';
import { type Files, fixtureRepo, gitOf, planYaml, profileOf, sources } from './fixture.js';

const scratches: string[] = [];
let oracleCache: string;
let prettierEnvironment: string;
beforeAll(() => {
  oracleCache = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-rewrap-oracle-cache-'));
  process.env.AC_ORACLE_CACHE = oracleCache;
  // The target's prettier: this package's, in an environment of its own (the certifier's stays the fixture repo).
  prettierEnvironment = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-rewrap-prettier-'));
  fs.symlinkSync(path.resolve('node_modules'), path.join(prettierEnvironment, 'node_modules'));
});
afterAll(() => {
  delete process.env.AC_ORACLE_CACHE;
  for (const directory of [...scratches, oracleCache, prettierEnvironment]) fs.rmSync(directory, { recursive: true, force: true });
});

const noRenames: Partial<RunDependencies> = { normalizationSteps: () => ({ steps: [], declined: [] }) };
const withPrettier: Partial<RunDependencies> = { ...noRenames, rewrap: (input) => planRewrap({ ...input, environment: prettierEnvironment }) };

/** The fixture with an importer whose two-binding import the album move pushes past printWidth 82 (81 → 83 columns). */
const lengthened: Files = {
  ...sources,
  'server/.prettierrc': '{ "singleQuote": true, "trailingComma": "all", "printWidth": 82 }\n',
  'server/src/controllers/album.controller.ts': `${sources['server/src/controllers/album.controller.ts']}export const albumRoutes = ['albums'];\n`,
  'server/src/main.ts': "import { AlbumController, albumRoutes } from './controllers/album.controller.js';\nimport { UserController } from './controllers/user.controller.js';\nexport const controllers = [AlbumController, UserController, albumRoutes];\n",
};

/** The fixture where user.service.ts (moved by R1) imports two bindings of format.ts (moved by R2): 50 → 54 columns, printWidth 52. */
const movedImporter: Files = {
  ...sources,
  'server/.prettierrc': '{ "singleQuote": true, "trailingComma": "all", "printWidth": 52 }\n',
  'server/src/utils/format.ts': 'export const title = (text: string) => text.toUpperCase();\nexport const upper = title;\n',
  'server/src/services/user.service.ts': sources['server/src/services/user.service.ts']!.replace("import { title } from '../utils/format.js';", "import { title, upper } from '../utils/format.js';"),
};

function setup(files: Files) {
  const fixture = fixtureRepo(files);
  scratches.push(fixture.scratch);
  const runDirectory = path.join(fixture.scratch, 'run');
  const options = (overrides: Partial<StartOptions> = {}): StartOptions => ({
    repo: fixture.repo, environment: fixture.repo, profile: profileOf(),
    plan: { text: planYaml(fixture.base), source: 'fixture/plan.yaml', files: new Map(), recordedCostUsd: null },
    cost: { budgetRun: null, mode: null, llmUsd: 0 }, runDirectory, branch: 'ac/run-test', rungs: ['R0', 'R1', 'R2', 'R3', 'S3', 'R4'], maxSteps: null, jobs: 1, injectFault: null,
    log: () => {}, ...overrides,
  });
  const read = (file: string) => fs.readFileSync(path.join(runDirectory, file), 'utf8');
  return { ...fixture, options, read, git: (...args: string[]) => gitOf(fixture.repo, ...args), state: () => JSON.parse(read('run.json')) as RunState };
}

describe('ac run: S3, the import re-wrap', () => {
  it('is off unless --rungs names it: no S3 record, the re-wrap never called', async () => {
    const run = setup(lengthened);
    const outcome = await startRun(run.options({ rungs: ['R0', 'R1', 'R2', 'R3', 'R4'] }), { ...noRenames, rewrap: () => { throw new Error('S3 ran'); } });
    expect(outcome.state.error).toBeUndefined();
    const state = run.state();
    expect(state.status).toBe('completed');
    expect(state.rungsRequested).toEqual(['R0', 'R1', 'R2', 'R3', 'R4']);
    expect(state.rungs.map((rung) => rung.id)).toEqual(['R0', 'R1', 'R2', 'R3', 'R4']);
    expect(state.steps.map((step) => step.rung)).toEqual(['R1', 'R1', 'R2', 'R4']);
    expect(run.git('show', 'HEAD:server/src/main.ts')).toContain("import { AlbumController, albumRoutes } from './modules/album/album.controller.js';");
  });

  it('re-wraps after R3 and before R4, certified statically (K2: layout only) and as a rung with the oracles', async () => {
    const run = setup(lengthened);
    const outcome = await startRun(run.options(), withPrettier);
    expect(outcome.state.error).toBeUndefined();
    expect(outcome.exitCode).toBe(0);
    const state = run.state();
    expect(state.rungsRequested).toEqual(['R0', 'R1', 'R2', 'R3', 'S3', 'R4']);
    expect(state.rungs.map((rung) => [rung.id, rung.status])).toEqual([['R0', 'passed'], ['R1', 'certified'], ['R2', 'certified'], ['R3', 'skipped'], ['S3', 'certified'], ['R4', 'certified']]);
    const subjects = run.git('log', '--reverse', '--format=%s', `${run.base}..HEAD`).split('\n');
    expect(subjects).toEqual([
      'refactor(server): move album into src/modules/album',
      'refactor(server): move user into src/modules/user',
      'refactor(server): move shared into src/shared',
      'style(server): re-wrap the import lines the moves lengthened',
      'chore(server): add boundary rules with a frozen baseline',
    ]);
    const step = state.steps.find((candidate) => candidate.rung === 'S3')!;
    expect(step).toMatchObject({ index: 4, group: 'rewrap', status: 'certified', counts: { filesMoved: 0, specifierEdits: 0, filesEdited: 1 }, pathMap: {} });
    const message = run.git('log', '-1', '--format=%B', step.commit!);
    expect(message).toContain(`Step 4 (S3, rewrap) of plan sha256 ${state.plan.sha256.slice(0, 12)}.`);
    expect(message).toMatch(/^1 import and export declarations re-wrapped in 1 files with prettier [\d.]+: line breaks, indentation and the trailing comma of their binding lists only\.$/m);
    expect(message).toMatch(/^Ac-Certificate: pass \(static\) K0=pass /m);
    expect(run.git('show', `${step.commit}:server/src/main.ts`)).toBe("import {\n  AlbumController,\n  albumRoutes,\n} from './modules/album/album.controller.js';\nimport { UserController } from './modules/user/user.controller.js';\nexport const controllers = [AlbumController, UserController, albumRoutes];");
    const certificate = JSON.parse(run.read(step.certificate!.file)) as Certificate;
    expect(step.certificate!.file).toBe('certificates/004-S3-rewrap.json');
    expect(certificate).toMatchObject({ verdict: 'pass', scope: 'static' });
    expect(certificate.checks.find((check) => check.id === 'K2')!.metrics).toEqual({ comparedFiles: 1, editedFiles: 0, changedSpans: 0, layoutOnlyFiles: 1 });
    expect(JSON.parse(run.read('rungs/S3.json'))).toMatchObject({ verdict: 'pass', scope: 'full', base: step.parent, head: step.commit });
    expect(JSON.parse(run.read('certificate.json'))).toMatchObject({ verdict: 'pass', scope: 'full' });
    expect(run.read('report.md')).toMatch(/\| S3 \| certified \|/);
  });

  it('skips the step when no import line needs a re-wrap, and the run goes on', async () => {
    const run = setup(sources);
    const outcome = await startRun(run.options(), withPrettier);
    expect(outcome.exitCode).toBe(0);
    const state = run.state();
    expect(state.rungs.find((rung) => rung.id === 'S3')).toMatchObject({ status: 'skipped', note: 'no commits: every step was pinned or skipped' });
    expect(state.steps.find((step) => step.rung === 'S3')).toMatchObject({ status: 'skipped', attempts: [expect.objectContaining({ state: 'declined' })] });
    expect(state.findings).toContainEqual(expect.objectContaining({ kind: 'step-skipped', rung: 'S3', detail: expect.stringMatching(/^no import line needs a re-wrap/) }));
    expect(state.rungs.find((rung) => rung.id === 'R4')!.status).toBe('certified');
  });

  it('re-wraps an import inside a file R1 moved, and the whole PR (base..final head) certifies PASS', async () => {
    const run = setup(movedImporter);
    const outcome = await startRun(run.options(), withPrettier);
    expect(outcome.state.error).toBeUndefined();
    expect(outcome.exitCode).toBe(0);
    const state = run.state();
    expect(state.status).toBe('completed');
    expect(state.rungs.map((rung) => [rung.id, rung.status])).toEqual([['R0', 'passed'], ['R1', 'certified'], ['R2', 'certified'], ['R3', 'skipped'], ['S3', 'certified'], ['R4', 'certified']]);
    const step = state.steps.find((candidate) => candidate.rung === 'S3')!;
    expect(run.git('diff', '--name-only', step.parent!, step.commit!)).toBe('server/src/modules/user/user.service.ts');
    expect(run.git('show', `${step.commit}:server/src/modules/user/user.service.ts`)).toContain("import {\n  title,\n  upper,\n} from '../../shared/format.js';\n");
    const whole = JSON.parse(run.read('certificate.json')) as Certificate;
    expect(whole).toMatchObject({ verdict: 'pass', scope: 'full', base: run.base, head: state.head });
    expect(whole.checks.find((check) => check.id === 'K2')!.findings).toContainEqual(expect.objectContaining({ kind: 'layout-only', file: 'server/src/modules/user/user.service.ts' }));
  });

  it('reads a shared config and its plugin from the environment, though the run\'s checkout has no node_modules (R2)', async () => {
    // The environment: this package's prettier, a shared config naming a plugin, and the plugin, which logs its loads.
    const environment = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-rewrap-shared-'));
    scratches.push(environment);
    const modules = path.join(environment, 'node_modules');
    const install = (name: string, exported: string) => {
      fs.mkdirSync(path.join(modules, name), { recursive: true });
      fs.writeFileSync(path.join(modules, name, 'package.json'), `${JSON.stringify({ name, main: 'index.js' })}\n`);
      fs.writeFileSync(path.join(modules, name, 'index.js'), `require('node:fs').appendFileSync(require('node:path').join(__dirname, 'loads'), '1');\nmodule.exports = ${exported};\n`);
    };
    fs.mkdirSync(modules);
    fs.symlinkSync(path.resolve('node_modules/prettier'), path.join(modules, 'prettier'));
    install('fake-prettier-config', JSON.stringify({ singleQuote: true, trailingComma: 'all', printWidth: 82, plugins: ['prettier-plugin-fake'] }));
    install('prettier-plugin-fake', '{ languages: [] }');
    const withoutConfig = Object.fromEntries(Object.entries(lengthened).filter(([file]) => file !== 'server/.prettierrc'));
    const run = setup({ ...withoutConfig, 'server/package.json': '{ "name": "fixture", "private": true, "type": "module", "prettier": "fake-prettier-config" }\n' });
    const outcome = await startRun(run.options(), { ...noRenames, rewrap: (input) => planRewrap({ ...input, environment }) });
    expect(outcome.exitCode).toBe(0);
    const state = run.state();
    expect(state.findings.filter((finding) => finding.kind === 'rewrap-error' || finding.kind === 'rewrap-skipped')).toEqual([]);
    const step = state.steps.find((candidate) => candidate.rung === 'S3')!;
    expect(step.status).toBe('certified');
    expect(run.git('show', `${step.commit}:server/src/main.ts`)).toContain("import {\n  AlbumController,\n  albumRoutes,\n} from './modules/album/album.controller.js';\n");
    expect(fs.existsSync(path.join(modules, 'fake-prettier-config', 'loads'))).toBe(true);
    expect(fs.existsSync(path.join(modules, 'prettier-plugin-fake', 'loads'))).toBe(true);
    expect(run.git('worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('rolls back and pins a re-wrap that K2 rejects (more than layout), and certifies the rest of the ladder', async () => {
    const run = setup(lengthened);
    const unsafe: Partial<RunDependencies> = {
      ...noRenames,
      rewrap: async (input) => {
        const plan = await planRewrap({ ...input, environment: prettierEnvironment });
        // A "re-wrap" that also drops a binding: K2 must see more than layout.
        for (const [file, text] of plan.files) plan.files.set(file, text.replace('  albumRoutes,\n', ''));
        return plan;
      },
    };
    const outcome = await startRun(run.options(), unsafe);
    expect(outcome.exitCode).toBe(0);
    const state = run.state();
    const step = state.steps.find((candidate) => candidate.rung === 'S3')!;
    expect(step.status).toBe('pinned');
    expect(step.attempts[0]).toMatchObject({ state: 'failed', detail: expect.stringMatching(/^certificate FAIL \(K2.*not layout only: token \d+ differs/) });
    expect(state.findings).toContainEqual(expect.objectContaining({ kind: 'rewrap-rejected', rung: 'S3', files: ['server/src/main.ts'] }));
    expect(state.rungs.find((rung) => rung.id === 'S3')!.status).toBe('skipped');
    expect(run.git('log', '--format=%s', `${run.base}..HEAD`)).not.toContain('re-wrap');
    expect(fs.existsSync(path.join(run.scratch, 'run', 'certificates', 'failed', '004-S3-rewrap-attempt1.json'))).toBe(true);
  });
});

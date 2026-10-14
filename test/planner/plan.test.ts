// `ac plan` end to end on a small repo: facts → seeds → K edits → validator → critic → plan.yaml, plan.md, plan.json
// and steps, through the real gateway. The recording run answers from a fake transport; the replay run has none, and
// must write the same bytes without touching the ledger.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { createGateway } from '../../src/gateway/gateway.js';
import type { RequestBody } from '../../src/gateway/request.js';
import type { Transport } from '../../src/gateway/transport.js';
import { GatewayError } from '../../src/gateway/types.js';
import { defaultCriticSettings } from '../../src/planner/critic.js';
import { defaultEditSettings } from '../../src/planner/edit.js';
import { planOutputs } from '../../src/planner/outputs.js';
import { planRepo, type PlanOptions } from '../../src/planner/plan.js';
import { readPlanYaml } from '../../src/planner/plan-file.js';
import { stepsOf } from '../../src/planner/steps.js';

const sources: Record<string, string> = {
  'server/package.json': '{ "name": "fixture", "type": "module", "main": "dist/main.js" }\n',
  'server/tsconfig.json': '{ "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext", "target": "es2022", "strict": true }, "include": ["src"] }\n',
  'server/src/main.ts': "import { AlbumController } from './controllers/album.controller.js';\nexport const app = [AlbumController];\n",
  'server/src/controllers/album.controller.ts': "import { AlbumService } from '../services/album.service.js';\nexport class AlbumController {\n  constructor(readonly albums: AlbumService) {}\n}\n",
  'server/src/controllers/user.controller.ts': "import { UserService } from '../services/user.service.js';\nexport class UserController {\n  constructor(readonly users: UserService) {}\n}\n",
  'server/src/services/album.service.ts': "import { AlbumRepository } from '../repositories/album.repository.js';\nimport { today } from '../utils/date.js';\nexport class AlbumService {\n  constructor(readonly albums: AlbumRepository) {}\n  created() { return today(); }\n}\n",
  'server/src/services/album.service.spec.ts': "import { AlbumService } from './album.service.js';\nexport const subject = AlbumService;\n",
  'server/src/services/user.service.ts': "import { UserRepository } from '../repositories/user.repository.js';\nexport class UserService {\n  constructor(readonly users: UserRepository) {}\n}\n",
  'server/src/services/user-admin.service.ts': "import { UserRepository } from '../repositories/user.repository.js';\nexport class UserAdminService {\n  constructor(readonly users: UserRepository) {}\n}\n",
  'server/src/repositories/album.repository.ts': "export class AlbumRepository {\n  list(db: { selectFrom(table: string): unknown }) { return db.selectFrom('album'); }\n}\n",
  'server/src/repositories/user.repository.ts': "export class UserRepository {\n  list(db: { selectFrom(table: string): unknown }) { return db.selectFrom('user'); }\n}\n",
  'server/src/utils/date.ts': 'export const today = () => new Date(0).toISOString();\n',
};

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-plan-e2e-'));
afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));
const repoRoot = path.join(temporary, 'repo');
const git = (...args: string[]) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
for (const [file, text] of Object.entries(sources)) {
  fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, file), text);
}
git('init', '-q');
git('-c', 'user.name=fixture', '-c', 'user.email=fixture@ac.invalid', 'add', '-A');
git('-c', 'user.name=fixture', '-c', 'user.email=fixture@ac.invalid', 'commit', '-q', '-m', 'fixture');

const budget = path.join(temporary, 'budget');
fs.mkdirSync(budget);
fs.writeFileSync(path.join(budget, 'runs.json'), JSON.stringify({ globalCap: 5, runs: { test: { cap: 2 } } }));
const files = { ledgerPath: path.join(budget, 'ledger.jsonl'), runsPath: path.join(budget, 'runs.json'), cassettePath: path.join(temporary, 'cassette.jsonl') };

/** Answers like Ultra would: each draft group keeps its label; the second sample also moves the date util into album. */
const fakeUltra: Transport = async (body: RequestBody) => {
  const request = body as unknown as { n?: number; response_format: { json_schema: { name: string; schema: { properties: { groups: { properties: Record<string, unknown> } } } } } };
  const { name, schema } = request.response_format.json_schema;
  const answers = name === 'plan_edit'
    ? Array.from({ length: request.n ?? 1 }, (_, index) => ({
      groups: Object.fromEntries(Object.keys(schema.properties.groups.properties).map((key) => {
        const label = key.slice(key.indexOf(':') + 1);
        return [key, label === 'shared' ? { name: 'shared', kind: 'shared' } : label === 'registry' ? { name: 'registry', kind: 'platform' } : { name: label.replace(/-admin$/, ''), kind: 'module' }];
      })),
      moves: index === 1 ? [{ file: 'utils/date.ts', to: 'album', kind: 'module', rationale: 'only the album service uses it' }] : [],
    }))
    : [{ review: 'Feature modules match the routes and tables.', groups: [], moves: [{ file: 'services/user-admin.service.ts', to: 'user', kind: 'module', rationale: 'admin side of users' }] }];
  const choices = answers.map((answer, index) => ({ index, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer), reasoning_content: 'thinking' } }));
  return { status: 200, headers: {}, bodyText: JSON.stringify({ id: 'fake', object: 'chat.completion', choices, usage: { prompt_tokens: 900, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 100 } } }) };
};

const options: PlanOptions = { packageRoot: 'server', moduleRoot: 'src', pins: [], edit: defaultEditSettings, critic: defaultCriticSettings };
const plan = async (mode: 'record' | 'replay') => {
  const gateway = createGateway({ runId: 'test', mode, ...files, ...(mode === 'record' ? { transport: fakeUltra, apiKey: 'test-key' } : {}) });
  const run = await planRepo(gitRepoFs(repoRoot), gateway, options);
  return { run, outputs: planOutputs(run, { name: 'fixture' }, options) };
};
// A call's outcome line carries its cost; a reservation line before it (if the ledger writes one) does not.
const ledgerCalls = () => fs.readFileSync(files.ledgerPath, 'utf8').trim().split('\n').filter((line) => typeof (JSON.parse(line) as { costUsd?: unknown }).costUsd === 'number');

describe('ac plan, recorded then replayed', async () => {
  const recorded = await plan('record');

  it('plans the repo: pins the entrypoint, one module per feature, specs move with their subject', () => {
    expect(recorded.run.facts.pins.map((pin) => [pin.path, pin.reason])).toEqual([['src/main.ts', 'entrypoint']]);
    expect(recorded.outputs.get('plan.yaml')).toContain('  module/album:\n    - { path: src/controllers/album.controller.ts, confidence: seed }');
    expect(recorded.outputs.get('plan.yaml')).toContain('services/album.service.ts, tests: [src/services/album.service.spec.ts]');
    expect(recorded.run.validation.valid).toBe(true);
    expect(JSON.parse(recorded.outputs.get('steps/01-module-album.json')!).moves['server/src/services/album.service.spec.ts']).toBe('server/src/modules/album/album.service.spec.ts');
  });

  it('writes every candidate\'s full plan next to plan.yaml, each one ready for ac steps', () => {
    const files = [...recorded.outputs.keys()].filter((file) => file.startsWith('candidates/'));
    expect(files).toEqual(['candidates/seeds-draft.yaml', 'candidates/ultra-1.yaml', 'candidates/ultra-2.yaml', 'candidates/ultra-3.yaml']);
    const second = readPlanYaml(recorded.outputs.get('candidates/ultra-2.yaml')!);
    expect(second.groups.get('module/album')!.map((entry) => entry.path)).toContain('src/utils/date.ts');
    expect(stepsOf(second).map((step) => step.group)).toEqual(['module/album', 'module/user']);
    expect(recorded.outputs.get(`candidates/${recorded.run.winner.label.replace('#', '-')}.yaml`)).toMatch(/^# ac plan for fixture server\/ @ \w{10}: candidate ultra#\d \(the winner, before the critic\)\n/);
    expect(recorded.outputs.get('plan.md')).toContain('| `candidates/ultra-2.yaml` |');
  });

  it('records two calls (n=3 edit, critic) in the cassette and the ledger', () => {
    expect(recorded.run.editRun).toMatchObject({ sampling: 'n', calls: 1 });
    expect(recorded.run.candidates).toHaveLength(3);
    expect(ledgerCalls()).toHaveLength(2);
    expect(fs.readFileSync(files.cassettePath, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(recorded.outputs.get('plan.md')).toContain('- Cost: **$0.0036** in 2 calls (1800 prompt, 600 completion tokens, 200 of them reasoning)');
  });

  it('replays to the same bytes without a transport, and spends nothing', async () => {
    const replayed = await plan('replay');
    expect([...replayed.outputs.keys()]).toEqual([...recorded.outputs.keys()]);
    for (const [file, content] of recorded.outputs) expect(replayed.outputs.get(file), file).toBe(content);
    expect(ledgerCalls()).toHaveLength(2);
  });

  it('fails a replay whose prompt changed (a cassette miss), instead of calling out', async () => {
    fs.appendFileSync(path.join(repoRoot, 'server/src/utils/date.ts'), 'export const epoch = 0;\n');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@ac.invalid', 'commit', '-q', '-am', 'change');
    await expect(plan('replay')).rejects.toSatisfy((error) => error instanceof GatewayError && error.code === 'replay-miss');
  });
});

describe('ac plan on a root with nothing to plan', () => {
  it('fails before any model call, so a mistyped --root spends nothing', async () => {
    let calls = 0;
    const counting: Transport = async (body) => {
      calls++;
      return fakeUltra(body);
    };
    const paths = { ledgerPath: path.join(temporary, 'empty-root.ledger.jsonl'), runsPath: files.runsPath, cassettePath: path.join(temporary, 'empty-root.jsonl') };
    const gateway = createGateway({ runId: 'test', mode: 'record', ...paths, transport: counting, apiKey: 'test-key' });
    // The fixture's code is under server/src; the repo root has no src/.
    await expect(planRepo(gitRepoFs(repoRoot), gateway, { ...options, packageRoot: '' }))
      .rejects.toThrow('no movable files under src/ (0 pinned): check --root and --module-root, or the profile');
    expect(calls).toBe(0);
    expect(fs.existsSync(paths.ledgerPath)).toBe(false);
  });
});

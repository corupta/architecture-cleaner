// Planner rules 2 (S8) and the pin that keeps rules 1 for a recording made with them. The S7 bench found two planner
// defects: Ultra named moves' files by the ids the prompt showed (kaneo, ghostfolio), and the validator dropped every
// one as an unknown file; and a plan with 0 modules won the ranking (ghostfolio). Rules 2 read exactly the id forms the
// prompts render and rank a plan with a feature module first. A replay of a plan recorded under rules 1 (immich) reads
// its answers with rules 1, so it writes the recording's bytes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { loadProfile } from '../../src/certificate/profile.js';
import { createGateway } from '../../src/gateway/gateway.js';
import type { RequestBody } from '../../src/gateway/request.js';
import type { Transport } from '../../src/gateway/transport.js';
import { GatewayError } from '../../src/gateway/types.js';
import { applyCritiques, criticSettingsFor, defaultCriticSettings, type Critique } from '../../src/planner/critic.js';
import { defaultEditSettings, editPrompt, editSettingsFor } from '../../src/planner/edit.js';
import { fileResolver, lowConfidenceNames } from '../../src/planner/facts.js';
import { planOutputs } from '../../src/planner/outputs.js';
import { planRepo, type PlanOptions } from '../../src/planner/plan.js';
import type { Draft, Facts, FileFact, PlanEdit, Placement, Plan, Validation } from '../../src/planner/types.js';
import { checkEdit, rankCandidates } from '../../src/planner/validate.js';

const fileFact = (id: number, filePath: string, role: string): FileFact =>
  ({ path: filePath, id, role, loc: 10, exports: [], primaryExport: null, tables: { reads: [], writes: [] }, routes: [], tests: [] });

// A type-sliced backend in miniature; `src/src/user.service.ts` displays as `src/user.service.ts`, the package path of
// another file: the one name two files share.
const paths = ['src/controllers/album.controller.ts', 'src/services/album.service.ts', 'src/services/user-admin.service.ts', 'src/src/user.service.ts', 'src/user.service.ts', 'src/utils/date.ts'];
const facts: Facts = {
  packageRoot: 'server', moduleRoot: 'src', sha: 'test', edges: [],
  files: paths.map((filePath, index) => fileFact(index + 1, filePath, path.posix.basename(filePath).split('.').at(-2)!)),
  pins: [{ path: 'src/main.ts', reason: 'entrypoint', detail: '' }],
};
const draft: Draft = {
  assignment: new Map([[paths[0]!, 'album'], [paths[1]!, 'album'], [paths[2]!, 'user'], [paths[3]!, 'user'], [paths[4]!, 'user'], [paths[5]!, 'album']]),
  confidence: new Map([[paths[0]!, 'seed'], [paths[1]!, 'seed'], [paths[2]!, 'contested'], [paths[3]!, 'seed'], [paths[4]!, 'seed'], [paths[5]!, 'isolated']]),
  contested: [paths[2]!, paths[5]!],
};
const groupIds = new Map([['album', 'G1'], ['user', 'G2']]);

describe('the names a model may give a file', () => {
  const rules1 = fileResolver(facts, 1);
  const rules2 = fileResolver(facts, 2, lowConfidenceNames(draft));
  const resolved = (resolve: (named: string) => FileFact[], named: string) => resolve(named).map((file) => file.path);

  it('rules 1: a package or displayed path only, the first file that has it', () => {
    expect(resolved(rules1, 'services/album.service.ts')).toEqual([paths[1]]);
    expect(resolved(rules1, ` ${paths[1]} `)).toEqual([paths[1]]);
    expect(resolved(rules1, '2')).toEqual([]);
    expect(resolved(rules1, '3(contested)')).toEqual([]);
    expect(resolved(rules1, 'src/user.service.ts')).toEqual([paths[3]]);
  });

  it('rules 2: also the bare id FILES shows, and a low-confidence file as the draft lists it, exactly', () => {
    expect(resolved(rules2, 'services/album.service.ts')).toEqual([paths[1]]);
    expect(resolved(rules2, '2')).toEqual([paths[1]]);
    expect(resolved(rules2, ' 6 ')).toEqual([paths[5]]);
    expect(resolved(rules2, '3(contested)')).toEqual([paths[2]]);
    expect(resolved(rules2, '6(isolated)')).toEqual([paths[5]]);
    // Never fuzzy: a confidence the draft didn't list, a file the low-confidence list doesn't show, a type-only edge's
    // `~`, an id that doesn't exist, a zero-padded id, a basename.
    for (const named of ['3(isolated)', '2(seed)', '~2', '7', '02', 'album.service.ts', 'G1']) expect(resolved(rules2, named), named).toEqual([]);
  });

  it('rules 2: a name two files share names neither', () => {
    expect(resolved(rules2, 'src/user.service.ts')).toEqual([paths[3], paths[4]]);
    expect(resolved(rules2, 'user.service.ts')).toEqual([paths[4]]);
  });
});

describe('checkEdit by rules', () => {
  const edit: PlanEdit = { groups: [], moves: [
    { file: '2', to: 'user', kind: 'module', rationale: 'by id' },
    { file: '3(contested)', to: 'album', kind: 'module', rationale: 'by the low-confidence form' },
    { file: '6(contested)', to: 'user', kind: 'module', rationale: 'a confidence the draft did not list' },
    { file: 'src/user.service.ts', to: 'album', kind: 'module', rationale: 'two files have this name' },
  ] };

  it('rules 1 drop every move that names its file by id (the S7 bench), and take the first file a shared name fits', () => {
    const { accepted, issues } = checkEdit(facts, draft, edit, groupIds, 1);
    expect(accepted.moves.map((move) => move.file)).toEqual([paths[3]]);
    expect(issues.filter((issue) => issue.code === 'unknown-file').map((issue) => issue.detail)).toEqual([
      'no movable file 2; its move to "user" dropped', 'no movable file 3(contested); its move to "album" dropped', 'no movable file 6(contested); its move to "user" dropped',
    ]);
  });

  it('rules 2 read the ids the prompt showed, and drop an unknown or shared name as an unknown file', () => {
    const { accepted, issues } = checkEdit(facts, draft, edit, groupIds, 2);
    expect(accepted.moves).toEqual([
      { file: paths[1], to: 'user', kind: 'module', rationale: 'by id' },
      { file: paths[2], to: 'album', kind: 'module', rationale: 'by the low-confidence form' },
    ]);
    expect(issues.filter((issue) => issue.code === 'unknown-file').map((issue) => issue.detail)).toEqual([
      'no movable file 6(contested); its move to "user" dropped',
      'src/user.service.ts names 2 movable files (src/src/user.service.ts, src/user.service.ts); its move to "album" dropped',
    ]);
  });

  it('rules 2 read a target named by its draft group\'s id or key (kaneo, S7): that group as the edit names it', () => {
    const groups: PlanEdit['groups'] = [{ draft: 'G1', name: 'album', kind: 'module' }, { draft: 'G2', name: 'account', kind: 'platform' }];
    const targets: PlanEdit = { groups, moves: [
      { file: '1', to: 'G2:user', kind: 'module', rationale: 'by key' },
      { file: '2', to: 'G2', kind: 'module', rationale: 'by id' },
      { file: '3(contested)', to: 'G1:user', kind: 'module', rationale: 'a key the prompt never showed' },
    ] };
    const named = checkEdit({ ...facts, files: facts.files.map((file) => (file.path === paths[1] ? { ...file, exports: ['Account'] } : file)) }, draft, targets, groupIds, 2);
    expect(named.accepted.moves).toEqual([
      { file: paths[0], to: 'account', kind: 'platform', rationale: 'by key' },
      { file: paths[1], to: 'account', kind: 'platform', rationale: 'by id' },
    ]);
    expect(named.issues.filter((issue) => issue.file === paths[2]).map((issue) => issue.code)).toEqual(['bad-name']);
    // Rules 1 read neither form: the S7 recordings' targets stay as they were judged.
    expect(checkEdit(facts, draft, { groups, moves: [{ file: paths[0]!, to: 'G2:user', kind: 'module', rationale: '' }, { file: paths[1]!, to: 'G2', kind: 'module', rationale: '' }] }, groupIds, 1)
      .issues.filter((issue) => issue.file).map((issue) => issue.code)).toEqual(['bad-name', 'foreign-name']);
  });

  it('rules 2 still refuse a pinned file, named by path', () => {
    const { issues } = checkEdit(facts, draft, { groups: [], moves: [{ file: 'main.ts', to: 'album', kind: 'module', rationale: '' }] }, groupIds, 2);
    expect(issues.find((issue) => issue.code === 'pinned-file')).toMatchObject({ file: 'src/main.ts' });
  });
});

describe('the critic\'s moves by rules', () => {
  const plan: Plan = { placements: paths.map((filePath): Placement => ({ path: filePath, kind: 'module', name: draft.assignment.get(filePath)!, confidence: 'seed', contested: false, source: 'draft' })) };
  const critique = (file: string): Critique => ({ review: 'r', groups: [], moves: [{ file, to: 'shared', kind: 'shared', rationale: 'pure code' }] });
  const outcome = (file: string, rules: 1 | 2) => applyCritiques(facts, draft, plan, [critique(file)], rules).suggestions.map((suggestion) => [suggestion.summary, suggestion.accepted, suggestion.reason ?? '']);

  it('rules 1 find no file by id; rules 2 read the bare id its FILES list shows', () => {
    expect(outcome('6', 1)).toEqual([['move 6 → shared/shared', false, 'no such movable file']]);
    expect(outcome('6', 2)).toEqual([['move src/utils/date.ts → shared/shared', true, '']]);
  });

  it('rules 2 read no low-confidence form (the critic\'s prompt has no draft) and no shared name', () => {
    expect(outcome('6(isolated)', 2)).toEqual([['move 6(isolated) → shared/shared', false, 'no such movable file']]);
    expect(outcome('src/user.service.ts', 2)).toEqual([['move src/user.service.ts → shared/shared', false, 'names 2 movable files']]);
  });
});

describe('rankCandidates by rules', () => {
  const candidate = (label: string, valid: boolean, modules: number, warnings: number, turboMqSum = 5) => ({
    label,
    validation: {
      valid,
      issues: [
        ...(valid ? [] : [{ severity: 'error' as const, code: 'foreign-name' as const, detail: '' }]),
        ...Array.from({ length: warnings }, () => ({ severity: 'warning' as const, code: 'singleton-group' as const, detail: '' })),
      ],
      metrics: { files: 0, groups: 0, modules, sharedOrPlatformFiles: 0, singletonGroups: [], crossEdgeRatio: 0, turboMqSum, turboMqMean: 0, cycles: [], groupsInCycles: 0, disagreements: [], movedFromDraft: 0 },
    } satisfies Validation,
  });
  // ghostfolio (S7): the 0-module plan had the fewest warnings.
  const platformOnly = candidate('ultra#1', true, 0, 1);
  const modular = candidate('ultra#2', true, 30, 4);
  const invalidModular = candidate('ultra#3', false, 30, 0);
  const labels = (ranked: { label: string }[]) => ranked.map((entry) => entry.label);

  it('rules 1 rank on validity, errors, cohesion, warnings: the 0-module plan wins', () => {
    expect(labels(rankCandidates([modular, invalidModular, platformOnly], 5, 1))).toEqual(['ultra#1', 'ultra#2', 'ultra#3']);
  });

  it('rules 2 put every plan with a feature module first, before validity: a 0-module plan never wins while one has a module', () => {
    expect(labels(rankCandidates([modular, invalidModular, platformOnly], 5, 2))).toEqual(['ultra#2', 'ultra#3', 'ultra#1']);
    expect(labels(rankCandidates([invalidModular, platformOnly], 5, 2))).toEqual(['ultra#3', 'ultra#1']);
    // With no module anywhere, the rest of the ranking decides as before.
    expect(labels(rankCandidates([candidate('b', true, 0, 3), candidate('a', true, 0, 2)], 5, 2))).toEqual(['a', 'b']);
    expect(labels(rankCandidates([modular, invalidModular, platformOnly], 5))).toEqual(labels(rankCandidates([modular, invalidModular, platformOnly], 5, 2)));
  });
});

describe('the rules pin', () => {
  it('defaults to rules 2; a replay takes the profile\'s pin, a recording the latest; an unknown version is refused', () => {
    expect(defaultEditSettings.rules).toBe(2);
    expect(editSettingsFor(null, 'replay')).toEqual(defaultEditSettings);
    expect(editSettingsFor({ plan: {} }, 'replay')).toEqual(defaultEditSettings);
    expect(editSettingsFor({ plan: { rules: 1 } }, 'replay')).toEqual({ ...defaultEditSettings, rules: 1 });
    for (const mode of ['record', 'auto'] as const) expect(editSettingsFor({ plan: { rules: 1 } }, mode)).toEqual(defaultEditSettings);
    for (const mode of ['replay', 'record'] as const) expect(() => editSettingsFor({ plan: { rules: 9 } }, mode)).toThrow('no planner rules version 9 (versions: 1, 2)');
  });

  it('is pinned for immich only: its committed plan was made with rules 1; the bench\'s scrambles take the latest', () => {
    expect(editSettingsFor(loadProfile('immich'), 'replay').rules).toBe(1);
    for (const name of ['hoppscotch', 'kaneo', 'ghostfolio']) expect(editSettingsFor(loadProfile(name), 'replay').rules, name).toBe(2);
  });
});

// An immich-like repo planned end to end through the real gateway: recorded under rules 1 (as S5 to S7 recorded),
// replayed under the pin, and planned again under rules 2, which replays the edit and records only the critic.
const sources: Record<string, string> = {
  'server/package.json': '{ "name": "fixture", "type": "module", "main": "dist/main.js" }\n',
  'server/tsconfig.json': '{ "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext", "target": "es2022", "strict": true }, "include": ["src"] }\n',
  'server/src/main.ts': "import { AlbumController } from './controllers/album.controller.js';\nexport const app = [AlbumController];\n",
  'server/src/controllers/album.controller.ts': "import { AlbumService } from '../services/album.service.js';\nexport class AlbumController {\n  constructor(readonly albums: AlbumService) {}\n}\n",
  'server/src/controllers/user.controller.ts': "import { UserService } from '../services/user.service.js';\nexport class UserController {\n  constructor(readonly users: UserService) {}\n}\n",
  'server/src/services/album.service.ts': "import { AlbumRepository } from '../repositories/album.repository.js';\nimport { today } from '../utils/date.js';\nexport class AlbumService {\n  constructor(readonly albums: AlbumRepository) {}\n  created() { return today(); }\n}\n",
  'server/src/services/user.service.ts': "import { UserRepository } from '../repositories/user.repository.js';\nexport class UserService {\n  constructor(readonly users: UserRepository) {}\n}\n",
  'server/src/services/user-admin.service.ts': "import { UserRepository } from '../repositories/user.repository.js';\nexport class UserAdminService {\n  constructor(readonly users: UserRepository) {}\n}\n",
  'server/src/repositories/album.repository.ts': "export class AlbumRepository {\n  list(db: { selectFrom(table: string): unknown }) { return db.selectFrom('album'); }\n}\n",
  'server/src/repositories/user.repository.ts': "export class UserRepository {\n  list(db: { selectFrom(table: string): unknown }) { return db.selectFrom('user'); }\n}\n",
  'server/src/utils/date.ts': 'export const today = () => new Date(0).toISOString();\n',
  'server/src/utils/format.ts': 'export const format = (value: string) => value.trim();\n',
};

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-planner-rules-'));
afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));
const repoRoot = path.join(temporary, 'repo');
for (const [file, text] of Object.entries(sources)) {
  fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, file), text);
}
const git = (...args: string[]) => execFileSync('git', ['-C', repoRoot, '-c', 'user.name=fixture', '-c', 'user.email=fixture@ac.invalid', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
git('init', '-q');
git('add', '-A');
git('commit', '-q', '-m', 'fixture');

const budget = path.join(temporary, 'budget');
fs.mkdirSync(budget);
fs.writeFileSync(path.join(budget, 'runs.json'), JSON.stringify({ globalCap: 5, runs: { test: { cap: 2 } } }));
const gatewayFiles = { ledgerPath: path.join(budget, 'ledger.jsonl'), runsPath: path.join(budget, 'runs.json'), cassettePath: path.join(temporary, 'cassette.jsonl') };

/**
 * Answers like the S7 bench's Ultra: sample 1 makes every feature group platform (0 modules) and names its move's file
 * by id, as ghostfolio's winner did; samples 2 and 3 keep the features as modules and split two one-file modules off
 * (sample 2 names a file by its low-confidence form). The critic names a file by its id too.
 */
const transportCalls: string[] = [];
const fakeUltra: Transport = async (body: RequestBody) => {
  const request = body as unknown as { n?: number; response_format: { json_schema: { name: string; schema: { properties: { groups: { properties: Record<string, unknown> } } } } } };
  const { name, schema } = request.response_format.json_schema;
  transportCalls.push(name);
  const keys = name === 'plan_edit' ? Object.keys(schema.properties.groups.properties) : [];
  const groups = (kinds: Record<string, string>) => Object.fromEntries(keys.map((key) => {
    const label = key.slice(key.indexOf(':') + 1);
    return [key, { name: label, kind: kinds[label] ?? 'module' }];
  }));
  const split = [{ file: 'utils/date.ts', to: 'date', kind: 'module', rationale: 'a feature of its own' }, { file: 'services/user-admin.service.ts', to: 'admin', kind: 'module', rationale: 'the admin side' }];
  const answers = name === 'plan_edit'
    ? [
      { groups: groups({ album: 'platform', user: 'platform', format: 'shared' }), moves: [{ file: '8', to: 'shared', kind: 'shared', rationale: 'pure code' }] },
      { groups: groups({}), moves: [...split, { file: '9(isolated)', to: 'album', kind: 'module', rationale: 'formats album titles' }] },
      { groups: groups({}), moves: split },
    ]
    : [{ review: 'The admin service belongs with its users.', groups: [], moves: [{ file: '6', to: 'user', kind: 'module', rationale: 'admin side of users' }] }];
  const choices = answers.map((answer, index) => ({ index, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer), reasoning_content: 'thinking' } }));
  return { status: 200, headers: {}, bodyText: JSON.stringify({ id: 'fake', object: 'chat.completion', choices, usage: { prompt_tokens: 900, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 100 } } }) };
};

const plan = async (mode: 'record' | 'replay' | 'auto', edit: PlanOptions['edit']) => {
  const gateway = createGateway({ runId: 'test', mode, ...gatewayFiles, ...(mode === 'replay' ? {} : { transport: fakeUltra, apiKey: 'test-key' }) });
  const options: PlanOptions = { packageRoot: 'server', moduleRoot: 'src', pins: [], edit, critic: defaultCriticSettings };
  const run = await planRepo(gitRepoFs(repoRoot), gateway, options);
  return { run, outputs: planOutputs(run, { name: 'fixture' }, options) };
};
const pinned = { plan: { rules: 1 } };
const cassetteLines = () => fs.readFileSync(gatewayFiles.cassettePath, 'utf8').trim().split('\n').length;

describe('a plan recorded under rules 1, replayed under its pin and planned under rules 2', async () => {
  // What the S7-era planner recorded: rules 1 were the only rules.
  const recorded = await plan('record', { ...defaultEditSettings, rules: 1 });

  it('records under rules 1: the 0-module edit wins and its id-named move is dropped; the critic\'s id is no file', () => {
    expect(editPrompt(recorded.run.facts, recorded.run.draft).user).toContain('DRAFT LOW-CONFIDENCE FILES\n9(isolated)');
    expect(recorded.run.winner.label).toBe('ultra#1');
    expect(recorded.run.validation.metrics.modules).toBe(0);
    expect(recorded.run.winner.dropped.filter((issue) => issue.code === 'unknown-file').map((issue) => issue.detail)).toEqual(['no movable file 8; its move to "shared" dropped']);
    expect(recorded.run.candidates[1]!.dropped.filter((issue) => issue.code === 'unknown-file').map((issue) => issue.detail)).toEqual(['no movable file 9(isolated); its move to "album" dropped']);
    expect(recorded.run.criticRun!.suggestions.map((suggestion) => [suggestion.summary, suggestion.reason])).toEqual([['move 6 → module/user', 'no such movable file']]);
    expect(recorded.outputs.get('plan.md')).toContain('\nRanking: valid first, then fewer errors;');
    expect(transportCalls).toEqual(['plan_edit', 'plan_review']);
  });

  it('replays under the pin to the recording\'s bytes, with no call', async () => {
    const replayed = await plan('replay', editSettingsFor(pinned, 'replay'));
    expect([...replayed.outputs.keys()]).toEqual([...recorded.outputs.keys()]);
    for (const [file, content] of recorded.outputs) expect(replayed.outputs.get(file), file).toBe(content);
    expect(transportCalls).toHaveLength(2);
  });

  it('misses the cassette under rules 2 on a replay: a new winner changes the critic\'s request', async () => {
    await expect(plan('replay', editSettingsFor(null, 'replay'))).rejects.toSatisfy((error) => error instanceof GatewayError && error.code === 'replay-miss');
    expect(transportCalls).toHaveLength(2);
  });

  it('plans under rules 2 in auto mode: the edit replays, only the critic is recorded, and a plan with modules wins', async () => {
    const latest = await plan('auto', editSettingsFor(pinned, 'auto'));
    expect(transportCalls).toEqual(['plan_edit', 'plan_review', 'plan_review']);
    expect(cassetteLines()).toBe(3);
    expect(latest.run.rules).toBe(2);
    // The id-named moves are read now; the module plan that reads its low-confidence form wins, with its moves applied.
    expect(latest.run.candidates.map((candidate) => candidate.dropped.filter((issue) => issue.code === 'unknown-file').length)).toEqual([0, 0, 0]);
    expect(latest.run.winner.label).toBe('ultra#2');
    expect(latest.run.winner.validation.metrics.modules).toBeGreaterThan(0);
    expect(latest.run.winner.plan.placements.find((placement) => placement.path === 'src/utils/format.ts')).toMatchObject({ kind: 'module', name: 'album', source: 'planner' });
    // The critic's move by id is read and passes the gate: the admin service joins its users.
    expect(latest.run.criticRun!.suggestions.map((suggestion) => [suggestion.summary, suggestion.accepted])).toEqual([['move src/services/user-admin.service.ts → module/user', true]]);
    expect(latest.outputs.get('plan.md')).toContain('\nRanking: plans with at least one feature module first (a plan of platform and shared groups only moves nothing into a feature); then valid first, then fewer errors;');
    expect(latest.outputs.get('plan.yaml')).not.toBe(recorded.outputs.get('plan.yaml'));
  });

  it('then replays under rules 2 from the cassette it extended, and still under the pin to the rules 1 bytes', async () => {
    const latest = await plan('replay', editSettingsFor(null, 'replay'));
    expect(latest.run.winner.label).toBe('ultra#2');
    const old = await plan('replay', editSettingsFor(pinned, 'replay'));
    for (const [file, content] of recorded.outputs) expect(old.outputs.get(file), file).toBe(content);
    expect(transportCalls).toHaveLength(3);
  });
});

describe('the critic settings and the rules pin together', () => {
  it('pin immich to the S6 recording\'s pair for replays, and both move to the latest for a recording', () => {
    const immich = loadProfile('immich');
    expect([criticSettingsFor(immich, 'replay').prompt, editSettingsFor(immich, 'replay').rules]).toEqual([1, 1]);
    expect([criticSettingsFor(immich, 'auto').prompt, editSettingsFor(immich, 'auto').rules]).toEqual([2, 2]);
  });
});

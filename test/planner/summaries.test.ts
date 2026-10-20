// The opt-in Lightning one-liners (plan §3.5 step 1): one call per low-confidence draft file, their lines in the edit
// prompt, and `ac plan` with summaries on, replayed from the committed fixture cassette (cassettes/summaries.jsonl).
// AC_RECORD_FIXTURES=1 re-records that cassette from a fake transport, after a deliberate prompt change.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { createGateway } from '../../src/gateway/gateway.js';
import type { Transport } from '../../src/gateway/transport.js';
import type { Gateway, StructuredRequest, StructuredResult } from '../../src/gateway/types.js';
import { defaultCriticSettings } from '../../src/planner/critic.js';
import { defaultEditSettings, editPrompt } from '../../src/planner/edit.js';
import { buildFacts } from '../../src/planner/facts.js';
import { planOutputs } from '../../src/planner/outputs.js';
import { planRepo, type PlanOptions } from '../../src/planner/plan.js';
import { seedDraft } from '../../src/planner/seeds.js';
import { defaultSummarySettings, runSummaries, summaryPrompt } from '../../src/planner/summaries.js';

const sources: Record<string, string> = {
  'server/package.json': '{ "name": "fixture", "type": "module", "main": "dist/main.js" }\n',
  'server/tsconfig.json': '{ "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext", "target": "es2022", "strict": true }, "include": ["src"] }\n',
  'server/src/main.ts': "import { AlbumController } from './controllers/album.controller.js';\nexport const app = [AlbumController];\n",
  'server/src/controllers/album.controller.ts': "import { AlbumService } from '../services/album.service.js';\nexport class AlbumController {\n  constructor(readonly albums: AlbumService) {}\n}\n",
  'server/src/services/album.service.ts': "import { AlbumRepository } from '../repositories/album.repository.js';\nimport { label } from '../utils/format.js';\nexport class AlbumService {\n  constructor(readonly albums: AlbumRepository) {}\n  title(name: string) { return label(name); }\n}\n",
  'server/src/services/user.service.ts': "import { UserRepository } from '../repositories/user.repository.js';\nimport { label } from '../utils/format.js';\nexport class UserService {\n  constructor(readonly users: UserRepository) {}\n  title(name: string) { return label(name); }\n}\n",
  'server/src/repositories/album.repository.ts': "export class AlbumRepository {\n  list(db: { selectFrom(table: string): unknown }) { return db.selectFrom('album'); }\n}\n",
  'server/src/repositories/user.repository.ts': "export class UserRepository {\n  list(db: { selectFrom(table: string): unknown }) { return db.selectFrom('user'); }\n}\n",
  'server/src/utils/format.ts': 'export const label = (name: string) => name.trim().toUpperCase();\n',
  'server/src/utils/checksum.ts': "import { createHash } from 'node:crypto';\nexport const checksum = (text: string) => createHash('sha1').update(text).digest('hex');\n",
};

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-summaries-'));
afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));
const repoRoot = path.join(temporary, 'repo');
const git = (...args: string[]) => execFileSync('git', ['-C', repoRoot, '-c', 'user.name=fixture', '-c', 'user.email=fixture@ac.invalid', ...args], { stdio: 'ignore' });
for (const [file, text] of Object.entries(sources)) {
  fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, file), text);
}
git('init', '-q');
git('add', '-A');
git('commit', '-q', '-m', 'fixture');
const repo = gitRepoFs(repoRoot);
const facts = buildFacts(repo, { packageRoot: 'server', moduleRoot: 'src', rules: defaultEditSettings.rules });
const draft = seedDraft(facts);

/** A Gateway that answers each file's purpose from its FILE line and records the requests. */
function fakeLightning() {
  const requests: StructuredRequest<unknown>[] = [];
  const gateway: Gateway = {
    async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      requests.push(request as StructuredRequest<unknown>);
      const file = /^FILE (\S+)/.exec(request.messages[1]!.content)![1]!;
      const value = file.includes('checksum') ? undefined : request.parse({ purpose: `  ${file}\n purpose ` });
      return {
        choices: [value === undefined ? { index: 0, finishReason: 'length', error: 'truncated', reasoning: null } : { index: 0, finishReason: 'stop', value, reasoning: null }],
        usage: { promptTokens: 300, completionTokens: 20, reasoningTokens: null }, costUsd: 0.00002, replayed: false, key: 'k:0',
      };
    },
    spent: () => ({ run: 0, global: 0 }),
  };
  return { gateway, requests };
}

describe('Lightning one-liners', () => {
  it('cover exactly the draft\'s low-confidence files', () => {
    expect(draft.contested).toEqual(['src/utils/checksum.ts', 'src/utils/format.ts']);
  });

  it('send each low-confidence file to Lightning, thinking off, json_schema strict, with its facts, neighbours and source', async () => {
    const { gateway, requests } = fakeLightning();
    const run = await runSummaries(gateway, repo, facts, draft);
    expect(requests.map((request) => [request.model, request.templateKwargs, request.schemaName, request.maxTokens])).toEqual([
      ['lightning', { enable_thinking: false }, 'file_purpose', 256], ['lightning', { enable_thinking: false }, 'file_purpose', 256],
    ]);
    expect(requests[0]!.schema).toEqual({ type: 'object', properties: { purpose: { type: 'string' } }, required: ['purpose'], additionalProperties: false });
    expect(requests[1]!.messages[1]!.content).toBe([
      'FILE utils/format.ts (role util, 2 lines)',
      'EXPORTS: label',
      'USES: (none)',
      'USED BY: services/album.service.ts services/user.service.ts',
      `SOURCE:\n${sources['server/src/utils/format.ts']}`,
    ].join('\n'));
    expect([...run.purposes]).toEqual([['src/utils/format.ts', 'utils/format.ts purpose']]);
    expect([...run.failures]).toEqual([['src/utils/checksum.ts', 'truncated']]);
    expect(run).toMatchObject({ calls: 2, usage: { promptTokens: 600, completionTokens: 40, reasoningTokens: 0 } });
  });

  it('cut long sources at the limit and say so', () => {
    const text = summaryPrompt(repo, facts, 'src/utils/checksum.ts', { ...defaultSummarySettings, maxSourceCharacters: 20 });
    expect(text.endsWith(`SOURCE:\n${sources['server/src/utils/checksum.ts']!.slice(0, 20)}\n… (cut at 20 of ${sources['server/src/utils/checksum.ts']!.length} characters)`)).toBe(true);
  });

  it('add a purpose line per file to the edit prompt, and leave it byte-identical without them', () => {
    const plain = editPrompt(facts, draft);
    expect(editPrompt(facts, draft, new Map()).user).toBe(plain.user);
    const withPurposes = editPrompt(facts, draft, new Map([['src/utils/format.ts', 'Upper-cases display labels for albums and users']])).user;
    const id = facts.files.find((file) => file.path === 'src/utils/format.ts')!.id;
    expect(withPurposes).toContain(`\n\nLOW-CONFIDENCE FILE PURPOSES (one line per file from a smaller model that read its source: a hint, not a fact)\n${id} utils/format.ts: Upper-cases display labels for albums and users\n\n`);
    expect(withPurposes.replace(/\n\nLOW-CONFIDENCE FILE PURPOSES[^]*?\n\n/, '\n\n')).toBe(plain.user);
  });
});

// The fixture cassette: Lightning per file, then Ultra's n=3 edit and the critic, as a fake transport answers them.
const cassettePath = path.join(import.meta.dirname, 'cassettes/summaries.jsonl');
const fakeTransport: Transport = async (body) => {
  const request = body as unknown as { n?: number; messages: { content: string }[]; response_format: { json_schema: { name: string; schema: { properties: Record<string, { properties?: Record<string, unknown> }> } } } };
  const { name, schema } = request.response_format.json_schema;
  const answers = name === 'file_purpose'
    ? [{ purpose: `what ${/^FILE (\S+)/.exec(request.messages[1]!.content)![1]} does` }]
    : name === 'plan_edit'
      ? Array.from({ length: request.n ?? 1 }, () => ({
        groups: Object.fromEntries(Object.keys(schema.properties.groups!.properties!).map((key) => {
          const label = key.slice(key.indexOf(':') + 1);
          return [key, label === 'shared' ? { name: 'shared', kind: 'shared' } : { name: label, kind: 'module' }];
        })),
        moves: [],
      }))
      : [{ review: 'Fine.', groups: [], moves: [] }];
  const choices = answers.map((answer, index) => ({ index, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer), reasoning_content: null } }));
  return { status: 200, headers: {}, bodyText: JSON.stringify({ id: 'fake', object: 'chat.completion', choices, usage: { prompt_tokens: 400, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 0 } } }) };
};

describe('ac plan with summaries on, replayed from the fixture cassette', async () => {
  const options: PlanOptions = { packageRoot: 'server', moduleRoot: 'src', pins: [], edit: defaultEditSettings, critic: defaultCriticSettings, summaries: defaultSummarySettings };
  const budget = path.join(temporary, 'budget');
  fs.mkdirSync(budget);
  const ledgerPath = path.join(budget, 'ledger.jsonl');
  if (process.env.AC_RECORD_FIXTURES === '1') {
    fs.rmSync(cassettePath, { force: true });
    fs.writeFileSync(path.join(budget, 'runs.json'), JSON.stringify({ globalCap: 1, runs: { fixture: { cap: 1 } } }));
    const recorder = createGateway({ runId: 'fixture', mode: 'record', cassettePath, ledgerPath: path.join(budget, 'record.ledger.jsonl'), runsPath: path.join(budget, 'runs.json'), transport: fakeTransport, apiKey: 'fixture' });
    await planRepo(repo, recorder, options);
  }
  const gateway = createGateway({ runId: 'replay', mode: 'replay', cassettePath, ledgerPath });
  const run = await planRepo(repo, gateway, options);
  const cassette = fs.readFileSync(cassettePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { request: { model: string; messages: { content: string }[]; response_format: { json_schema: { name: string } } } });

  it('replays the Lightning calls, then an edit whose prompt carries their lines, spending nothing', () => {
    expect(cassette.map((record) => record.request.response_format.json_schema.name)).toEqual(['file_purpose', 'file_purpose', 'plan_edit', 'plan_review']);
    expect(cassette[0]!.request.model).toBe('nvidia/Nemotron-3_5-Lightning');
    expect([...run.summaryRun!.purposes]).toEqual([['src/utils/checksum.ts', 'what utils/checksum.ts does'], ['src/utils/format.ts', 'what utils/format.ts does']]);
    expect(cassette[2]!.request.messages[1]!.content).toContain('utils/format.ts: what utils/format.ts does');
    expect(fs.existsSync(ledgerPath)).toBe(false);
  });

  it('reports the one-liners and their cost in plan.md, and keeps them in plan.json', () => {
    const outputs = planOutputs(run, { name: 'fixture' }, options);
    const markdown = outputs.get('plan.md')!;
    expect(markdown).toContain('→ Nemotron 3.5 Lightning (thinking off) writes a one-line purpose for each of the 2 low-confidence files →');
    expect(markdown).toContain('## Low-confidence file purposes (2 of 2)\n\n- `utils/checksum.ts`: what utils/checksum.ts does\n- `utils/format.ts`: what utils/format.ts does\n');
    expect(markdown).toContain('in 4 calls (1600 prompt, 120 completion tokens, 0 of them reasoning)');
    expect(JSON.parse(outputs.get('plan.json')!).summaries.purposes).toEqual({ 'src/utils/checksum.ts': 'what utils/checksum.ts does', 'src/utils/format.ts': 'what utils/format.ts does' });
  });
});

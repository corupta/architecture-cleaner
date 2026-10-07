// The draft editor's prompt and call (label-keyed groups, path-named moves, n=K with a sequential fallback) and the
// critic's validator gate. No model: a fake Gateway answers.
import { describe, expect, it } from 'vitest';
import { GatewayError, type Gateway, type StructuredRequest, type StructuredResult } from '../../src/gateway/types.js';
import { applyCritique, type Critique, planText } from '../../src/planner/critic.js';
import { defaultEditSettings, draftGroupIds, editPrompt, factsText, runEdit, subFeatureHints } from '../../src/planner/edit.js';
import type { Confidence, Draft, Edge, Facts, FileFact, Placement, Plan, PlanEdit } from '../../src/planner/types.js';
import { validatePlan } from '../../src/planner/validate.js';

const files = [
  'src/controllers/album.controller.ts', 'src/controllers/asset-media.controller.ts', 'src/controllers/asset.controller.ts',
  'src/repositories/album.repository.ts', 'src/repositories/asset.repository.ts', 'src/services/album.service.ts',
  'src/services/asset-media.service.ts', 'src/services/asset.service.ts', 'src/services/index.ts', 'src/utils/date.ts',
];
const roles: Record<string, string> = { controllers: 'controller', repositories: 'repository', services: 'service', utils: 'util' };
const roleOf = (path: string) => (path.endsWith('index.ts') ? 'registry' : roles[path.split('/')[1]!]!);
const fact = (path: string, index: number): FileFact => ({
  path, id: index + 1, role: roleOf(path), loc: 10, exports: [], primaryExport: null,
  tables: { reads: [], writes: path.includes('album.repository') ? ['album'] : [] }, routes: path.includes('album.controller') ? ['albums'] : [], tests: [],
});
const edge = (from: string, to: string, weight = 1): Edge => ({ from, to, weight, typeOnly: weight < 1, kinds: ['import'], symbols: [] });
const facts: Facts = {
  packageRoot: 'server', moduleRoot: 'src', sha: 'abc', pins: [{ path: 'src/main.ts', reason: 'entrypoint', detail: 'nest-cli.json' }],
  files: files.map(fact),
  edges: [
    edge(files[0]!, files[5]!), edge(files[5]!, files[3]!), edge(files[5]!, files[9]!), edge(files[2]!, files[7]!),
    edge(files[7]!, files[4]!), edge(files[1]!, files[6]!), edge(files[6]!, files[7]!), edge(files[8]!, files[5]!), edge(files[8]!, files[7]!),
  ],
};
const labels: Record<string, string> = {
  [files[0]!]: 'album', [files[3]!]: 'album', [files[5]!]: 'album', [files[2]!]: 'asset', [files[4]!]: 'asset', [files[7]!]: 'asset',
  [files[1]!]: 'asset-media', [files[6]!]: 'asset-media', [files[8]!]: 'registry', [files[9]!]: 'shared',
};
const draft: Draft = {
  assignment: new Map(Object.entries(labels)),
  confidence: new Map(files.map((path) => [path, (path === files[9] ? 'contested' : 'seed') as Confidence])),
  contested: [files[9]!],
};

/** A Gateway that hands each request to `answer` and records it. */
function fakeGateway(answer: (request: StructuredRequest<unknown>) => unknown[] | Error) {
  const requests: StructuredRequest<unknown>[] = [];
  const gateway: Gateway = {
    async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      requests.push(request as StructuredRequest<unknown>);
      const values = answer(request as StructuredRequest<unknown>);
      if (values instanceof Error) throw values;
      return {
        choices: values.map((value, index) => (value === 'truncated'
          ? { index, finishReason: 'length', error: 'truncated', reasoning: null }
          : { index, finishReason: 'stop', value: request.parse(value), reasoning: 'thought' })),
        usage: { promptTokens: 100, completionTokens: 40, reasoningTokens: 10 }, costUsd: 0.01, replayed: false, key: 'k:0',
      };
    },
    spent: () => ({ run: 0, global: 0 }),
  };
  return { gateway, requests };
}

describe('the edit prompt', () => {
  const groupIds = draftGroupIds(facts, draft);

  it('numbers draft groups largest first, then by label', () => {
    expect([...groupIds]).toEqual([['album', 'G1'], ['asset', 'G2'], ['asset-media', 'G3'], ['registry', 'G4'], ['shared', 'G5']]);
  });

  it('lists each file under the module root with role, tables, routes and edges by id', () => {
    const lines = factsText(facts).split('\n');
    expect(lines[1]).toBe('1 controllers/album.controller.ts controller L10 rt:albums →6');
    expect(lines[4]).toBe('4 repositories/album.repository.ts repository L10 tbl:w[album]');
  });

  it('hints sub-features between domain labels only, never under shared or registry', () => {
    expect(subFeatureHints(facts, draft, groupIds)).toEqual(['G3 "asset-media" extends G2 "asset" (1 edges between them)']);
    expect(editPrompt(facts, draft).user).toContain('PINNED (never moved, not listed above): 1 files');
  });
});

describe('runEdit', () => {
  const prompt = editPrompt(facts, draft);
  const answer = (overrides: Record<string, { name: string; kind: string }> = {}, moves: unknown[] = []) => ({
    groups: { 'G1:album': { name: 'album', kind: 'module' }, 'G2:asset': { name: 'asset', kind: 'module' }, 'G3:asset-media': { name: 'asset', kind: 'module' },
      'G4:registry': { name: 'registry', kind: 'platform' }, 'G5:shared': { name: 'shared', kind: 'shared' }, ...overrides },
    moves,
  });

  it('asks for every draft group by "<id>:<label>" key, all required, and moves that name files by path', async () => {
    const { gateway, requests } = fakeGateway(() => [answer()]);
    await runEdit(gateway, prompt, { ...defaultEditSettings, samples: 1 });
    const schema = requests[0]!.schema as { properties: { groups: { required: string[] }; moves: { items: { properties: { file: { type: string } } } } } };
    expect(schema.properties.groups.required).toEqual(['G1:album', 'G2:asset', 'G3:asset-media', 'G4:registry', 'G5:shared']);
    expect(schema.properties.moves.items.properties.file.type).toBe('string');
    expect(requests[0]).toMatchObject({ model: 'ultra', templateKwargs: { medium_effort: true }, maxTokens: 64_000 });
  });

  it('turns the keyed answer back into draft ids, in draft order', async () => {
    const { gateway } = fakeGateway(() => [answer({}, [{ file: 'utils/date.ts', to: 'album', kind: 'module', rationale: 'only album uses it' }])]);
    const run = await runEdit(gateway, prompt, { ...defaultEditSettings, samples: 1 });
    const edit = run.candidates[0]!.edit as PlanEdit;
    expect(edit.groups.map((group) => `${group.draft} ${group.kind}/${group.name}`)).toEqual(['G1 module/album', 'G2 module/asset', 'G3 module/asset', 'G4 platform/registry', 'G5 shared/shared']);
    expect(edit.moves).toEqual([{ file: 'utils/date.ts', to: 'album', kind: 'module', rationale: 'only album uses it' }]);
  });

  it('takes K candidates from one n=K call, a truncated choice becoming an error', async () => {
    const { gateway, requests } = fakeGateway(() => [answer(), 'truncated', answer()]);
    const run = await runEdit(gateway, prompt);
    expect(requests.map((request) => request.n)).toEqual([3]);
    expect(run.sampling).toBe('n');
    expect(run.candidates.map((candidate) => [candidate.label, candidate.error ?? 'ok'])).toEqual([['ultra#1', 'ok'], ['ultra#2', 'truncated'], ['ultra#3', 'ok']]);
    expect(run.costUsd).toBe(0.01);
  });

  it('falls back to K sequential calls when the model refuses n>1', async () => {
    const { gateway, requests } = fakeGateway((request) => (request.n ? new GatewayError('400: n must be 1 when using greedy sampling', 'http', 400) : [answer()]));
    const run = await runEdit(gateway, prompt);
    expect(requests.map((request) => request.n)).toEqual([3, undefined, undefined, undefined]);
    expect(run).toMatchObject({ sampling: 'sequential', calls: 3 });
    expect(run.candidates).toHaveLength(3);
  });

  it('does not swallow other errors', async () => {
    const { gateway } = fakeGateway(() => new GatewayError('refused', 'budget'));
    await expect(runEdit(gateway, prompt)).rejects.toThrow('refused');
  });
});

describe('the critic', () => {
  const placement = (path: string, kind: Placement['kind'], name: string): Placement => ({ path, kind, name, confidence: 'seed', contested: false, source: 'draft' });
  const plan: Plan = {
    placements: files.map((path) => {
      const label = labels[path]!;
      return label === 'registry' ? placement(path, 'platform', 'registry') : label === 'shared' ? placement(path, 'shared', 'shared') : placement(path, 'module', label);
    }),
  };
  const critique = (change: Partial<Critique>): Critique => ({ review: 'fine', groups: [], moves: [], ...change });

  it('shows the plan by path, never by id', () => {
    expect(planText(facts, plan, validatePlan(facts, draft, plan))).toContain('module/album: controllers/album.controller.ts repositories/album.repository.ts services/album.service.ts');
  });

  it('keeps a suggestion that removes warnings and rejects one that adds a warning', () => {
    const { plan: revised, suggestions } = applyCritique(facts, draft, plan, critique({
      groups: [{ group: 'module/asset-media', name: 'asset', kind: 'module' }],
      moves: [{ file: 'repositories/album.repository.ts', to: 'storage', kind: 'module', rationale: 'split for no reason' }],
    }));
    expect(suggestions.map((suggestion) => [suggestion.summary, suggestion.accepted])).toEqual([
      ['group module/asset-media → module/asset', true],
      ['move src/repositories/album.repository.ts → module/storage', false],
    ]);
    expect(suggestions[1]!.reason).toMatch(/^adds (a warning|an error)/);
    expect(revised.placements.filter((candidate) => candidate.name === 'asset')).toHaveLength(5);
  });

  it('rejects unknown groups and files, and drops suggestions that change nothing', () => {
    const { plan: revised, suggestions } = applyCritique(facts, draft, plan, critique({
      groups: [{ group: 'module/photo', name: 'album', kind: 'module' }, { group: 'module/album', name: 'modules/album', kind: 'module' }],
      moves: [{ file: 'utils/nope.ts', to: 'album', kind: 'module', rationale: '' }, { file: 'src/utils/date.ts', to: 'misc', kind: 'shared', rationale: 'pure' }],
    }));
    expect(suggestions.map((suggestion) => [suggestion.summary, suggestion.accepted, suggestion.reason])).toEqual([
      ['group module/photo → module/album', false, 'no such group'],
      ['move utils/nope.ts → module/album', false, 'no such movable file'],
    ]);
    expect(revised).toBe(plan);
  });

  it('marks a kept move as the critic\'s, contested, with its rationale', () => {
    const { plan: revised } = applyCritique(facts, draft, plan, critique({ moves: [{ file: 'utils/date.ts', to: 'album', kind: 'module', rationale: 'only album uses it' }] }));
    expect(revised.placements.find((candidate) => candidate.path === 'src/utils/date.ts')).toMatchObject({ kind: 'module', name: 'album', source: 'critic', contested: true, rationale: 'only album uses it' });
  });
});

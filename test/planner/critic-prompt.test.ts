// The critic's prompt versions: version 1 is the prompt the committed immich plan was recorded with (byte for byte the
// system message of the critic call in cassettes/s6-immich.jsonl), version 2 states the gate's rules, the profiles pin
// a version, and what version 2 says about evidence holds in the gate (the hub threshold, registries, ordering).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProfile } from '../../src/certificate/profile.js';
import { applyCritiques, criticPrompts, criticSettingsFor, defaultCriticSettings, runCritic, type Critique } from '../../src/planner/critic.js';
import type { Gateway, StructuredRequest } from '../../src/gateway/types.js';
import type { Draft, Edge, Facts, FileFact, GroupKind, Placement, Plan } from '../../src/planner/types.js';
import { validatePlan } from '../../src/planner/validate.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');

/** The system message of the recorded critic call (schema plan_review) in the S6 immich cassette. */
function recordedCriticPrompt(): string {
  const records = fs.readFileSync(path.join(repoRoot, 'cassettes/s6-immich.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as {
    request: { messages: { role: string; content: string }[]; response_format: { json_schema: { name: string } } };
  });
  const critic = records.filter((record) => record.request.response_format.json_schema.name === 'plan_review');
  expect(critic).toHaveLength(1);
  return critic[0]!.request.messages[0]!.content;
}

describe('critic prompt versions', () => {
  it('keeps version 1 byte-identical to the prompt the committed immich plan was recorded with', () => {
    expect(criticPrompts[1]).toBe(recordedCriticPrompt());
  });

  it('defaults to version 2; profiles/immich.json pins 1 for replays, other profiles take the default, an unknown version is refused', () => {
    expect(defaultCriticSettings.prompt).toBe(2);
    expect(criticSettingsFor(null, 'replay')).toEqual(defaultCriticSettings);
    expect(criticSettingsFor({ plan: {} }, 'replay')).toEqual(defaultCriticSettings);
    expect(criticSettingsFor(loadProfile('immich'), 'replay')).toEqual({ ...defaultCriticSettings, prompt: 1 });
    expect(() => criticSettingsFor({ plan: { criticPrompt: 9 } }, 'replay')).toThrow('no critic prompt version 9');
  });

  it('records with the current prompt: the pin is the recording\'s, so a re-recorded immich plan asks with version 2', () => {
    for (const mode of ['record', 'auto'] as const) {
      expect(criticSettingsFor(loadProfile('immich'), mode)).toEqual(defaultCriticSettings);
      expect(criticSettingsFor(loadProfile('immich'), mode).prompt).toBe(2);
    }
    expect(() => criticSettingsFor({ plan: { criticPrompt: 9 } }, 'record')).toThrow('no critic prompt version 9');
  });

  it('sends the version the settings name', async () => {
    const sent: string[] = [];
    const gateway: Gateway = {
      async structured<T>(request: StructuredRequest<T>) {
        sent.push(request.messages[0]!.content);
        return { choices: [], usage: null, costUsd: 0, replayed: true, key: 'k' };
      },
      spent: () => ({ run: 0, global: 0 }),
    };
    const facts: Facts = { packageRoot: '', moduleRoot: 'src', sha: 'test', pins: [], files: [], edges: [] };
    const validation = validatePlan(facts, { assignment: new Map(), confidence: new Map(), contested: [] }, { placements: [] });
    await runCritic(gateway, facts, { placements: [] }, validation, { ...defaultCriticSettings, prompt: 1 });
    await runCritic(gateway, facts, { placements: [] }, validation);
    expect(sent).toEqual([criticPrompts[1], criticPrompts[2]]);
  });

  it('states the gate in version 2 only: order, warnings per code and group, evidence, hubs, registries, earlier changes', () => {
    for (const rule of [
      'one at a time, in your order (all "groups" changes, then all "moves")',
      'Warnings are counted per code and group',
      'a renamed group keeps its warnings under its new name',
      "a group's last file moved into one",
      'Edges to or from a registry don\'t count',
      'more than three groups of the plan read or write is a hub',
      'a registry joins it without evidence',
      'an earlier kept change already changed is dropped',
    ]) {
      expect(criticPrompts[2]).toContain(rule);
      expect(criticPrompts[1]).not.toContain(rule);
    }
    expect(criticPrompts[2].startsWith(criticPrompts[1].slice(0, criticPrompts[1].indexOf('\nEach change')))).toBe(true);
  });
});

/** Groups that each read one table; `module/x` and `module/y` share the table `t`, used by `users` groups in all. */
function hubFixture(users: number) {
  const file = (filePath: string, role: string, extra: Partial<FileFact> = {}): Omit<FileFact, 'id'> =>
    ({ path: filePath, role, loc: 10, exports: [], primaryExport: null, tables: { reads: [], writes: [] }, routes: [], tests: [], ...extra });
  const rows: [string, GroupKind, string, Omit<FileFact, 'id'>][] = [];
  for (let index = 0; index < users; index++) {
    const name = ['x', 'y', 'z', 'w', 'v'][index]!;
    for (const role of ['service', 'repository']) {
      const filePath = `src/${role}s/${name}.${role}.ts`;
      rows.push([filePath, 'module', name, file(filePath, role, role === 'repository' ? { tables: { reads: ['t', name], writes: [name] } } : {})]);
    }
  }
  const sorted = rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const edges: Edge[] = rows.filter(([filePath]) => filePath.includes('/services/'))
    .map(([filePath, , name]) => ({ from: filePath, to: `src/repositorys/${name}.repository.ts`, weight: 1, typeOnly: false, kinds: ['import'], symbols: [] }));
  const facts: Facts = { packageRoot: '', moduleRoot: 'src', sha: 'test', pins: [], files: sorted.map(([, , , fact], index) => ({ ...fact, id: index + 1 })), edges };
  const draft: Draft = { assignment: new Map(sorted.map(([filePath, , name]) => [filePath, name])), confidence: new Map(sorted.map(([filePath]) => [filePath, 'seed'])), contested: [] };
  const plan: Plan = { placements: sorted.map(([filePath, kind, name]): Placement => ({ path: filePath, kind, name, confidence: 'seed', contested: false, source: 'draft' })) };
  return { facts, draft, plan };
}

describe('what version 2 says about evidence holds in the gate', () => {
  const merge: Critique = { review: 'merge y into x', groups: [{ group: 'module/y', name: 'x', kind: 'module' }], moves: [] };

  it('a table three groups use links two of them; one that more than three use is a hub and links nothing', () => {
    const three = hubFixture(3);
    expect(applyCritiques(three.facts, three.draft, three.plan, [merge]).suggestions).toEqual([
      expect.objectContaining({ summary: 'group module/y → module/x', accepted: true, evidence: 'tables t' }),
    ]);
    const four = hubFixture(4);
    expect(applyCritiques(four.facts, four.draft, four.plan, [merge]).suggestions).toEqual([
      expect.objectContaining({ summary: 'group module/y → module/x', accepted: false, reason: expect.stringContaining('a merge without evidence') }),
    ]);
  });
});

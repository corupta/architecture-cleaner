// The committed immich plan, replayed from its cassette: the same plan.md, plan.yaml, steps/ and candidates/ as
// docs/plans/immich/, byte for byte. cassettes/s6-immich.jsonl holds S5's recorded edit call and the S6 critic call
// (the critic's prompt changed with the S6 validator rules). Needs the immich clone at the pinned base
// (~/ac-targets/immich, server/ @ 02063972e8); skipped without. The critic's prompt and the planner rules are version 1,
// as the immich profile pins them for replays.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { createGateway } from '../../src/gateway/gateway.js';
import { loadProfile } from '../../src/certificate/profile.js';
import { criticSettingsFor } from '../../src/planner/critic.js';
import { defaultEditSettings, editPrompt, editSettingsFor } from '../../src/planner/edit.js';
import { buildFacts } from '../../src/planner/facts.js';
import { planOutputs } from '../../src/planner/outputs.js';
import { planRepo } from '../../src/planner/plan.js';
import { plannerDraft } from '../../src/planner/seeds.js';
import type { PlannerRules } from '../../src/planner/types.js';

const immich = path.join(os.homedir(), 'ac-targets/immich');
const base = '02063972e82b1bfd17b6fc2e3b3ff39936229ea5';
const repoRoot = path.resolve(import.meta.dirname, '../..');
const committed = path.join(repoRoot, 'docs/plans/immich');
const atBase = () => {
  try {
    const head = execFileSync('git', ['-C', immich, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const clean = execFileSync('git', ['-C', immich, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() === '';
    return head === base && clean;
  } catch {
    return false;
  }
};
const filesUnder = (directory: string): string[] => fs.readdirSync(path.join(committed, directory)).sort().map((file) => `${directory}/${file}`);

const ledgerPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-immich-replay-')), 'ledger.jsonl');
const replay = async (edit: typeof defaultEditSettings) => {
  const gateway = createGateway({ runId: 'replay', mode: 'replay', cassettePath: path.join(repoRoot, 'cassettes/s6-immich.jsonl'), ledgerPath });
  const settings = { edit, critic: criticSettingsFor(loadProfile('immich'), 'replay') };
  const run = await planRepo(gitRepoFs(immich), gateway, { packageRoot: 'server', moduleRoot: 'src', pins: [], ...settings });
  return planOutputs(run, { name: 'immich' }, settings);
};

describe.skipIf(!atBase())('the committed immich plan', () => {
  it('replays from cassettes/s6-immich.jsonl to docs/plans/immich/ byte for byte, spending nothing', async () => {
    // profiles/immich.json pins the critic prompt and the planner rules the plan was recorded with, for replays.
    const outputs = await replay(editSettingsFor(loadProfile('immich'), 'replay'));
    const files = ['plan.md', 'plan.yaml', ...filesUnder('candidates'), ...filesUnder('steps')];
    expect(files.filter((file) => file.startsWith('steps/'))).toHaveLength(59);
    expect([...outputs.keys()].filter((file) => file !== 'plan.json').sort()).toEqual([...files].sort());
    for (const file of files) expect(outputs.get(file), file).toBe(fs.readFileSync(path.join(committed, file), 'utf8'));
    expect(fs.existsSync(ledgerPath)).toBe(false);
  }, 120_000);

  it("needs its pin: planner rules 2 read immich's common table expression aliases as no tables, so the edit prompt has no recorded answer", async () => {
    const factsUnder = (rules: PlannerRules) => buildFacts(gitRepoFs(immich), { packageRoot: 'server', moduleRoot: 'src', pins: [], rules });
    const [pinned, latest] = [factsUnder(1), factsUnder(2)];
    // Only table reads change, in five repositories, and only by names that are no table of immich's schema: under
    // rules 2 every table name the facts hold is a `@Table` of server/src/schema/tables.
    expect({ ...latest, files: latest.files.map((file, index) => ({ ...file, tables: pinned.files[index]!.tables })) }).toEqual(pinned);
    const schemaDirectory = path.join(immich, 'server/src/schema/tables');
    const schema = new Set(fs.readdirSync(schemaDirectory).flatMap((file) => [...fs.readFileSync(path.join(schemaDirectory, file), 'utf8').matchAll(/@Table\((?:\{\s*name:\s*)?'(\w+)'/g)].map((match) => match[1]!)));
    const named = (facts: typeof pinned) => new Set(facts.files.flatMap((file) => [...file.tables.reads, ...file.tables.writes]));
    expect([...named(latest)].filter((table) => !schema.has(table))).toEqual([]);
    const dropped = pinned.files.flatMap((file, index) => {
      const { tables } = latest.files[index]!;
      expect(tables.writes, file.path).toEqual(file.tables.writes);
      expect(file.tables.reads, file.path).toEqual(expect.arrayContaining(tables.reads));
      const gone = file.tables.reads.filter((table) => !tables.reads.includes(table));
      return gone.length ? [[file.path, gone] as const] : [];
    });
    expect(Object.fromEntries(dropped)).toEqual({
      'src/repositories/asset.repository.ts': ['agg', 'cities', 'cte', 'res', 'today'],
      'src/repositories/duplicate.repository.ts': ['cte', 'duplicates'],
      'src/repositories/person.repository.ts': ['mapping', 'shared'],
      'src/repositories/search.repository.ts': ['cte'],
      'src/repositories/tag.repository.ts': ['created_tag', 'descendants'],
    });
    expect(dropped.flatMap(([, gone]) => gone).filter((table) => schema.has(table) || named(latest).has(table))).toEqual([]);
    // The edit prompt shows each file's tables, so its FILES lines of those five change and the cassette misses.
    const promptLines = (facts: typeof pinned) => editPrompt(facts, plannerDraft(facts).draft).user.split('\n');
    const pinnedLines = promptLines(pinned);
    expect(promptLines(latest).filter((line) => !pinnedLines.includes(line)).map((line) => line.split(' ')[1])).toEqual(dropped.map(([file]) => file.replace(/^src\//, '')));
    await expect(replay(defaultEditSettings)).rejects.toMatchObject({ code: 'replay-miss' });
    expect(fs.existsSync(ledgerPath)).toBe(false);
  }, 240_000);
});

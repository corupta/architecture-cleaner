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
import { defaultEditSettings, editSettingsFor } from '../../src/planner/edit.js';
import { planOutputs } from '../../src/planner/outputs.js';
import { planRepo } from '../../src/planner/plan.js';

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

  it('would plan the same under planner rules 2: every recorded move names a path and every candidate has modules', async () => {
    // The pin is what guarantees the replay; this says what rules 2 change on immich today: plan.md's ranking sentence only.
    const pinned = await replay(editSettingsFor(loadProfile('immich'), 'replay'));
    const latest = await replay(defaultEditSettings);
    expect([...latest.keys()]).toEqual([...pinned.keys()]);
    for (const [file, content] of pinned) if (file !== 'plan.md') expect(latest.get(file), file).toBe(content);
    const differing = (text: string) => text.split('\n').filter((line) => !pinned.get('plan.md')!.split('\n').includes(line));
    expect(differing(latest.get('plan.md')!)).toEqual([expect.stringMatching(/^Ranking: plans with at least one feature module first /)]);
  }, 240_000);
});

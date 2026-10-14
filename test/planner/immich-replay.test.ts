// The committed immich plan, replayed from its cassette: the same plan.md, plan.yaml, steps/ and candidates/ as
// docs/plans/immich/, byte for byte. cassettes/s6-immich.jsonl holds S5's recorded edit call and the S6 critic call
// (the critic's prompt changed with the S6 validator rules). Needs the immich clone at the pinned base
// (~/ac-targets/immich, server/ @ 02063972e8); skipped without.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { createGateway } from '../../src/gateway/gateway.js';
import { defaultCriticSettings } from '../../src/planner/critic.js';
import { defaultEditSettings } from '../../src/planner/edit.js';
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

describe.skipIf(!atBase())('the committed immich plan', () => {
  it('replays from cassettes/s6-immich.jsonl to docs/plans/immich/ byte for byte, spending nothing', async () => {
    const ledgerPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-immich-replay-')), 'ledger.jsonl');
    const gateway = createGateway({ runId: 'replay', mode: 'replay', cassettePath: path.join(repoRoot, 'cassettes/s6-immich.jsonl'), ledgerPath });
    const settings = { edit: defaultEditSettings, critic: defaultCriticSettings };
    const run = await planRepo(gitRepoFs(immich), gateway, { packageRoot: 'server', moduleRoot: 'src', pins: [], ...settings });
    const outputs = planOutputs(run, { name: 'immich' }, settings);
    const files = ['plan.md', 'plan.yaml', ...filesUnder('candidates'), ...filesUnder('steps')];
    expect(files.filter((file) => file.startsWith('steps/'))).toHaveLength(58);
    expect([...outputs.keys()].filter((file) => file !== 'plan.json').sort()).toEqual([...files].sort());
    for (const file of files) expect(outputs.get(file), file).toBe(fs.readFileSync(path.join(committed, file), 'utf8'));
    expect(fs.existsSync(ledgerPath)).toBe(false);
  }, 120_000);
});

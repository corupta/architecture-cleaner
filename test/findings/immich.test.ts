// The findings log on immich server/ at the pinned base with the committed plan: BaseService's god injection, the
// one large import cycle and the tables several groups write. Reads git objects only, so it needs the immich clone
// (~/ac-targets/immich) to have the base commit, whatever its checkout; skipped without.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runFindings } from '../../src/findings/index.js';

const immich = path.join(os.homedir(), 'ac-targets/immich');
const base = '02063972e82b1bfd17b6fc2e3b3ff39936229ea5';
const repoRoot = path.resolve(import.meta.dirname, '../..');
const hasBase = () => {
  try {
    execFileSync('git', ['-C', immich, 'cat-file', '-e', `${base}^{commit}`], { stdio: 'ignore' });
    return fs.existsSync(path.join(immich, 'server/node_modules'));
  } catch {
    return false;
  }
};

describe.skipIf(!hasBase())('findings on immich server/ @ 02063972e8', () => {
  it('count BaseService\'s injection, find the large cycle and the multi-writer tables', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-findings-immich-'));
    try {
      fs.mkdirSync(path.join(directory, 'plan'));
      fs.copyFileSync(path.join(repoRoot, 'docs/plans/immich/plan.yaml'), path.join(directory, 'plan/plan.yaml'));
      fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({
        format: 'ac-run/1', status: 'running', tool: { name: 'architecture-cleaner', version: '0.1.0' }, repo: immich, environment: immich,
        profile: { name: 'immich', packageRoot: 'server', node: 'system', plan: { moduleRoot: 'src' } }, packageRoot: 'server', moduleRoot: 'src',
        base, baseTree: '', branch: 'none', head: base, plan: { file: 'plan/plan.yaml', source: 'planner', sha256: '', steps: 58, moves: 0 },
        rungsRequested: [], options: { jobs: 1, injectFault: null }, rungs: [], steps: [], pins: [], findings: [], quarantine: [], fault: null,
        cost: { budgetRun: null, mode: null, llmUsd: 0, planRecordedUsd: null },
        timeline: { startedAt: '', durationMs: 0, preflightMs: 0, baselineMs: 0, stepsMs: 0, rungCertificationMs: 0, bisectMs: 0, runCertificationMs: 0, resumedAt: [] },
      }));
      const { document } = await runFindings({ runDirectory: directory, gateway: null });
      const [injection] = document.findings.filter((finding) => finding.kind === 'god-injection');
      expect(injection!.title).toBe('BaseService injects 56 members into 51 classes');
      expect(injection!.evidence).toMatch(/^BaseService \(server\/src\/services\/base\.service\.ts\) takes 56 constructor-injected members/);
      const cycles = document.findings.filter((finding) => finding.kind === 'module-cycle');
      expect(cycles).toHaveLength(1);
      expect(cycles[0]!.weight).toBeGreaterThan(40);
      expect(document.findings.filter((finding) => finding.kind === 'multi-writer-table').map((finding) => finding.title)).toContain('Table asset is written by 4 groups');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 180_000);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { abTableFor, abTableView, certificateCount, checkNote, readAbDocument } from '../../src/report/ab.js';
import { certificateSummary, oracleNames, oracleSummary, readCertificate } from '../../src/report/certificates.js';
import { finalGroups, tableHeatmap } from '../../src/report/heatmap.js';
import { readLedger, summarizeLedger } from '../../src/report/ledger.js';
import { readRunReport } from '../../src/report/run-data.js';
import { readPlanYaml } from '../../src/planner/plan-file.js';
import { makePackageFixture, makeRunFixture } from './fixture.js';

const packageDirectory = path.resolve(import.meta.dirname, '..', '..');

describe('table-access heatmap', () => {
  const planFile = readPlanYaml(`version: 1
packageRoot: server
moduleRoot: src
sha: "0"
groups:
  module/album:
    - { path: src/repositories/album.repository.ts, confidence: seed }
  module/asset:
    - { path: src/repositories/asset.repository.ts, tests: [src/repositories/asset.repository.spec.ts], confidence: seed }
  platform/access:
    - { path: src/repositories/access.repository.ts, confidence: seed }
`);
  const files = [
    { path: 'src/repositories/access.repository.ts', tables: { reads: ['album', 'asset'], writes: [] } },
    { path: 'src/repositories/album.repository.ts', tables: { reads: ['album', 'asset'], writes: ['album', 'asset'] } },
    { path: 'src/repositories/asset.repository.ts', tables: { reads: ['asset'], writes: ['asset', 'asset_exif'] } },
    { path: 'src/repositories/orphan.repository.ts', tables: { reads: ['user'], writes: [] } },
  ];

  it('maps facts through the plan, orders tables under their first writer and flags tables written by several groups', () => {
    const heatmap = tableHeatmap(files, finalGroups(planFile, []), [...planFile.groups.keys()]);
    expect(heatmap.groups).toEqual(['module/album', 'module/asset', 'platform/access', 'unplaced']);
    expect(heatmap.tables.map((table) => [table.name, table.writerGroups, table.readerGroups, table.multiWriter])).toEqual([
      ['album', ['module/album'], ['platform/access'], false],
      ['asset', ['module/album', 'module/asset'], ['platform/access'], true],
      ['asset_exif', ['module/asset'], [], false],
      ['user', [], ['unplaced'], false],
    ]);
    expect(heatmap.cells.find((cell) => cell.table === 'asset' && cell.group === 'module/album')).toEqual({ table: 'asset', group: 'module/album', readers: 1, writers: 1 });
  });

  it('counts a pinned file under `pinned`, not under the group it never moved to', () => {
    const heatmap = tableHeatmap(files, finalGroups(planFile, ['server/src/repositories/album.repository.ts']), [...planFile.groups.keys()]);
    expect(heatmap.tables.find((table) => table.name === 'asset')!.writerGroups).toEqual(['module/asset', 'pinned']);
    expect(heatmap.groups).toEqual(['module/asset', 'platform/access', 'pinned', 'unplaced']);
  });
});

describe('cost ledger', () => {
  it('sums by run in order of appearance: carried lines, reconciliations, calls and open reservations', () => {
    const lines = [
      { runId: 'tf-probes', carried: 'spike', paidCalls: 82, costUsd: 0.025 },
      { runId: 'g1', carried: 'spike', paidCalls: 53, costUsd: 1.7 },
      { runId: 's5', model: 'nvidia/Nemotron-3-Ultra-550b-a55b', callId: 'a', reservedUsd: 0.6 },
      { runId: 's5', model: 'nvidia/Nemotron-3-Ultra-550b-a55b', callId: 'a', promptTokens: 100, completionTokens: 50, costUsd: 0.1 },
      { runId: 'g1', reconciled: 'one lost call', costUsd: 0.05 },
      { runId: 's6', model: 'nvidia/Nemotron-3_5-Lightning', callId: 'b', reservedUsd: 0.01 },
    ];
    const ledger = summarizeLedger(lines.map((line) => JSON.stringify(line)).join('\n'), { globalCap: 50, runs: { s5: { cap: 3 }, s7: { cap: 5 } } });
    expect(ledger.runs.map((run) => [run.run, run.calls, Number(run.costUsd.toFixed(6)), run.openReservationsUsd, run.models, run.capUsd])).toEqual([
      ['tf-probes', 82, 0.025, 0, [], null],
      ['g1', 53, 1.75, 0, [], null],
      ['s5', 1, 0.1, 0, ['Nemotron 3 Ultra'], 3],
      ['s6', 0, 0.01, 0.01, [], null],
      ['s7', 0, 0, 0, [], 5],
    ]);
    expect(ledger.runs[1]!.notes).toEqual(['carried over from spike: 53 paid calls, $1.7000', 'reconciled, $0.0500: one lost call']);
    expect(Number(ledger.totalUsd.toFixed(6))).toBe(1.885);
    expect(ledger.globalCapUsd).toBe(50);
  });

  it('matches the committed ledger line by line', () => {
    const text = fs.readFileSync(path.join(packageDirectory, 'budget', 'ledger.jsonl'), 'utf8');
    const ledger = readLedger(path.join(packageDirectory, 'budget', 'ledger.jsonl'), path.join(packageDirectory, 'budget', 'runs.json'))!;
    const lines = text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { costUsd?: number });
    const direct = lines.reduce((sum, line) => sum + (line.costUsd ?? 0), 0);
    expect(ledger.totalUsd - ledger.runs.reduce((sum, run) => sum + run.openReservationsUsd, 0)).toBeCloseTo(direct, 9);
    expect(ledger.runs.slice(0, 2).map((run) => run.run)).toEqual(['tf-probes', 'g1']);
  });
});

describe('certificates, both formats', () => {
  it('reads format 1 (S4, no trees) and format 2 (the run, trees) to the same view', () => {
    const v1 = readCertificate(path.join(packageDirectory, 'runs', 'g3', 'g3-immich-opencode-super.full.json')).view;
    expect(v1.format).toBe('ac-certificate/1');
    expect(v1.baseTree).toBeNull();
    expect(v1.verdict).toBe('fail');
    expect(v1.failing).toEqual(['K1', 'K3a', 'K4', 'K6', 'K8']);
    expect(v1.checks.map((check) => check.id)).not.toContain('K7');
    const v2 = readCertificate(path.join(packageDirectory, 'runs', 'immich-ladder', 'certificate.json')).view;
    expect(v2.format).toBe('ac-certificate/2');
    expect(v2.headTree).toBe('4e457bb4e806f1bc0a63b83141345e20edab0f57');
    expect([v2.verdict, v2.scope, v2.pathMap.moves, v2.failing]).toEqual(['pass', 'full', 367, []]);
  });

  it('uses the stored summary without its log lines, and renders one when none is stored', () => {
    const file = path.join(packageDirectory, 'runs', 'g3', 'immich-r1.full.json');
    const { certificate } = readCertificate(file);
    const stored = certificateSummary(file, certificate);
    expect(stored.startsWith('ac certify 02063972e8..ff429b0d24')).toBe(true);
    expect(stored).not.toContain('[certify]');
    const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-certificate-')), 'r1.json');
    fs.copyFileSync(file, copy);
    const rendered = certificateSummary(copy, certificate);
    expect(rendered).toContain('PASS  K8');
    expect(rendered).not.toContain('trees:');
    expect(rendered).toContain('verdict: PASS (static checks and oracles)');
  });
});

describe('the A/B', () => {
  it('reads runs/g3/ab.json and the arms\' certificates into check rows', () => {
    const document = readAbDocument(path.join(packageDirectory, 'runs', 'g3', 'ab.json'))!;
    expect(document.tables.map((table) => table.id)).toEqual(['immich', 'immich-ultra', 'mcphub']);
    const immich = abTableFor(document, { base: '02063972e82b1bfd17b6fc2e3b3ff39936229ea5', packageRoot: 'server' })!;
    expect(immich.id).toBe('immich');
    expect(abTableFor(document, { base: '02063972e82b1bfd17b6fc2e3b3ff39936229ea5', packageRoot: '' })).toBeNull();
    for (const row of immich.rows) expect(row.source.length).toBeGreaterThan(0);
    const view = abTableView(immich, packageDirectory);
    expect(Object.fromEntries(Object.entries(view.certificates).map(([arm, certificate]) => [arm, certificate?.view.verdict]))).toEqual({
      'ac-ladder': 'pass', 'ac-r1': 'pass', 'g3-single': 'fail', 'g3-persistent': 'fail',
    });
    const row = (id: string) => view.checkRows.find((check) => check.id === id)!.statuses;
    expect(row('K1')).toEqual({ 'ac-ladder': 'pass', 'ac-r1': 'pass', 'g3-single': 'fail', 'g3-persistent': 'fail' });
    // The certificates, not the prose, decide: K2 passes on both G3 branches (their edits show up as added files, K1).
    expect(row('K2')).toEqual({ 'ac-ladder': 'pass', 'ac-r1': 'pass', 'g3-single': 'pass', 'g3-persistent': 'pass' });
    expect(row('K7')).toEqual({ 'ac-ladder': 'pass', 'ac-r1': null, 'g3-single': null, 'g3-persistent': null });
    // S9: the same agent on Nemotron 3 Ultra. The single-shot changed nothing (no certificate); the persistent branch only
    // moved files, so K2 passes and every resolution check fails.
    const ultra = abTableView(document.tables.find((table) => table.id === 'immich-ultra')!, packageDirectory);
    expect(Object.fromEntries(Object.entries(ultra.certificates).map(([arm, certificate]) => [arm, certificate?.view.verdict ?? null]))).toEqual({
      'ac-ladder': 'pass', 'g3u-single': null, 'g3u-persistent': 'fail',
    });
    const ultraRow = (id: string) => ultra.checkRows.find((check) => check.id === id)!.statuses;
    expect(ultraRow('K2')).toEqual({ 'ac-ladder': 'pass', 'g3u-single': null, 'g3u-persistent': 'pass' });
    expect(ultraRow('K3b')).toEqual({ 'ac-ladder': 'pass', 'g3u-single': null, 'g3u-persistent': 'fail' });
    const mcphub = abTableView(document.tables.find((table) => table.id === 'mcphub')!, packageDirectory);
    expect(Object.values(mcphub.certificates).map((certificate) => certificate?.view.verdict)).toEqual(['fail', 'fail']);
  });

  it('shows the certificates\' own counts wherever a row cites them, and every named count exists in every certificate', () => {
    const document = readAbDocument(path.join(packageDirectory, 'runs', 'g3', 'ab.json'))!;
    for (const table of document.tables) {
      const view = abTableView(table, packageDirectory);
      for (const row of table.rows) {
        if (/certificate/.test(row.source)) expect(row.certificate, `${table.id}: ${row.metric}`).toBeDefined();
        if (!row.certificate) continue;
        for (const arm of table.arms) {
          const certificate = view.certificates[arm.id];
          if (certificate) expect(certificateCount(certificate.view, row.certificate), `${table.id}: ${row.metric}, ${arm.id}`).not.toBeNull();
        }
      }
    }
  });

  it('reads the counts from the certificate: K1 pairing, a K2 PASS with nothing to compare, one oracle of K8', () => {
    const single = readCertificate(path.join(packageDirectory, 'runs', 'g3', 'g3-immich-opencode-super.full.json')).view;
    expect(certificateCount(single, 'K1')).toBe('K1: 0 moved, 0 edited in place, 211 added (31 of them copies of files that still exist), 0 deleted');
    expect(certificateCount(single, 'K2')).toBe('K2: no file paired with a base file changed, so there was nothing to compare; K1 counts the 211 added files');
    expect(checkNote(single, 'K2')).toBe('nothing to compare: K1 counts the 211 added files');
    expect(checkNote(single, 'K1')).toBeNull();
    expect(oracleNames(single)).toEqual(['tsc', 'unit', 'openapi']);
    expect(certificateCount(single, 'K8 tsc')).toBe('K8: tsc exited 1 on head (1,680 diagnostics), 0 on base');
    expect(oracleSummary(single, 'openapi')).toBe("openapi byte-identical to the base's open-api/immich-openapi-specs.json (947,932 bytes), but 1 step failed on head");
    const ladder = readCertificate(path.join(packageDirectory, 'runs', 'immich-ladder', 'certificate.json')).view;
    expect(certificateCount(ladder, 'K2')).toBe('K2: 2474 specifier spans changed in 515 files; every other byte identical');
    expect(checkNote(ladder, 'K2')).toBeNull();
    const mcphub = readCertificate(path.join(packageDirectory, 'runs', 'g3', 'g3-mcphub-opencode-super.full.json')).view;
    expect(certificateCount(mcphub, 'K8 openapi')).toBeNull();
    expect(certificateCount(mcphub, 'K8 unit')).toBe('K8: unit 96/219 files and 779/1,934 cases equal to base (head: 99/219 files load, 779 passed, 8 failed, 0 skipped)');
  });

  it('refuses a row that names a certificate count it doesn\'t know', () => {
    const { root } = makePackageFixture();
    const file = path.join(root, 'runs', 'g3', 'ab.json');
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    document.tables[0].rows[0].certificate = 'K9';
    fs.writeFileSync(file, JSON.stringify(document));
    expect(() => readAbDocument(file)).toThrow(/unknown certificate count K9/);
  });

  it('refuses a row that names an arm the table doesn\'t have', () => {
    const { root } = makePackageFixture();
    const file = path.join(root, 'runs', 'g3', 'ab.json');
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    document.tables[0].rows[0].values.ghost = '1';
    fs.writeFileSync(file, JSON.stringify(document));
    expect(() => readAbDocument(file)).toThrow(/unknown arms ghost/);
  });
});

describe('a run dir read for the report', () => {
  it('keeps every attempt\'s certificate, the rolled-back one included, and lists unreferenced certificates', () => {
    const fixture = makeRunFixture();
    const data = readRunReport(fixture.directory, { packageDirectory });
    const step2 = data.steps[1]!;
    expect(step2.attempts.map(({ attempt, certificate }) => [attempt.state, certificate?.view.verdict, certificate?.file])).toEqual([
      ['failed', 'fail', 'certificates/failed/002-R1-module-order-attempt1.json'],
      ['passed', 'pass', 'certificates/002-R1-module-order.json'],
    ]);
    expect(step2.attempts[0]!.certificate!.view.failing).toEqual(['K3a', 'K3b']);
    // The passing certificate of step 2 has no stored summary: it is rendered from the JSON.
    expect(step2.attempts[1]!.certificate!.summary).toContain('verdict: PASS (static checks only)');
    expect(data.otherCertificates.map((certificate) => certificate.file)).toEqual(['rungs/failed/R1.json']);
    expect(data.whole?.view.verdict).toBe('pass');
    expect(data.plan).toMatchObject({ groups: { module: 2, platform: 0, shared: 0 }, files: 4, bySource: { draft: 3, planner: 1 }, contested: 1, winner: 'ultra#1' });
    expect(data.heatmap!.tables.find((table) => table.name === 'users')).toMatchObject({ writerGroups: ['module/user', 'pinned'], multiWriter: true });
    expect(data.attachments).toContain('certificates/failed/002-R1-module-order-attempt1.json');
    expect(data.attachments).toContain('plan/plan.yaml');
    expect(data.attachments).not.toContain('plan/plan.md');
    expect(data.ab).toBeNull();
  });
});

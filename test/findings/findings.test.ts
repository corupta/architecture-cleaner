// The findings log end to end on a fixture repo and a synthetic run directory: every collector, the stable ids, the
// three rendered files, the boundary report taking over the graph findings, narration (a fake Lightning) that can
// only add text, and `ac findings` re-rendering report.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findingsCommand } from '../../src/findings/command.js';
import { reportSectionOf, runFindings } from '../../src/findings/index.js';
import { type BoundaryReport, readRunData } from '../../src/findings/run-data.js';
import type { Finding } from '../../src/findings/types.js';
import type { Gateway, StructuredRequest, StructuredResult } from '../../src/gateway/types.js';
import { createRepo, createRunDirectory } from './fixture.js';

let repo: { root: string; base: string };
const cleanup: string[] = [];
beforeAll(() => {
  repo = createRepo();
  cleanup.push(repo.root);
});
afterAll(() => {
  for (const directory of cleanup) fs.rmSync(directory, { recursive: true, force: true });
});

function runDirectory(options: Parameters<typeof createRunDirectory>[2] = {}): string {
  const directory = createRunDirectory(repo.root, repo.base, options);
  cleanup.push(directory);
  return directory;
}

const ofKind = (findings: Finding[], kind: string) => findings.filter((finding) => finding.kind === kind);
const read = (directory: string, file: string) => fs.readFileSync(path.join(directory, file), 'utf8');

/** A Lightning stand-in: answers each finding with `text(title)`, records the requests. */
function fakeGateway(text: (title: string) => string): Gateway & { requests: StructuredRequest<unknown>[] } {
  const requests: StructuredRequest<unknown>[] = [];
  return {
    requests,
    async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      requests.push(request as StructuredRequest<unknown>);
      const shown = JSON.parse(request.messages[1]!.content.replace(/^Findings \(JSON\):\n/, '')) as { id: string; title: string }[];
      const value = request.parse({ narrations: shown.map((finding) => ({ id: finding.id, text: text(finding.title) })) });
      return { choices: [{ index: 0, finishReason: 'stop', value, reasoning: null }], usage: { promptTokens: 100, completionTokens: 50, reasoningTokens: null }, costUsd: 0.00002, replayed: true, key: 'k:0' };
    },
    spent: () => ({ run: 0, global: 0 }),
  };
}

describe('runFindings on a fixture run', () => {
  let directory: string;
  let findings: Finding[];
  beforeAll(async () => {
    directory = runDirectory();
    findings = (await runFindings({ runDirectory: directory, gateway: null })).document.findings;
  });

  it('finds the module cycle the plan creates, with the edges that close it', () => {
    const [cycle, ...more] = ofKind(findings, 'module-cycle');
    expect(more).toEqual([]);
    expect(cycle).toMatchObject({ source: 'plan-graph', title: '4 groups form one import cycle', weight: 4 });
    expect(cycle!.evidence).toContain('Members: module/album, module/tag, module/user, shared/shared.');
    expect(cycle!.evidence).toMatch(/These \d+ edges \(\d+ file pairs\) close every cycle/);
  });

  it('counts the members a god base class injects and how many each subclass reads', () => {
    const [injection] = ofKind(findings, 'god-injection');
    expect(injection!.title).toBe('BaseService injects 10 members into 3 classes');
    expect(injection!.files).toEqual(['server/src/services/album.service.ts', 'server/src/services/base.service.ts', 'server/src/services/tag.service.ts', 'server/src/services/user.service.ts']);
    expect(injection!.evidence).toContain('takes 10 constructor-injected members (10 of them repositories), and 3 classes extend it');
    expect(injection!.evidence).toContain('reads 2.0 of them on average through this.<member> (median 2, min 1, max 3 in TagService); 5 members no subclass reads: sessionRepository, jobRepository, eventRepository, cryptoRepository, storageRepository.');
    expect(injection!.evidence).toContain('- TagService (server/src/services/tag.service.ts): 3 (assetRepository, logger, tagRepository)');
    expect(injection!.evidence).toContain('- UserService (server/src/services/user.service.ts): 1 (userRepository)');
  });

  it('names a table that files of two plan groups write, with the writers', () => {
    expect(ofKind(findings, 'multi-writer-table').map((finding) => [finding.title, finding.evidence])).toEqual([[
      'Table asset is written by 2 groups',
      'Table asset is written by 2 files in 2 plan groups:\n- module/asset: server/src/repositories/asset.repository.ts\n- module/tag: server/src/repositories/tag.repository.ts',
    ]]);
  });

  it('finds production code that imports test code', () => {
    const [found, ...more] = ofKind(findings, 'prod-imports-test');
    expect(more).toEqual([]);
    expect(found!.files).toEqual(['server/src/utils/clock.ts', 'server/test/clock.fake.ts']);
    expect(found!.evidence).toContain("- line 1: import '../../test/clock.fake.js' → server/test/clock.fake.ts");
  });

  it('recomputes the plan validator\'s warnings for the run\'s plan', () => {
    const titles = ofKind(findings, 'plan-warning').map((finding) => finding.title);
    expect(titles).toContain('Plan warning (singleton-group): module/asset');
    expect(titles).toContain('Plan warning (registry-outside-platform): shared/shared');
  });

  it('de-duplicates certificate findings across steps and certificates, leaving failed attempts out', () => {
    const [docs, ...more] = ofKind(findings, 'old-path-in-docs');
    expect(more).toEqual([]);
    expect(docs).toMatchObject({ source: 'certificate', files: ['docs/architecture.md'], steps: [1, 2], certificates: ['rungs/R1.json'], weight: 1 });
    expect(docs!.evidence).toContain('K4 reported one finding in docs/architecture.md, 3 times (steps 1–2, rungs/R1.json):');
    const [flaky] = ofKind(findings, 'flaky-test');
    expect(flaky).toMatchObject({ steps: [], certificates: ['certificate.json', 'rungs/R1.json'] });
    expect(flaky!.evidence).toContain('(log <path>)');
    expect(ofKind(findings, 'stack-text')).toEqual([]);
  });

  it('merges the executor finding every step repeats, and keeps each pin an event', () => {
    const [coverage] = ofKind(findings, 'ungated-coverage-glob');
    expect(coverage).toMatchObject({ source: 'run', steps: [1, 2], files: ['server/vitest.config.mjs'] });
    expect(coverage!.evidence.split('\n')).toHaveLength(2);
    const [pinned] = ofKind(findings, 'step-pinned');
    expect(pinned).toMatchObject({ steps: [3], title: 'Step pinned: step 3', files: ['server/src/repositories/tag.repository.ts', 'server/src/services/tag.service.ts'] });
  });

  it('gives every finding a stable id, and the same findings in the same order on every run', async () => {
    expect(findings.every((finding) => /^F-[0-9a-f]{12}$/.test(finding.id))).toBe(true);
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(findings.length);
    const again = (await runFindings({ runDirectory: runDirectory(), gateway: null })).document.findings;
    expect(again).toEqual(findings);
  });

  it('writes findings.json, findings.md grouped by kind, and the PR body', () => {
    const document = JSON.parse(read(directory, 'findings/findings.json'));
    expect(document).toMatchObject({ format: 'ac-findings/1', narration: null, run: { base: repo.base, profile: 'fixture', packageRoot: 'server' } });
    const markdown = read(directory, 'findings/findings.md');
    expect(markdown).toContain('Recorded, never fixed.');
    expect(markdown.indexOf('## Module cycles (1)')).toBeLessThan(markdown.indexOf('## God injection (1)'));
    expect(markdown).toContain('### Table asset is written by 2 groups');
    const body = read(directory, 'findings/pr-body.md');
    expect(body).toContain('This PR moves 5 files of `server/src/` into 2 feature modules, in 2 commits.');
    expect(body).toContain('- **Files:** 5 moved; 14 import specifiers rewritten in 6 files (K2 of `certificate.json`, base..head); nothing else edited');
    expect(body).toContain('| R1 rung (`rungs/R1.json`) |');
    expect(body).toContain('| **Whole PR** (`certificate.json`) |');
    expect(body).toContain(`ac certify <checkout> ${repo.base.slice(0, 10)}..ffffffffff --profile fixture --oracles`);
    expect(body).toContain('### Findings: recorded, never fixed');
    expect(body).toContain('1. **4 groups form one import cycle**');
    expect(body).toContain('- external consumers\n- runtime fs contents');
    expect(body).toContain('Planner: deterministic facts'.replace('Planner: ', ''));
    expect(body).toContain('Nemotron 3 Ultra (medium_effort)');
    expect(body).toContain('The plan cost $0.1234 when it was recorded');
    expect(reportSectionOf(directory)).toContain(`${findings.length} findings, recorded and never fixed.`);
  });
});

describe('the PR body\'s edit counts', () => {
  it('sums the steps\' counts as edits, not files, when no certificate covers the whole range', async () => {
    const directory = runDirectory();
    const state = JSON.parse(read(directory, 'run.json'));
    delete state.certificate;
    state.rungs[1].certificate.partial = true;
    state.rungs[1].certificate.head = 'e'.repeat(40);
    fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify(state));
    await runFindings({ runDirectory: directory, gateway: null });
    expect(read(directory, 'findings/pr-body.md')).toContain('- **Files:** 5 moved; 15 import-specifier rewrites and 7 file edits summed over 2 steps (a file several steps edit counts once per step); nothing else edited');
  });
});

describe('runFindings with a boundary report (contract C8)', () => {
  const report: BoundaryReport = {
    version: 1, packageRoot: 'server', moduleRoot: 'src',
    folders: ['module/album', 'module/user', 'module/tag', 'shared'].map((key) => ({ key, path: key, files: 2 })),
    edges: [
      { from: 'module/album', to: 'module/user', files: 3, sample: [{ from: 'src/modules/album/album.service.ts', to: 'src/modules/user/user.service.ts' }] },
      { from: 'module/user', to: 'module/tag', files: 2, sample: [{ from: 'src/modules/user/user.service.ts', to: 'src/modules/tag/tag.service.ts' }] },
      { from: 'module/tag', to: 'module/album', files: 1, sample: [{ from: 'src/modules/tag/tag.service.ts', to: 'src/modules/album/album.service.ts' }] },
      { from: 'module/album', to: 'shared', files: 4, sample: [] },
    ],
    sccs: [['module/album', 'module/tag', 'module/user']],
    order: ['module/album', 'module/user', 'module/tag'],
    backEdges: [{ from: 'module/tag', to: 'module/album', files: 1, sample: [{ from: 'src/modules/tag/tag.service.ts', to: 'src/modules/album/album.service.ts' }] }],
    publicFiles: {}, rules: [], baseline: [], antiVacuity: [],
  };

  it('takes cycles and back-edges from the report instead of the plan graph', async () => {
    const { document } = await runFindings({ runDirectory: runDirectory({ boundaries: report, r4: 'certified' }), gateway: null });
    const [cycle, ...more] = ofKind(document.findings, 'module-cycle');
    expect(more).toEqual([]);
    expect(cycle).toMatchObject({ source: 'boundaries', title: '3 folders form one import cycle' });
    expect(cycle!.evidence).toContain("These 1 edges (1 files) close every cycle (R4's back-edges first)");
    expect(cycle!.evidence).toContain('- module/tag → module/album (1 files, e.g. server/src/modules/tag/tag.service.ts → server/src/modules/album/album.service.ts)');
    expect(ofKind(document.findings, 'back-edge').map((finding) => [finding.title, finding.files])).toEqual([['Back-edge module/tag → module/album', ['server/src/modules/album/album.service.ts', 'server/src/modules/tag/tag.service.ts']]]);
    expect(document.sources.map((source) => source.name)).not.toContain('plan-graph');
    expect(ofKind(document.findings, 'back-edge')[0]!.evidence).toContain("R4's baseline freezes it as a known violation");
    expect(ofKind(document.findings, 'old-path-in-comment')[0]!.certificates).toEqual(['rungs/R4.json']);
  });

  it('reads neither the report nor the certificate of an R4 whose commit the run reset', async () => {
    const directory = runDirectory({ boundaries: report, r4: 'failed' });
    expect(readRunData(directory).certificates.map((stored) => stored.file)).not.toContain('rungs/R4.json');
    const { document } = await runFindings({ runDirectory: directory, gateway: null });
    expect(ofKind(document.findings, 'back-edge')).toEqual([]);
    expect(ofKind(document.findings, 'module-cycle').map((finding) => finding.source)).toEqual(['plan-graph']);
    expect(ofKind(document.findings, 'old-path-in-comment')).toEqual([]);
    expect(read(directory, 'findings/findings.md')).not.toContain('freezes');
    expect(document.sources.find((source) => source.name === 'plan-graph')!.detail).toContain('R4 failed');
    const body = read(directory, 'findings/pr-body.md');
    expect(body).not.toContain('rungs/R4.json');
    expect(body).not.toContain('frozen baseline');
  });
});

describe('certificates of commits the run threw away', () => {
  it('leaves out the certificate of a step a K8 bisect rolled back and pinned', async () => {
    const directory = runDirectory();
    const state = JSON.parse(read(directory, 'run.json'));
    for (const field of ['commit', 'tree', 'parent', 'certificate', 'counts', 'pathMap']) delete state.steps[0][field];
    state.steps[0].status = 'pinned';
    fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify(state));
    expect(readRunData(directory).certificates.map((stored) => [stored.file, stored.step])).toEqual([
      ['certificates/002-R1-module-user.json', 2], ['rungs/R1.json', null], ['certificate.json', null],
    ]);
    const { document } = await runFindings({ runDirectory: directory, gateway: null });
    expect(ofKind(document.findings, 'old-path-in-docs')[0]!.steps).toEqual([2]);
    expect(ofKind(document.findings, 'default-root-dir')[0]!.steps).toEqual([2]);
  });
});

describe('narration', () => {
  it('adds guarded Lightning text to the top findings and changes nothing else', async () => {
    const plain = (await runFindings({ runDirectory: runDirectory(), gateway: null })).document.findings;
    const gateway = fakeGateway((title) => (title.startsWith('Table asset') ? 'Two groups write this table, per server/src/elsewhere.ts.' : 'This finding is recorded and stays as it was.'));
    const directory = runDirectory();
    const { document } = await runFindings({ runDirectory: directory, gateway, narration: { batchSize: 5 } });
    expect(document.findings.map(({ narration: _narration, ...rest }) => rest)).toEqual(plain.map(({ narration: _narration, ...rest }) => rest));
    const request = gateway.requests[0]!;
    expect(request).toMatchObject({ model: 'lightning', templateKwargs: { enable_thinking: false }, schemaName: 'findings_narration' });
    expect(request.maxTokens).toBe(64 + 120 * 5);
    expect(gateway.requests).toHaveLength(Math.ceil(document.findings.length / 5));
    const table = document.findings.find((finding) => finding.kind === 'multi-writer-table')!;
    expect(table.narration).toBeNull();
    expect(document.narration!.dropped).toContainEqual({ id: table.id, reason: 'names "server/src/elsewhere.ts", which the evidence doesn\'t contain' });
    expect(document.findings.filter((finding) => finding.narration)).toHaveLength(document.findings.length - 1);
    expect(document.narration).toMatchObject({ model: 'nvidia/Nemotron-3_5-Lightning', label: 'Nemotron 3.5 Lightning (thinking off)', replayed: true, narrated: document.findings.length - 1 });
    expect(read(directory, 'findings/pr-body.md')).toContain('1. **4 groups form one import cycle**: This finding is recorded and stays as it was.');
    expect(read(directory, 'findings/findings.md')).toContain('It checks words, not claims: a number or name from the evidence can still be put to the wrong use.');
  });

  it('stops at a failed call and keeps every finding\'s evidence', async () => {
    const failing: Gateway = { structured: async () => { throw new Error('replay miss: no lightning record'); }, spent: () => ({ run: 0, global: 0 }) };
    const { document } = await runFindings({ runDirectory: runDirectory(), gateway: failing });
    expect(document.narration).toMatchObject({ calls: 0, narrated: 0, replayed: false, error: 'replay miss: no lightning record' });
    expect(document.findings.every((finding) => finding.narration === null && finding.evidence.length > 0)).toBe(true);
  });
});

describe('without the target', () => {
  it('still records the certificates\' and the run\'s findings, and says why the code findings are missing', async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-findings-empty-'));
    cleanup.push(elsewhere);
    const { document } = await runFindings({ runDirectory: runDirectory(), repo: elsewhere, gateway: null });
    expect(document.sources.find((source) => source.name === 'target')!.detail).toMatch(/^not read \(/);
    expect(new Set(document.findings.map((finding) => finding.source))).toEqual(new Set(['certificate', 'run']));
  });
});

describe('ac findings', () => {
  it('writes the log and re-renders report.md with its findings section', async () => {
    const directory = runDirectory();
    const logged: string[] = [];
    const original = console.log;
    console.log = (line: string) => void logged.push(line);
    try {
      expect(await findingsCommand(directory, { 'no-narration': true })).toBe(0);
    } finally {
      console.log = original;
    }
    const report = read(directory, 'report.md');
    expect(report).toContain('## Findings');
    expect(report).toContain('findings, recorded and never fixed. Full log: `findings/findings.md`');
    expect(logged[0]).toMatch(/^\d+ findings → /);
    expect(await findingsCommand(directory, { 'no-narration': false, mode: 'record' })).toBe(2);
  });
});

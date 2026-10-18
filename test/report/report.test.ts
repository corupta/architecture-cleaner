import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareOutput, reportMarker, writeReport } from '../../src/report/bundle.js';
import { reportCommand } from '../../src/report/command.js';
import type { GraphSide, RunGraph } from '../../src/report/graph.js';
import { graphNarrative, narrationOutcome, noFailureSentence, planMaking, type NarrativeFacts } from '../../src/report/render.js';
import type { PlanSummary } from '../../src/report/run-data.js';
import type { RunState } from '../../src/orchestrator/types.js';
import { makeRunFixture, pageText } from './fixture.js';

const packageDirectory = path.resolve(import.meta.dirname, '..', '..');
const temporary = (label: string) => fs.mkdtempSync(path.join(os.tmpdir(), `ac-report-${label}-`));

/** Every file under a directory with the sha256 of its bytes, for byte-for-byte comparisons. */
function snapshot(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (relative: string) => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else files.set(child, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, child))).digest('hex'));
    }
  };
  walk('');
  return files;
}

/** The page is self-contained and its tags balance. */
function expectWellFormed(html: string) {
  expect(html.startsWith('<!doctype html>')).toBe(true);
  expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|<img[^>]+src="https?:|@import|\bfetch\(|XMLHttpRequest/);
  for (const tag of ['details', 'table', 'svg', 'section', 'figure', 'pre']) {
    expect(html.split(`<${tag}`).length, tag).toBe(html.split(`</${tag}>`).length);
  }
}

describe('ac report on a run with a failed attempt', () => {
  it('computes graph.json from the reachable repo, copies every linked certificate and shows the rollback', () => {
    const fixture = makeRunFixture();
    const out = path.join(temporary('fixture'), 'bundle');
    const result = writeReport({ runDirectory: fixture.directory, out, packageDirectory });
    expect(result.graph).toBe('computed');
    expect(fs.existsSync(path.join(fixture.directory, 'graph.json'))).toBe(true);
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    expectWellFormed(html);
    expect(html).toContain('Failed attempts and rollbacks (1)');
    expect(html).toContain('failed, rolled back');
    expect(html).toContain('injected fault');
    expect(html).toContain('Pinned by this failure: <code>src/services/order.service.ts</code>');
    expect(html).toContain('href="certificates/failed/002-R1-module-order-attempt1.json"');
    expect(html).toContain('rungs/failed/R1.json');
    expect(html).toContain('⚠ users');
    expect(html).toContain('Two groups write the users table &lt;on purpose&gt;.');
    expect(html).toContain('Files flow: where the 6 source files under src/ went');
    for (const file of result.files) expect(fs.existsSync(path.join(out, file)), file).toBe(true);
    for (const href of [...html.matchAll(/href="([^"#]+)"/g)].map((match) => match[1]!)) {
      expect(fs.existsSync(path.join(out, href)), href).toBe(true);
    }
    // Same inputs, same bytes: a second build into another directory.
    const again = path.join(temporary('fixture-again'), 'bundle');
    writeReport({ runDirectory: fixture.directory, out: again, packageDirectory });
    expect(snapshot(again)).toEqual(snapshot(out));
  });

  it('renders without a module graph when graph.json is missing and only stored graphs may be read', () => {
    const fixture = makeRunFixture();
    const result = writeReport({ runDirectory: fixture.directory, out: path.join(temporary('nograph'), 'bundle'), packageDirectory, storedGraphOnly: true });
    expect(result.graph).toBe('missing');
    expect(fs.readFileSync(path.join(result.out, 'index.html'), 'utf8')).toContain('No graph.json in the run dir.');
  });

  it('renders a stopped run: a partial rung, no whole-PR certificate, steps that never ran', () => {
    const fixture = makeRunFixture();
    const { certificate: _whole, ...rest } = fixture.state;
    const state: RunState = {
      ...rest,
      status: 'stopped',
      rungs: rest.rungs.map((rung) => (rung.id === 'R1' ? { ...rung, status: 'running', certificate: { ...rung.certificate!, partial: true } } : rung)),
      steps: [...rest.steps, { index: 5, rung: 'R2', group: 'platform/database', moves: { 'src/db.ts': 'src/platform/database/db.ts' }, entries: [['src/db.ts']], status: 'pending', round: 1, attempts: [], durationMs: 0 }],
    };
    fs.writeFileSync(path.join(fixture.directory, 'run.json'), JSON.stringify(state));
    for (const file of ['certificate.json', 'certificate.txt']) fs.rmSync(path.join(fixture.directory, file));
    const result = writeReport({ runDirectory: fixture.directory, out: path.join(temporary('stopped'), 'bundle'), packageDirectory });
    const html = fs.readFileSync(path.join(result.out, 'index.html'), 'utf8');
    expectWellFormed(html);
    expect(html).toContain('no whole-PR certificate');
    expect(html).toContain('run status stopped: the run ended before its whole-PR certificate');
    expect(html).toContain('<span class="pill">partial</span>');
    expect(html).toContain('1 step never ran (run status: stopped).');
    expect(html).toContain('No whole-PR certificate.');
    const text = pageText(html);
    // The ladder's opening says what this run's certificates cover, not what a finished run's would.
    expect(text).toContain('One transformation per commit: each of the 3 committed steps was certified against its parent before the next one started, with the static checks (K0, K1, K2, K3a, K3b, K3c, K4, K6, K7).');
    expect(text).toContain('The rung certificates of R1 (partial: the run stopped inside the rung), R3, R4 add the oracles');
    expect(text).toContain('There is no whole-PR certificate (run status: stopped).');
    expect(text).not.toContain('each rung and the whole PR are then certified with the oracles');
  });

  it('counts a declined attempt as failed, says nothing committed, and never claims a first-try run with failures', () => {
    const fixture = makeRunFixture();
    const state = structuredClone(fixture.state);
    const step1 = state.steps[0]!;
    step1.attempts.unshift({ ...step1.attempts[0]!, attempt: 1, state: 'declined', commit: undefined, certificate: undefined, detail: 'executor declined: a same-stem pair' });
    step1.attempts[1]!.attempt = 2;
    fs.writeFileSync(path.join(fixture.directory, 'run.json'), JSON.stringify(state));
    const text = pageText(fs.readFileSync(path.join(writeReport({ runDirectory: fixture.directory, out: path.join(temporary('declined'), 'bundle'), packageDirectory }).out, 'index.html'), 'utf8'));
    expect(text).toContain('Failed attempts and rollbacks (2)');
    expect(text).toContain('2 attempts failed (1 certified FAIL and rolled back, 1 declined by the executor). A commit that fails its certificate is rolled back. An attempt declined commits nothing.');
    expect(text).toContain('The step then replanned without 1 pinned file: attempt 2 passed.');
    expect(text).toContain('The step then replanned: attempt 2 passed.');
    expect(text).not.toContain('No attempt failed');
  });

  it('replaces an earlier bundle but refuses a directory it did not make', () => {
    const parent = temporary('output');
    const foreign = path.join(parent, 'foreign');
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, 'notes.txt'), 'keep me');
    expect(() => prepareOutput(foreign, [reportMarker])).toThrow(/not empty/);
    expect(fs.readFileSync(path.join(foreign, 'notes.txt'), 'utf8')).toBe('keep me');
    const earlier = path.join(parent, 'earlier');
    fs.mkdirSync(earlier);
    fs.writeFileSync(path.join(earlier, reportMarker), '');
    fs.writeFileSync(path.join(earlier, 'stale.html'), '');
    prepareOutput(earlier, [reportMarker]);
    expect(fs.readdirSync(earlier)).toEqual([]);
  });

  it('answers usage errors with exit 2', async () => {
    expect(await reportCommand([])).toBe(2);
    expect(await reportCommand(['runs/immich-ladder'])).toBe(2);
    expect(await reportCommand(['runs/immich-ladder', '--out', '/tmp/x', '--unknown'])).toBe(2);
  });
});

describe('ac report on the committed immich run', () => {
  it('builds offline from the run dir (graph.json stored), every step and certificate in a light bundle', () => {
    const out = path.join(temporary('immich'), 'bundle');
    const result = writeReport({ runDirectory: path.join(packageDirectory, 'runs', 'immich-ladder'), out, packageDirectory, storedGraphOnly: true });
    expect(result.graph).toBe('stored');
    expect(result.bytes).toBeLessThan(3_000_000);
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    expectWellFormed(html);
    expect(html.match(/class="step-block"/g)).toHaveLength(63);
    expect(html).toContain('Whole PR: <span class="status status-pass">');
    expect(html).toContain('sha256:9a5b2404631c2ac668462ad93fcbcd116637244e2b4f76e987bcc4e23e8be2b5');
    const text = pageText(html);
    expect(text).toContain('No attempt failed: each of the 63 certified steps passed its certificate on its first attempt.');
    expect(text).toContain('each of the 62 committed steps was certified against its parent before the next one started, with the static checks (K0, K1, K2, K3a, K3b, K3c, K4, K6, K7).');
    expect(text).toContain('Step 63 (R4) is certified with the oracles, by its rung certificate.');
    expect(text).toContain('The rung certificates of R1, R2, R3, R4 and the whole-PR certificate add the oracles (K8: tsc, unit, openapi).');
    expect(text).toContain("R4's rules freeze today's violations so they can't grow.");
    expect(text).toContain('35 findings narrated; 4 narrations dropped by the lexical guard (a narration may only restate its evidence), 1 finding with no narration returned by the model.');
    expect(text).toContain('NVIDIA Nemotron 3 Ultra (on Nebius Token Factory) edited the draft in 3 candidates, and a critic call reviewed the chosen one');
    expect(html).toContain('opencode + Nemotron 3 Super, single-shot');
    expect(html).toContain('Before: 14 folders at 02063972e8');
    expect(html).toContain('After: 70 folders at c4be040b57');
    expect(fs.existsSync(path.join(out, 'certificates', '062-R3-shared-shared.json'))).toBe(true);
    const again = path.join(temporary('immich-again'), 'bundle');
    writeReport({ runDirectory: path.join(packageDirectory, 'runs', 'immich-ladder'), out: again, packageDirectory, storedGraphOnly: true });
    expect(fs.readFileSync(path.join(again, 'index.html')).equals(fs.readFileSync(path.join(out, 'index.html')))).toBe(true);
  });
});

describe('ac report on the committed fault run (stopped after R1 step 3)', () => {
  it('says only what the run reached: no R4, no whole-PR oracles, three modules at head', () => {
    const out = path.join(temporary('fault'), 'bundle');
    const result = writeReport({ runDirectory: path.join(packageDirectory, 'runs', 'immich-fault'), out, packageDirectory, storedGraphOnly: true });
    expect(result.graph).toBe('stored');
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    expectWellFormed(html);
    const text = pageText(html);
    expect(text).not.toContain("R4's rules freeze");
    expect(text).not.toContain('feature modules, platform folders and shared/');
    expect(text).not.toContain('each rung and the whole PR are then certified with the oracles');
    expect(text).toContain('at the head commit 18 sit in 3 feature modules and 545 are still in 14 folders outside the layout.');
    expect(text).toContain('R4 was not part of this run, so no boundary rules hold them yet.');
    expect(text).toContain('The rung certificate of R1 (partial: the run stopped inside the rung) adds the oracles (K8: tsc, unit, openapi).');
    expect(text).toContain('There is no whole-PR certificate (run status: stopped).');
    expect(text).toContain('1 attempt failed (certified FAIL and rolled back). A commit that fails its certificate is rolled back. They are recorded');
    expect(text).toContain('The step then replanned without 1 pinned file: attempt 2 passed.');
    expect(text).toContain('56 steps never ran (run status: stopped).');
    expect(text).toContain('Replaying the plan from the committed cassettes costs $0.');
    expect(text).toContain('plan.yaml marks 8 placements by the planner and 2 by the critic. This run dir has no plan.json');
    expect(text).not.toContain('edits the draft and a critic call reviews it');
  });
});

describe('the graph prose', () => {
  const side = (internalPairs: number, crossPairs: number, folders: GraphSide['folders'] = [{ key: 'src/services/', kind: 'folder', files: 3, productionFiles: 3, internalPairs }]): GraphSide => ({
    commit: 'c', tree: 't', edges: [], cycles: [], internalPairs, crossPairs, folders,
  });
  const graph = (base: GraphSide, head: GraphSide, flow: RunGraph['flow'] = []): RunGraph => ({ format: 'ac-graph/1', origin: null, packageRoot: '', moduleRoot: 'src', base, head, flow, unmatched: [], source: { analyzer: 'a', typescript: '6' } });
  const finished: NarrativeFacts = { r4: 'certified', godInjections: 1, moduleCycles: 2 };

  it('says what the numbers say: a fall, a rise, totals that differ', () => {
    const fall = graphNarrative(graph(side(479, 1572), side(421, 1630)), finished);
    expect(fall).toContain('The file-level import pairs are the same 2,051 on both sides');
    expect(fall).toContain('falls: 479 of 2,051 (23.4%) at base, 421 of 2,051 (20.5%) at head');
    expect(fall).toContain('makes them visible');
    expect(fall).toContain('The findings below name what ties the modules together (1 god-injection base class and 2 module cycles).');
    expect(fall).toContain("R4's rules freeze today's violations so they can't grow.");
    const rise = graphNarrative(graph(side(10, 90), side(60, 40)), finished);
    expect(rise).toContain('rises: 10 of 100 (10.0%) at base, 60 of 100 (60.0%) at head');
    expect(rise).toContain('More of the imports now stay inside one folder.');
    expect(graphNarrative(graph(side(10, 90), side(10, 91)), finished)).toContain('There are 100 file-level import pairs at base and 101 at head');
  });

  it('names only the layout kinds the head has, and R4 only when it is certified', () => {
    const base = side(10, 90, [{ key: 'src/services/', kind: 'folder', files: 4, productionFiles: 4, internalPairs: 10 }, { key: 'src/controllers/', kind: 'folder', files: 3, productionFiles: 3, internalPairs: 0 }]);
    const flow = [{ from: 'src/services/', to: 'module/user', files: 2 }, { from: 'src/services/', to: 'src/services/', files: 2 }, { from: 'src/controllers/', to: 'src/controllers/', files: 3 }];
    const partialHead = side(8, 92, [
      { key: 'module/user', kind: 'module', files: 2, productionFiles: 2, internalPairs: 1 },
      { key: 'src/services/', kind: 'folder', files: 2, productionFiles: 2, internalPairs: 7 },
      { key: 'src/controllers/', kind: 'folder', files: 3, productionFiles: 3, internalPairs: 0 },
    ]);
    const stopped = graphNarrative(graph(base, partialHead, flow), { r4: 'not-requested', godInjections: 0, moduleCycles: 0 });
    expect(stopped).toContain('At the base commit the 7 source files under src/ sit in 2 folders outside the layout; at the head commit 2 sit in 1 feature module and 5 are still in 2 folders outside the layout.');
    expect(stopped).not.toContain('platform');
    expect(stopped).not.toContain('shared/');
    expect(stopped).not.toContain('The findings below');
    expect(stopped).toContain('R4 was not part of this run, so no boundary rules hold them yet.');
    expect(graphNarrative(graph(base, partialHead, flow), { r4: 'failed', godInjections: 0, moduleCycles: 0 })).toContain('R4 ended failed, so no boundary rules hold them yet.');

    const fullHead = side(8, 92, [
      { key: 'module/user', kind: 'module', files: 2, productionFiles: 2, internalPairs: 1 },
      { key: 'platform/database', kind: 'platform', files: 2, productionFiles: 2, internalPairs: 7 },
      { key: 'shared', kind: 'shared', files: 3, productionFiles: 3, internalPairs: 0 },
    ]);
    const done = [{ from: 'src/services/', to: 'module/user', files: 2 }, { from: 'src/services/', to: 'platform/database', files: 2 }, { from: 'src/controllers/', to: 'shared', files: 3 }];
    expect(graphNarrative(graph(base, fullHead, done), finished)).toContain('at the head commit all sit in the layout: 2 in 1 feature module, 2 in 1 platform folder and 3 in shared/.');
  });
});

describe('the ladder and plan prose', () => {
  it('qualifies "no attempt failed" by what the steps did', () => {
    const fixture = makeRunFixture();
    const state: RunState = structuredClone(fixture.state);
    state.steps[1]!.attempts.shift();
    expect(noFailureSentence(state)).toBe('No attempt failed: each of the 4 certified steps passed its certificate on its first attempt.');
    state.steps[0]!.attempts.unshift({ ...state.steps[0]!.attempts[0]!, state: 'interrupted' });
    state.steps.push({ ...state.steps[2]!, index: 5, status: 'pinned', attempts: [] });
    expect(noFailureSentence(state)).toBe('No attempt failed: each of the 4 certified steps passed its certificate on its first attempt (1 step after an interrupted attempt that --resume discarded). 1 step was pinned and left in place.');
    expect(noFailureSentence({ ...state, steps: state.steps.map((step) => ({ ...step, status: 'pending' as const, attempts: [] })) })).toBe('No attempt failed: no step was certified.');
  });

  it('names who made the plan from plan.json, not from what a full run would have', () => {
    const plan: PlanSummary = { groups: { module: 1, platform: 0, shared: 0 }, files: 2, bySource: { draft: 2 }, contested: 0, decisions: [], editors: [], critic: false, criticReview: null, winner: 'seeds draft', recordedCostUsd: 0 };
    expect(planMaking(plan)).toBe('Deterministic seeds decided where files go, and no model edited the draft.');
    expect(planMaking({ ...plan, editors: null, critic: null, bySource: { draft: 259, planner: 8, critic: 2 } })).toBe("Deterministic seeds decided where files go; plan.yaml marks 8 placements by the planner and 2 by the critic. This run dir has no plan.json, so the report can't name the models that made the plan.");
    expect(planMaking({ ...plan, editors: ['ultra#1', 'ultra#2'], critic: true })).toBe('Deterministic seeds decided where files go; NVIDIA Nemotron 3 Ultra (on Nebius Token Factory) edited the draft in 2 candidates, and a critic call reviewed the chosen one; the validator gates both.');
  });

  it('tells a guard drop from a narration the model never returned', () => {
    expect(narrationOutcome({ narrated: 3, dropped: [{ reason: 'names "relocated", which the evidence doesn\'t contain' }, { reason: 'no narration returned' }, { reason: 'no narration returned (length)' }] }))
      .toBe('3 findings narrated; 1 narration dropped by the lexical guard (a narration may only restate its evidence), 2 findings with no narration returned by the model');
    expect(narrationOutcome({ narrated: 1, dropped: [] })).toBe('1 finding narrated');
  });
});

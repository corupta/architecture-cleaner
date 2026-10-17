import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareOutput, reportMarker, writeReport } from '../../src/report/bundle.js';
import { reportCommand } from '../../src/report/command.js';
import type { GraphSide, RunGraph } from '../../src/report/graph.js';
import { graphNarrative } from '../../src/report/render.js';
import type { RunState } from '../../src/orchestrator/types.js';
import { makeRunFixture } from './fixture.js';

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
    expect(html).toContain('1 step never ran (the run stopped first).');
    expect(html).toContain('No whole-PR certificate.');
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
    expect(html).toContain('No attempt failed');
    expect(html).toContain('opencode + Nemotron 3 Super, single-shot');
    expect(html).toContain('Before: 14 folders at 02063972e8');
    expect(html).toContain('After: 70 folders at c4be040b57');
    expect(fs.existsSync(path.join(out, 'certificates', '062-R3-shared-shared.json'))).toBe(true);
    const again = path.join(temporary('immich-again'), 'bundle');
    writeReport({ runDirectory: path.join(packageDirectory, 'runs', 'immich-ladder'), out: again, packageDirectory, storedGraphOnly: true });
    expect(fs.readFileSync(path.join(again, 'index.html')).equals(fs.readFileSync(path.join(out, 'index.html')))).toBe(true);
  });
});

describe('the graph prose', () => {
  const side = (internalPairs: number, crossPairs: number): GraphSide => ({
    commit: 'c', tree: 't', edges: [], cycles: [], internalPairs, crossPairs,
    folders: [{ key: 'src/services/', kind: 'folder', files: 3, productionFiles: 3, internalPairs }],
  });
  const graph = (base: GraphSide, head: GraphSide): RunGraph => ({ format: 'ac-graph/1', origin: null, packageRoot: '', moduleRoot: 'src', base, head, flow: [], unmatched: [], source: { analyzer: 'a', typescript: '6' } });

  it('says what the numbers say: a fall, a rise, totals that differ', () => {
    const fall = graphNarrative(graph(side(479, 1572), side(421, 1630)));
    expect(fall).toContain('The file-level import pairs are the same 2,051 on both sides');
    expect(fall).toContain('falls: 479 of 2,051 (23.4%) at base, 421 of 2,051 (20.5%) at head');
    expect(fall).toContain("makes them visible");
    const rise = graphNarrative(graph(side(10, 90), side(60, 40)));
    expect(rise).toContain('rises: 10 of 100 (10.0%) at base, 60 of 100 (60.0%) at head');
    expect(rise).toContain('More of the imports now stay inside one folder.');
    expect(graphNarrative(graph(side(10, 90), side(10, 91)))).toContain('There are 100 file-level import pairs at base and 101 at head');
  });
});

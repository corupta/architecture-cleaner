import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BenchResult } from '../../src/bench/types.js';
import { benchOverview, plannerScore, readBenchResults, renderBenchBody } from '../../src/site/bench.js';
import { buildSite, committedRuns, siteMarker } from '../../src/site/build.js';
import { siteCommand } from '../../src/site/command.js';
import { pitchLine } from '../../src/site/pages.js';
import { benchResultFixture, makePackageFixture } from '../report/fixture.js';

const packageDirectory = path.resolve(import.meta.dirname, '..', '..');
const temporary = (label: string) => fs.mkdtempSync(path.join(os.tmpdir(), `ac-site-${label}-`));

function filesUnder(root: string, relative = ''): string[] {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(root, child) : [child];
  }).sort();
}

/** Every relative link of every page resolves to a file of the build; nothing points outside it but https links. */
function expectLinksResolve(out: string) {
  for (const page of filesUnder(out).filter((file) => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(out, page), 'utf8');
    for (const href of [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!)) {
      if (href.startsWith('#') || href.startsWith('https://')) continue;
      expect(href.startsWith('/') || href.startsWith('http:'), `${page}: ${href}`).toBe(false);
      const target = path.join(out, path.dirname(page), href.split('#')[0]!);
      expect(fs.existsSync(target) && fs.statSync(target).isFile(), `${page}: ${href}`).toBe(true);
    }
  }
}

/** File → sha256 of its bytes (comparing hashes keeps the equality check fast on megabytes). */
const snapshot = (root: string) => new Map(filesUnder(root).map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));

describe('ac site on a package with one run, the A/B and bench results', () => {
  it('builds every page with relative links that resolve, and the same bytes twice', () => {
    const { root, run } = makePackageFixture({ bench: true });
    const out = path.join(temporary('fixture'), '_site');
    const messages: string[] = [];
    const result = buildSite({ packageDirectory: root, out, sourceUrl: 'https://github.com/example/architecture-cleaner', log: (message) => messages.push(message) });
    expect(result.runs).toEqual([{ name: 'shop-fault', graph: 'missing' }]);
    expect(messages.join('\n')).toContain('runs/shop-fault: no graph.json');
    // The site reads committed files only: it never derives graph.json, even though the run's repo is reachable.
    expect(fs.existsSync(path.join(root, 'runs', 'shop-fault', 'graph.json'))).toBe(false);
    expect(fs.existsSync(path.join(run.directory, 'graph.json'))).toBe(false);
    for (const file of ['.nojekyll', siteMarker, 'index.html', 'ab/index.html', 'ab/certificates/agent.full.json', 'bench/index.html', 'bench/results/shop.json', 'bench/results/summary.md', 'verify/index.html', 'runs/shop-fault/index.html', 'runs/shop-fault/certificates/failed/002-R1-module-order-attempt1.json']) {
      expect(result.files, file).toContain(file);
    }
    expectLinksResolve(out);

    const landing = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(landing).toContain(pitchLine);
    expect(landing).toContain('href="runs/shop-fault/index.html"');
    expect(landing).toContain('1 attempt failed and rolled back, 1 files pinned');
    expect(landing).toContain('href="https://github.com/example/architecture-cleaner"');
    const ab = fs.readFileSync(path.join(out, 'ab', 'index.html'), 'utf8');
    expect(ab).toContain('href="../runs/shop-fault/certificate.json"');
    expect(ab).toContain('href="certificates/agent.full.json"');
    expect(ab).toContain('href="../runs/shop-fault/index.html"');
    expect(ab).toContain('not checked: K7 came after this certificate (S6)');
    const runPage = fs.readFileSync(path.join(out, 'runs', 'shop-fault', 'index.html'), 'utf8');
    expect(runPage).toContain('href="../../index.html"');
    expect(runPage).toContain('href="../../ab/certificates/agent.full.json"');
    const verify = fs.readFileSync(path.join(out, 'verify', 'index.html'), 'utf8');
    expect(verify).toContain('npx ac demo --replay');
    expect(verify).toContain('git clone https://github.com/example/architecture-cleaner architecture-cleaner');

    const again = path.join(temporary('fixture-again'), '_site');
    buildSite({ packageDirectory: root, out: again, sourceUrl: 'https://github.com/example/architecture-cleaner' });
    expect(snapshot(again)).toEqual(snapshot(out));
    // A rebuild into the same directory replaces the earlier build.
    buildSite({ packageDirectory: root, out, sourceUrl: 'https://github.com/example/architecture-cleaner' });
    expect(snapshot(out)).toEqual(snapshot(again));
  });

  it('says "not recorded yet" when there are no bench results', () => {
    const { root } = makePackageFixture();
    const out = path.join(temporary('nobench'), '_site');
    buildSite({ packageDirectory: root, out });
    expect(fs.readFileSync(path.join(out, 'bench', 'index.html'), 'utf8')).toContain('Not recorded yet.');
    expect(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).toContain('(not recorded yet)');
    expect(fs.existsSync(path.join(out, 'bench', 'results'))).toBe(false);
  });

  it('answers usage errors with exit 2', async () => {
    expect(await siteCommand([])).toBe(2);
    expect(await siteCommand(['--out'])).toBe(2);
    expect(await siteCommand(['positional', '--out', '/tmp/x'])).toBe(2);
  });
});

describe('the benchmarks page', () => {
  it('reads results, picks the planner\'s best row and shows the planner against the best deterministic method', () => {
    const directory = temporary('results');
    fs.writeFileSync(path.join(directory, 'shop.json'), JSON.stringify(benchResultFixture()));
    const results = readBenchResults(directory);
    expect(results.map((result) => result.entry)).toEqual(['shop']);
    expect(plannerScore(results[0]!)?.method).toBe('planner (Ultra)');
    expect(benchOverview(results)).toEqual([{ entry: 'shop', kind: 'scramble', metric: 'MoJoFM', best: { method: 'name-token (anchored)', value: 81.5 }, draft: 80, planner: 78.25 }]);
    const body = renderBenchBody(results);
    expect(body).toContain('<td class="num">-3.25</td>');
    expect(body).toContain('The planner loses to name-token here by 3.25 MoJoFM.');
    expect(readBenchResults(path.join(directory, 'missing'))).toEqual([]);
  });

  it('scores real targets by TurboMQ, without ground truth, and tolerates a missing planner', () => {
    const real = { ...benchResultFixture(), entry: 'immich', kind: 'real', scramble: null, featureFiles: null, groundTruthModules: null, hardFiles: null, leakyFiles: null, planner: null, louvainMojoFmByResolution: null,
      methods: benchResultFixture().methods.filter((method) => method.kind !== 'planner').map((method) => ({ ...method, mojoFm: null, ari: null, c2cCvg: null, clusterCountRatio: null, mojoFmHard: null })),
      bestBaseline: { method: 'B0 type folders', mojoFm: null, turboMq: 2.5 } } as unknown as BenchResult;
    expect(benchOverview([real])).toEqual([{ entry: 'immich', kind: 'real', metric: 'TurboMQ', best: { method: 'B0 type folders', value: 2.5 }, draft: 2, planner: null }]);
    const body = renderBenchBody([real]);
    expect(body).toContain('no ground truth');
    expect(body).toContain('Planner: not recorded yet.');
  });

  it('refuses a results file of another format', () => {
    const directory = temporary('format');
    fs.writeFileSync(path.join(directory, 'x.json'), JSON.stringify({ format: 'other' }));
    expect(() => readBenchResults(directory)).toThrow(/unknown format/);
  });
});

describe('ac site on this package', () => {
  it('builds offline from the committed artifacts, twice the same', () => {
    expect(committedRuns(packageDirectory)).toContain('immich-ladder');
    const out = path.join(temporary('package'), '_site');
    const result = buildSite({ packageDirectory, out });
    expect(result.runs.find((run) => run.name === 'immich-ladder')?.graph).toBe('stored');
    expect(result.bytes).toBeLessThan(20_000_000);
    expectLinksResolve(out);
    const ab = fs.readFileSync(path.join(out, 'ab', 'index.html'), 'utf8');
    expect(ab).toContain('mcphub @ 70cf036c90');
    expect(ab).toContain('href="../runs/immich-ladder/certificate.json"');
    const again = path.join(temporary('package-again'), '_site');
    buildSite({ packageDirectory, out: again });
    expect(snapshot(again)).toEqual(snapshot(out));
  });
});

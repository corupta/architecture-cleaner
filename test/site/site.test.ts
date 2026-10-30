import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BenchKeyScore, BenchPartialKey, BenchRepeats, BenchResult, BenchRunMeasures, MethodScore } from '../../src/bench/types.js';
import { benchOverview, plannerRejection, plannerScore, plannerTally, readBenchResults, renderBenchBody, scrambleCertificatesLine } from '../../src/site/bench.js';
import { buildSite, committedRuns, siteMarker } from '../../src/site/build.js';
import { siteCommand } from '../../src/site/command.js';
import { pitchLine } from '../../src/site/pages.js';
import { readSuperVlExperiment, renderSuperVlSection, superVlDirectory } from '../../src/site/super-vl.js';
import { benchResultFixture, makePackageFixture, pageText } from '../report/fixture.js';

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
    const landingText = pageText(landing);
    expect(landingText).toContain('1 attempt failed (certified FAIL and rolled back), 1 file pinned');
    // Each commit gets the static checks; the oracles come with the rung and whole-PR certificates, and the card says which.
    expect(landingText).toContain('A separate checker certifies each commit with the static checks');
    expect(landingText).not.toContain('and the tests, the type check and the OpenAPI spec come out the same');
    expect(landingText).toContain('3 step certificates with the static checks; step 4 (R4), 3 rung certificates, the whole PR with the oracles');
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
    // S8's demo: the work dir is <tmp>/ac-demo from a clone, and --env compares every digest; S7's status-only fallback is gone.
    const verifyText = pageText(verify);
    expect(verifyText).toContain('It works in /tmp/ac-demo/ (your system\'s temporary directory)');
    expect(verifyText).toContain('each check\'s content and each certificate\'s digest are compared with the recording, byte for byte');
    expect(verifyText).toContain('No --work is needed.');
    for (const stale of ['statuses only', 'outside this clone', '--work <']) expect(verifyText).not.toContain(stale);

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

const fixture = () => benchResultFixture() as unknown as BenchResult;
/** The fixture with its planner row changed. */
const withPlanner = (result: BenchResult, change: Partial<MethodScore>) => ({ ...result, methods: result.methods.map((method) => (method.kind === 'planner' ? { ...method, ...change } : method)) }) as BenchResult;

/**
 * The fixture as a real entry scored over a partial key (`file`): its rows keep null ground-truth scores, the key has
 * them. 4 scored files of 40 in 2 features (2 in services/, 1 each in dtos/ and utils/), 1 hard.
 */
function keyed(file = 'bench/ground-truth/immich-2024.rsf'): BenchResult {
  const base = fixture();
  const keyScore = (method: string, mojoFm: number): BenchKeyScore => ({ method, mojoFm, ari: mojoFm / 100, c2cCvg: 0.5, clusterCountRatio: 1, mojoFmHard: null });
  const partialKey: BenchPartialKey = {
    file, sha256: 'a'.repeat(64), source: "immich's 2024 domain layer", labeled: 4, scoredFiles: 4, features: 2, share: 0.1, hardFiles: ['src/utils/x.ts'], notMovable: [],
    truth: { 'src/dtos/a.dto.ts': 'a', 'src/services/a.service.ts': 'a', 'src/services/b.service.ts': 'b', 'src/utils/x.ts': 'b' },
    methods: [keyScore('B0 type folders', 20), keyScore('name-token (anchored)', 90), keyScore('seeds draft', 85), keyScore('planner (Ultra)', 88)],
    louvainSeeds: { 4: [61, 62, 63, 64, 65].map((mojoFm, seed) => keyScore(`Louvain r=4 seed ${seed + 1}`, mojoFm)) },
    bestBaseline: { method: 'name-token (anchored)', mojoFm: 90 },
  };
  return {
    ...base, entry: 'immich', kind: 'real', scramble: null, featureFiles: null, groundTruthModules: null, hardFiles: null, leakyFiles: null, louvainMojoFmByResolution: null,
    methods: base.methods.map((method) => ({ ...method, mojoFm: null, ari: null, c2cCvg: null, clusterCountRatio: null, mojoFmHard: null })),
    bestBaseline: { method: 'B0 type folders', mojoFm: null, turboMq: 2.5 }, partialKey,
  };
}

/** The entry block of `entry` in a rendered body. */
const entryBlockOf = (body: string, entry: string) => body.slice(body.indexOf(`<h3 id="entry-${entry}"`)).split('<h3')[1]!;

describe('the benchmarks page', () => {
  it('says what the certifier said about each scramble, and how the planner did on MoJoFM and on TurboMQ, from the results', () => {
    const pass = fixture();
    const fail = { ...pass, entry: 'kaneo', scramble: { ...pass.scramble!, certificate: { verdict: 'fail', scope: 'static', digest: 'sha256:d', failing: ['K3c', 'K4'] } } } as BenchResult;
    const unchecked = { ...pass, entry: 'other', scramble: { ...pass.scramble!, certificate: null } } as BenchResult;
    expect(scrambleCertificatesLine([pass, fail, unchecked])).toBe('Each scramble is one commit by our own executor, then checked by our own certifier as a pure move: shop passes (static checks); kaneo (failing K3c, K4) fails (static checks); other was not certified in this run. Each entry below shows its verdict; a scramble is scored whatever its verdict, since the ground truth is its original folders.');
    const body = pageText(renderBenchBody([pass, fail]));
    expect(body).not.toContain('a certified move');
    expect(body).toContain('kaneo (failing K3c, K4) fails (static checks)');
    // Each measure has its own best: name-token on MoJoFM (81.5), B0 type folders on TurboMQ (2.5, its 5 clusters).
    expect(plannerTally(benchOverview([pass, withPlanner(fail, { mojoFm: 90 })])))
      .toBe('In these results the planner beats the best deterministic method on MoJoFM on 1 of 2 entries (kaneo), and loses on 1 (shop); on TurboMQ it beats it on 0 of 2 entries, and loses on 2 (shop and kaneo). Each measure has its own best deterministic method.');
    expect(plannerTally(benchOverview([withPlanner(pass, { mojoFm: 81.5, turboMq: { sum: 3, mean: 0.1 } })])))
      .toBe('In these results the planner beats the best deterministic method on MoJoFM on 0 of 1 entries, ties it on 1 (shop); on TurboMQ it beats it on 1 of 1 entries (shop). Each measure has its own best deterministic method.');
  });

  it('says which plans the validator rejects and why, and doesn\'t count a rejected plan as a win without saying so', () => {
    /** `entry` with the planner at `mojoFm`, its plan rejected for `reason` as `ac bench` records it (a row note and a note). */
    const rejected = (entry: string, mojoFm: number, reason: string, turboMq = 2) => ({
      ...withPlanner(fixture(), { mojoFm, turboMq: { sum: turboMq, mean: 0.1 }, note: 'invalid plan: 1 validator error' }), entry,
      notes: [...(fixture().notes ?? []), `The validator rejects the planner's plan (${reason}); it is scored as it came back.`],
    } as BenchResult);
    const app = 'banned-name: "app" is a junk drawer or a type word, not a feature';
    const middleware = 'banned-name: "middleware" is a junk drawer or a type word, not a feature';
    const won = { ...withPlanner(fixture(), { mojoFm: 90 }), entry: 'won' } as BenchResult;
    const results = [rejected('ghostfolio', 90, app), won, rejected('kaneo', 50, middleware), fixture()];
    expect(results.map(plannerRejection)).toEqual([app, null, middleware, null]);
    const tally = 'In these results the planner beats the best deterministic method on MoJoFM on 2 of 4 entries (ghostfolio and won), and loses on 2 (kaneo and shop); '
      + 'on TurboMQ it beats it on 0 of 4 entries, and loses on 4 (ghostfolio, won, kaneo and shop). Each measure has its own best deterministic method.';
    expect(plannerTally(benchOverview(results))).toBe(`${tally} Our own validator rejects the plans of ghostfolio (${app}) and kaneo (${middleware}). ac run refuses such a plan; the bench scores it as it came back. `
      + 'Counting only the plans the validator accepts, the planner wins on MoJoFM on 1 of 4 (won) and on TurboMQ on 0 of 4.');
    // A rejected plan that loses on both measures doesn't change the count of wins.
    expect(plannerTally(benchOverview([rejected('kaneo', 50, middleware), fixture()])))
      .toBe('In these results the planner beats the best deterministic method on MoJoFM on 0 of 2 entries, and loses on 2 (kaneo and shop); on TurboMQ it beats it on 0 of 2 entries, and loses on 2 (kaneo and shop). '
        + `Each measure has its own best deterministic method. Our own validator rejects the plan of kaneo (${middleware}). ac run refuses such a plan; the bench scores it as it came back.`);
    // One that wins on TurboMQ alone does.
    expect(plannerTally(benchOverview([rejected('kaneo', 50, middleware, 3), fixture()])))
      .toContain('Counting only the plans the validator accepts, the planner wins on MoJoFM on 0 of 2 and on TurboMQ on 0 of 2.');
    const overview = pageText(renderBenchBody(results)).split('summary.md')[0]!;
    expect(overview).toContain('90.00 (plan rejected)');
    expect(overview).toContain('50.00 (plan rejected)');
    // Both measures of each rejected plan say so.
    expect(overview.match(/plan rejected\)/g)).toHaveLength(4);
  });

  it('reads results, picks the planner\'s best row and shows the planner against the best deterministic method on each measure', () => {
    const directory = temporary('results');
    fs.writeFileSync(path.join(directory, 'shop.json'), JSON.stringify(benchResultFixture()));
    const results = readBenchResults(directory);
    expect(results.map((result) => result.entry)).toEqual(['shop']);
    expect(plannerScore(results[0]!)?.method).toBe('planner (Ultra)');
    expect(benchOverview(results)).toEqual([{
      entry: 'shop', kind: 'scramble', plannerRejection: null,
      measures: [
        { metric: 'MoJoFM', scope: null, best: { method: 'name-token (anchored)', value: 81.5 }, draft: 80, planner: 78.25 },
        { metric: 'TurboMQ', scope: null, best: { method: 'B0 type folders', value: 2.5 }, draft: 2, planner: 2 },
      ],
    }]);
    const body = renderBenchBody(results);
    // The overview and the entry block: on each measure the best and the planner, the higher one bold.
    const overview = body.split('summary.md')[0]!;
    expect(overview).toContain('<tr><td><a href="#entry-shop">shop</a></td><td>MoJoFM</td><td>name-token (anchored)</td><td class="num"><strong>81.50</strong></td><td class="num">80.00</td><td class="num">78.25</td><td class="num">-3.25</td></tr>');
    expect(overview).toContain('<tr><td></td><td>TurboMQ</td><td>B0 type folders</td><td class="num"><strong>2.50</strong></td><td class="num">2.00</td><td class="num">2.00</td><td class="num">-0.50</td></tr>');
    const block = entryBlockOf(body, 'shop');
    expect(block).toContain('<tr><td>MoJoFM</td><td>name-token (anchored)</td><td class="num"><strong>81.50</strong></td>');
    expect(block).toContain('<tr><td>TurboMQ</td><td>B0 type folders</td><td class="num"><strong>2.50</strong></td>');
    // A chart per measure, each with its own best.
    expect(block.match(/<svg/g)).toHaveLength(2);
    expect(pageText(block)).toContain('MoJoFM against the original folders (0–100)');
    expect(pageText(block)).toContain('TurboMQ (sum of cluster factors)');
    // The table bolds the best on MoJoFM in the ground-truth columns and the best on TurboMQ in the graph's.
    expect(block).toContain('<tr><td><strong>B0 type folders</strong></td><td><strong>baseline</strong></td><td class="num"><strong>5</strong></td><td class="num">20.00</td>');
    expect(block).toContain('<tr><td><strong>name-token (anchored)</strong></td><td><strong>baseline</strong></td><td class="num">4</td><td class="num"><strong>81.50</strong></td>');
    expect(body).toContain('The planner loses to name-token here by 3.25 MoJoFM.');
    expect(readBenchResults(path.join(directory, 'missing'))).toEqual([]);
  });

  it('scores a real target without a key by TurboMQ only, and tolerates a missing planner', () => {
    const real = { ...keyed(), partialKey: undefined, planner: null, methods: keyed().methods.filter((method) => method.kind !== 'planner') } as BenchResult;
    expect(benchOverview([real])).toEqual([{
      entry: 'immich', kind: 'real', plannerRejection: null,
      measures: [
        { metric: 'MoJoFM', scope: null, best: null, draft: null, planner: null },
        { metric: 'TurboMQ', scope: null, best: { method: 'B0 type folders', value: 2.5 }, draft: 2, planner: null },
      ],
    }]);
    const body = renderBenchBody([real]);
    expect(pageText(body)).toContain('Real type-sliced targets have no ground truth and get TurboMQ and back-edges only.');
    expect(body).toContain('<td>MoJoFM</td><td>none (no ground truth)</td>');
    const block = entryBlockOf(body, 'immich');
    expect(pageText(block)).toContain('A real type-sliced target: no ground truth, so TurboMQ (higher is more modular) and back-edges (lower is better) only.');
    expect(block).toContain('Planner: not recorded yet.');
    expect(block.match(/<svg/g)).toHaveLength(1);
    expect(plannerTally(benchOverview([real]))).toBe('');
  });

  it('scores a real target with a partial key on MoJoFM over the key, and says what the key is and covers', () => {
    const real = keyed();
    expect(benchOverview([real])[0]!.measures).toEqual([
      { metric: 'MoJoFM', scope: 'over its 2024 key', best: { method: 'name-token (anchored)', value: 90 }, draft: 85, planner: 88 },
      { metric: 'TurboMQ', scope: null, best: { method: 'B0 type folders', value: 2.5 }, draft: 2, planner: 2 },
    ]);
    expect(plannerTally(benchOverview([real, fixture()])))
      .toBe('In these results the planner beats the best deterministic method on MoJoFM on 0 of 2 entries, and loses on 2 (immich and shop); on TurboMQ it beats it on 0 of 2 entries, and loses on 2 (immich and shop). '
        + "Each measure has its own best deterministic method, and immich's MoJoFM is over its 2024 key.");
    const body = renderBenchBody([real]);
    const text = pageText(body);
    expect(text).toContain("where a target's own history labels some of its files (a partial answer key), MoJoFM and the rest over those files only.");
    expect(body).toContain('<td>MoJoFM over its 2024 key</td><td>name-token (anchored)</td><td class="num"><strong>90.00</strong></td><td class="num">85.00</td><td class="num">88.00</td><td class="num">-2.00</td>');
    const block = entryBlockOf(body, 'immich');
    expect(pageText(block)).toContain("A real type-sliced target, with no complete ground truth. MoJoFM, ARI, c2c_cvg, the cluster ratio and MoJoFM hard are over its 2024 key, immich's March 2024 domain-layer feature folders followed through git history to the pinned commit: "
      + '4 of the 40 movable files in 2 features, mostly in src/services/ (2) and src/dtos/ (1) with 1 elsewhere; 3 of the 4 are named after their feature (key bench/ground-truth/immich-2024.rsf, details in bench/ground-truth/README.md in the repository). '
      + 'Every method places all 40, and only those 4 count. TurboMQ (higher is more modular) and back-edges (lower is better) cover every file.');
    // The table shows the key's scores in the ground-truth columns, bold for the best over the key; the chart is over the key.
    expect(block).toContain('<tr><td><strong>name-token (anchored)</strong></td><td><strong>baseline</strong></td><td class="num">4</td><td class="num"><strong>90.00</strong></td><td class="num"><strong>0.900</strong></td>');
    expect(block).toContain('<tr><td>seeds draft</td><td>draft</td><td class="num">4</td><td class="num">85.00</td>');
    expect(pageText(block)).toContain("MoJoFM over its 2024 key's 4 files (0–100)");
    expect(block.match(/<svg/g)).toHaveLength(2);
    expect(pageText(block)).toContain('Louvain MoJoFM over its 2024 key by resolution, seeds 1–5');
    expect(pageText(block)).toContain('61.00, 62.00, 63.00, 64.00, 65.00');
    // A key the page has no words for is named by who labeled it.
    const other = { ...real, partialKey: { ...real.partialKey!, file: 'bench/ground-truth/other.rsf', notMovable: [{ path: 'src/gone.ts', feature: 'a' }] } } as BenchResult;
    expect(benchOverview([other])[0]!.measures[0]!.scope).toBe('over its partial key');
    expect(pageText(entryBlockOf(renderBenchBody([other]), 'immich'))).toContain("are over its partial key, the files immich's 2024 domain layer labels: 4 of the 40 movable files in 2 features, mostly in src/services/ (2) and src/dtos/ (1) with 1 elsewhere; "
      + '3 of the 4 are named after their feature (key bench/ground-truth/other.rsf). Every method places all 40, and only those 4 count. 1 more labeled path is no movable file here and not scored.');
  });

  it('refuses a results file of another format', () => {
    const directory = temporary('format');
    fs.writeFileSync(path.join(directory, 'x.json'), JSON.stringify({ format: 'other' }));
    expect(() => readBenchResults(directory)).toThrow(/unknown format/);
  });
});

/** `result` with k planner runs (`#1` to `#k`, as `ac bench --repeats k` writes them): their rows, a repeats block, and their key scores on a keyed entry. */
function withRuns(result: BenchResult, label: string, runs: { mojoFm: number; turboMq: number; cost: number }[]): BenchResult {
  const planner = result.methods.find((method) => method.kind === 'planner')!;
  const rows = runs.map((run, index) => ({ ...planner, method: `planner (${label}) #${index + 1}`, mojoFm: result.kind === 'scramble' ? run.mojoFm : null, turboMq: { sum: run.turboMq, mean: 0.1 } }));
  const measures = {} as BenchRunMeasures;
  const repeats: BenchRepeats = {
    runs: rows.map((row, index) => ({
      repeat: index + 1, method: row.method, valid: true, validatorErrors: 0, fromEdit: true, criticRan: true, editChoices: { asked: 3, returned: 3, parsed: 3, truncated: 0 },
      groups: 4, modules: 4, samePartition: false, planSha256: 'f'.repeat(64), recordedCostUsd: runs[index]!.cost, spentUsd: 0, calls: { replayed: 2, recorded: 0 }, tokens: { prompt: 1, completion: 1, reasoning: 0 },
    })),
    mean: measures, min: measures, max: measures,
  };
  const partialKey = result.partialKey && {
    ...result.partialKey,
    methods: [...result.partialKey.methods.filter((score) => !score.method.startsWith('planner')), ...rows.map((row, index) => ({ method: row.method, mojoFm: runs[index]!.mojoFm, ari: 0, c2cCvg: 0, clusterCountRatio: 1, mojoFmHard: null }))],
  };
  return { ...result, methods: [...result.methods.filter((method) => method.kind !== 'planner'), ...rows], repeats, ...(partialKey ? { partialKey } : {}) };
}

/** Three runs at these MoJoFM and TurboMQ values, each at `cost`. */
const three = (mojoFm: number[], turboMq: number[], cost: number) => mojoFm.map((value, index) => ({ mojoFm: value, turboMq: turboMq[index]!, cost }));

/** A package with the Super VL experiment's three configurations, each with two scrambles and a keyed real entry, 3 runs each. */
function superVlPackage(root = temporary('super-vl')): string {
  const shopH1 = { ...fixture(), entry: 'shop-H1', variant: 'H1' } as BenchResult;
  const configurations: Record<string, BenchResult[]> = {
    ultra: [withRuns(keyed(), 'Ultra', three([88, 90, 88], [2.2, 2.3, 2.1], 0.1)), withRuns(fixture(), 'Ultra', three([80, 82, 84], [2, 2, 2], 0.1)), withRuns(shopH1, 'Ultra', three([70, 71, 72], [2, 2, 2], 0.1))],
    'super-vl-direct': [withRuns(keyed(), 'Super VL, thinking off', three([90, 90, 88], [2, 2, 2], 0.02)), withRuns(fixture(), 'Super VL, thinking off', three([70, 75, 80], [2.1, 2.2, 2.3], 0.02)), withRuns(shopH1, 'Super VL, thinking off', three([60, 60, 60], [2, 2, 2], 0.02))],
    'super-vl-256k': [withRuns(keyed(), 'Super VL, thinking on, 256k', three([86, 86, 86], [2.2, 2.2, 2.2], 0.25)), withRuns(fixture(), 'Super VL, thinking on, 256k', three([90, 91, 92], [2.4, 2.7, 2.5], 0.25)), withRuns(shopH1, 'Super VL, thinking on, 256k', three([65, 65, 65], [2, 2, 2], 0.25))],
  };
  for (const [directory, results] of Object.entries(configurations)) {
    const target = path.join(root, superVlDirectory, directory);
    fs.mkdirSync(target, { recursive: true });
    for (const result of results) fs.writeFileSync(path.join(target, `${result.entry}.json`), JSON.stringify(result));
    fs.writeFileSync(path.join(target, 'summary.md'), `# ${directory}\n`);
  }
  fs.writeFileSync(path.join(root, superVlDirectory, 'README.md'), '# the write-up\n');
  return root;
}

describe('the Super VL section', () => {
  it('reads each configuration\'s runs and shows their mean (min to max) on MoJoFM and on TurboMQ next to the best deterministic method', () => {
    const experiment = readSuperVlExperiment(superVlPackage())!;
    expect(experiment.configurations.map(({ directory, results }) => [directory, results.map((result) => result.entry)])).toEqual([
      ['ultra', ['immich', 'shop-H1', 'shop']], ['super-vl-direct', ['immich', 'shop-H1', 'shop']], ['super-vl-256k', ['immich', 'shop-H1', 'shop']],
    ]);
    const section = renderSuperVlSection(experiment);
    // Scrambles first, then the real target, MoJoFM then TurboMQ; the highest on each row bold.
    expect(section).toContain('<tr><td>shop-H1</td><td>MoJoFM</td><td><strong>81.50</strong> <span class="muted small">name-token (anchored)</span></td><td class="num">71.00 (70.00 to 72.00)</td><td class="num">60.00 (60.00 to 60.00)</td><td class="num">65.00 (65.00 to 65.00)</td></tr>');
    expect(section).toContain('<tr><td>shop</td><td>MoJoFM</td><td>81.50 <span class="muted small">name-token (anchored)</span></td><td class="num">82.00 (80.00 to 84.00)</td><td class="num">75.00 (70.00 to 80.00)</td><td class="num"><strong>91.00 (90.00 to 92.00)</strong></td></tr>');
    expect(section).toContain('<tr><td></td><td>TurboMQ</td><td>2.50 <span class="muted small">B0 type folders</span></td><td class="num">2.00 (2.00 to 2.00)</td><td class="num">2.20 (2.10 to 2.30)</td><td class="num"><strong>2.53 (2.40 to 2.70)</strong></td></tr>');
    expect(section).toContain('<tr><td>immich</td><td>MoJoFM over its 2024 key (4 of 40 files)</td><td><strong>90.00</strong> <span class="muted small">name-token (anchored)</span></td><td class="num">88.67 (88.00 to 90.00)</td><td class="num">89.33 (88.00 to 90.00)</td><td class="num">86.00 (86.00 to 86.00)</td></tr>');
    expect(section.indexOf('<td>shop-H1</td>')).toBeLessThan(section.indexOf('<td>immich</td>'));
    const text = pageText(section);
    // The counts, means and the cost come from the results; the p and the time from the write-up.
    expect(text).toContain("Super VL's mean MoJoFM is above Ultra's on 1 of the 2 scrambles (a permutation test over the runs, stratified by entry, gives p ≈ 0.0007), at 2.5 times Ultra's cost and 6.4 times its time per plan.");
    expect(text).toContain("On TurboMQ 1 of the 27 planner runs scores above the best deterministic method, and on immich (TurboMQ 2.20 against Ultra's 2.20, MoJoFM over its 2024 key 86.00 against Ultra's 88.67) we see no measurable difference between the two.");
    expect(text).toContain('The demo keeps Ultra. Among the reasons: the recorded demo run reproduces byte for byte');
    expect(text).toContain('3 runs per entry for each configuration');
    expect(text).toContain('The full write-up is bench/experiments/s8b-super-vl/README.md in the repository.');
    expect(section).toContain('<a href="experiments/s8b-super-vl/super-vl-256k/summary.md">super-vl-256k</a>');
  });

  it('is absent without the experiment, and a configuration without results is an error', () => {
    const { root } = makePackageFixture({ bench: true });
    expect(readSuperVlExperiment(root)).toBeNull();
    const out = path.join(temporary('no-super-vl'), '_site');
    buildSite({ packageDirectory: root, out });
    expect(fs.readFileSync(path.join(out, 'bench', 'index.html'), 'utf8')).not.toContain('Super VL');
    expect(fs.existsSync(path.join(out, 'bench', 'experiments'))).toBe(false);
    const broken = superVlPackage();
    fs.rmSync(path.join(broken, superVlDirectory, 'super-vl-direct'), { recursive: true });
    expect(() => readSuperVlExperiment(broken)).toThrow(/super-vl-direct: no bench results/);
  });

  it('is on the benchmarks page after the overview, with its results copied and linked, the same bytes twice', () => {
    const { root } = makePackageFixture({ bench: true });
    superVlPackage(root);
    const out = path.join(temporary('with-super-vl'), '_site');
    const result = buildSite({ packageDirectory: root, out });
    for (const directory of ['ultra', 'super-vl-direct', 'super-vl-256k']) {
      for (const file of ['immich.json', 'shop-H1.json', 'shop.json', 'summary.md']) expect(result.files).toContain(`${superVlDirectory}/${directory}/${file}`);
    }
    // Only the configurations' results: not the write-up.
    expect(result.files).not.toContain(`${superVlDirectory}/README.md`);
    expectLinksResolve(out);
    const bench = fs.readFileSync(path.join(out, 'bench', 'index.html'), 'utf8');
    expect(bench.indexOf('summary.md</a> · each entry')).toBeLessThan(bench.indexOf('<h2 id="super-vl">'));
    expect(bench.indexOf('<h2 id="super-vl">')).toBeLessThan(bench.indexOf('<h2 id="entries">'));
    const again = path.join(temporary('with-super-vl-again'), '_site');
    buildSite({ packageDirectory: root, out: again });
    expect(snapshot(again)).toEqual(snapshot(out));
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
    // The counted rows show the certificate's own count under the gate's, and say why the two differ.
    const abText = pageText(ab);
    expect(abText).toContain('certificate K1: 365 moved, 0 edited in place, 614 added (291 of them copies of files that still exist), 0 deleted');
    expect(abText).toContain('certificate K1: 367 moved, 180 edited in place, 2 added (2 inert tool configs), 0 deleted');
    expect(abText).toContain('certificate K8: unit 96/219 files and 779/1,934 cases equal to base');
    expect(abText).toContain('certificate K8: tsc exited 1 on head (1,680 diagnostics), 0 on base');
    expect(abText).toContain('nothing to compare: K1 counts the 211 added files');
    expect(abText).toContain("Where the gate's numbers and the certificates' differ");
    expect(abText).toContain("On immich, the branch g3/opencode-super (opencode + Nemotron 3 Super, single-shot) still passes all 2,337 of the base's test cases, while 66 of its 171 test files fail to load and tsc reports 1,680 errors (its certificate: K6, K8).");
    expect(abText).toContain("On mcphub, the branch g3/opencode-super-persistent (opencode + Nemotron 3 Super, persistent) still passes all 1,934 of the base's test cases outside the 7 network test files K8 sets aside, while 35 of its 264 test files fail to load and tsc reports 101 errors (its certificate: K6, K8).");
    const landing = pageText(fs.readFileSync(path.join(out, 'index.html'), 'utf8'));
    expect(landing).toContain('62 step certificates with the static checks; step 63 (R4), 4 rung certificates, the whole PR with the oracles (tsc, unit, openapi)');
    expect(landing).toContain('3 step certificates with the static checks; 1 rung certificate (R1 partial) with the oracles (tsc, unit, openapi)');
    expect(landing).toContain('1 attempt failed (certified FAIL and rolled back), 1 file pinned');
    const bench = pageText(fs.readFileSync(path.join(out, 'bench', 'index.html'), 'utf8'));
    expect(bench).not.toContain('a certified move');
    expect(bench).toContain('ghostfolio, hoppscotch-H1 and hoppscotch pass (static checks); kaneo (failing K3c, K4) fails (static checks).');
    // S8's results: ghostfolio's win and kaneo's loss are plans the validator rejects (bench/results/*.json notes); each
    // measure has its own best (bench/results/summary.md), and immich's MoJoFM is over its 2024 key (S8e).
    expect(bench).toContain('In these results the planner beats the best deterministic method on MoJoFM on 3 of 5 entries (ghostfolio, hoppscotch-H1 and hoppscotch), and loses on 2 (immich and kaneo); '
      + 'on TurboMQ it beats it on 1 of 5 entries (ghostfolio), and loses on 4 (hoppscotch-H1, hoppscotch, immich and kaneo). '
      + "Each measure has its own best deterministic method, and immich's MoJoFM is over its 2024 key. Our own validator rejects the plans of "
      + 'ghostfolio (banned-name: "app" is a junk drawer or a type word, not a feature) and kaneo (banned-name: "middleware" is a junk drawer or a type word, not a feature). '
      + 'ac run refuses such a plan; the bench scores it as it came back. Counting only the plans the validator accepts, the planner wins on MoJoFM on 2 of 5 (hoppscotch-H1 and hoppscotch) and on TurboMQ on 0 of 5.');
    expect(bench).toContain('86.81 (plan rejected)');
    expect(bench).toContain('19.93 (plan rejected)');
    expect(bench).toContain('50.65 (plan rejected)');
    expect(bench).toContain('MoJoFM over its 2024 keyseeds draft (file names)93.0293.0288.37-4.65');
    expect(bench).toContain('TurboMQLouvain r=4 (mean of seeds 1-5)10.5010.1910.07-0.43');
    expect(bench).toContain("over its 2024 key, immich's March 2024 domain-layer feature folders followed through git history to the pinned commit: 47 of the 269 movable files in 23 features, "
      + 'mostly in src/services/ (23) and src/dtos/ (22) with 2 elsewhere; 41 of the 47 are named after their feature (key bench/ground-truth/immich-2024.rsf, details in bench/ground-truth/README.md in the repository).');
    // S8b to S8d: Super VL as the planner, from bench/experiments/s8b-super-vl. Every mean (min to max) is the one
    // `ac bench compare` wrote, and the numbers the results don't hold are the write-up's.
    const section = bench.slice(bench.indexOf('Nemotron 3.5 Super VL as the planner'), bench.indexOf('Entry by entry'));
    const experiment = path.join(packageDirectory, 'bench', 'experiments', 's8b-super-vl');
    const compared = fs.readFileSync(path.join(experiment, 'compare.md'), 'utf8');
    const spreads = section.match(/\d+\.\d\d \(\d+\.\d\d to \d+\.\d\d\)/g)!;
    expect(spreads).toHaveLength(30);
    for (const spread of spreads) expect(compared, spread).toContain(spread);
    expect(section).toContain('hoppscotchMoJoFM81.38 seeds draft (export names)83.22 (81.38 to 84.83)81.84 (76.55 to 90.34)91.26 (88.97 to 94.48)');
    expect(section).toContain('immichMoJoFM over its 2024 key (47 of 269 files)93.02 seeds draft (file names)89.15 (88.37 to 90.70)89.92 (88.37 to 90.70)88.37 (88.37 to 88.37)');
    expect(section).toContain("Super VL's mean MoJoFM is above Ultra's on all 4 scrambles (a permutation test over the runs, stratified by entry, gives p ≈ 0.0007), at 2.5 times Ultra's cost and 6.4 times its time per plan. "
      + "On TurboMQ none of the 45 planner runs score above the best deterministic method, and on immich (TurboMQ 10.26 against Ultra's 10.20, MoJoFM over its 2024 key 88.37 against Ultra's 89.15) we see no measurable difference between the two. "
      + "The demo keeps Ultra. Among the reasons: the recorded demo run reproduces byte for byte with the frozen tool, and switching would mean new code and new recordings after the feature freeze; 3 runs per entry are few; in 11 of its 30 calls Super VL's long reasoning names the public project it is planning (ghostfolio, kaneo or immich), and in most of them tries to recall its structure; and Ultra was compared at medium_effort only, never at full thinking.");
    const writeUp = fs.readFileSync(path.join(experiment, 'README.md'), 'utf8');
    for (const quoted of ['a permutation test stratified by entry gives p ≈ 0.0007', "$0.428, 2.5 times Ultra's $0.170", '6.4 times as long', 'the demo plans with Ultra', '11 of its 30 calls']) expect(writeUp).toContain(quoted);
    expect(fs.existsSync(path.join(out, 'bench', 'experiments', 's8b-super-vl', 'super-vl-256k', 'immich.json'))).toBe(true);
    // S9's numbers freeze: the scramble count is the scored files; the co-located tests move too and aren't counted.
    expect(bench).toContain('156 scored files moved into type folders (a test next to its source moves with it and isn\'t scored)');
    // S9: 2,337/2,337 cases pass on opencode's branch, but its vitest run fails (66 files don't load): a green count, not green tests.
    expect(landing).toContain('a green test count, a broken build, and the certificate that says why');
    expect(landing).not.toContain('green tests, broken build');
    // S9: the G3 branches were certified by the S4 version of the checker, the ladder by the S6 version.
    const abPage = pageText(fs.readFileSync(path.join(out, 'ab', 'index.html'), 'utf8'));
    expect(abPage).toContain('certified in session S4 by our checker, the version that also certified our one-step R1 branch (certificate format 1)');
    expect(abPage).not.toContain('by the same checker as ours');
    expect(abPage).toContain('still passes all 1,934 of the base\'s test cases outside the 7 network test files K8 sets aside');
    // S9: the same agent on Nemotron 3 Ultra, the model ac plans with, so the A/B doesn't compare models.
    expect(abPage).toContain('In S9 the same agent ran again on NVIDIA Nemotron 3 Ultra, the model ac plans with, with the same prompt, scripts and pinned commit (the second table); only the caps differ');
    expect(landing).toContain('(opencode with Nemotron 3 Super, and with Ultra, the model ac plans with)');
    // An arm with no certificate (the Ultra single-shot changed nothing) says so in every check row.
    expect(abPage.match(/no certificate/g)?.length).toBe(11);
    expect(abPage).not.toContain('not in this certificate');
    expect(abPage).toContain('immich server/ @ 02063972e8: the same agent on Nemotron 3 Ultra');
    expect(abPage).toContain('3,809certificate K8: tsc exited 1 on head (3,809 diagnostics), 0 on base');
    expect(abPage).toContain('Ran `ls` on the same two test folders 38 times in 48 tool calls');
    const ladder = pageText(fs.readFileSync(path.join(out, 'runs', 'immich-ladder', 'index.html'), 'utf8'));
    expect(ladder).toContain('certified in session S4 by our checker, the version before this run\'s (certificate format 1; K7 came later)');
    // S9: the critic's review is the model's claim; the gate's record stands next to it.
    expect(ladder).toContain('The critic\'s review (plan.json, the model\'s own words)');
    expect(ladder).toContain('The gate accepted 6 of the critic\'s 12 suggestions; 10 validator warnings remain on the plan (findings: plan-warning).');
    expect(ladder).toContain('35 findings narrated of the 40 findings sent (5 more were not sent: the narration takes the first 40); 4 narrations dropped by the lexical guard');
    expect(ladder).toContain('63 table names × the 32 groups');
    expect(ladder).toContain('A FAIL rolls the commit back, and the step replans with the plan entries the failure names pinned in place.');
    const verifyPage = pageText(fs.readFileSync(path.join(out, 'verify', 'index.html'), 'utf8'));
    expect(verifyPage).toContain('On 2026-10-23 we ran npx ac demo --replay --env --oracles from a fresh clone, with no --work (20 m 32 s, exit 0)');
    // S9: the plan was recorded in S5 and S6; the run's budget run names where the run's own planner spend went.
    expect(ladder).toContain('This run: the plan cost $0.1998 when it was recorded; planner spend during the run $0.0000 (budget run s6, mode auto)');
    expect(ladder).toContain('The G3 runs (opencode with Nemotron 3 Super and, in S9, with Ultra: the generic-agent baseline) account for $8.9572 of it.');
    // S10: the 2026-10-24 bill reconciled: cached input billed at its cached price, the 504 and a stopped call not billed.
    expect(ladder).toContain('The whole project\'s spend on Nebius Token Factory, from the gateway\'s ledger (budget/ledger.jsonl): $24.3980 of the $50.00 hard cap. The lines marked reconciled bring the ledger to the Nebius console bill: what Token Factory billed differently from the gateway\'s count (a lost call, cached input at its cached price, calls it didn\'t bill).');
    expect(ladder).toContain('The same agent on Nemotron 3 Ultra, the model ac plans with (S9), is on the site\'s A/B page: its single-shot changed nothing, and its persistent run hit its $12 cap in turn 1 with every import of the moved files dangling.');
    // S9: the R1 arm's timings are its certificate's own: K0–K6 and K8 as recorded in runs/g3/immich-r1.full.json.
    const r1 = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'runs', 'g3', 'immich-r1.full.json'), 'utf8')) as { checks: { id: string; durationMs: number }[] };
    const staticSeconds = Math.round(r1.checks.filter((check) => check.id !== 'K8').reduce((sum, check) => sum + check.durationMs, 0) / 1000);
    const oracleSeconds = Math.round(r1.checks.find((check) => check.id === 'K8')!.durationMs / 1000);
    expect(abPage).toContain(`executor 14 s; certificate: static checks ${staticSeconds} s, oracles ${oracleSeconds} s`);
    const again = path.join(temporary('package-again'), '_site');
    buildSite({ packageDirectory, out: again });
    expect(snapshot(again)).toEqual(snapshot(out));
  });
});

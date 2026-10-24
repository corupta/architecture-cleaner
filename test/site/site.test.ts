import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BenchResult } from '../../src/bench/types.js';
import { benchOverview, plannerRejection, plannerScore, plannerTally, readBenchResults, renderBenchBody, scrambleCertificatesLine } from '../../src/site/bench.js';
import { buildSite, committedRuns, siteMarker } from '../../src/site/build.js';
import { siteCommand } from '../../src/site/command.js';
import { pitchLine } from '../../src/site/pages.js';
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

describe('the benchmarks page', () => {
  it('says what the certifier said about each scramble, and how the planner did, from the results', () => {
    const pass = benchResultFixture() as unknown as BenchResult;
    const fail = { ...pass, entry: 'kaneo', scramble: { ...pass.scramble!, certificate: { verdict: 'fail', scope: 'static', digest: 'sha256:d', failing: ['K3c', 'K4'] } } } as BenchResult;
    const unchecked = { ...pass, entry: 'other', scramble: { ...pass.scramble!, certificate: null } } as BenchResult;
    expect(scrambleCertificatesLine([pass, fail, unchecked])).toBe('Each scramble is one commit by our own executor, then checked by our own certifier as a pure move: shop passes (static checks); kaneo (failing K3c, K4) fails (static checks); other was not certified in this run. Each entry below shows its verdict; a scramble is scored whatever its verdict, since the ground truth is its original folders.');
    const body = pageText(renderBenchBody([pass, fail]));
    expect(body).not.toContain('a certified move');
    expect(body).toContain('kaneo (failing K3c, K4) fails (static checks)');
    expect(plannerTally(benchOverview([pass, { ...fail, methods: fail.methods.map((method) => (method.kind === 'planner' ? { ...method, mojoFm: 90 } : method)) }])))
      .toBe('In these results the planner beats the best deterministic method (on the entry\'s metric, MoJoFM or TurboMQ) on 1 of 2 entries (kaneo), and loses on 1 (shop).');
  });

  it('says which plans the validator rejects and why, and doesn\'t count a rejected plan as a win without saying so', () => {
    const fixture = benchResultFixture() as unknown as BenchResult;
    /** `entry` with the planner at `mojoFm`, its plan rejected for `reason` as `ac bench` records it (a row note and a note). */
    const rejected = (entry: string, mojoFm: number, reason: string) => ({
      ...fixture, entry,
      methods: fixture.methods.map((method) => (method.kind === 'planner' ? { ...method, mojoFm, note: 'invalid plan: 1 validator error' } : method)),
      notes: [...(fixture.notes ?? []), `The validator rejects the planner's plan (${reason}); it is scored as it came back.`],
    } as BenchResult);
    const app = 'banned-name: "app" is a junk drawer or a type word, not a feature';
    const middleware = 'banned-name: "middleware" is a junk drawer or a type word, not a feature';
    const won = { ...fixture, entry: 'won', methods: fixture.methods.map((method) => (method.kind === 'planner' ? { ...method, mojoFm: 90 } : method)) } as BenchResult;
    const results = [rejected('ghostfolio', 90, app), won, rejected('kaneo', 50, middleware), fixture];
    expect(results.map(plannerRejection)).toEqual([app, null, middleware, null]);
    const tally = 'In these results the planner beats the best deterministic method (on the entry\'s metric, MoJoFM or TurboMQ) on 2 of 4 entries (ghostfolio and won), and loses on 2 (kaneo and shop).';
    expect(plannerTally(benchOverview(results))).toBe(`${tally} Our own validator rejects the plans of ghostfolio (${app}) and kaneo (${middleware}). ac run refuses such a plan; the bench scores it as it came back. `
      + 'Counting only the plans the validator accepts, the planner wins on 1 of 4 (won).');
    // A rejected plan that loses doesn't change the count of wins.
    expect(plannerTally(benchOverview([rejected('kaneo', 50, middleware), fixture])))
      .toBe(`In these results the planner beats the best deterministic method (on the entry's metric, MoJoFM or TurboMQ) on 0 of 2 entries, and loses on 2 (kaneo and shop). Our own validator rejects the plan of kaneo (${middleware}). ac run refuses such a plan; the bench scores it as it came back.`);
    const overview = pageText(renderBenchBody(results)).split('summary.md')[0]!;
    expect(overview).toContain('90.00 (plan rejected)');
    expect(overview).toContain('50.00 (plan rejected)');
    expect(overview.match(/plan rejected\)/g)).toHaveLength(2);
  });

  it('reads results, picks the planner\'s best row and shows the planner against the best deterministic method', () => {
    const directory = temporary('results');
    fs.writeFileSync(path.join(directory, 'shop.json'), JSON.stringify(benchResultFixture()));
    const results = readBenchResults(directory);
    expect(results.map((result) => result.entry)).toEqual(['shop']);
    expect(plannerScore(results[0]!)?.method).toBe('planner (Ultra)');
    expect(benchOverview(results)).toEqual([{ entry: 'shop', kind: 'scramble', metric: 'MoJoFM', best: { method: 'name-token (anchored)', value: 81.5 }, draft: 80, planner: 78.25, plannerRejection: null }]);
    const body = renderBenchBody(results);
    expect(body).toContain('<td class="num">-3.25</td>');
    expect(body).toContain('The planner loses to name-token here by 3.25 MoJoFM.');
    expect(readBenchResults(path.join(directory, 'missing'))).toEqual([]);
  });

  it('scores real targets by TurboMQ, without ground truth, and tolerates a missing planner', () => {
    const real = { ...benchResultFixture(), entry: 'immich', kind: 'real', scramble: null, featureFiles: null, groundTruthModules: null, hardFiles: null, leakyFiles: null, planner: null, louvainMojoFmByResolution: null,
      methods: benchResultFixture().methods.filter((method) => method.kind !== 'planner').map((method) => ({ ...method, mojoFm: null, ari: null, c2cCvg: null, clusterCountRatio: null, mojoFmHard: null })),
      bestBaseline: { method: 'B0 type folders', mojoFm: null, turboMq: 2.5 } } as unknown as BenchResult;
    expect(benchOverview([real])).toEqual([{ entry: 'immich', kind: 'real', metric: 'TurboMQ', best: { method: 'B0 type folders', value: 2.5 }, draft: 2, planner: null, plannerRejection: null }]);
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
    // S8's results: ghostfolio's win and kaneo's loss are plans the validator rejects (bench/results/*.json notes).
    expect(bench).toContain('on 3 of 5 entries (ghostfolio, hoppscotch-H1 and hoppscotch), and loses on 2 (immich and kaneo). Our own validator rejects the plans of '
      + 'ghostfolio (banned-name: "app" is a junk drawer or a type word, not a feature) and kaneo (banned-name: "middleware" is a junk drawer or a type word, not a feature). '
      + 'ac run refuses such a plan; the bench scores it as it came back. Counting only the plans the validator accepts, the planner wins on 2 of 5 (hoppscotch-H1 and hoppscotch).');
    expect(bench).toContain('86.81 (plan rejected)');
    expect(bench).toContain('50.65 (plan rejected)');
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

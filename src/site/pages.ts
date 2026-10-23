// The replay site's own pages: the landing page (the pitch line and one card per committed run), the A/B page, the
// benchmarks page and "verify it yourself". Run reports come from src/report. All links are relative, so the site
// works from file:// and from any GitHub Pages path.
import type { BenchResult } from '../bench/types.js';
import type { AbTableView } from '../report/ab.js';
import { code, count, escapeHtml, formatDuration, link, page, plural, pre, statusMark, usd } from '../report/html.js';
import { certificateCoverage, failedAttemptsPhrase } from '../report/render.js';
import { renderAbTable, type AbLinks } from '../report/render-ab.js';
import type { RunReportData } from '../report/run-data.js';
import { renderBenchBody } from './bench.js';

export const pitchLine = 'Nemotron draws the map. Code moves it. A checker proves nothing else changed.';

export interface SiteContext {
  /** Committed runs, in display order. */
  runs: RunReportData[];
  ab: AbTableView[];
  bench: BenchResult[];
  /** The source repository's URL, when the build knows it (GitHub Actions passes it). */
  sourceUrl: string | null;
}

/** What the run's certificates cover, in one line: the static step certificates, then those with the oracles. */
export function coverageLine(data: RunReportData): string {
  const coverage = certificateCoverage(data);
  const withOracles = [
    ...coverage.fullSteps.map((step) => `step ${step.index} (${step.rung})`),
    coverage.fullRungs.length ? `${plural(coverage.fullRungs.length, 'rung certificate')}${coverage.fullRungs.some((rung) => rung.partial) ? ` (${coverage.fullRungs.filter((rung) => rung.partial).map((rung) => `${rung.id} partial`).join(', ')})` : ''}` : '',
    coverage.whole === 'full' ? 'the whole PR' : '',
  ].filter(Boolean);
  const parts = [
    coverage.staticSteps.length ? `${plural(coverage.staticSteps.length, 'step certificate')} with the static checks` : 'no static step certificate',
    withOracles.length ? `${withOracles.join(', ')} with the oracles${coverage.oracles.length ? ` (${coverage.oracles.join(', ')})` : ''}` : 'nothing with the oracles',
  ];
  return parts.join('; ');
}

function runCard(data: RunReportData): string {
  const { state, whole } = data;
  const certified = state.steps.filter((step) => step.status === 'certified').length;
  const verdict = whole ? statusMark(whole.view.verdict, `whole PR ${whole.view.verdict.toUpperCase()}${whole.view.scope === 'full' ? ' with oracles' : ''}`) : statusMark('none', `run ${state.status}, no whole-PR certificate`);
  const facts = [
    `${count(certified)} certified commits on ${code(state.branch)}`,
    escapeHtml(coverageLine(data)),
    `${escapeHtml(failedAttemptsPhrase(state))}, ${plural(state.pins.length, 'file')} pinned`,
    `${count(data.findings?.findings.length ?? state.findings.length)} findings, recorded and never fixed`,
    `wall time ${formatDuration(state.timeline.durationMs)}; the plan cost ${state.cost.planRecordedUsd === null ? 'unknown' : usd(state.cost.planRecordedUsd)} when recorded, a replay $0`,
    state.fault ? `injected fault ${code(`${state.fault.step}:${state.fault.operator}`)}${state.fault.appliedTo !== undefined ? ` on step ${state.fault.appliedTo}` : ', not applied'}` : '',
  ].filter(Boolean);
  return `<div class="card"><h3>${link(`runs/${data.name}/index.html`, `${state.profile.name} ${state.packageRoot ? `${state.packageRoot}/` : ''} · ${data.name}`)}</h3>
<p>${verdict}</p>
<ul class="small">${facts.map((fact) => `<li>${fact}</li>`).join('')}</ul></div>`;
}

export function landingPage(context: SiteContext): string {
  const cards = context.runs.length ? `<div class="cards">${context.runs.map(runCard).join('\n')}</div>` : '<p>No committed runs.</p>';
  const body = `<p class="pitch">${escapeHtml(pitchLine)}</p>
<p>architecture-cleaner restructures a TypeScript backend sliced by technical type (${code('controllers/')}, ${code('services/')}, ${code('repositories/')}) into feature modules, one certified commit at a time. NVIDIA Nemotron 3 Ultra on Nebius Token Factory edits a deterministic draft of the new layout and a critic call reviews it; a codemod on the TypeScript compiler API moves the files. A separate checker certifies each commit with the static checks: the moves and specifier edits are all that changed, every import resolves to the same file under TypeScript, the test runner and the runtime, and the test inventory is the same. It certifies each rung and the whole PR again with the oracles the target's profile names (on immich: tsc, the unit suite, and the OpenAPI spec byte for byte). Each run card below says which certificates it has.</p>
<p>Proof, not trust: every page here is rendered from committed run artifacts (run.json, the certificates, the findings log). Nothing calls a model; the recorded Nemotron responses replay from cassettes for $0.</p>
<h2>Recorded runs</h2>
${cards}
<h2>More</h2>
<ul>
<li>${link('ab/index.html', 'A/B: the same task given to a generic coding agent')} (opencode with Nemotron 3 Super): a green test count, a broken build, and the certificate that says why.</li>
<li>${link('bench/index.html', 'Benchmarks')}: recovering real feature boundaries next to deterministic baselines${context.bench.length ? '' : ' (not recorded yet)'}.</li>
<li>${link('verify/index.html', 'Verify it yourself')}: replay the run with no key and no cost, and certify any diff.</li>
${context.sourceUrl ? `<li>${link(context.sourceUrl, 'Source code')}</li>` : ''}
</ul>`;
  return page({ title: 'architecture-cleaner', lead: '<p class="lead">A replay site: recorded runs, their certificates and findings.</p>', body });
}

export function abPage(context: SiteContext, links: AbLinks): string {
  const body = `<p>In the G3 gate (docs/gates.md) a generic coding agent, opencode 1.18.34 with NVIDIA Nemotron 3 Super on Nebius Token Factory, got the restructure with a fixed prompt and no human input, single-shot and persistent (an automated reply asked it to continue whenever it stopped). Its branches were certified in session S4 by our checker, the version that also certified our one-step R1 branch (certificate format 1); the full ladder's certificates come from the S6 version (format 2, which added K7). The gate's numbers come from its own scripts and name their source. The verdict and check rows, and each "certificate" line under a value, are read from the certificate files when this page is built; where the two count the same thing differently, the notes under the table say why.</p>
${context.ab.map((view) => renderAbTable(view, links)).join('\n')}`;
  return page({ title: 'A/B: a generic agent and ac on the same task', breadcrumbs: [['../index.html', 'home']], body });
}

export function benchPage(context: SiteContext): string {
  return page({ title: 'Benchmarks: recovering feature boundaries', breadcrumbs: [['../index.html', 'home']], body: renderBenchBody(context.bench) });
}

export function verifyPage(context: SiteContext): string {
  const clone = context.sourceUrl ? `git clone ${context.sourceUrl}` : 'git clone <this repository>';
  const body = `<p>Nothing here asks for trust. The steps below rebuild the evidence on your machine. None needs a Token Factory key, and none spends money.</p>
<h2>1. Replay the immich run</h2>
${pre(`${clone} architecture-cleaner\ncd architecture-cleaner\nnpm ci\nnpx ac demo --replay`)}
<p>It fetches immich at the pinned commit 02063972e8, replays Nemotron's plan from the committed cassette and checks its sha256 against the recorded run, re-executes the move steps with the executor, commits each one and compares its tree with the recorded run's, static-certifies a sample of the commits, and replays the findings narration. It writes a summary that says what was re-executed, what was replayed, and what was not re-run, and exits 0 when everything it compared matches the recorded run.</p>
<p>It works in ${code('/tmp/ac-demo/')} (your system's temporary directory) and prints where its summary is. It doesn't use ${code('./ac-demo')} inside the clone: the clone's node_modules and package.json are above it, and TypeScript and Node look both up from every tree the certifier checks, so a certificate made there would depend on them. The certifier refuses such a directory, and so does the demo's ${code('--work')}.</p>
<p>Without immich's node_modules, K0, K1, K2, K3a, K4 and K7 run on the sample, and each must give the recorded certificate's status. K3b, K3c and K6 skip, and the summary reports them as not compared, with the checks' content and the digests. What it does not re-run by default: the oracles (tsc, the unit suite, the OpenAPI spec) need immich's node_modules and Node 24.21.0; the README's full reproduction sets both up. Add ${code('--env <an immich checkout with node_modules>')} and every check runs on the sample: each check's content and each certificate's digest are compared with the recording, byte for byte. Add ${code('--oracles')} as well and the whole PR is certified with the oracles, its digest compared with the recorded one. No ${code('--work')} is needed. Or add ${code('--full')} to run the whole ladder with ${code('ac run')} (1 h 55 m on a quiet machine in S6).</p>
<p>On 2026-10-23 we ran ${code('npx ac demo --replay --env --oracles')} from a fresh clone, with no ${code('--work')} (20 m 32 s, exit 0): the three sample certificates and the whole-PR certificate came out with the recorded digests, byte for byte.</p>
<h2>2. Certify any diff</h2>
${pre('npx ac certify <immich clone> <base>..<head> --profile immich\nnpx ac certify <immich clone> <base>..<head> --profile immich --oracles --env <checkout with node_modules>')}
<p>The certifier is a separate process from the executor and accepts any two commits: ours, a hand-made restructure, or an agent's. Its digest covers the two trees, not commit ids, so a certificate stays valid when its trailers are added by amending the commit.</p>
<h2>3. Rebuild this site</h2>
${pre('npx ac site --out _site')}
<p>The build reads only committed files (runs/*/, runs/g3/, bench/results/, budget/ledger.jsonl) and writes the same bytes every time. A run report can be rebuilt on its own with ${code('npx ac report runs/<name> --out <dir>')}.</p>
<h2>4. Read the raw evidence</h2>
<ul>
${context.runs.map((data) => `<li>${link(`../runs/${data.name}/index.html`, data.name)}: ${[
    data.whole ? link(`../runs/${data.name}/${data.whole.file}`, 'the whole-PR certificate') : 'no whole-PR certificate',
    link(`../runs/${data.name}/index.html#ladder`, 'every step certificate'),
    data.findings ? link(`../runs/${data.name}/findings/findings.json`, 'findings.json') : '',
  ].filter(Boolean).join(', ')}</li>`).join('\n')}
<li>${link('../ab/index.html', 'The G3 certificates')} (format 1, from session S4)</li>
</ul>`;
  return page({ title: 'Verify it yourself', breadcrumbs: [['../index.html', 'home']], body });
}

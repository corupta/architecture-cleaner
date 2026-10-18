// The site's benchmarks page, from bench/results/*.json (BenchResult, src/bench/types.ts) alone: per entry, every
// method's scores next to the deterministic baselines, the best of them and the planner emphasized, honestly including
// where the planner loses. A missing results directory says "not recorded yet".
import fs from 'node:fs';
import path from 'node:path';
import type { BenchResult, MethodScore } from '../bench/types.js';
import { compare } from '../boundaries/folder-graph.js';
import { horizontalBars, legend } from '../report/charts.js';
import { code, count, details, escapeHtml, figure, link, shortSha, statusMark, table, usd } from '../report/html.js';

/** bench/results/*.json in name order, each checked for its format. */
export function readBenchResults(directory: string): BenchResult[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((file) => file.endsWith('.json')).sort(compare).map((file) => {
    const result = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')) as BenchResult;
    if (result.format !== 'ac-bench/1') throw new Error(`${path.join(directory, file)}: unknown format ${String(result.format)}`);
    return result;
  });
}

const dash = '–';
const fixed = (value: number | null, digits: number) => (value === null ? dash : value.toFixed(digits));
const clusters = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** The planner's best row: the method of kind `planner` with the highest MoJoFM (or TurboMQ on real targets). */
export function plannerScore(result: BenchResult): MethodScore | null {
  const planners = result.methods.filter((method) => method.kind === 'planner');
  const score = (method: MethodScore) => (result.kind === 'scramble' ? method.mojoFm ?? -1 : method.turboMq.sum);
  return planners.sort((left, right) => score(right) - score(left) || compare(left.method, right.method))[0] ?? null;
}

/** One line per entry for the overview: the best deterministic method, the seeds draft and the planner. */
export interface BenchOverviewRow {
  entry: string;
  kind: BenchResult['kind'];
  metric: 'MoJoFM' | 'TurboMQ';
  best: { method: string; value: number } | null;
  draft: number | null;
  planner: number | null;
}

export function benchOverview(results: readonly BenchResult[]): BenchOverviewRow[] {
  return results.map((result) => {
    const metric = result.kind === 'scramble' ? 'MoJoFM' : 'TurboMQ';
    const value = (method: MethodScore | undefined | null) => (method ? (metric === 'MoJoFM' ? method.mojoFm : method.turboMq.sum) : null);
    const best = result.bestBaseline ? { method: result.bestBaseline.method, value: (metric === 'MoJoFM' ? result.bestBaseline.mojoFm : result.bestBaseline.turboMq) ?? 0 } : null;
    return { entry: result.entry, kind: result.kind, metric, best, draft: value(result.methods.find((method) => method.kind === 'draft')), planner: value(plannerScore(result)) };
  });
}

function entryBlock(result: BenchResult): string {
  const scramble = result.kind === 'scramble';
  const planner = plannerScore(result);
  const best = result.bestBaseline?.method ?? null;
  const emphasized = (method: MethodScore) => method.method === best || method === planner;
  const rows = result.methods.map((method) => {
    const cells = [
      escapeHtml(method.method) + (method.note && !method.note.startsWith('mean of seeds') ? ` <span class="muted small">(${escapeHtml(method.note)})</span>` : ''),
      escapeHtml(method.kind), clusters(method.clusters), fixed(method.mojoFm, 2), fixed(method.ari, 3), fixed(method.c2cCvg, 3), fixed(method.clusterCountRatio, 2), fixed(method.mojoFmHard, 2),
      method.turboMq.sum.toFixed(2), clusters(method.backEdges),
    ];
    return emphasized(method) ? cells.map((cell) => `<strong>${cell}</strong>`) : cells;
  });
  const columns = [{ label: 'Method' }, { label: 'Kind' }, { label: 'Clusters', numeric: true }, { label: 'MoJoFM', numeric: true }, { label: 'ARI', numeric: true }, { label: 'c2c_cvg', numeric: true },
    { label: 'Cluster ratio', numeric: true }, { label: 'MoJoFM hard', numeric: true }, { label: 'TurboMQ', numeric: true }, { label: 'Back-edges', numeric: true }];
  const value = (method: MethodScore) => (scramble ? method.mojoFm ?? 0 : method.turboMq.sum);
  const bars = horizontalBars(result.methods.map((method) => ({
    label: method.method.length > 34 ? `${method.method.slice(0, 33)}…` : method.method,
    value: value(method),
    valueLabel: scramble ? fixed(method.mojoFm, 1) : `${method.turboMq.sum.toFixed(2)} · ${clusters(method.backEdges)} back-edges`,
    tip: `${method.method}\n${scramble ? `MoJoFM ${fixed(method.mojoFm, 2)}, ARI ${fixed(method.ari, 3)}` : `TurboMQ ${method.turboMq.sum.toFixed(2)}`}, ${clusters(method.clusters)} clusters, ${clusters(method.backEdges)} back-edges`,
    color: method === planner ? 'var(--s1)' : method.method === best ? 'var(--s2)' : 'var(--neutral)',
  })), { labelWidth: 230, ...(scramble ? { max: 100 } : {}) });
  const key = legend([
    { id: 'planner', label: 'the planner (Nemotron)', color: 'var(--s1)' },
    { id: 'best', label: 'the best deterministic method', color: 'var(--s2)' },
    { id: 'other', label: 'other methods', color: 'var(--neutral)' },
  ]);
  const where = [result.packageRoot, result.moduleRoot].filter(Boolean).join('/') || '.';
  const facts: string[] = [`Target ${code(where)} @ ${code(shortSha(result.sha))}, ${count(result.files)} movable files.`];
  if (result.scramble) {
    const certificate = result.scramble.certificate;
    facts.push(`Scrambled by our own executor in commit ${code(shortSha(result.scramble.commit))}: ${count(result.scramble.moved)} files moved into type folders, ${count(result.scramble.declined)} declined (they stay), ${count(result.scramble.excluded)} excluded; ${certificate ? `certificate ${statusMark(certificate.verdict)} (${certificate.scope}${certificate.failing.length ? `, failing ${escapeHtml(certificate.failing.join(', '))}` : ''})` : 'not certified in this run'}.`);
    const leakage = result.leakage
      ? `${count(result.leakyFiles ?? 0)} of the movable files give their feature away in their path (${count(result.leakage.renamed)} renamed after it, ${count(result.leakage.inFeatureFolder)} still in a feature folder, ${count(result.leakage.underSubFolder)} under a sub-folder their feature kept; ${count(result.leakage.unseen)} more that no method sees are not counted)`
      : `${count(result.leakyFiles ?? 0)} leaky files`;
    facts.push(`Ground truth: ${count(result.featureFiles ?? 0)} feature files in ${count(result.groundTruthModules ?? 0)} original folders; ${count(result.hardFiles ?? 0)} hard files (their name doesn't give their feature away); ${leakage}.`);
  } else {
    facts.push('A real type-sliced target: no ground truth, so TurboMQ (higher is more modular) and back-edges (lower is better) only.');
  }
  facts.push(result.planner
    ? `Planner: ${result.planner.groups} groups${result.planner.modules === undefined ? '' : ` (${count(result.planner.modules)} modules)`}${result.draft ? `, from the ${escapeHtml(result.draft.method)}` : ''}, plan sha256 ${code(result.planner.planSha256.slice(0, 12))}, ${usd(result.planner.recordedCostUsd)} when recorded${result.planner.replayed ? ', replayed from ' : ', recorded into '}${code(result.planner.cassette)} (${usd(result.planner.spentUsd)} spent by this run).`
    : 'Planner: not recorded yet.');
  const louvain = result.louvainMojoFmByResolution
    ? details('Louvain MoJoFM by resolution, seeds 1–5', table([{ label: 'Resolution' }, { label: 'MoJoFM per seed' }], Object.entries(result.louvainMojoFmByResolution).map(([resolution, values]) => [escapeHtml(resolution), escapeHtml(values.map((entry) => entry.toFixed(2)).join(', '))])), { className: 'more' })
    : '';
  const notes = result.notes?.length ? `<ul>${result.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : '';
  return `<h3 id="entry-${escapeHtml(result.entry)}">${escapeHtml(result.entry)} <span class="pill">${escapeHtml(result.kind)}${scramble ? `, ${escapeHtml(result.variant)}` : ''}</span></h3>
${facts.map((fact) => `<p class="small">${fact}</p>`).join('\n')}
${notes}
${figure(scramble ? 'MoJoFM against the original folders (0–100)' : 'TurboMQ (sum of cluster factors)', `${key}${bars}`, { tableView: table(columns, rows) })}
${louvain}
<p class="small">${link(`results/${result.entry}.json`, `${result.entry}.json`)}</p>`;
}

/** Names as prose: `a`, `a and b`, `a, b and c`. */
const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** What our certifier said about the scramble commits, from the results: a FAIL is never called a certified move. */
export function scrambleCertificatesLine(results: readonly BenchResult[]): string {
  const scrambles = results.filter((result) => result.scramble);
  if (!scrambles.length) return '';
  const verdict = (wanted: 'pass' | 'fail') => scrambles.filter((result) => result.scramble!.certificate?.verdict === wanted);
  const scopes = (entries: BenchResult[]) => [...new Set(entries.map((result) => result.scramble!.certificate!.scope === 'full' ? 'static checks and oracles' : 'static checks'))].join(' or ');
  const passing = verdict('pass');
  const failing = verdict('fail');
  const unchecked = scrambles.filter((result) => !result.scramble!.certificate);
  const parts = [
    passing.length ? `${list(passing.map((result) => result.entry))} ${passing.length === 1 ? 'passes' : 'pass'} (${scopes(passing)})` : '',
    failing.length ? `${list(failing.map((result) => `${result.entry} (failing ${result.scramble!.certificate!.failing.join(', ') || 'no check named'})`))} ${failing.length === 1 ? 'fails' : 'fail'} (${scopes(failing)})` : '',
    unchecked.length ? `${list(unchecked.map((result) => result.entry))} ${unchecked.length === 1 ? 'was' : 'were'} not certified in this run` : '',
  ].filter(Boolean);
  return `Each scramble is one commit by our own executor, then checked by our own certifier as a pure move: ${parts.join('; ')}. Each entry below shows its verdict; a scramble is scored whatever its verdict, since the ground truth is its original folders.`;
}

/** How the planner did against the best deterministic method, entry by entry, from the overview. */
export function plannerTally(overview: readonly BenchOverviewRow[]): string {
  const compared = overview.filter((row) => row.planner !== null && row.best);
  if (!compared.length) return '';
  const wins = compared.filter((row) => row.planner! > row.best!.value).map((row) => row.entry);
  const losses = compared.filter((row) => row.planner! < row.best!.value).map((row) => row.entry);
  const ties = compared.filter((row) => row.planner === row.best!.value).map((row) => row.entry);
  const clause = (names: string[], verb: string) => (names.length ? `${verb} on ${names.length} (${list(names)})` : '');
  return `In these results the planner beats the best deterministic method (on the entry's metric, MoJoFM or TurboMQ) on ${wins.length} of ${compared.length} entries${wins.length ? ` (${list(wins)})` : ''}${[clause(ties, 'ties it'), clause(losses, 'and loses')].filter(Boolean).map((part) => `, ${part}`).join('')}.`;
}

export function renderBenchBody(results: readonly BenchResult[]): string {
  const certificates = scrambleCertificatesLine(results);
  const intro = `<p>Can a planner recover a codebase's real feature boundaries? We flatten feature-modular repos into type folders, then score each method against the original folders: MoJoFM (0–100), ARI, c2c_cvg and the cluster-count ratio.${certificates ? ` ${escapeHtml(certificates)}` : ''} Deterministic baselines are always shown next to the planner, because classic methods often win (ICSA 2026 found they beat LLM decompositions by 62% on MoJoFM, docs/plan.md §7; our G1 gate agrees on kaneo, docs/gates.md). Real type-sliced targets have no ground truth and get TurboMQ and back-edges only.</p>`;
  if (!results.length) return `${intro}<p><strong>Not recorded yet.</strong> The benchmark runs land in ${code('bench/results/')} (${code('ac bench bench/manifest.json')}); this page renders them when they do.</p>`;
  const overview = benchOverview(results);
  const overviewTable = table([{ label: 'Entry' }, { label: 'Metric' }, { label: 'Best deterministic method' }, { label: 'Best', numeric: true }, { label: 'Seeds draft', numeric: true }, { label: 'Planner', numeric: true }, { label: 'Planner − best', numeric: true }],
    overview.map((row) => [
      link(`#entry-${row.entry}`, row.entry), row.metric, escapeHtml(row.best?.method ?? dash), row.best ? row.best.value.toFixed(2) : dash, fixed(row.draft, 2), fixed(row.planner, 2),
      row.planner !== null && row.best ? `${row.planner - row.best.value >= 0 ? '+' : ''}${(row.planner - row.best.value).toFixed(2)}` : dash,
    ]));
  const tally = plannerTally(overview);
  return `${intro}
${tally ? `<p>${escapeHtml(tally)}</p>` : ''}
${overviewTable}
<p class="small">${link('results/summary.md', 'summary.md')} · each entry's JSON is linked under its table.</p>
${results.map(entryBlock).join('\n')}`;
}

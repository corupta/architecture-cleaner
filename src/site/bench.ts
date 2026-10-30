// The site's benchmarks page, from bench/results/*.json (BenchResult, src/bench/types.ts) alone: per entry, every
// method's scores on MoJoFM and on TurboMQ, the best deterministic method on each and the planner emphasized, honestly
// including where the planner loses. A real entry's MoJoFM is over its partial answer key. A missing results directory
// says "not recorded yet".
import fs from 'node:fs';
import path from 'node:path';
import { keyScoresByMethod } from '../bench/partial-key.js';
import { benchMetrics, bestDeterministicOn, hasMoJoFm, metricValue, type BenchMetric } from '../bench/repeats.js';
import type { BenchPartialKey, BenchResult, MethodScore } from '../bench/types.js';
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
const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

/** Names as prose: `a`, `a and b`, `a, b and c`. */
export const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** The planner's best row: the method of kind `planner` with the highest MoJoFM (or TurboMQ on real targets). */
export function plannerScore(result: BenchResult): MethodScore | null {
  const planners = result.methods.filter((method) => method.kind === 'planner');
  const score = (method: MethodScore) => (result.kind === 'scramble' ? method.mojoFm ?? -1 : method.turboMq.sum);
  return planners.sort((left, right) => score(right) - score(left) || compare(left.method, right.method))[0] ?? null;
}

/** Where the planner's calls came from: the cassette, this run's recordings into it, or both (call counts since S8). */
function plannerCalls(planner: NonNullable<BenchResult['planner']>): string {
  const cassette = code(planner.cassette);
  const { calls } = planner;
  if (!calls) return planner.replayed ? `replayed from ${cassette}` : `recorded into ${cassette}`;
  const total = calls.replayed + calls.recorded;
  const callCount = `${total} ${total === 1 ? 'call' : 'calls'}`;
  if (!calls.recorded) return `${callCount} replayed from ${cassette}`;
  if (!calls.replayed) return `${callCount} recorded into ${cassette}`;
  return `${calls.replayed} of ${callCount} replayed from ${cassette} and ${calls.recorded} recorded into it`;
}

/** The note `ac bench` adds when the validator rejects the planner's plan, with the validator's errors. */
const rejectionNote = /^The validator rejects the planner's plan \((.+)\); it is scored as it came back\.$/;

/**
 * Why our validator rejects the planner's plan (its errors, from the results' notes), or null when it accepts it. `ac run`
 * refuses such a plan; the bench scores it as it came back.
 */
export function plannerRejection(result: BenchResult): string | null {
  const planner = plannerScore(result);
  if (!planner?.note?.startsWith('invalid plan')) return null;
  return result.notes?.map((note) => rejectionNote.exec(note)?.[1]).find((reason) => reason !== undefined) ?? planner.note;
}

/**
 * A partial answer key in words, by its file: the name the page gives it and what it is; its derivation is in the
 * README next to it. A key not named here is "its partial key", the files its labeler (BenchPartialKey.source) labels.
 */
const keyWords: Record<string, { name: string; what: string; readme: string }> = {
  'bench/ground-truth/immich-2024.rsf': {
    name: '2024 key',
    what: "immich's March 2024 domain-layer feature folders followed through git history to the pinned commit",
    readme: 'bench/ground-truth/README.md',
  },
};

/** What an entry's MoJoFM is over, when it isn't the original folders: `over its 2024 key` on a real entry with a key; null otherwise. */
export function moJoFmScope(result: BenchResult): string | null {
  return result.partialKey ? `over its ${keyWords[result.partialKey.file]?.name ?? 'partial key'}` : null;
}

/** Where the key's files sit, by folder: `mostly in src/services/ (23) and src/dtos/ (22) with 2 elsewhere`. */
function keyFolders(key: BenchPartialKey): string {
  const filesByFolder = new Map<string, number>();
  for (const file of Object.keys(key.truth)) {
    const folder = `${path.posix.dirname(file)}/`;
    filesByFolder.set(folder, (filesByFolder.get(folder) ?? 0) + 1);
  }
  const folders = [...filesByFolder].sort(([left, leftFiles], [right, rightFiles]) => rightFiles - leftFiles || compare(left, right));
  const total = folders.reduce((sum, [, files]) => sum + files, 0);
  const most: [string, number][] = [];
  let covered = 0;
  for (const folder of folders) {
    if (covered * 2 > total) break;
    most.push(folder);
    covered += folder[1];
  }
  const named = list(most.map(([folder, files]) => `${folder} (${files})`));
  return covered === total ? `all in ${named}` : `mostly in ${named} with ${total - covered} elsewhere`;
}

/** What a real entry's partial key is and covers, in one sentence, from its record (BenchPartialKey); then what counts. */
function keyFacts(result: BenchResult, key: BenchPartialKey): string {
  const words = keyWords[key.file];
  const what = words ? escapeHtml(words.what) : `the files ${key.source ? escapeHtml(key.source) : 'its labeler'} labels`;
  const named = key.scoredFiles - key.hardFiles.length;
  const notMovable = key.notMovable.length ? ` ${count(key.notMovable.length)} more labeled ${key.notMovable.length === 1 ? 'path is' : 'paths are'} no movable file here and not scored.` : '';
  return `A real type-sliced target, with no complete ground truth. MoJoFM, ARI, c2c_cvg, the cluster ratio and MoJoFM hard are ${escapeHtml(moJoFmScope(result)!)}, ${what}: ${count(key.scoredFiles)} of the ${count(result.files)} movable files in ${count(key.features)} ${key.features === 1 ? 'feature' : 'features'}, ${escapeHtml(keyFolders(key))}; ${count(named)} of the ${count(key.scoredFiles)} are named after their feature (key ${code(key.file)}${words ? `, details in ${code(words.readme)} in the repository` : ''}). Every method places all ${count(result.files)}, and only those ${count(key.scoredFiles)} count.${notMovable} TurboMQ (higher is more modular) and back-edges (lower is better) cover every file.`;
}

/** One measure of an entry: the best deterministic method on it, the seeds draft and the planner; null where the entry has no value on it. */
export interface BenchMeasure {
  metric: BenchMetric;
  /** What MoJoFM is over on a real entry with a partial key (`over its 2024 key`), else null. */
  scope: string | null;
  best: { method: string; value: number } | null;
  draft: number | null;
  planner: number | null;
}

/** One entry of the overview: its measures and why the validator rejects the planner's plan. */
export interface BenchOverviewRow {
  entry: string;
  kind: BenchResult['kind'];
  /** MoJoFM, then TurboMQ. A real entry without a partial key has no MoJoFM: its values are null. */
  measures: BenchMeasure[];
  /** Why the validator rejects the planner's plan (plannerRejection), or null. */
  plannerRejection: string | null;
}

export function benchOverview(results: readonly BenchResult[]): BenchOverviewRow[] {
  return results.map((result) => {
    const draft = result.methods.find((method) => method.kind === 'draft');
    const planner = plannerScore(result);
    return {
      entry: result.entry,
      kind: result.kind,
      measures: benchMetrics.map((metric) => ({
        metric,
        scope: metric === 'MoJoFM' ? moJoFmScope(result) : null,
        best: bestDeterministicOn(result, metric),
        draft: draft ? metricValue(result, metric, draft) : null,
        planner: planner ? metricValue(result, metric, planner) : null,
      })),
      plannerRejection: plannerRejection(result),
    };
  });
}

const measureName = (measure: BenchMeasure) => (measure.scope ? `${measure.metric} ${measure.scope}` : measure.metric);

const measureColumns = [{ label: 'Measure' }, { label: 'Best deterministic method' }, { label: 'Best', numeric: true }, { label: 'Seeds draft', numeric: true }, { label: 'Planner', numeric: true }, { label: 'Planner − best', numeric: true }];

/** A measure's cells: the best deterministic method and its value, the seeds draft, the planner, the planner minus the best; the higher of the best and the planner bold. */
function measureCells(measure: BenchMeasure, rejection: string | null): string[] {
  const { best, planner } = measure;
  const top = Math.max(best?.value ?? -Infinity, planner ?? -Infinity);
  const bold = (value: number) => (value === top ? `<strong>${value.toFixed(2)}</strong>` : value.toFixed(2));
  const noValue = measure.metric === 'MoJoFM' && !best && planner === null;
  return [
    escapeHtml(measureName(measure)),
    best ? escapeHtml(best.method) : noValue ? 'none (no ground truth)' : dash,
    best ? bold(best.value) : dash,
    fixed(measure.draft, 2),
    planner === null ? dash : `${bold(planner)}${rejection ? ' <span class="muted small">(plan rejected)</span>' : ''}`,
    planner !== null && best ? signed(Number(planner.toFixed(2)) - Number(best.value.toFixed(2))) : dash,
  ];
}

/** The entry table's columns by index: the ground-truth measures (MoJoFM to MoJoFM hard) and the import graph's (clusters, TurboMQ, back-edges), each with the method and its kind. */
const truthColumns: ReadonlySet<number> = new Set([0, 1, 3, 4, 5, 6, 7]);
const graphColumns: ReadonlySet<number> = new Set([0, 1, 2, 8, 9]);

function entryBlock(result: BenchResult, row: BenchOverviewRow): string {
  const scramble = result.kind === 'scramble';
  const planner = plannerScore(result);
  const best = (metric: BenchMetric) => row.measures.find((measure) => measure.metric === metric)?.best?.method ?? null;
  const keyScores = result.partialKey ? keyScoresByMethod(result.partialKey) : null;
  /** A row's ground-truth scores: over the partial key on a real entry with one. */
  const truth = (method: MethodScore) => keyScores?.get(method.method) ?? method;
  /** The planner's row bold, the best on MoJoFM in the ground-truth columns and the best on TurboMQ in the graph's (all of them when one method is both). */
  const boldColumns = (method: MethodScore): ReadonlySet<number> | boolean => {
    if (method === planner) return true;
    const [onTruth, onGraph] = [method.method === best('MoJoFM'), method.method === best('TurboMQ')];
    return onTruth && onGraph ? true : onTruth ? truthColumns : onGraph ? graphColumns : false;
  };
  const rows = result.methods.map((method) => {
    const scores = truth(method);
    const cells = [
      escapeHtml(method.method) + (method.note && !method.note.startsWith('mean of seeds') ? ` <span class="muted small">(${escapeHtml(method.note)})</span>` : ''),
      escapeHtml(method.kind), clusters(method.clusters), fixed(scores.mojoFm, 2), fixed(scores.ari, 3), fixed(scores.c2cCvg, 3), fixed(scores.clusterCountRatio, 2), fixed(scores.mojoFmHard, 2),
      method.turboMq.sum.toFixed(2), clusters(method.backEdges),
    ];
    const bold = boldColumns(method);
    return cells.map((cell, column) => ((bold === true || (bold && bold.has(column))) && cell !== dash ? `<strong>${cell}</strong>` : cell));
  });
  const columns = [{ label: 'Method' }, { label: 'Kind' }, { label: 'Clusters', numeric: true }, { label: 'MoJoFM', numeric: true }, { label: 'ARI', numeric: true }, { label: 'c2c_cvg', numeric: true },
    { label: 'Cluster ratio', numeric: true }, { label: 'MoJoFM hard', numeric: true }, { label: 'TurboMQ', numeric: true }, { label: 'Back-edges', numeric: true }];
  const key = legend([
    { id: 'planner', label: 'the planner (Nemotron)', color: 'var(--s1)' },
    { id: 'best', label: 'the best deterministic method', color: 'var(--s2)' },
    { id: 'other', label: 'other methods', color: 'var(--neutral)' },
  ]);
  const scope = moJoFmScope(result);
  const chart = (metric: BenchMetric) => {
    const bars = horizontalBars(result.methods.map((method) => {
      const scores = truth(method);
      const value = metricValue(result, metric, method);
      return {
        label: method.method.length > 34 ? `${method.method.slice(0, 33)}…` : method.method,
        value: value ?? 0,
        valueLabel: metric === 'MoJoFM' ? fixed(value, 1) : `${method.turboMq.sum.toFixed(2)} · ${clusters(method.backEdges)} back-edges`,
        tip: `${method.method}\n${metric === 'MoJoFM' ? `MoJoFM ${fixed(value, 2)}, ARI ${fixed(scores.ari, 3)}` : `TurboMQ ${method.turboMq.sum.toFixed(2)}`}, ${clusters(method.clusters)} clusters, ${clusters(method.backEdges)} back-edges`,
        color: method === planner ? 'var(--s1)' : method.method === best(metric) ? 'var(--s2)' : 'var(--neutral)',
      };
    }), { labelWidth: 230, ...(metric === 'MoJoFM' ? { max: 100 } : {}) });
    const title = metric === 'TurboMQ' ? 'TurboMQ (sum of cluster factors)'
      : scramble ? 'MoJoFM against the original folders (0–100)' : `MoJoFM ${scope}'s ${count(result.partialKey!.scoredFiles)} files (0–100)`;
    return figure(title, `${key}${bars}`);
  };
  const where = [result.packageRoot, result.moduleRoot].filter(Boolean).join('/') || '.';
  const facts: string[] = [`Target ${code(where)} @ ${code(shortSha(result.sha))}, ${count(result.files)} movable files.`];
  if (result.scramble) {
    const certificate = result.scramble.certificate;
    facts.push(`Scrambled by our own executor in commit ${code(shortSha(result.scramble.commit))}: ${count(result.scramble.moved)} scored files moved into type folders (a test next to its source moves with it and isn't scored), ${count(result.scramble.declined)} declined (they stay), ${count(result.scramble.excluded)} excluded; ${certificate ? `certificate ${statusMark(certificate.verdict)} (${certificate.scope}${certificate.failing.length ? `, failing ${escapeHtml(certificate.failing.join(', '))}` : ''})` : 'not certified in this run'}.`);
    const leakage = result.leakage
      ? `${count(result.leakyFiles ?? 0)} of the movable files give their feature away in their path (${count(result.leakage.renamed)} renamed after it, ${count(result.leakage.inFeatureFolder)} still in a feature folder, ${count(result.leakage.underSubFolder)} under a sub-folder their feature kept; ${count(result.leakage.unseen)} more that no method sees are not counted)`
      : `${count(result.leakyFiles ?? 0)} leaky files`;
    facts.push(`Ground truth: ${count(result.featureFiles ?? 0)} feature files in ${count(result.groundTruthModules ?? 0)} original folders; ${count(result.hardFiles ?? 0)} hard files (their name doesn't give their feature away); ${leakage}.`);
  } else if (result.partialKey) {
    facts.push(keyFacts(result, result.partialKey));
  } else {
    facts.push('A real type-sliced target: no ground truth, so TurboMQ (higher is more modular) and back-edges (lower is better) only.');
  }
  facts.push(result.planner
    ? `Planner: ${result.planner.groups} groups${result.planner.modules === undefined ? '' : ` (${count(result.planner.modules)} modules)`}${result.draft ? `, from the ${escapeHtml(result.draft.method)}` : ''}, plan sha256 ${code(result.planner.planSha256.slice(0, 12))}, ${usd(result.planner.recordedCostUsd)} when recorded, ${plannerCalls(result.planner)} (${usd(result.planner.spentUsd)} spent by this run).`
    : 'Planner: not recorded yet.');
  const measures = table(measureColumns, row.measures.map((measure) => measureCells(measure, row.plannerRejection)));
  const louvainSeeds = result.louvainMojoFmByResolution
    ?? (result.partialKey ? Object.fromEntries(Object.entries(result.partialKey.louvainSeeds).map(([resolution, seeds]) => [resolution, seeds.map((seed) => seed.mojoFm)])) : null);
  const louvain = louvainSeeds && Object.keys(louvainSeeds).length
    ? details(`Louvain MoJoFM${scramble || !scope ? '' : ` ${escapeHtml(scope)}`} by resolution, seeds 1–5`, table([{ label: 'Resolution' }, { label: 'MoJoFM per seed' }], Object.entries(louvainSeeds).map(([resolution, values]) => [escapeHtml(resolution), escapeHtml(values.map((entry) => entry.toFixed(2)).join(', '))])), { className: 'more' })
    : '';
  const notes = result.notes?.length ? `<ul>${result.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : '';
  const charts = [...(hasMoJoFm(result) ? [chart('MoJoFM')] : []), chart('TurboMQ')];
  return `<h3 id="entry-${escapeHtml(result.entry)}">${escapeHtml(result.entry)} <span class="pill">${escapeHtml(result.kind)}${scramble ? `, ${escapeHtml(result.variant)}` : ''}</span></h3>
${facts.map((fact) => `<p class="small">${fact}</p>`).join('\n')}
${measures}
${notes}
${charts.join('\n')}
${details('Table view: every measure of every method', table(columns, rows), { className: 'table-view' })}
${louvain}
<p class="small">${link(`results/${result.entry}.json`, `${result.entry}.json`)}</p>`;
}

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

/**
 * How the planner did against the best deterministic method, entry by entry and on each measure (each has its own
 * best), from the overview. A plan our validator rejects is scored as it came back, so the tally says which plans those
 * are, why, and the wins without them.
 */
export function plannerTally(overview: readonly BenchOverviewRow[]): string {
  type Compared = { row: BenchOverviewRow; measure: BenchMeasure };
  const measured = benchMetrics.map((metric) => ({
    metric,
    compared: overview.flatMap((row): Compared[] => row.measures.filter((measure) => measure.metric === metric && measure.planner !== null && measure.best).map((measure) => ({ row, measure }))),
  })).filter(({ compared }) => compared.length);
  if (!measured.length) return '';
  const won = ({ measure }: Compared) => measure.planner! > measure.best!.value;
  const entries = (compared: Compared[]) => compared.map(({ row }) => row.entry);
  const clause = (names: string[], verb: string) => (names.length ? `${verb} on ${names.length} (${list(names)})` : '');
  const parts = measured.map(({ metric, compared }, index) => {
    const wins = entries(compared.filter(won));
    const losses = entries(compared.filter(({ measure }) => measure.planner! < measure.best!.value));
    const ties = entries(compared.filter(({ measure }) => measure.planner === measure.best!.value));
    const subject = index ? `on ${metric} it beats it` : `the planner beats the best deterministic method on ${metric}`;
    return `${subject} on ${wins.length} of ${compared.length} entries${wins.length ? ` (${list(wins)})` : ''}${[clause(ties, 'ties it'), clause(losses, 'and loses')].filter(Boolean).map((part) => `, ${part}`).join('')}`;
  });
  const scoped = measured.flatMap(({ compared }) => compared.filter(({ measure }) => measure.scope).map(({ row, measure }) => `${row.entry}'s ${measure.metric} is ${measure.scope}`));
  const own = measured.length > 1 ? ` Each measure has its own best deterministic method${scoped.length ? `, and ${list(scoped)}` : ''}.` : scoped.length ? ` ${list(scoped)}.` : '';
  const tally = `In these results ${parts.join('; ')}.${own}`;
  const rejected = overview.filter((row) => row.plannerRejection && measured.some(({ compared }) => compared.some((item) => item.row === row)));
  if (!rejected.length) return tally;
  const reasons = list(rejected.map((row) => `${row.entry} (${row.plannerRejection})`));
  const validWins = measured.map(({ metric, compared }) => {
    const wins = entries(compared.filter((item) => won(item) && !item.row.plannerRejection));
    return `on ${metric} on ${wins.length} of ${compared.length}${wins.length ? ` (${list(wins)})` : ''}`;
  });
  const withoutRejected = measured.some(({ compared }) => compared.some((item) => item.row.plannerRejection && won(item)))
    ? ` Counting only the plans the validator accepts, the planner wins ${validWins.join(' and ')}.` : '';
  return `${tally} Our own validator rejects the ${rejected.length === 1 ? 'plan' : 'plans'} of ${reasons}. ac run refuses such a plan; the bench scores it as it came back.${withoutRejected}`;
}

/** The benchmarks page's body; `plannerModels` is a section after the overview (the Super VL comparison, super-vl.ts), or empty. */
export function renderBenchBody(results: readonly BenchResult[], plannerModels = ''): string {
  const certificates = scrambleCertificatesLine(results);
  const real = results.some((result) => result.partialKey)
    ? "Real type-sliced targets have no complete ground truth: they get TurboMQ and back-edges, and where a target's own history labels some of its files (a partial answer key), MoJoFM and the rest over those files only."
    : 'Real type-sliced targets have no ground truth and get TurboMQ and back-edges only.';
  const intro = `<p>Can a planner recover a codebase's real feature boundaries? We flatten feature-modular repos into type folders, then score each method against the original folders: MoJoFM (0–100), ARI, c2c_cvg and the cluster-count ratio. TurboMQ needs no ground truth: it scores the import graph alone (many imports inside a module, few between modules), not whether the modules are the features. Every entry gets both MoJoFM and TurboMQ, each with its own best deterministic method.${certificates ? ` ${escapeHtml(certificates)}` : ''} Deterministic baselines are always shown next to the planner, because classic methods often win (ICSA 2026 found they beat LLM decompositions by 62% on MoJoFM, docs/plan.md §7; our G1 gate agrees on kaneo, docs/gates.md). ${escapeHtml(real)}</p>`;
  if (!results.length) return `${intro}<p><strong>Not recorded yet.</strong> The benchmark runs land in ${code('bench/results/')} (${code('ac bench bench/manifest.json')}); this page renders them when they do.</p>${plannerModels ? `\n${plannerModels}` : ''}`;
  const overview = benchOverview(results);
  const overviewTable = table([{ label: 'Entry' }, ...measureColumns],
    overview.flatMap((row) => row.measures.map((measure, index) => [index ? '' : link(`#entry-${row.entry}`, row.entry), ...measureCells(measure, row.plannerRejection)])));
  const tally = plannerTally(overview);
  return `${intro}
${tally ? `<p>${escapeHtml(tally)}</p>` : ''}
<p class="small">Bold: the higher of the best deterministic method and the planner on each measure.</p>
${overviewTable}
<p class="small">${link('results/summary.md', 'summary.md')} · each entry's JSON is linked under its table.</p>
${plannerModels ? `${plannerModels}\n` : ''}<h2 id="entries">Entry by entry</h2>
${results.map((result, index) => entryBlock(result, overview[index]!)).join('\n')}`;
}

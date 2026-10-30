// The benchmarks page's section on NVIDIA Nemotron 3.5 Super VL as the planner (S8b to S8d): three planner
// configurations, each a results directory under bench/experiments/s8b-super-vl with its runs per entry, read like
// bench/results. The table is each configuration's mean (min to max) per entry on MoJoFM and on TurboMQ, next to the
// best deterministic method; the prose takes its counts, means and cost from the same results, and quotes the write-up
// (its README) only for what the results don't hold: the permutation test and the time per plan.
import fs from 'node:fs';
import path from 'node:path';
import { benchMetrics, beatsBestOn, bestDeterministicOn, metricValue, plannerRunsOf, type BenchMetric } from '../bench/repeats.js';
import type { BenchResult } from '../bench/types.js';
import { code, escapeHtml, link, table } from '../report/html.js';
import { list, moJoFmScope, readBenchResults } from './bench.js';

/** The experiment's directory, package-relative; the site copies each configuration's results to the same path. */
export const superVlDirectory = 'bench/experiments/s8b-super-vl';

/** What the results don't hold, from the write-up's S8d section: the permutation test over the runs, and model time per plan (the ledger's latencies). */
const writeUp = { file: `${superVlDirectory}/README.md`, permutationP: '0.0007', timeRatio: '6.4' };

/** The configurations compared, in the table's order, by their results directory. */
const configurations = [
  { directory: 'ultra', label: 'Ultra (medium_effort)' },
  { directory: 'super-vl-direct', label: 'Super VL, thinking off' },
  { directory: 'super-vl-256k', label: 'Super VL, thinking on, 256k' },
] as const;

type ConfigurationDirectory = (typeof configurations)[number]['directory'];

export interface SuperVlConfiguration {
  directory: ConfigurationDirectory;
  label: string;
  results: BenchResult[];
}

export interface SuperVlExperiment {
  configurations: SuperVlConfiguration[];
}

/** The experiment's results, or null when the package has no such directory; a configuration without results is an error. */
export function readSuperVlExperiment(packageDirectory: string): SuperVlExperiment | null {
  const root = path.join(packageDirectory, superVlDirectory);
  if (!fs.existsSync(root)) return null;
  return {
    configurations: configurations.map(({ directory, label }) => {
      const results = readBenchResults(path.join(root, directory));
      if (!results.length) throw new Error(`${path.join(root, directory)}: no bench results`);
      return { directory, label, results };
    }),
  };
}

/** Each configuration's files the site copies (its results and their summary.md), package-relative, sorted. */
export function superVlFiles(packageDirectory: string, experiment: SuperVlExperiment): string[] {
  return experiment.configurations.flatMap(({ directory }) => fs.readdirSync(path.join(packageDirectory, superVlDirectory, directory))
    .filter((file) => file.endsWith('.json') || file === 'summary.md').sort()
    .map((file) => `${superVlDirectory}/${directory}/${file}`));
}

interface Spread { mean: number; min: number; max: number; runs: number }

/** A configuration's planner runs of an entry on a measure (each run as delivered), or null where it has none or a run has no value. */
function runsOn(result: BenchResult | undefined, metric: BenchMetric): Spread | null {
  if (!result) return null;
  const values = plannerRunsOf(result).map((run) => metricValue(result, metric, run.score));
  if (!values.length || !values.every((value): value is number => value !== null)) return null;
  return { mean: values.reduce((sum, value) => sum + value, 0) / values.length, min: Math.min(...values), max: Math.max(...values), runs: values.length };
}

const spreadText = (spread: Spread) => (spread.runs > 1 ? `${spread.mean.toFixed(2)} (${spread.min.toFixed(2)} to ${spread.max.toFixed(2)})` : spread.mean.toFixed(2));

/** Entries in the configurations' results: scrambles, then real targets, each in results order. */
function entriesOf(experiment: SuperVlExperiment): BenchResult[] {
  const first = new Map<string, BenchResult>();
  for (const { results } of experiment.configurations) for (const result of results) if (!first.has(result.entry)) first.set(result.entry, result);
  const all = [...first.values()];
  return [...all.filter((result) => result.kind === 'scramble'), ...all.filter((result) => result.kind !== 'scramble')];
}

const resultOf = (configuration: SuperVlConfiguration, entry: string) => configuration.results.find((result) => result.entry === entry);

function configuration(experiment: SuperVlExperiment, directory: ConfigurationDirectory): SuperVlConfiguration {
  return experiment.configurations.find((candidate) => candidate.directory === directory)!;
}

/** The table's rows: per entry, MoJoFM then TurboMQ, the best deterministic method and each configuration's runs; the highest bold. */
function tableRows(experiment: SuperVlExperiment): string[][] {
  return entriesOf(experiment).flatMap((first) => benchMetrics.map((metric, index) => {
    const found = experiment.configurations.map((candidate) => resultOf(candidate, first.entry));
    // The deterministic methods read the facts alone: one best per entry, unless the configurations scored different facts.
    const bests = experiment.configurations.flatMap((candidate, position) => {
      const best = found[position] && bestDeterministicOn(found[position], metric);
      return best ? [{ label: candidate.label, ...best }] : [];
    });
    const distinct = [...new Map(bests.map((best) => [`${best.method} ${best.value}`, best])).values()];
    const spreads = found.map((result) => runsOn(result, metric));
    const top = Math.max(...distinct.map((best) => best.value), ...spreads.map((spread) => spread?.mean ?? -Infinity));
    const bold = (value: number, text: string) => (value === top ? `<strong>${text}</strong>` : text);
    const bestCell = distinct.length
      ? distinct.map((best) => `${bold(best.value, best.value.toFixed(2))} <span class="muted small">${escapeHtml(best.method)}${distinct.length > 1 ? ` (${escapeHtml(best.label)})` : ''}</span>`).join('<br>')
      : '–';
    const scope = metric === 'MoJoFM' ? moJoFmScope(first) : null;
    const name = scope ? `MoJoFM ${scope} (${first.partialKey!.scoredFiles} of ${first.files} files)` : metric;
    return [index ? '' : escapeHtml(first.entry), escapeHtml(name), bestCell, ...spreads.map((spread) => (spread ? bold(spread.mean, spreadText(spread)) : '–'))];
  }));
}

/** `3`, or `1 to 3` when entries or configurations differ. */
function runsPerEntry(experiment: SuperVlExperiment): string {
  const counts = [...new Set(experiment.configurations.flatMap(({ results }) => results.map((result) => plannerRunsOf(result).length)))].sort((a, b) => a - b);
  return counts.length === 1 ? String(counts[0]) : `${counts[0]} to ${counts.at(-1)}`;
}

/** The reading, from the results: thinking on against Ultra on the scrambles' MoJoFM, the cost, TurboMQ, and the real targets. */
function reading(experiment: SuperVlExperiment): string {
  const ultra = configuration(experiment, 'ultra');
  const thinkingOn = configuration(experiment, 'super-vl-256k');
  const mean = (candidate: SuperVlConfiguration, entry: string, metric: BenchMetric) => runsOn(resultOf(candidate, entry), metric)?.mean ?? null;
  const entries = entriesOf(experiment);
  const scrambles = entries.filter((result) => result.kind === 'scramble');
  const above = scrambles.filter((result) => (mean(thinkingOn, result.entry, 'MoJoFM') ?? -Infinity) > (mean(ultra, result.entry, 'MoJoFM') ?? Infinity));
  const costPerRun = (candidate: SuperVlConfiguration) => {
    const runs = candidate.results.flatMap((result) => plannerRunsOf(result));
    return runs.reduce((sum, run) => sum + run.recordedCostUsd, 0) / runs.length;
  };
  const runs = experiment.configurations.flatMap(({ results }) => results.flatMap((result) => plannerRunsOf(result).map((run) => ({ result, run }))));
  const turboMqAbove = runs.filter(({ result, run }) => beatsBestOn(result, 'TurboMQ', run.score)).length;
  const onMoJoFm = above.length === scrambles.length ? `all ${scrambles.length} scrambles` : `${above.length} of the ${scrambles.length} scrambles`;
  const first = `With thinking on and room to finish (256k-token answers), Super VL's mean MoJoFM is above Ultra's on ${onMoJoFm} (a permutation test over the runs, stratified by entry, gives p ≈ ${writeUp.permutationP}), at ${(costPerRun(thinkingOn) / costPerRun(ultra)).toFixed(1)} times Ultra's cost and ${writeUp.timeRatio} times its time per plan.`;
  const real = entries.filter((result) => result.kind !== 'scramble').map((result) => {
    const scope = moJoFmScope(result);
    const pair = (metric: BenchMetric, name: string) => {
      const [on, against] = [mean(thinkingOn, result.entry, metric), mean(ultra, result.entry, metric)];
      return on === null || against === null ? '' : `${name} ${on.toFixed(2)} against Ultra's ${against.toFixed(2)}`;
    };
    return `${result.entry} (${[pair('TurboMQ', 'TurboMQ'), scope ? pair('MoJoFM', `MoJoFM ${scope}`) : ''].filter(Boolean).join(', ')})`;
  });
  const turboMq = `On TurboMQ ${turboMqAbove ? `${turboMqAbove} of the ${runs.length}` : `none of the ${runs.length}`} planner runs ${turboMqAbove === 1 ? 'scores' : 'score'} above the best deterministic method`;
  const second = real.length ? `${turboMq}, and on ${list(real)} we see no measurable difference between the two.` : `${turboMq}.`;
  const third = `The demo keeps Ultra. Among the reasons: the recorded demo run reproduces byte for byte with the frozen tool, and switching would mean new code and new recordings after the feature freeze; ${runsPerEntry(experiment)} runs per entry are few; in 11 of its 30 calls Super VL's long reasoning names the public project it is planning (ghostfolio, kaneo or immich), and in most of them tries to recall its structure; and Ultra was compared at medium_effort only, never at full thinking.`;
  return `${first} ${second} ${third}`;
}

/** The section: what was measured, the table, the raw results, the reading, and where the full write-up is. */
export function renderSuperVlSection(experiment: SuperVlExperiment): string {
  const columns = [{ label: 'Entry' }, { label: 'Measure' }, { label: 'Best deterministic method' },
    ...experiment.configurations.map(({ label }) => ({ label, numeric: true }))];
  const raw = experiment.configurations.map(({ directory }) => link(`${path.posix.relative('bench', superVlDirectory)}/${directory}/summary.md`, directory));
  return `<h2 id="super-vl">Nemotron 3.5 Super VL as the planner</h2>
<p>We measured NVIDIA Nemotron 3.5 Super VL as the planner in place of Nemotron 3 Ultra: the same pipeline, prompts and entries, ${runsPerEntry(experiment)} runs per entry for each configuration, with Super VL's thinking off, and on with room to finish (256k-token answers). Ultra was recorded afresh for this comparison; the overview's planner values above are one earlier draw per scramble, and immich's is the demo's recorded plan (planner rules 1). Each cell is the mean over the runs, min to max in parentheses, every run as delivered; bold is the highest on each row.</p>
${table(columns, tableRows(experiment))}
<p class="small">Each configuration's results: ${raw.join(', ')} (summary.md; each entry's JSON is next to it).</p>
<p>${escapeHtml(reading(experiment))}</p>
<p>The full write-up is ${code(writeUp.file)} in the repository.</p>`;
}

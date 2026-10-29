// `ac bench compare <results-dir>...`: the planner's runs from several results directories side by side, one planner
// configuration each. Per entry, on MoJoFM and on TurboMQ's sum each: the mean and the min to max over the runs as
// delivered, how many runs beat the best deterministic method on it, and where each mean falls against the other
// directories' ranges; then how many runs delivered the seeds draft because no edit choice was usable and how many
// choices the length cap cut, how many plans from an edit the validator accepts, modules, cost and tokens per run; then
// totals. A real entry's MoJoFM is over its partial key's files (dashes without one), and it says what the key covers.
// A pure function of the results: it states numbers, never a winner.
import fs from 'node:fs';
import path from 'node:path';
import { partialKeyScope } from './partial-key.js';
import { beatsBestOn, benchMetrics, bestDeterministicOn, configurationOf, configurationText, metricValue, plannerRunsOf, type BenchMetric, type PlannerRunView } from './repeats.js';
import { readResults } from './run.js';
import type { BenchResult } from './types.js';

export interface ComparedResults {
  /** The directory as given on the command line. */
  directory: string;
  /** Its name in the tables: the directory's base name, or the directory as given when two base names clash. */
  label: string;
  results: BenchResult[];
}

const dash = '–';
const code = (text: string) => `\`${text}\``;
const usd = (value: number) => `$${value.toFixed(4)}`;
const tokens = (value: number) => Math.round(value).toLocaleString('en-US');
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** Every BenchResult in each directory (summary.md and other files are skipped). */
export function readComparedResults(directories: string[]): ComparedResults[] {
  const baseNames = directories.map((directory) => path.basename(path.resolve(directory)));
  return directories.map((directory, index) => {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error(`${directory}: not a results directory`);
    const results = readResults(directory, { entries: [] });
    if (!results.length) throw new Error(`${directory}: no ac-bench/1 result in it`);
    const clashes = baseNames.filter((name) => name === baseNames[index]).length > 1;
    return { directory, label: clashes ? directory : baseNames[index]!, results };
  });
}

/** A measure over runs: its mean, and its min to max when there is more than one run. */
function spread(values: number[], format: (value: number) => string, formatMean = format): string {
  const [low, high] = [Math.min(...values), Math.max(...values)];
  return values.length > 1 ? `${formatMean(mean(values))} (${format(low)} to ${format(high)})` : format(values[0]!);
}

/** A count (back-edges, modules) as written, its mean with one decimal. */
const counted = (values: number[]) => spread(values, (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1)), (value) => value.toFixed(1));

/** One directory's runs on a measure: the mean of their values, and every value. */
interface Placed { label: string; value: number; values: number[] }

/** Places each directory's mean against the other directories' runs, as `- label: mean, inside the range (…) of other.` lines. */
function placements(means: Placed[], format: (value: number) => string): string[] {
  return means.map(({ label, value }) => {
    const against = means.filter((other) => other.label !== label).map((other) => `${placement(value, other.values, format)} of ${other.label}`);
    return `- ${label}: ${format(value)}, ${list(against)}.`;
  });
}

type Found = { set: ComparedResults; result: BenchResult | null }[];

/**
 * What a real entry's partial keys cover, and the best deterministic method on MoJoFM over them: one sentence each when
 * every directory's agrees, else one per directory; the directories with a result but no key are named (dashes).
 */
function keyLines(found: Found): string[] {
  const keyed = found.filter(({ result }) => result?.partialKey);
  if (!keyed.length) return ['No directory scores a partial key for this entry, so it has no MoJoFM: dashes.'];
  const scopes = keyed.map(({ set, result }) => ({
    label: set.label,
    text: `${partialKeyScope(result!.partialKey!, result!.files)} (key ${code(result!.partialKey!.file)}, sha256 ${code(result!.partialKey!.sha256.slice(0, 12))})`,
  }));
  const bests = keyed.flatMap(({ set, result }) => (result!.partialKey!.bestBaseline
    ? [{ label: set.label, text: `${result!.partialKey!.bestBaseline.method}, MoJoFM ${result!.partialKey!.bestBaseline.mojoFm.toFixed(2)}` }]
    : []));
  const one = <T extends { text: string }>(items: T[]) => new Set(items.map((item) => item.text)).size === 1;
  const where = (count: number) => (count === found.length ? ' in every directory' : count > 1 ? ` in the ${count} directories with a key` : '');
  const keyless = found.filter(({ result }) => result && !result.partialKey).map(({ set }) => set.label);
  return [
    one(scopes)
      ? `MoJoFM over the key is ${scopes[0]!.text}${where(scopes.length)}.`
      : `MoJoFM over the key is ${scopes.map((scope) => `${scope.text} in ${scope.label}`).join('; ')}.`,
    ...(bests.length ? [one(bests)
      ? `Best deterministic method on MoJoFM over the key: ${bests[0]!.text}${where(bests.length)}.`
      : `Best deterministic method on MoJoFM over the key: ${bests.map((best) => `${best.text} (${best.label})`).join('; ')}.`] : []),
    ...(keyless.length ? [`${list(keyless)} ${keyless.length === 1 ? 'scores' : 'score'} no key for this entry: dashes.`] : []),
  ];
}

/**
 * The best deterministic method on a measure (bestDeterministicOn): one sentence when every directory's agrees, else
 * each directory's with its planner rules, since the deterministic methods read the facts alone and a different best
 * means different facts (planner rules 2 changed immich's).
 */
function bestLine(found: Found, metric: BenchMetric): string {
  const bests = found.flatMap(({ set, result }) => {
    const best = result && bestDeterministicOn(result, metric);
    return best ? [{ label: set.label, rules: result.planner?.rules, text: `${best.method}, ${metric} ${best.value.toFixed(2)}` }] : [];
  });
  const texts = [...new Set(bests.map((best) => best.text))];
  if (!texts.length) return `Best deterministic method on ${metric}: none.`;
  if (texts.length > 1) {
    const differing = bests.map((best) => `${best.text} (${best.label}${best.rules === undefined ? '' : `, planner rules ${best.rules}`})`);
    return `Best deterministic method on ${metric}: ${differing.join('; ')}. The directories scored different facts.`;
  }
  const everywhere = bests.length === found.length ? ' in every directory' : bests.length > 1 ? ` in the ${bests.length} directories with this entry` : '';
  return `Best deterministic method on ${metric}: ${texts[0]}${everywhere}.`;
}

/** The configurations a directory's results asked for (one, normally). */
const configurationsOf = (set: ComparedResults) => [...new Set(set.results.map(configurationOf))];

/** Runs per entry in a directory: `3`, or `1 to 3` when its entries differ. */
function runsPerEntry(set: ComparedResults): number[] {
  return [...new Set(set.results.map((result) => plannerRunsOf(result).length).filter(Boolean))].sort((a, b) => a - b);
}

function header(sets: ComparedResults[]): string[] {
  const counts = [...new Set(sets.flatMap(runsPerEntry))].sort((a, b) => a - b);
  const k = counts.length === 1 ? counts[0]! : null;
  const conclusive = k === null
    ? `The directories have from ${counts[0] ?? 0} to ${counts.at(-1) ?? 0} runs per entry. A difference that falls inside another directory's min-to-max range isn't conclusive, and a single run has no range at all.`
    : k === 1
      ? 'Every directory has k=1 run per entry: one sample each, with no range to judge a difference by, so no difference here is conclusive.'
      : `Every directory has k=${k} runs per entry. A difference that falls inside the other directory's min-to-max range over k=${k} isn't conclusive.`;
  return [
    '# ac bench compare',
    '',
    `The planner's runs from ${sets.length} results ${sets.length === 1 ? 'directory' : 'directories'}, one planner configuration each (src/planner/configurations.ts). \`ac bench --repeats k\` runs the planner k times per entry through one gateway, so each run is a sample of its own; the deterministic methods run once.`,
    '',
    '| results | directory | configuration | models | runs per entry |',
    '|---|---|---|---|---|',
    ...sets.map((set) => {
      const configurations = configurationsOf(set);
      const runs = runsPerEntry(set);
      return `| ${set.label} | ${code(set.directory)} | ${configurations.map(code).join(', ')} | ${configurations.map(configurationText).join('; ')} | ${runs.length ? runs.length === 1 ? runs[0] : `${runs[0]} to ${runs.at(-1)}` : dash} |`;
    }),
    '',
    `- MoJoFM and TurboMQ's sum are each the mean over an entry's runs, the min to max in parentheses, every run as delivered: with the plan \`ac plan\` would give, which is the seeds draft when none of a run's edit choices came back usable. ${conclusive}`,
    "- Beat: the runs that score above the entry's best deterministic method (the baselines and the seeds draft) on that measure, MoJoFM or TurboMQ's sum: each measure has its own best. The totals count MoJoFM over the runs that have one.",
    '- Draft as the plan: the runs where none of the K edit choices came back usable (each one cut by the length cap or unparseable), so the seeds draft became the plan and the critic had nothing to review. Edit choices truncated: the choices the length cap cut (finish_reason length), of K per run. Critic ran: the runs whose winning edit the critic reviewed.',
    "- Valid plans from an edit: the runs whose plan came from an edit and that our validator accepts. A run that delivered the draft is no plan of the model, so it never counts here, whatever the validator says of the draft; `ac run` refuses an invalid plan, and the bench scores it as it came back.",
    `- Cost is what a run's edit and critic calls cost when they were recorded; tokens are the cassette's usage over those calls. ${dash} where a result doesn't record a count: tokens and edit choices in a result without a repeats block (before S8b, or one default run), and where the plan came from in a result written before the S7 fix round.`,
    ...(sets.some((set) => set.results.some((result) => result.kind === 'real'))
      ? ["- MoJoFM over the key: a real target has a MoJoFM only over the files its partial answer key labels, every method still placing every movable file, and its best deterministic method on MoJoFM is the best over those files. Each such entry says what its key covers; a real target without a key has dashes."]
      : []),
  ];
}

/**
 * Where a directory's mean falls against another's runs: inside its min to max, above or below it, judged on the values
 * as `format` prints them (a plain number), so a gap below the printed precision reads as inside.
 */
function placement(value: number, others: number[], format: (value: number) => string): string {
  const printed = (number: number) => Number(format(number));
  const [low, high] = [Math.min(...others), Math.max(...others)];
  const range = others.length > 1 ? `${format(low)} to ${format(high)}` : format(low);
  const shown = printed(value);
  return `${shown > printed(high) ? 'above' : shown < printed(low) ? 'below' : 'inside'} ${others.length > 1 ? 'the range' : 'the one run'} (${range})`;
}

/** `2 of 3`: the runs `holds` is true for; a dash when a run doesn't record it (null). */
function runsWhere(runs: PlannerRunView[], holds: (run: PlannerRunView) => boolean | null): string {
  const values = runs.map(holds);
  return values.includes(null) ? dash : `${values.filter(Boolean).length} of ${runs.length}`;
}

/** `4 of 9`: the edit choices the length cap cut, of K per run; a dash when a run doesn't record its choices. */
function truncatedChoices(runs: PlannerRunView[]): string {
  const choices = runs.map((run) => run.editChoices);
  if (choices.includes(null)) return dash;
  const known = choices as NonNullable<PlannerRunView['editChoices']>[];
  return `${known.reduce((sum, choice) => sum + choice.truncated, 0)} of ${known.reduce((sum, choice) => sum + choice.asked, 0)}`;
}

/** Where the runs' plans came from: draft as the plan, edit choices truncated, critic ran, valid plans from an edit. */
const origins = (runs: PlannerRunView[]) => [
  runsWhere(runs, (run) => (run.fromEdit === null ? null : !run.fromEdit)),
  truncatedChoices(runs),
  runsWhere(runs, (run) => run.criticRan),
  runsWhere(runs, (run) => (run.fromEdit === null ? null : run.fromEdit && run.valid)),
];

const originHeaders = ['draft as the plan', 'edit choices truncated', 'critic ran', 'valid plans from an edit'];

/** A table's header and separator rows. */
const tableHead = (headers: string[]) => [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`];

function entrySection(entry: string, sets: ComparedResults[]): string[] {
  const found = sets.map((set) => ({ set, result: set.results.find((result) => result.entry === entry) ?? null }));
  const first = found.find(({ result }) => result)!.result!;
  const real = first.kind === 'real';
  const format = (value: number) => value.toFixed(2);
  // A real entry's MoJoFM is over its partial key's files.
  const moJoFmName = real ? 'MoJoFM over the key' : 'MoJoFM';
  const headers = [
    'results', 'configuration', 'runs',
    `${moJoFmName} mean (min to max), as delivered`, 'beat the best deterministic on MoJoFM',
    'TurboMQ mean (min to max), as delivered', 'beat the best deterministic on TurboMQ',
    ...(real ? ['back-edges mean (min to max)'] : []),
    ...originHeaders, 'modules mean (min to max)', 'recorded cost per run', 'completion tokens per run', 'reasoning tokens per run',
  ];
  const lines = [
    `## ${entry} (${first.kind}${first.kind === 'scramble' ? `, ${first.variant}` : ''})`,
    '',
    ...(real ? keyLines(found) : [bestLine(found, 'MoJoFM')]),
    bestLine(found, 'TurboMQ'),
    '',
    ...tableHead(headers),
  ];
  const placed = new Map<BenchMetric, Placed[]>(benchMetrics.map((metric) => [metric, []]));
  for (const { set, result } of found) {
    const runs = result ? plannerRunsOf(result) : [];
    // No result for this entry: the directory's configuration stands in.
    const configurationCell = (result ? [configurationOf(result)] : configurationsOf(set)).map(code).join(', ');
    if (!runs.length) {
      const why = result ? 'no planner row (its notes say why)' : 'no result for this entry';
      lines.push(`| ${[set.label, configurationCell, '0', why, ...Array.from({ length: headers.length - 4 }, () => dash)].join(' | ')} |`);
      continue;
    }
    // Each measure's mean (min to max) and the runs above the best on it; dashes when a run has no value on it.
    const metricCells = benchMetrics.flatMap((metric) => {
      const values = runs.map((run) => metricValue(result!, metric, run.score));
      if (!values.every((value): value is number => value !== null)) return [dash, dash];
      placed.get(metric)!.push({ label: set.label, value: mean(values), values });
      return [spread(values, format), `${runs.filter((run) => beatsBestOn(result!, metric, run.score)).length} of ${runs.length}`];
    });
    const modules = runs.map((run) => run.modules);
    const tokenRuns = runs.map((run) => run.tokens);
    const known = tokenRuns.every((value) => value !== null) ? (tokenRuns as NonNullable<PlannerRunView['tokens']>[]) : null;
    const cells = [
      set.label,
      configurationCell,
      String(runs.length),
      ...metricCells,
      ...(real ? [counted(runs.map((run) => run.score.backEdges))] : []),
      ...origins(runs),
      modules.every((value) => value !== null) ? counted(modules as number[]) : dash,
      usd(mean(runs.map((run) => run.recordedCostUsd))),
      known ? tokens(mean(known.map((value) => value.completion))) : dash,
      known ? tokens(mean(known.map((value) => value.reasoning))) : dash,
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  for (const metric of benchMetrics) {
    const means = placed.get(metric)!;
    const name = metric === 'MoJoFM' && real ? 'MoJoFM mean over the key' : `${metric} mean`;
    if (means.length > 1) lines.push('', `Each ${name} against the other directories' runs:`, '', ...placements(means, format));
  }
  return lines;
}

function totals(sets: ComparedResults[]): string[] {
  const lines = [
    '## Totals',
    '',
    ...tableHead([
      'results', 'configuration', 'entries with runs', 'runs', 'beat the best deterministic on MoJoFM', 'beat the best deterministic on TurboMQ',
      ...originHeaders, 'recorded cost', 'recorded cost per run', 'completion tokens', 'reasoning tokens',
    ]),
  ];
  for (const set of sets) {
    const perEntry = set.results.map((result) => ({ result, runs: plannerRunsOf(result) })).filter(({ runs }) => runs.length);
    const runs = perEntry.flatMap(({ runs }) => runs);
    // Each measure over the runs that have it: a real entry without a key has no MoJoFM.
    const beat = (metric: BenchMetric) => {
      const beats = perEntry.flatMap(({ result, runs }) => runs.map((run) => beatsBestOn(result, metric, run.score))).filter((value) => value !== null);
      return beats.length ? `${beats.filter(Boolean).length} of ${beats.length}` : dash;
    };
    const cost = runs.reduce((sum, run) => sum + run.recordedCostUsd, 0);
    const known = runs.every((run) => run.tokens !== null);
    const sum = (pick: (value: NonNullable<PlannerRunView['tokens']>) => number) => (known ? tokens(runs.reduce((total, run) => total + pick(run.tokens!), 0)) : dash);
    lines.push(`| ${[
      set.label,
      configurationsOf(set).map(code).join(', '),
      String(perEntry.length),
      String(runs.length),
      ...benchMetrics.map(beat),
      ...origins(runs),
      usd(cost),
      runs.length ? usd(cost / runs.length) : dash,
      sum((value) => value.completion),
      sum((value) => value.reasoning),
    ].join(' | ')} |`);
  }
  return lines;
}

/** The compare report: the header, one section per entry (scrambles, then real targets, each by name), then totals. */
export function compareReport(sets: ComparedResults[]): string {
  const kinds = new Map(sets.flatMap((set) => set.results.map((result) => [result.entry, result.kind] as const)));
  const entries = [...kinds.keys()].sort((a, b) => (kinds.get(a) === kinds.get(b) ? byCodeUnit(a, b) : kinds.get(a) === 'scramble' ? -1 : 1));
  return `${[...header(sets), '', ...entries.flatMap((entry) => [...entrySection(entry, sets), '']), ...totals(sets)].join('\n')}\n`;
}

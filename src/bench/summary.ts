// bench/results/summary.md: one table per entry, rendered from the BenchResult files alone (a pure function, so the
// same results give the same bytes). The best deterministic method and the planner are bolded.
import { beatsBestDeterministic, configurationOf, configurationText } from './repeats.js';
import type { BenchPlannerRun, BenchRepeats, BenchResult, BenchRunMeasures, MethodScore } from './types.js';

const dash = '–';
const fixed = (value: number | null, digits: number) => (value === null ? dash : value.toFixed(digits));
/** The first 12 hex digits of a commit, tree or digest (`sha256:` dropped). */
const short = (hash: string) => hash.replace(/^sha256:/, '').slice(0, 12);
const code = (text: string) => `\`${text}\``;
const usd = (value: number) => `$${value.toFixed(4)}`;
const count = (value: number) => (Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(1));

/** Names as prose: `a`, `a and b`, `a, b and c`. */
const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** What our certifier said about each scramble commit, from the results (every sentence about a run comes from its data). */
function scrambleVerdicts(results: readonly BenchResult[]): string {
  const scrambles = results.filter((result) => result.scramble);
  if (!scrambles.length) return '';
  const passing = scrambles.filter((result) => result.scramble!.certificate?.verdict === 'pass').map((result) => result.entry);
  const failing = scrambles.filter((result) => result.scramble!.certificate?.verdict === 'fail').map((result) => `${result.entry} (${result.scramble!.certificate!.failing.join(', ') || 'no failing check named'})`);
  const unchecked = scrambles.filter((result) => !result.scramble!.certificate).map((result) => result.entry);
  const parts = [
    ...(passing.length ? [`${list(passing)} ${passing.length === 1 ? 'passes' : 'pass'}`] : []),
    ...(failing.length ? [`${list(failing)} ${failing.length === 1 ? 'fails' : 'fail'}`] : []),
    ...(unchecked.length ? [`${list(unchecked)} ${unchecked.length === 1 ? 'was' : 'were'} not certified in this run`] : []),
  ];
  return ` Our certifier checks that commit as a pure move: ${parts.join('; ')}. Verdict, scope and failing checks are per entry below; a scramble is scored whatever its verdict, since the ground truth is its original folders.`;
}

const header = (results: readonly BenchResult[], rulesStated: boolean, configurationsStated: boolean) => `# ac bench results

\`ac bench\` writes one JSON file per entry next to this summary (format \`ac-bench/1\`, src/bench/types.ts).

- **Scramble** entries flatten a feature-modular package into type folders with our own executor, in one commit.${scrambleVerdicts(results)}
- **Real** entries are type-sliced targets with no ground truth: TurboMQ and back-edges only.
- MoJoFM runs 0 to 100 (ARCADE port). ARI runs from −0.5 to 1. c2c_cvg is the share of ground-truth modules recovered
  (c2c above 0.66). The cluster ratio is predicted clusters over ground-truth clusters.
- MoJoFM hard counts only the files whose own name doesn't give their feature away.
- TurboMQ is Bunch's sum of cluster factors; the JSON also has ARCADE's mean. Back-edges are the cluster-level import
  edges that point backwards in the partition's own DAG order.
- Louvain rows are the mean of seeds 1 to 5. **Bold**: the best deterministic method (baselines and the seeds draft)
  and the planner.
${rulesStated ? plannerRulesNote : ''}${configurationsStated ? configurationsNote : ''}`;

/**
 * Said once a result records its planner rules (S8 on). From then on every entry with a planner row states its rules,
 * a result from before S8 included (entrySection), so the note's last sentence holds for any mix of results.
 */
const plannerRulesNote = `- Planner rules (src/planner/types.ts) say how the planner reads the target and Nemotron's answers and ranks its
  edits. Rules 2 (S8) read a move that names its file by the id the prompt showed, or its target by a draft group's id
  or key, never rank a plan without feature modules first while another candidate has one, and leave out of the facts'
  tables a Kysely common table expression's alias and any query call in a comment or a string. Rules 1 (S5 to S7)
  dropped such moves. A replay uses the rules its profile pins for its recording; each entry with a planner row says
  which it used.
`;

/** Said once a result names its planner configuration or has a repeats block (`--planner`, `--repeats` above 1; S8b on). */
const configurationsNote = `- A planner configuration (src/planner/configurations.ts) names the models that edit the draft and review the
  winner. With \`--repeats k\` the planner runs k times per entry through one gateway, so the cassette keys each
  repeated request by its occurrence and every run is a sample of its own; the deterministic methods run once. Each
  run has its row (\`#1\` to \`#k\`), and the entry's runs table adds where its plan came from (an edit, or the seeds
  draft when none of the K edit choices came back usable), its edit choices, whether the critic ran, the validator's
  verdict, the cost and the tokens. The mean, min and max take every run as delivered; the validator's count takes
  only the plans that came from an edit.
`;

function row(score: MethodScore, bold: boolean): string {
  const cells = [
    score.method + (score.note && !score.note.startsWith('mean of seeds') ? ` (${score.note})` : ''),
    Number.isInteger(score.clusters) ? String(score.clusters) : score.clusters.toFixed(1),
    fixed(score.mojoFm, 2),
    fixed(score.ari, 3),
    fixed(score.c2cCvg, 3),
    fixed(score.clusterCountRatio, 2),
    fixed(score.mojoFmHard, 2),
    score.turboMq.sum.toFixed(2),
    Number.isInteger(score.backEdges) ? String(score.backEdges) : score.backEdges.toFixed(1),
  ];
  return `| ${cells.map((cell) => (bold && cell !== dash ? `**${cell}**` : cell)).join(' | ')} |`;
}

/** Where the planner's answers came from: the cassette, this run's calls, or both (a run in auto mode records only the misses). */
function plannerSpend(planner: NonNullable<BenchResult['planner']>): string {
  const cassette = code(planner.cassette);
  const recordedCost = `$${planner.recordedCostUsd.toFixed(4)}`;
  const { calls } = planner;
  if (!calls) return planner.replayed ? `replayed from ${cassette} (recorded cost ${recordedCost}, this run spent $0)` : `recorded into ${cassette} for $${planner.spentUsd.toFixed(4)}`;
  const total = calls.replayed + calls.recorded;
  const callCount = `${total} ${total === 1 ? 'call' : 'calls'}`;
  if (!calls.recorded) return `replayed from ${cassette} (${callCount}, recorded cost ${recordedCost}, this run spent $0)`;
  if (!calls.replayed) return `recorded into ${cassette} (${callCount}) for $${planner.spentUsd.toFixed(4)}`;
  return `${calls.replayed} of ${callCount} replayed from ${cassette} and ${calls.recorded} recorded into it for $${planner.spentUsd.toFixed(4)} (the plan's calls cost ${recordedCost} when recorded)`;
}

const measures: [string, keyof BenchRunMeasures, (value: number) => string][] = [
  ['MoJoFM', 'mojoFm', (value) => value.toFixed(2)],
  ['ARI', 'ari', (value) => value.toFixed(3)],
  ['c2c_cvg', 'c2cCvg', (value) => value.toFixed(3)],
  ['cluster ratio', 'clusterCountRatio', (value) => value.toFixed(2)],
  ['MoJoFM hard', 'mojoFmHard', (value) => value.toFixed(2)],
  ['TurboMQ', 'turboMq', (value) => value.toFixed(2)],
  ['back-edges', 'backEdges', count],
  ['groups', 'groups', count],
  ['modules', 'modules', count],
  ['recorded cost', 'recordedCostUsd', usd],
  ['completion tokens', 'completionTokens', (value) => Math.round(value).toLocaleString('en-US')],
  ['reasoning tokens', 'reasoningTokens', (value) => Math.round(value).toLocaleString('en-US')],
];

/** `1 of 3 parsed (2 returned, 1 truncated)`: the edit's choices that parsed into an edit, of K. */
function editChoicesText({ editChoices: { asked, returned, parsed, truncated } }: BenchPlannerRun): string {
  const lost = [...(returned < asked ? [`${returned} returned`] : []), ...(truncated ? [`${truncated} truncated`] : [])];
  return `${parsed} of ${asked} parsed${lost.length ? ` (${lost.join(', ')})` : ''}`;
}

/** `1 of 3 runs`, `1 of 1 run`. */
const ofRuns = (part: number, runs: number, noun: string) => `${part} of ${runs} ${runs === 1 ? noun : `${noun}s`}`;

/**
 * The runs table, the mean, min and max over the runs as delivered, how many beat the best deterministic method, how
 * many delivered the seeds draft, how many edit choices the length cap cut, and how many plans from an edit pass the validator.
 */
function repeatsSection(result: BenchResult, repeats: BenchRepeats): string[] {
  const { runs } = repeats;
  const rows = new Map(result.methods.map((score) => [score.method, score]));
  const beat = runs.filter((run) => beatsBestDeterministic(result, rows.get(run.method)!)).length;
  const drafts = runs.filter((run) => !run.fromEdit).length;
  const reviewed = runs.filter((run) => run.criticRan).length;
  const truncated = runs.reduce((sum, run) => sum + run.editChoices.truncated, 0);
  const asked = runs.reduce((sum, run) => sum + run.editChoices.asked, 0);
  const valid = runs.filter((run) => run.fromEdit && run.valid).length;
  const calls = (run: BenchPlannerRun) => [run.calls.replayed ? `${run.calls.replayed} replayed` : '', run.calls.recorded ? `${run.calls.recorded} recorded` : ''].filter(Boolean).join(', ') || 'none';
  const lines = [
    '',
    `Planner runs (${code(configurationOf(result))}):`,
    '',
    '| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...runs.map((run) => `| ${[
      run.method,
      run.fromEdit ? 'an edit' : 'the seeds draft',
      editChoicesText(run),
      run.criticRan ? 'yes' : 'no',
      run.valid ? 'yes' : `no (${run.validatorErrors} ${run.validatorErrors === 1 ? 'error' : 'errors'})`,
      run.groups, run.modules, usd(run.recordedCostUsd), usd(run.spentUsd), calls(run),
      count(run.tokens.prompt), count(run.tokens.completion), count(run.tokens.reasoning), code(short(run.planSha256)),
    ].join(' | ')} |`),
  ];
  if (runs.length > 1) {
    const shown = measures.filter(([, field]) => repeats.mean[field] !== null);
    lines.push(
      '',
      `| over the ${runs.length} runs, as delivered | ${shown.map(([label]) => label).join(' | ')} |`,
      `|---|${shown.map(() => '---').join('|')}|`,
      ...(['mean', 'min', 'max'] as const).map((statistic) => `| ${statistic} | ${shown.map(([, field, format]) => format(repeats[statistic][field]!)).join(' | ')} |`),
    );
  }
  const measure = result.kind === 'scramble' ? 'MoJoFM' : "TurboMQ's sum";
  lines.push('', [
    `${beat} of ${runs.length} ${runs.length === 1 ? 'run scores' : 'runs score'} above the best deterministic method on ${measure}, each run as delivered.`,
    `${ofRuns(drafts, runs.length, 'run')} had no usable edit${drafts ? `, so the seeds draft became ${drafts === 1 ? 'its' : 'their'} plan` : ''}; the critic reviewed ${ofRuns(reviewed, runs.length, 'plan')};`,
    `${truncated} of ${asked} edit choices ${truncated === 1 ? 'was' : 'were'} cut by the length cap (finish_reason length).`,
    `The validator accepts ${ofRuns(valid, runs.length, 'plan')}, counting only plans that came from an edit.`,
  ].join(' '));
  return lines;
}

const configurationStated = (result: BenchResult) => result.plannerConfiguration !== undefined || result.repeats !== undefined;

/** `- Planner configuration `super-vl`: Nemotron 3.5 Super VL (thinking on) edits and reviews; 3 runs through one gateway.` */
function configurationLine(result: BenchResult): string {
  const configuration = configurationOf(result);
  const runs = result.repeats?.runs.length ?? 0;
  return `- Planner configuration ${code(configuration)}: ${configurationText(configuration)}${runs > 1 ? `; ${runs} runs through one gateway` : ''}.`;
}

function entrySection(result: BenchResult, rulesStated: boolean): string {
  const lines = [`## ${result.entry} (${result.kind}${result.kind === 'scramble' ? `, ${result.variant}` : ''})`, ''];
  const where = [result.packageRoot, result.moduleRoot].filter(Boolean).join('/') || '.';
  lines.push(`- Target: ${code(result.repo)} ${code(where)} @ ${code(short(result.sha))}.`);
  if (result.scramble) {
    const { scramble } = result;
    const certificate = scramble.certificate
      ? `certificate ${scramble.certificate.verdict.toUpperCase()} (${scramble.certificate.scope})${scramble.certificate.failing.length ? `, failing ${scramble.certificate.failing.join(', ')}` : ''}, digest ${code(short(scramble.certificate.digest))}`
      : 'not certified';
    lines.push(`- Scramble: commit ${code(short(scramble.commit))}, ${scramble.moved} files moved, ${scramble.declined} declined by the executor (they stay), ${scramble.excluded} excluded; ${certificate}.`);
    const leaky = result.leakage ? `${result.leakyFiles} of the movable files give their feature away in their path (the leakage note below)` : `${result.leakyFiles} files give their feature away (leaky renames and files left in a feature folder)`;
    lines.push(`- Scored: ${result.featureFiles} feature files in ${result.groundTruthModules} modules (${result.hardFiles} hard), of ${result.files} movable files. ${leaky}.`);
  } else {
    lines.push(`- ${result.files} movable files; no ground truth.`);
  }
  if (result.bestBaseline) {
    const value = result.kind === 'scramble' ? `MoJoFM ${fixed(result.bestBaseline.mojoFm, 2)}` : `TurboMQ ${result.bestBaseline.turboMq.toFixed(2)}`;
    lines.push(`- Best deterministic method: ${result.bestBaseline.method}, ${value}.`);
  }
  if (result.planner) {
    const { planner } = result;
    const groups = `${planner.groups} groups${planner.modules === undefined ? '' : ` (${planner.modules} modules)`}${result.draft ? `, from the ${result.draft.method}` : ''}`;
    // A result written before S8 has no rules field: it used rules 1, said once the header explains rules.
    const rules = planner.rules !== undefined ? `; planner rules ${planner.rules}` : rulesStated ? "; planner rules 1 (from before S8, which didn't record them)" : '';
    const runs = result.repeats?.runs.length ?? 1;
    if (configurationStated(result)) lines.push(configurationLine(result));
    lines.push(`- Planner${runs > 1 ? `, run 1 of ${runs} (the runs table has every run)` : ''}: ${plannerSpend(planner)}; ${groups}${rules}; plan.yaml sha256 ${code(short(planner.planSha256))}.`);
  } else {
    if (configurationStated(result)) lines.push(configurationLine(result));
    lines.push('- Planner: no row (see the notes).');
  }
  lines.push('', '| method | clusters | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges |', '|---|---|---|---|---|---|---|---|---|');
  for (const score of result.methods) lines.push(row(score, score.kind === 'planner' || score.method === result.bestBaseline?.method));
  if (result.louvainMojoFmByResolution) {
    const perSeed = Object.entries(result.louvainMojoFmByResolution).map(([resolution, values]) => `r=${resolution}: ${values.map((value) => value.toFixed(2)).join(', ')}`);
    lines.push('', `Louvain MoJoFM per seed (1 to 5): ${perSeed.join('; ')}.`);
  }
  if (result.repeats) lines.push(...repeatsSection(result, result.repeats));
  if (result.notes?.length) lines.push('', ...result.notes.map((note) => `- ${note}`));
  return lines.join('\n');
}

export function benchSummary(results: readonly BenchResult[]): string {
  const rulesStated = results.some((result) => result.planner?.rules !== undefined);
  const configurationsStated = results.some(configurationStated);
  if (!results.length) return `${header(results, rulesStated, configurationsStated)}\nNo results recorded yet.\n`;
  return `${header(results, rulesStated, configurationsStated)}\n${results.map((result) => entrySection(result, rulesStated)).join('\n\n')}\n`;
}

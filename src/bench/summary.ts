// bench/results/summary.md: one table per entry, rendered from the BenchResult files alone (a pure function, so the
// same results give the same bytes). The best deterministic method and the planner are bolded.
import type { BenchResult, MethodScore } from './types.js';

const dash = '–';
const fixed = (value: number | null, digits: number) => (value === null ? dash : value.toFixed(digits));
/** The first 12 hex digits of a commit, tree or digest (`sha256:` dropped). */
const short = (hash: string) => hash.replace(/^sha256:/, '').slice(0, 12);
const code = (text: string) => `\`${text}\``;

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

const header = (results: readonly BenchResult[]) => `# ac bench results

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
${results.some((result) => result.planner?.rules !== undefined) ? plannerRulesNote : ''}`;

/** Said once results record the planner rules (S8 on). */
const plannerRulesNote = `- Planner rules (src/planner/types.ts) say how the planner reads the target and Nemotron's answers and ranks its
  edits. Rules 2 (S8) read a move that names its file by the id the prompt showed, or its target by a draft group's id
  or key, never rank a plan without feature modules first while another candidate has one, and leave a Kysely common
  table expression's alias out of the facts' tables (no scramble entry has one). Rules 1 (S5 to S7) dropped such moves.
  A replay uses the rules its profile pins for its recording; each entry says which it used.
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

function entrySection(result: BenchResult): string {
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
    const rules = planner.rules === undefined ? '' : `; planner rules ${planner.rules}`;
    lines.push(`- Planner: ${plannerSpend(planner)}; ${groups}${rules}; plan.yaml sha256 ${code(short(planner.planSha256))}.`);
  } else {
    lines.push('- Planner: no row (see the notes).');
  }
  lines.push('', '| method | clusters | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges |', '|---|---|---|---|---|---|---|---|---|');
  for (const score of result.methods) lines.push(row(score, score.kind === 'planner' || score.method === result.bestBaseline?.method));
  if (result.louvainMojoFmByResolution) {
    const perSeed = Object.entries(result.louvainMojoFmByResolution).map(([resolution, values]) => `r=${resolution}: ${values.map((value) => value.toFixed(2)).join(', ')}`);
    lines.push('', `Louvain MoJoFM per seed (1 to 5): ${perSeed.join('; ')}.`);
  }
  if (result.notes?.length) lines.push('', ...result.notes.map((note) => `- ${note}`));
  return lines.join('\n');
}

export function benchSummary(results: readonly BenchResult[]): string {
  if (!results.length) return `${header(results)}\nNo results recorded yet.\n`;
  return `${header(results)}\n${results.map(entrySection).join('\n\n')}\n`;
}

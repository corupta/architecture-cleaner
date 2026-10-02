// Real plan for a target without ground truth (G1 last step): immich server/ @ pinned SHA.
// Pins follow plan §2.4; the winner among Super ×2 and Ultra ×1 is picked by validator metrics only.
//   node g1/plan-real.mjs immich > ~/ac-work/g1/immich-plan.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildView, realEntities } from './view.mjs';
import { seedsWithPropagation } from './baselines.mjs';
import { runEditPlanner, planAssignment, evaluatePlan } from './planner.mjs';
import { turboMqClusterFactors } from './metrics/index.mjs';

const targets = {
  immich: {
    graph: 'immich.graph.json',
    moduleRoot: 'src',
    // Pinned (plan §2.4 / §2.6): schema + migrations, workers, bin, emails, the entrypoint, and location-sensitive files.
    pins: [/^src\/schema\//, /^src\/workers\//, /^src\/bin\//, /^src\/emails\//, /^src\/main\.ts$/],
  },
};

const workDir = path.join(os.homedir(), 'ac-work/g1');
const [targetName, ...options] = process.argv.slice(2);
const v1b = options.includes('--v1b');
const version = v1b ? 'v1b' : 'v1';
// --summarize <label>: write the one-pager for this candidate instead of the TurboMQ winner.
const forcedLabel = options.includes('--summarize') ? options[options.indexOf('--summarize') + 1] : null;
const target = targets[targetName];
const graph = JSON.parse(fs.readFileSync(path.join(workDir, target.graph), 'utf8'));
const locationSensitive = graph.files.filter((file) => file.locationSensitive && !file.isTest).map((file) => file.id);
const pinned = graph.files.filter((file) => !file.isTest && file.id.startsWith(`${target.moduleRoot}/`) && (target.pins.some((pattern) => pattern.test(file.id)) || locationSensitive.includes(file.id))).map((file) => file.id);
const entities = realEntities(graph, { moduleRoot: target.moduleRoot, exclude: [...target.pins, ...locationSensitive.map((id) => new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))] });
const view = buildView(graph, entities);
const draft = seedsWithPropagation(view);

const superRun = await runEditPlanner({ runId: 'g1', modelKey: 'super', view, draft, samples: 2, label: `${targetName}/${version}/super`, ...(v1b ? { templateKwargs: { low_effort: true }, evaluateRounds: 0 } : {}) });
const ultraRun = await runEditPlanner({ runId: 'g1', modelKey: 'ultra', view, draft, samples: 1, templateKwargs: { medium_effort: true }, label: `${targetName}/${version}/ultra`, ...(v1b ? { evaluateRounds: 0 } : {}) });
const candidates = [...superRun.results.map((result) => ({ result, facts: superRun.facts })), ...ultraRun.results.map((result) => ({ result, facts: ultraRun.facts }))]
  .filter(({ result }) => result.finalPlan)
  .map(({ result, facts }) => ({ label: result.label, plan: result.finalPlan, facts, evaluation: evaluatePlan(result.finalPlan, facts, view) }));
const groupsInCycles = (evaluation) => evaluation.groupCycles.reduce((sum, cycle) => sum + cycle.length, 0);
// Bunch-style TurboMQ (sum of cluster factors): rewards cohesive, loosely coupled groups without rewarding one big lump.
const turboMqSum = (candidate) => [...turboMqClusterFactors(planAssignment(candidate.plan, candidate.facts), view.edges).values()].reduce((sum, factor) => sum + factor, 0);
for (const candidate of candidates) candidate.turboMqSum = +turboMqSum(candidate).toFixed(2);
const draftCandidate = { label: 'deterministic draft', turboMqSum: +[...turboMqClusterFactors(draft.assignment, view.edges).values()].reduce((sum, factor) => sum + factor, 0).toFixed(2) };
candidates.sort((a, b) => b.turboMqSum - a.turboMqSum);
const winner = (forcedLabel && candidates.find((candidate) => candidate.label === forcedLabel)) || candidates[0];
fs.writeFileSync(path.join(workDir, `${targetName}-plan.${version}.json`), JSON.stringify({ sha: graph.sha, pinned, candidates: candidates.map(({ facts, ...rest }) => rest), superRun: superRun.results, ultraRun: ultraRun.results }, null, 1));

const assignment = planAssignment(winner.plan, winner.facts);
const nodeOf = new Map(view.nodes.map((node) => [node.key, node]));
const groups = new Map();
for (const [key, name] of assignment) groups.set(name, [...(groups.get(name) ?? []), key]);
const roleMix = (keys) => {
  const counts = {};
  for (const key of keys) counts[nodeOf.get(key).type] = (counts[nodeOf.get(key).type] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([role, count]) => `${count} ${role}`).join(', ');
};
const lines = [];
lines.push(`# immich server/ plan v1 (G1), for corupta to rate 1–5`, '');
lines.push(`immich-app/immich \`server/\` @ \`${graph.sha.slice(0, 10)}\` (AGPL-3.0; paths below are excerpts of that tree). Planner v1 (edit the draft): deterministic facts + seeds draft → Nemotron names/merges draft groups and moves misplaced files (json_schema strict) → 1 evaluate round. Shown: **${winner.label}**${forcedLabel ? ' (chosen by hand: see the candidates line)' : ' (TurboMQ winner; no ground truth)'}.`, '');
lines.push(`- Movable files planned: **${view.nodes.length}**; pinned and left in place: **${pinned.length}** (schema/migrations, workers, bin, emails, main.ts, and ${locationSensitive.length} location-sensitive files: ${locationSensitive.map((id) => `\`${id}\``).join(', ')}).`);
lines.push(`- Groups: **${winner.evaluation.groups}**; files in shared/platform: ${winner.evaluation.sharedOrPlatformFiles}; cross-group edge ratio ${winner.evaluation.crossGroupEdgeRatio}; group cycles: ${winner.evaluation.groupCycles.length ? winner.evaluation.groupCycles.map((cycle) => `${cycle.length} groups`).join(', ') : 'none'}; files pulled harder toward another group: ${winner.evaluation.graphDisagreementCount}.`);
lines.push(`- Candidates (TurboMQ sum, groups, groups in cycles, cross-edge ratio): ${candidates.map((candidate) => `${candidate.label} (${candidate.turboMqSum}, ${candidate.evaluation.groups}, ${groupsInCycles(candidate.evaluation)}, ${candidate.evaluation.crossGroupEdgeRatio})`).join('; ')}; ${draftCandidate.label} (${draftCandidate.turboMqSum}).`, '');
lines.push('**Rating question:** would you accept this plan after changing ≤10% of placements (≈' + Math.ceil(view.nodes.length / 10) + ' files)? 1 = no, 3 = yes with ≤10% changes, 5 = as is.', '');
lines.push('## Groups', '', '| group | files | roles | examples |', '|---|---|---|---|');
for (const [name, keys] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const examples = keys.slice(0, 4).map((key) => `\`${key.replace(/^src\//, '')}\``).join(', ') + (keys.length > 4 ? ', …' : '');
  lines.push(`| ${name} | ${keys.length} | ${roleMix(keys)} | ${examples} |`);
}
lines.push('', '## Contested files (planner rationale)', '');
for (const item of winner.plan.contested.slice(0, 40)) {
  const key = winner.facts.keys[item.file - 1];
  lines.push(`- \`${key?.replace(/^src\//, '') ?? `#${item.file}`}\` → ${item.group}: ${item.rationale}`);
}
if (winner.plan.contested.length > 40) lines.push(`- … ${winner.plan.contested.length - 40} more in ~/ac-work/g1/${targetName}-plan.json`);
lines.push('', '## Validator: strongest graph disagreements left in the plan', '');
for (const item of winner.evaluation.graphDisagreements.slice(0, 12)) lines.push(`- \`${winner.facts.keys[item.id - 1].replace(/^src\//, '')}\` in ${item.own} (${item.ownShare} of its edge weight) but pulled to ${item.pulledTo} (${item.share})`);
process.stdout.write(lines.join('\n') + '\n');

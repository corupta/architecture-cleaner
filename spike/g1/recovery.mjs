// Real-world recovery (plan §2.6, secondary): immich @6e93ddf2 (type-sliced, 2024-03-22) scored against the
// maintainers' former domain/<feature>/ folders @40262c30, mapped by the G2 recovery agent (gt.rsf).
// Baselines and the v1 planner see every movable file; scores count only the ground-truth files.
//   node g1/recovery.mjs [--v1]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyze } from './analyzer.mjs';
import { buildView, realEntities } from './view.mjs';
import { typeFolders, nameTokenAnchored, nameTokenFullStem, louvainClusters, seedsWithPropagation, exportTokens } from './baselines.mjs';
import { runEditPlanner, planAssignment } from './planner.mjs';
import { readRsf, mojoFm, adjustedRandIndex, c2cCvg } from './metrics/index.mjs';
import { matchedAccuracy } from './matching.mjs';

const recoveryDir = path.join(os.homedir(), 'ac-work/g2/immich-recovery');
const archive = path.join(recoveryDir, 'after');
const trackedFiles = execFileSync('find', ['server/src', '-type', 'f', '-name', '*.ts'], { cwd: archive, encoding: 'utf8' }).trim().split('\n');
const graph = analyze({ repoDir: archive, packageRoot: 'server', trackedFiles });
const truthAll = readRsf(path.join(recoveryDir, 'gt.rsf'));
const truth = new Map([...truthAll].map(([object, cluster]) => [object.replace(/^server\//, ''), cluster]));
const entities = realEntities(graph, { moduleRoot: 'src', exclude: [/^src\/infra\/migrations\//, /^src\/migrations\//, /^src\/main\.ts$/] });
const view = buildView(graph, entities);
const keys = [...truth.keys()].filter((key) => view.nodes.some((node) => node.key === key)).sort();
const restrict = (assignment) => new Map(keys.map((key) => [key, assignment.get(key)]));
const score = (assignment) => ({
  mojoFm: +mojoFm(restrict(assignment), restrict(truth)).toFixed(2),
  ari: +adjustedRandIndex(restrict(assignment), restrict(truth)).toFixed(3),
  c2cCvg: +c2cCvg(restrict(truth), restrict(assignment), { threshold: 0.66 }).toFixed(3),
  matchedAccuracy: +matchedAccuracy(assignment, truth, keys)(keys).toFixed(3),
});
const draft = seedsWithPropagation(view);
const rows = {
  'B0 type-folders': score(typeFolders(view, 'src')),
  'name-token (full stem)': score(nameTokenFullStem(view)),
  'name-token (anchored)': score(nameTokenAnchored(view).assignment),
  'export-token (anchored)': score(nameTokenAnchored(view, exportTokens).assignment),
  'seeds + LP (file names)': score(draft.assignment),
  'Louvain res=4 (seed 1)': score(louvainClusters(view, { seed: 1, resolution: 4 })),
};
const llm = [];
if (process.argv.includes('--v1')) {
  const run = await runEditPlanner({ runId: 'g1', modelKey: 'super', view, draft, samples: 2, label: 'immich-2024/v1/super' });
  for (const result of run.results) {
    if (result.error) llm.push({ label: result.label, error: result.error });
    else {
      rows[`${result.label} turn 1`] = score(planAssignment(result.turn1.plan, run.facts));
      rows[`${result.label} final`] = score(planAssignment(result.finalPlan, run.facts));
      llm.push(result);
    }
  }
}
fs.writeFileSync(path.join(os.homedir(), 'ac-work/g1/results/immich-2024-recovery.json'), JSON.stringify({ entities: view.nodes.length, groundTruthFiles: keys.length, groundTruthModules: new Set(keys.map((key) => truth.get(key))).size, rows, llm }, null, 1));
console.log(`immich 2024 recovery: ${view.nodes.length} movable files planned, scored on ${keys.length} ground-truth files in ${new Set(keys.map((key) => truth.get(key))).size} features`);
console.log('| method | MoJoFM | ARI | c2c_cvg@0.66 | matched acc |\n|---|---|---|---|---|');
for (const [name, row] of Object.entries(rows)) console.log(`| ${name} | ${row.mojoFm} | ${row.ari} | ${row.c2cCvg} | ${row.matchedAccuracy} |`);

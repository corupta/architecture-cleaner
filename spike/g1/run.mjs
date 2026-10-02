// G1 boundary spike runner: virtual scramble → baselines → planner (Super ×2 samples, Ultra ×1) → metrics.
//   node g1/run.mjs <bench> [--no-llm]      bench ∈ realworld | hoppscotch | kaneo | hoppscotch-H1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scramble, manifests } from './scramble.mjs';
import { buildView } from './view.mjs';
import { typeFolders, nameTokenFullStem, nameTokenAnchored, louvainClusters, seedsWithPropagation, exportTokens, nameTokens } from './baselines.mjs';
import { matchedAccuracy } from './matching.mjs';
import { runPlanner, runEditPlanner, planAssignment } from './planner.mjs';
import * as metrics from './metrics/index.mjs';

const benches = {
  realworld: { manifestKey: 'mikro-orm-realworld', graph: 'realworld.graph.json', nameMode: 'default' },
  hoppscotch: { manifestKey: 'hoppscotch', graph: 'hoppscotch.graph.json', nameMode: 'default' },
  kaneo: { manifestKey: 'kaneo', graph: 'kaneo.graph.json', nameMode: 'default' },
  'hoppscotch-H1': { manifestKey: 'hoppscotch', graph: 'hoppscotch.graph.json', nameMode: 'H1' },
};
const workDir = path.join(os.homedir(), 'ac-work/g1');

const restrict = (assignment, keys) => new Map(keys.map((key) => [key, assignment.get(key)]));

// A ground-truth label as name tokens: 'plugins/github' → 'github', 'team-collections' → 'team-collection'.
const labelTokens = (label) => nameTokens(label.split('/').pop()).join('-');

function score(assignment, truth, featureKeys, hardKeys) {
  const predicted = restrict(assignment, featureKeys);
  const authoritative = restrict(truth, featureKeys);
  const predictedHard = restrict(assignment, hardKeys);
  const authoritativeHard = restrict(truth, hardKeys);
  const accuracyOn = matchedAccuracy(assignment, truth, featureKeys);
  return {
    mojoFm: +metrics.mojoFm(predicted, authoritative).toFixed(2),
    ari: +metrics.adjustedRandIndex(predicted, authoritative).toFixed(3),
    // Share of ground-truth modules recovered (c2c > 0.66), i.e. ARCADE Cvg.run(gt, tool).
    c2cCvg: +metrics.c2cCvg(authoritative, predicted, { threshold: 0.66 }).toFixed(3),
    clusterCountRatio: +metrics.clusterCountRatio(predicted, authoritative).toFixed(2),
    matchedAccuracy: +accuracyOn(featureKeys).toFixed(3),
    mojoFmHard: hardKeys.length > 1 ? +metrics.mojoFm(predictedHard, authoritativeHard).toFixed(2) : null,
    matchedAccuracyHard: hardKeys.length ? +accuracyOn(hardKeys).toFixed(3) : null,
  };
}

async function main() {
  const [benchName, flag = ''] = process.argv.slice(2);
  const bench = benches[benchName];
  if (!bench) throw new Error(`unknown bench ${benchName}`);
  const graph = JSON.parse(fs.readFileSync(path.join(workDir, bench.graph), 'utf8'));
  const manifest = manifests[bench.manifestKey];
  const scrambled = scramble(graph, manifest, { nameMode: bench.nameMode });
  const view = buildView(graph, scrambled.entities);
  const truth = new Map(scrambled.entities.map((entity) => [entity.scrambledPath, entity.gt]));
  const featureKeys = scrambled.entities.filter((entity) => entity.gtKind === 'feature').map((entity) => entity.scrambledPath).sort();

  // Hard files (plan §6): feature files whose anchored name-token label differs from their ground-truth folder,
  // judged on the default naming and reused for H1 so both variants score the same original files.
  const defaultScramble = bench.nameMode === 'default' ? scrambled : scramble(graph, manifest, { nameMode: 'default' });
  const defaultView = buildView(graph, defaultScramble.entities);
  const defaultAnchored = nameTokenAnchored(defaultView).assignment;
  const hardIds = new Set(defaultScramble.entities.filter((entity) => entity.gtKind === 'feature' && defaultAnchored.get(entity.scrambledPath) !== labelTokens(entity.gt)).map((entity) => entity.id));
  const hardKeys = scrambled.entities.filter((entity) => hardIds.has(entity.id)).map((entity) => entity.scrambledPath).sort();

  const byExport = (node) => exportTokens(node);
  const draftByName = seedsWithPropagation(view);
  const draftByExport = seedsWithPropagation(view, { tokensOf: byExport });
  // GT-free choice of the planner's draft: the seed source that leaves fewer low-confidence files.
  const draft = draftByExport.contested.length < draftByName.contested.length ? draftByExport : draftByName;
  const baselines = {
    'B0 type-folders': typeFolders(view, manifest.moduleRoot),
    'name-token (full stem)': nameTokenFullStem(view),
    'name-token (anchored)': nameTokenAnchored(view).assignment,
    'export-token (anchored)': nameTokenAnchored(view, byExport).assignment,
    'seeds + LP (file names)': draftByName.assignment,
    'seeds + LP (export names)': draftByExport.assignment,
  };
  const rows = Object.entries(baselines).map(([name, assignment]) => ({ name, kind: 'baseline', ...score(assignment, truth, featureKeys, hardKeys) }));
  const louvainSummary = {};
  for (const resolution of [1, 2, 4]) {
    const runs = [1, 2, 3, 4, 5].map((seed) => score(louvainClusters(view, { seed, resolution }), truth, featureKeys, hardKeys));
    const mean = (field) => +(runs.reduce((sum, run) => sum + (run[field] ?? 0), 0) / runs.length).toFixed(3);
    louvainSummary[resolution] = runs.map((run) => run.mojoFm);
    rows.push({ name: `Louvain res=${resolution} (mean of seeds 1-5)`, kind: 'baseline', mojoFm: +mean('mojoFm').toFixed(2), ari: mean('ari'), c2cCvg: mean('c2cCvg'), clusterCountRatio: +mean('clusterCountRatio').toFixed(2), matchedAccuracy: mean('matchedAccuracy'), mojoFmHard: hardKeys.length > 1 ? +mean('mojoFmHard').toFixed(2) : null, matchedAccuracyHard: hardKeys.length ? mean('matchedAccuracyHard') : null });
  }
  const bestBaseline = rows.reduce((best, row) => (row.mojoFm > best.mojoFm ? row : best));
  const bestBaselineHard = rows.reduce((best, row) => ((row.mojoFmHard ?? -Infinity) > (best.mojoFmHard ?? -Infinity) ? row : best));

  const result = {
    bench: benchName,
    repo: manifest.repo,
    sha: graph.sha,
    nameMode: bench.nameMode,
    entities: scrambled.entities.length,
    featureFiles: featureKeys.length,
    groundTruthModules: new Set(featureKeys.map((key) => truth.get(key))).size,
    hardFiles: hardKeys.length,
    leakyRenames: scrambled.entities.filter((entity) => entity.leaky).length,
    louvainMojoFmByResolution: louvainSummary,
    draftSource: draft === draftByExport ? 'export names' : 'file names',
    bestBaseline: { name: bestBaseline.name, mojoFm: bestBaseline.mojoFm },
    bestBaselineHard: { name: bestBaselineHard.name, mojoFmHard: bestBaselineHard.mojoFmHard },
    rows,
    llm: [],
  };

  if (flag !== '--no-llm') {
    // --v1: the "edit the draft" planner; default: v0, which enumerates every file id.
    // --v1b: v1 with Super on low_effort (v1 Super truncated at 64k tokens of reasoning) and no evaluate round
    // (in v0/v1 the round mostly made plans worse).
    const planner = flag === '--v1' || flag === '--v1b' ? runEditPlanner : runPlanner;
    const version = flag.replace(/^--/, '') || 'v0';
    const v1b = flag === '--v1b';
    const superRun = await planner({ runId: 'g1', modelKey: 'super', view, draft, samples: 2, label: `${benchName}/${version}/super`, ...(v1b ? { templateKwargs: { low_effort: true }, evaluateRounds: 0 } : {}) });
    // Ultra on medium_effort: at default effort it spent all 32k tokens reasoning on hoppscotch (157 files).
    const ultraRun = await planner({ runId: 'g1', modelKey: 'ultra', view, draft, samples: 1, templateKwargs: { medium_effort: true }, label: `${benchName}/${version}/ultra`, ...(v1b ? { evaluateRounds: 0 } : {}) });
    for (const run of [superRun, ultraRun]) {
      for (const sample of run.results) {
        if (sample.error) {
          result.llm.push({ label: sample.label, error: sample.error, usage: sample.usage });
          continue;
        }
        const turn1 = score(planAssignment(sample.turn1.plan, run.facts), truth, featureKeys, hardKeys);
        const final = score(planAssignment(sample.finalPlan, run.facts), truth, featureKeys, hardKeys);
        rows.push({ name: `${sample.label} turn 1`, kind: 'llm', ...turn1 });
        rows.push({ name: `${sample.label} final`, kind: 'llm', ...final });
        result.llm.push({ ...sample, scores: { turn1, final } });
      }
    }
    result.factsTokensEstimate = Math.round(superRun.facts.text.length / 3.2);
  }

  fs.mkdirSync(path.join(workDir, 'results'), { recursive: true });
  fs.writeFileSync(path.join(workDir, 'results', `${benchName}${flag === '--no-llm' ? '.baselines' : flag ? `.${flag.replace(/^--/, '')}` : ''}.json`), JSON.stringify({ ...result, truth: Object.fromEntries(truth), hardKeys, featureKeys }, null, 1));
  console.log(`\n${benchName} (${manifest.repo}@${graph.sha.slice(0, 10)}, ${bench.nameMode}): ${result.featureFiles} feature files in ${result.groundTruthModules} modules, ${result.hardFiles} hard files, ${result.leakyRenames} leaky renames; draft from ${result.draftSource}; best baseline ${bestBaseline.name} ${bestBaseline.mojoFm}, best on hard ${bestBaselineHard.name} ${bestBaselineHard.mojoFmHard}`);
  console.log('| method | MoJoFM | ARI | c2c_cvg@0.66 | clusters/GT | matched acc | MoJoFM hard | matched acc hard |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const row of rows) console.log(`| ${row.name} | ${row.mojoFm} | ${row.ari} | ${row.c2cCvg} | ${row.clusterCountRatio} | ${row.matchedAccuracy} | ${row.mojoFmHard} | ${row.matchedAccuracyHard} |`);
}

await main();

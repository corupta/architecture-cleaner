// Validates the metric ports. Usage: node spike/g1/metrics/validate.mjs   (exit 1 on any failure)
//
// 1. ARCADE's recorded oracles: MoJo / MoJoFM / MoJoEvo / MoJoPlus from MoJoCalculatorTest and
//    TurboMQ from DecayMetricAnalyzerTest, read from an arcade_core checkout at $ARCADE_DIR
//    (default ~/ac-work/arcade, pinned to 53e6f4f6e350). These oracles are ARCADE's own
//    regression values (written by `generateOracles`), not independent truth.
// 2. Independent checks: a brute-force MoJo (BFS over all set partitions, Move + Join) against
//    the fast implementation for n <= 7, brute-force pair counting for ARI, a dense all-pairs c2c,
//    hand-computed TurboMQ / c2c / ARI cases, identities and symmetries on random partitions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  mojo, mojoFm, mojoPlus, mojoEvo, mojoDetails, adjustedRandIndex, c2cSimilarity, c2cCvg, c2cCoverage,
  turboMq, parseRsf, formatRsf, readRsf, readDependencyRsf, clusterCountRatio,
} from './index.mjs';

const pinnedCommit = '53e6f4f6e35098b260290e5cda794ec78f6df4df';
const arcadeDir = process.env.ARCADE_DIR ?? path.join(os.homedir(), 'ac-work/arcade');
const resources = path.join(arcadeDir, 'src/test/resources');
const tally = new Map();
const maxPrintedFailures = 10;

function record(section, ok, line) {
  const counts = tally.get(section) ?? { pass: 0, fail: 0 };
  counts[ok ? 'pass' : 'fail'] += 1;
  tally.set(section, counts);
  if (line) console.log(`${ok ? 'PASS' : 'FAIL'}  ${line}`);
}

// A property run is one line: pass count, or the first failures with expected vs actual.
function property(section, name, cases) {
  let passed = 0;
  const failures = [];
  for (const { expected, actual, label, tolerance = 0 } of cases) {
    if (agrees(expected, actual, tolerance)) passed += 1;
    else failures.push(`${label}: expected ${expected}, actual ${actual}`);
  }
  const ok = failures.length === 0 && passed > 0;
  record(section, ok, `${section}  ${name}  ${passed}/${passed + failures.length} cases`);
  for (const failure of failures.slice(0, maxPrintedFailures)) console.log(`        ${failure}`);
}

function agrees(expected, actual, tolerance) {
  if (Object.is(expected, actual)) return true;
  return typeof expected === 'number' && typeof actual === 'number' && Math.abs(expected - actual) <= tolerance;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20261002);
const randomInt = (limit) => Math.floor(random() * limit);

function randomPartition(objectIds, maxClusters, prefix) {
  const clusters = 1 + randomInt(maxClusters);
  return new Map(objectIds.map((objectId) => [objectId, `${prefix}${randomInt(clusters)}`]));
}

const objectNames = (count, prefix = 'o') => Array.from({ length: count }, (_, index) => `${prefix}${index}`);
const labelsToPartition = (labels, prefix) => new Map(labels.map((label, index) => [`o${index}`, `${prefix}${label}`]));

// ---------------------------------------------------------------- 1. ARCADE oracles

function arcadeOracles() {
  if (!fs.existsSync(resources)) {
    record('oracle', false, `oracle  ARCADE checkout missing at ${arcadeDir} (git clone usc-softarch/arcade_core, checkout ${pinnedCommit})`);
    return;
  }
  let head = 'unknown';
  try {
    head = execFileSync('git', ['-C', arcadeDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {}
  console.log(`ARCADE ${arcadeDir} @ ${head}${head === pinnedCommit ? ' (pinned)' : `  WARNING: expected ${pinnedCommit}`}`);

  // MoJoCalculatorTest.calcMojoMeasure: new MoJoCalculator(source = currFile, target = prevFile),
  // oracle key "currFile,prevFile". So the first file of each pair is A, the second is B.
  const families = [
    ['MoJoBaseOracles', 'mojo', mojo],
    ['MoJoFMoracles', 'mojoFm', mojoFm],
    ['MoJoEvoOracles', 'mojoEvo', mojoEvo],
    ['MoJoPlusOracles', 'mojoPlus', mojoPlus],
  ];
  const mojoRoot = path.join(resources, 'MoJoCalculator');
  const partitions = new Map();
  const load = (file) => {
    if (!partitions.has(file)) partitions.set(file, readRsf(file));
    return partitions.get(file);
  };
  for (const [folder, measure, compute] of families) {
    for (const oracleFile of fs.readdirSync(path.join(mojoRoot, folder)).sort()) {
      const [system, technique] = path.basename(oracleFile, '.txt').split('_');
      const tokens = fs.readFileSync(path.join(mojoRoot, folder, oracleFile), 'utf8').trim().split(',');
      for (let index = 1; index + 2 < tokens.length; index += 3) {
        const [fileA, fileB, value] = tokens.slice(index, index + 3);
        const expected = Number.parseFloat(value);
        const inputs = path.join(mojoRoot, system, technique);
        const actual = compute(load(path.join(inputs, fileA)), load(path.join(inputs, fileB)));
        const versions = `${fileA.split('_')[0]} -> ${fileB.split('_')[0]}`;
        record('oracle', actual === expected, `oracle  ${measure.padEnd(8)} ${`${system}/${technique}`.padEnd(13)} ${versions.padEnd(34)} expected ${expected}  actual ${actual}`);
      }
    }
  }

  // DecayMetricAnalyzerTest: oracle line "version, rci, twoWay, stability, turboMQ"; TurboMQ is
  // DecayMetricAnalyzer.runSingle result[3]. ARCADE sums cluster factors in HashMap order, so the
  // last bits can differ: compare at 1e-12 and report bit-exact matches separately.
  const decayRoot = path.join(resources, 'DecayMetricAnalyzer');
  for (const project of ['httpd', 'struts']) {
    for (const technique of ['acdc', 'arc']) {
      const oraclePath = path.join(decayRoot, project, 'oracles', `decay_metrics_oracle_${project}_${technique}.txt`);
      for (const line of fs.readFileSync(oraclePath, 'utf8').split('\n').filter(Boolean)) {
        const records = line.split(',');
        const version = records[0];
        const expected = Number.parseFloat(records[4]);
        const actual = turboMq(
          readRsf(path.join(decayRoot, project, `${technique}_cluster`, `${version}.rsf`)),
          readDependencyRsf(path.join(decayRoot, project, `${technique}_dep`, `${version}.rsf`)),
        );
        const exactness = actual === expected ? 'bit-exact' : `diff ${(actual - expected).toExponential(1)}`;
        record('oracle', agrees(expected, actual, 1e-12), `oracle  turboMq  ${`${project}/${technique}`.padEnd(13)} ${version.padEnd(34)} expected ${expected}  actual ${actual}  (${exactness})`);
      }
    }
  }
}

// ---------------------------------------------------------------- 2a. brute-force MoJo

// Every set partition of n objects as a restricted growth string.
function allPartitions(n) {
  const result = [];
  const labels = new Array(n).fill(0);
  const extend = (position, highest) => {
    if (position === n) {
      result.push(labels.slice());
      return;
    }
    for (let label = 0; label <= highest + 1; label++) {
      labels[position] = label;
      extend(position + 1, Math.max(highest, label));
    }
  };
  extend(0, -1);
  return result;
}

function canonicalKey(labels) {
  const renumber = new Map();
  return labels.map((label) => {
    if (!renumber.has(label)) renumber.set(label, renumber.size);
    return renumber.get(label);
  }).join(',');
}

// One MoJo operation away: move an object to another (possibly new) cluster, or join two clusters.
function successors(labels) {
  const sizes = new Map();
  for (const label of labels) sizes.set(label, (sizes.get(label) ?? 0) + 1);
  const clusters = [...sizes.keys()];
  const fresh = Math.max(...clusters) + 1;
  const result = [];
  labels.forEach((own, objectIndex) => {
    const targets = clusters.filter((cluster) => cluster !== own);
    if (sizes.get(own) > 1) targets.push(fresh);
    for (const target of targets) {
      const next = labels.slice();
      next[objectIndex] = target;
      result.push(canonicalKey(next));
    }
  });
  for (let first = 0; first < clusters.length; first++) {
    for (let second = first + 1; second < clusters.length; second++) {
      result.push(canonicalKey(labels.map((label) => (label === clusters[second] ? clusters[first] : label))));
    }
  }
  return result;
}

function bruteForceMojo() {
  const mnoCases = [];
  const maxCases = [];
  const fmCases = [];
  for (let n = 1; n <= 7; n++) {
    const states = allPartitions(n);
    const predecessors = new Map(states.map((labels) => [canonicalKey(labels), []]));
    for (const labels of states) {
      const key = canonicalKey(labels);
      for (const next of successors(labels)) predecessors.get(next).push(key);
    }
    const targets = n <= 6 ? states : Array.from({ length: 25 }, () => states[randomInt(states.length)]);
    for (const targetLabels of targets) {
      // BFS backwards from B gives mno(X, B) for every X at once.
      const distance = new Map([[canonicalKey(targetLabels), 0]]);
      const queue = [canonicalKey(targetLabels)];
      for (let head = 0; head < queue.length; head++) {
        for (const previous of predecessors.get(queue[head])) {
          if (distance.has(previous)) continue;
          distance.set(previous, distance.get(queue[head]) + 1);
          queue.push(previous);
        }
      }
      const b = labelsToPartition(targetLabels, 'b');
      const bruteMax = Math.max(...distance.values());
      let fastMax;
      for (const sourceLabels of states) {
        const label = `n=${n} A=[${sourceLabels}] B=[${targetLabels}]`;
        const a = labelsToPartition(sourceLabels, 'a');
        const details = mojoDetails(a, b);
        const bruteMno = distance.get(canonicalKey(sourceLabels));
        fastMax = details.maxDistance;
        mnoCases.push({ label, expected: bruteMno, actual: details.mno });
        if (n >= 2) fmCases.push({ label, expected: Math.round((1 - bruteMno / bruteMax) * 1e4) / 100, actual: mojoFm(a, b), tolerance: 1e-9 });
      }
      maxCases.push({ label: `n=${n} B=[${targetLabels}]`, expected: bruteMax, actual: fastMax });
    }
  }
  property('brute', 'mno(A,B) == BFS over Move+Join, all A for each B (n<=6 all B, n=7 25 random B)', mnoCases);
  property('brute', 'max(mno(∀A,B)) == n - g(B) from BFS', maxCases);
  property('brute', 'mojoFm(A,B) == (1 - bfs/bfsMax)*100 (n>=2)', fmCases);

  // Degenerate partitions against B = 3 clusters x 3 objects (n = 9: 21,147 states), by brute force.
  const b3x3 = labelsToPartition([0, 0, 0, 1, 1, 1, 2, 2, 2], 'b');
  const singletons = labelsToPartition([0, 1, 2, 3, 4, 5, 6, 7, 8], 'a');
  const oneCluster = labelsToPartition([0, 0, 0, 0, 0, 0, 0, 0, 0], 'a');
  const bfs9 = bruteDistancesTo([0, 0, 0, 1, 1, 1, 2, 2, 2]);
  const max9 = Math.max(...bfs9.values());
  for (const [name, a, labels] of [['singletons', singletons, [0, 1, 2, 3, 4, 5, 6, 7, 8]], ['one cluster', oneCluster, new Array(9).fill(0)]]) {
    const brute = bfs9.get(canonicalKey(labels));
    property('brute', `B=3x3, A=${name}: mojo ${brute}, max ${max9}`, [
      { label: 'mno', expected: brute, actual: mojo(a, b3x3) },
      { label: 'mojoFm', expected: Math.round((1 - brute / max9) * 1e4) / 100, actual: mojoFm(a, b3x3) },
    ]);
  }
}

function bruteDistancesTo(targetLabels) {
  const n = targetLabels.length;
  const predecessors = new Map();
  for (const labels of allPartitions(n)) {
    const key = canonicalKey(labels);
    for (const next of successors(labels)) {
      if (!predecessors.has(next)) predecessors.set(next, []);
      predecessors.get(next).push(key);
    }
  }
  const start = canonicalKey(targetLabels);
  const distance = new Map([[start, 0]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    for (const previous of predecessors.get(queue[head]) ?? []) {
      if (distance.has(previous)) continue;
      distance.set(previous, distance.get(queue[head]) + 1);
      queue.push(previous);
    }
  }
  return distance;
}

// ---------------------------------------------------------------- 2b. MoJo properties

function mojoProperties() {
  const identity = [];
  const fmIdentity = [];
  const intersection = [];
  for (let trial = 0; trial < 300; trial++) {
    const objects = objectNames(2 + randomInt(200));
    const a = randomPartition(objects, 1 + randomInt(30), 'c');
    identity.push({ label: `trial ${trial}`, expected: 0, actual: mojo(a, a) });
    fmIdentity.push({ label: `trial ${trial}`, expected: 100, actual: mojoFm(a, a) });

    // Objects present on one side only must not change mno.
    const b = randomPartition(objects, 1 + randomInt(30), 'd');
    const aWide = new Map([...a, ...objectNames(randomInt(20), 'onlyA').map((id) => [id, `c${randomInt(5)}`])]);
    const bWide = new Map([...b, ...objectNames(randomInt(20), 'onlyB').map((id) => [id, `d${randomInt(5)}`])]);
    intersection.push({ label: `trial ${trial}`, expected: mojo(a, b), actual: mojo(aWide, bWide) });
  }
  property('mojo', 'mojo(a,a) == 0', identity);
  property('mojo', 'mojoFm(a,a) == 100', fmIdentity);
  property('mojo', 'mno ignores objects present on one side only', intersection);

  // ARCADE quirk: B's cluster sizes for max(mno) include B-only objects, n does not.
  const a = new Map([['o1', 'a'], ['o2', 'a'], ['o3', 'a']]);
  const b = new Map([['o1', 'b1'], ['o2', 'b2'], ['o3', 'b3']]);
  const bWithExtras = new Map([...b, ['x1', 'b2'], ['x2', 'b3'], ['x3', 'b3']]);
  const details = mojoDetails(a, bWithExtras);
  property('mojo', 'ARCADE max(mno) uses B sizes incl. B-only objects (common-only 0, ARCADE -Infinity)', [
    { label: 'common-only mojoFm', expected: 0, actual: mojoFm(a, b) },
    { label: 'mno', expected: 2, actual: details.mno },
    { label: 'maxDistance', expected: 0, actual: details.maxDistance },
    { label: 'extraInB', expected: 3, actual: details.extraInB },
    { label: 'mojoFm', expected: -Infinity, actual: mojoFm(a, bWithExtras) },
  ]);
  property('mojo', 'hand values; asymmetric: a join costs 1, undoing it costs moves', [
    { label: 'mno(4 in one, 4 singletons)', expected: 3, actual: mojo(new Map(objectNames(4).map((id) => [id, 'x'])), new Map(objectNames(4).map((id) => [id, id]))) },
    { label: 'mno({o0,o1}{o2,o3} -> one)', expected: 1, actual: mojo(new Map([['o0', 'p'], ['o1', 'p'], ['o2', 'q'], ['o3', 'q']]), new Map(objectNames(4).map((id) => [id, 'x']))) },
    { label: 'mno(one -> {o0,o1}{o2,o3})', expected: 2, actual: mojo(new Map(objectNames(4).map((id) => [id, 'x'])), new Map([['o0', 'p'], ['o1', 'p'], ['o2', 'q'], ['o3', 'q']])) },
  ]);
}

// ---------------------------------------------------------------- 2c. ARI

function bruteForceAri(a, b) {
  const objects = [...a.keys()].filter((id) => b.has(id));
  let together = 0;
  let sameA = 0;
  let sameB = 0;
  let disagreements = 0;
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const inA = a.get(objects[i]) === a.get(objects[j]);
      const inB = b.get(objects[i]) === b.get(objects[j]);
      together += inA && inB ? 1 : 0;
      sameA += inA ? 1 : 0;
      sameB += inB ? 1 : 0;
      disagreements += inA !== inB ? 1 : 0;
    }
  }
  if (disagreements === 0) return 1;
  const pairs = (objects.length * (objects.length - 1)) / 2;
  const expected = (sameA * sameB) / pairs;
  return (together - expected) / ((sameA + sameB) / 2 - expected);
}

function ariChecks() {
  const fromLabels = (labels) => new Map(labels.map((label, index) => [index, label]));
  // scikit-learn adjusted_rand_score docstring examples.
  const examples = [
    [[0, 0, 1, 1], [0, 0, 1, 1], 1],
    [[0, 0, 1, 1], [1, 1, 0, 0], 1],
    [[0, 0, 1, 2], [0, 0, 1, 1], 4 / 7],
    [[0, 0, 1, 1], [0, 0, 1, 2], 4 / 7],
    [[0, 0, 0, 0], [0, 1, 2, 3], 0],
    [[0, 0, 1, 1], [0, 1, 0, 1], -0.5],
  ];
  property('ari', 'scikit-learn docstring examples', examples.map(([x, y, expected]) => ({
    label: `[${x}] vs [${y}]`, expected, actual: adjustedRandIndex(fromLabels(x), fromLabels(y)), tolerance: 1e-15,
  })));

  const identity = [];
  const symmetry = [];
  const brute = [];
  for (let trial = 0; trial < 300; trial++) {
    const objects = objectNames(1 + randomInt(120));
    const a = randomPartition(objects, 1 + randomInt(15), 'c');
    const b = randomPartition(objects, 1 + randomInt(15), 'd');
    const bWide = new Map([...b, ...objectNames(randomInt(10), 'onlyB').map((id) => [id, 'd0'])]);
    identity.push({ label: `trial ${trial}`, expected: 1, actual: adjustedRandIndex(a, a) });
    symmetry.push({ label: `trial ${trial}`, expected: adjustedRandIndex(a, bWide), actual: adjustedRandIndex(bWide, a) });
    brute.push({ label: `trial ${trial}`, expected: bruteForceAri(a, bWide), actual: adjustedRandIndex(a, bWide), tolerance: 1e-12 });
  }
  property('ari', 'ARI(a,a) == 1', identity);
  property('ari', 'ARI(a,b) == ARI(b,a) exactly', symmetry);
  property('ari', 'matches brute-force pair counting (Hubert-Arabie form, common objects)', brute);
}

// ---------------------------------------------------------------- 2d. c2c

function denseCoverage(source, target, threshold) {
  const group = (partition) => {
    const clusters = new Map();
    for (const [objectId, clusterId] of partition) clusters.set(clusterId, [...(clusters.get(clusterId) ?? []), objectId]);
    return clusters;
  };
  const sourceClusters = group(source);
  const targetClusters = group(target);
  const matchedSource = new Set();
  const matchedTarget = new Set();
  for (const [sourceId, sourceMembers] of sourceClusters) {
    for (const [targetId, targetMembers] of targetClusters) {
      const intersection = sourceMembers.filter((id) => targetMembers.includes(id)).length;
      const similarity = intersection / Math.max(sourceMembers.length, targetMembers.length);
      if (similarity > threshold && similarity <= 1) {
        matchedSource.add(sourceId);
        matchedTarget.add(targetId);
      }
    }
  }
  return [matchedSource.size / sourceClusters.size, matchedTarget.size / targetClusters.size];
}

function c2cChecks() {
  const hundred = objectNames(100);
  const source = new Map(hundred.map((id) => [id, 's']));
  const at = (count) => new Map(hundred.map((id, index) => [id, index < count ? 't' : 'u']));
  property('c2c', 'hand cases', [
    { label: 'sim({1,2,3},{2,3})', expected: 2 / 3, actual: c2cSimilarity([1, 2, 3], [2, 3]) },
    { label: 'sim 66/100 == 0.66 is not a match (strict >)', expected: 0, actual: c2cCvg(source, at(66)) },
    { label: 'sim 67/100 is a match', expected: 1, actual: c2cCvg(source, at(67)) },
    { label: 'upper bound 1.0 inclusive', expected: 1, actual: c2cCvg(source, source) },
    { label: 'sizes not restricted to common objects', expected: 0, actual: c2cCvg(new Map([['o1', 'x'], ['o2', 'x']]), new Map([['o1', 'y'], ['o2', 'y'], ['o3', 'y'], ['o4', 'y']])) },
  ]);

  // "recovered 9 of 11 modules": tool keeps 9 GT modules, merges the other 2 into one.
  const groundTruth = new Map();
  const tool = new Map();
  for (let module = 0; module < 11; module++) {
    for (let file = 0; file < 5; file++) {
      groundTruth.set(`m${module}/f${file}`, `gt${module}`);
      tool.set(`m${module}/f${file}`, module < 9 ? `tool${module}` : 'tool-merged');
    }
  }
  const coverage = c2cCoverage(tool, groundTruth);
  property('c2c', 'recovered 9 of 11 ground-truth modules', [
    { label: 'c2cCvg(groundTruth, tool)', expected: 9 / 11, actual: c2cCvg(groundTruth, tool) },
    { label: 'c2cCoverage(tool, gt).targetToSource', expected: 9 / 11, actual: coverage.targetToSource },
    { label: 'c2cCoverage(tool, gt).sourceToTarget', expected: 9 / 10, actual: coverage.sourceToTarget },
  ]);

  const identity = [];
  const symmetry = [];
  const dense = [];
  for (let trial = 0; trial < 200; trial++) {
    const objects = objectNames(1 + randomInt(80));
    const a = randomPartition(objects, 1 + randomInt(12), 'c');
    const b = new Map([...randomPartition(objects.filter(() => random() < 0.9), 1 + randomInt(12), 'd'), ...objectNames(randomInt(6), 'onlyB').map((id) => [id, 'd0'])]);
    const threshold = [0, 0.5, 0.66][trial % 3];
    identity.push({ label: `trial ${trial}`, expected: 1, actual: c2cCvg(a, a) });
    symmetry.push({ label: `trial ${trial}`, expected: c2cCoverage(a, b).targetToSource, actual: c2cCoverage(b, a).sourceToTarget });
    const [sourceToTarget, targetToSource] = denseCoverage(a, b, threshold);
    const sparse = c2cCoverage(a, b, { threshold });
    dense.push({ label: `trial ${trial} source->target`, expected: sourceToTarget, actual: sparse.sourceToTarget });
    dense.push({ label: `trial ${trial} target->source`, expected: targetToSource, actual: sparse.targetToSource });
  }
  property('c2c', 'c2cCvg(a,a) == 1', identity);
  property('c2c', 'coverage(a,b).targetToSource == coverage(b,a).sourceToTarget', symmetry);
  property('c2c', 'sparse overlap counting == dense all-pairs Cvg.compute', dense);
}

// ---------------------------------------------------------------- 2e. TurboMQ, RSF, cluster count ratio

function otherChecks() {
  const partition = new Map([['a', 'X'], ['b', 'X'], ['c', 'Y'], ['d', 'Y'], ['e', 'Z']]);
  const edges = [
    ['a', 'b'], { from: 'a', to: 'b', weight: 7 }, ['b', 'a'], ['a', 'c'], ['c', 'd'],
    ['d', 'd'], ['e', 'outside'], ['e', 'a'],
  ];
  // X: internal a→b, b→a; external a→c, e→a → 4/6. Y: internal c→d; external a→c → 2/3. Z: 0.
  property('turboMq', 'hand case (duplicate, weight, self-loop, outside endpoint)', [
    { label: 'turboMq', expected: 4 / 9, actual: turboMq(partition, edges), tolerance: 1e-15 },
    { label: 'no edges', expected: 0, actual: turboMq(partition, []) },
  ]);

  const tricky = new Map([['src/a b.ts', 'module one'], ['src/c.ts', 'two']]);
  const quoted = 'contain "module one" "src/a b.ts"\r\nCONTAIN two src/c.ts\n\ndepends src/c.ts src/a.ts\n';
  const rejects = (text) => {
    try {
      parseRsf(text);
      return false;
    } catch {
      return true;
    }
  };
  property('rsf', 'round trip and parsing rules', [
    { label: 'format -> parse', expected: JSON.stringify([...tricky]), actual: JSON.stringify([...parseRsf(formatRsf(tricky))]) },
    { label: 'quotes, CRLF, case, other relations', expected: JSON.stringify([...tricky]), actual: JSON.stringify([...parseRsf(quoted)]) },
    { label: 'rejects 2-token line', expected: true, actual: rejects('contain x\n') },
    { label: 'rejects duplicate object', expected: true, actual: rejects('contain x o\ncontain y o\n') },
  ]);

  const a = new Map([['o1', 'p'], ['o2', 'q'], ['o3', 'r'], ['only-a', 's']]);
  const b = new Map([['o1', 'x'], ['o2', 'x'], ['o3', 'y'], ['only-b', 'z']]);
  property('ratio', 'clusterCountRatio over common objects', [
    { label: '3 predicted / 2 ground truth', expected: 1.5, actual: clusterCountRatio(a, b) },
  ]);
}

arcadeOracles();
bruteForceMojo();
mojoProperties();
ariChecks();
c2cChecks();
otherChecks();

console.log('\nsummary');
let failed = 0;
for (const [section, { pass, fail }] of tally) {
  failed += fail;
  console.log(`  ${section.padEnd(8)} ${pass}/${pass + fail} pass`);
}
console.log(failed ? `FAILED (${failed})` : 'ALL PASS');
process.exitCode = failed ? 1 : 0;

// The bench metrics (src/bench/metrics/) against ARCADE's recorded MoJo and MoJoFM oracles, brute force (MoJo by BFS
// over every set partition, ARI by pair counting, c2c by dense all-pairs), hand values, and the plan §7 correction:
// with B = 3×3, all-singletons and one-cluster both score MoJoFM 0. Ported from spike/g1/metrics/validate.mjs.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/bench/baselines.js';
import { adjustedRandIndex } from '../../src/bench/metrics/ari.js';
import { c2cCoverage, c2cCvg } from '../../src/bench/metrics/c2c.js';
import { mojo, mojoDetails, mojoFm } from '../../src/bench/metrics/mojo.js';
import { clusterCountRatio, type Partition } from '../../src/bench/metrics/partition.js';

const arcade = path.join(import.meta.dirname, 'fixtures', 'arcade-mojo');

/** `contain <cluster> <object>` lines; an object listed twice is not a partition. */
function readRsf(file: string): Map<string, string> {
  const partition = new Map<string, string>();
  for (const line of zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [relation, cluster, object, ...rest] = line.trim().split(/\s+/);
    if (rest.length || !object || relation!.toLowerCase() !== 'contain') throw new Error(`unexpected RSF line: ${line}`);
    if (partition.has(object)) throw new Error(`object ${object} listed twice`);
    partition.set(object, cluster!);
  }
  return partition;
}

const random = mulberry32(20261002);
const randomInt = (limit: number) => Math.floor(random() * limit);
const objectNames = (count: number, prefix = 'o') => Array.from({ length: count }, (_, index) => `${prefix}${index}`);
const randomPartition = (objects: string[], maxClusters: number, prefix: string) => {
  const clusters = 1 + randomInt(maxClusters);
  return new Map(objects.map((object) => [object, `${prefix}${randomInt(clusters)}`]));
};
const fromLabels = (labels: readonly number[], prefix: string) => new Map(labels.map((label, index) => [`o${index}`, `${prefix}${label}`]));

describe('MoJo and MoJoFM against ARCADE oracles (arcade_core 53e6f4f6e350)', () => {
  const cache = new Map<string, Map<string, string>>();
  const load = (file: string) => {
    if (!cache.has(file)) cache.set(file, readRsf(`${file}.gz`));
    return cache.get(file)!;
  };
  const families = [['MoJoBaseOracles', mojo], ['MoJoFMoracles', mojoFm]] as const;
  for (const [folder, measure] of families) {
    for (const oracleFile of fs.readdirSync(path.join(arcade, folder)).sort()) {
      const [system, technique] = path.basename(oracleFile, '.txt').split('_') as [string, string];
      const tokens = fs.readFileSync(path.join(arcade, folder, oracleFile), 'utf8').trim().split(',');
      for (let index = 1; index + 2 < tokens.length; index += 3) {
        const [source, target, value] = tokens.slice(index, index + 3) as [string, string, string];
        it(`${folder} ${system}/${technique} ${source.split('_')[0]} -> ${target.split('_')[0]} = ${value}`, () => {
          const directory = path.join(arcade, system, technique);
          expect(measure(load(path.join(directory, source)), load(path.join(directory, target)))).toBe(Number.parseFloat(value));
        });
      }
    }
  }
});

// Every set partition of n objects as a restricted growth string.
function allPartitions(n: number): number[][] {
  const result: number[][] = [];
  const labels = new Array<number>(n).fill(0);
  const extend = (position: number, highest: number) => {
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

function canonicalKey(labels: readonly number[]): string {
  const renumber = new Map<number, number>();
  return labels.map((label) => {
    if (!renumber.has(label)) renumber.set(label, renumber.size);
    return renumber.get(label);
  }).join(',');
}

/** One MoJo operation away: move an object to another (possibly new) cluster, or join two clusters. */
function successors(labels: readonly number[]): string[] {
  const sizes = new Map<number, number>();
  for (const label of labels) sizes.set(label, (sizes.get(label) ?? 0) + 1);
  const clusters = [...sizes.keys()];
  const fresh = Math.max(...clusters) + 1;
  const result: string[] = [];
  labels.forEach((own, objectIndex) => {
    const targets = clusters.filter((cluster) => cluster !== own);
    if (sizes.get(own)! > 1) targets.push(fresh);
    for (const target of targets) {
      const next = labels.slice();
      next[objectIndex] = target;
      result.push(canonicalKey(next));
    }
  });
  for (let first = 0; first < clusters.length; first++) {
    for (let second = first + 1; second < clusters.length; second++) {
      result.push(canonicalKey(labels.map((label) => (label === clusters[second] ? clusters[first]! : label))));
    }
  }
  return result;
}

/** mno(X, B) for every partition X of B's objects: BFS backwards from B. */
function bruteDistancesTo(states: number[][], targetLabels: readonly number[], predecessors: Map<string, string[]>): Map<string, number> {
  const start = canonicalKey(targetLabels);
  const distance = new Map([[start, 0]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    for (const previous of predecessors.get(queue[head]!) ?? []) {
      if (distance.has(previous)) continue;
      distance.set(previous, distance.get(queue[head]!)! + 1);
      queue.push(previous);
    }
  }
  expect(distance.size).toBe(states.length);
  return distance;
}

function predecessorsOf(states: number[][]): Map<string, string[]> {
  const predecessors = new Map<string, string[]>(states.map((labels) => [canonicalKey(labels), []]));
  for (const labels of states) {
    const key = canonicalKey(labels);
    for (const next of successors(labels)) predecessors.get(next)!.push(key);
  }
  return predecessors;
}

describe('MoJo against brute force', () => {
  it('mno, max(mno) and MoJoFM equal a BFS over Move and Join (n ≤ 6: every A and B; n = 7: 25 random B)', () => {
    let cases = 0;
    for (let n = 1; n <= 7; n++) {
      const states = allPartitions(n);
      const predecessors = predecessorsOf(states);
      const targets = n <= 6 ? states : Array.from({ length: 25 }, () => states[randomInt(states.length)]!);
      for (const targetLabels of targets) {
        const distance = bruteDistancesTo(states, targetLabels, predecessors);
        const bruteMax = Math.max(...distance.values());
        const b = fromLabels(targetLabels, 'b');
        for (const sourceLabels of states) {
          const a = fromLabels(sourceLabels, 'a');
          const details = mojoDetails(a, b);
          const bruteMno = distance.get(canonicalKey(sourceLabels))!;
          expect(details.mno, `n=${n} A=[${sourceLabels}] B=[${targetLabels}]`).toBe(bruteMno);
          expect(details.maxDistance).toBe(bruteMax);
          if (n >= 2) expect(mojoFm(a, b)).toBeCloseTo(Math.round((1 - bruteMno / bruteMax) * 1e4) / 100, 9);
          cases++;
        }
      }
    }
    expect(cases).toBeGreaterThan(40_000);
  });

  it('plan §7 correction: with B = 3×3, all-singletons and one-cluster both score MoJoFM 0 (not 14.29)', () => {
    const target = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    const states = allPartitions(9);
    const distance = bruteDistancesTo(states, target, predecessorsOf(states));
    const bruteMax = Math.max(...distance.values());
    const b = fromLabels(target, 'b');
    for (const labels of [[0, 1, 2, 3, 4, 5, 6, 7, 8], [0, 0, 0, 0, 0, 0, 0, 0, 0]]) {
      const a = fromLabels(labels, 'a');
      expect(mojo(a, b)).toBe(distance.get(canonicalKey(labels)));
      expect(mojo(a, b)).toBe(6);
      expect(bruteMax).toBe(6);
      expect(mojoFm(a, b)).toBe(0);
    }
  });
});

describe('MoJo properties and hand values', () => {
  it('mojo(a, a) = 0, MoJoFM(a, a) = 100, and objects on one side only do not change mno', () => {
    for (let trial = 0; trial < 300; trial++) {
      const objects = objectNames(2 + randomInt(200));
      const a = randomPartition(objects, 1 + randomInt(30), 'c');
      expect(mojo(a, a)).toBe(0);
      expect(mojoFm(a, a)).toBe(100);
      const b = randomPartition(objects, 1 + randomInt(30), 'd');
      const aWide = new Map([...a, ...objectNames(randomInt(20), 'onlyA').map((id) => [id, `c${randomInt(5)}`] as const)]);
      const bWide = new Map([...b, ...objectNames(randomInt(20), 'onlyB').map((id) => [id, `d${randomInt(5)}`] as const)]);
      expect(mojo(aWide, bWide)).toBe(mojo(a, b));
    }
  });

  it("keeps ARCADE's max(mno) over B's sizes including B-only objects", () => {
    const a = new Map([['o1', 'a'], ['o2', 'a'], ['o3', 'a']]);
    const b = new Map([['o1', 'b1'], ['o2', 'b2'], ['o3', 'b3']]);
    const bWithExtras = new Map([...b, ['x1', 'b2'], ['x2', 'b3'], ['x3', 'b3']]);
    expect(mojoFm(a, b)).toBe(0);
    expect(mojoDetails(a, bWithExtras)).toMatchObject({ mno: 2, maxDistance: 0, extraInB: 3 });
    expect(mojoFm(a, bWithExtras)).toBe(-Infinity);
  });

  it('is asymmetric: a join costs 1, undoing it costs moves', () => {
    const one = new Map(objectNames(4).map((id) => [id, 'x']));
    const halves = new Map([['o0', 'p'], ['o1', 'p'], ['o2', 'q'], ['o3', 'q']]);
    expect(mojo(one, new Map(objectNames(4).map((id) => [id, id])))).toBe(3);
    expect(mojo(halves, one)).toBe(1);
    expect(mojo(one, halves)).toBe(2);
  });
});

function bruteForceAri(a: Partition, b: Partition): number {
  const objects = [...a.keys()].filter((id) => b.has(id));
  let together = 0;
  let sameA = 0;
  let sameB = 0;
  let disagreements = 0;
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const inA = a.get(objects[i]!) === a.get(objects[j]!);
      const inB = b.get(objects[i]!) === b.get(objects[j]!);
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

describe('ARI', () => {
  it("matches scikit-learn's adjusted_rand_score docstring examples", () => {
    const examples: [number[], number[], number][] = [
      [[0, 0, 1, 1], [0, 0, 1, 1], 1],
      [[0, 0, 1, 1], [1, 1, 0, 0], 1],
      [[0, 0, 1, 2], [0, 0, 1, 1], 4 / 7],
      [[0, 0, 1, 1], [0, 0, 1, 2], 4 / 7],
      [[0, 0, 0, 0], [0, 1, 2, 3], 0],
      [[0, 0, 1, 1], [0, 1, 0, 1], -0.5],
    ];
    for (const [x, y, expected] of examples) expect(adjustedRandIndex(fromLabels(x, 'a'), fromLabels(y, 'b'))).toBeCloseTo(expected, 15);
  });

  it('is 1 on itself, symmetric, and equals brute-force pair counting over common objects', () => {
    for (let trial = 0; trial < 300; trial++) {
      const objects = objectNames(1 + randomInt(120));
      const a = randomPartition(objects, 1 + randomInt(15), 'c');
      const b = new Map([...randomPartition(objects, 1 + randomInt(15), 'd'), ...objectNames(randomInt(10), 'onlyB').map((id) => [id, 'd0'] as const)]);
      expect(adjustedRandIndex(a, a)).toBe(1);
      expect(adjustedRandIndex(b, a)).toBe(adjustedRandIndex(a, b));
      expect(adjustedRandIndex(a, b)).toBeCloseTo(bruteForceAri(a, b), 12);
    }
  });
});

function denseCoverage(source: Partition, target: Partition, threshold: number): [number, number] {
  const group = (partition: Partition) => {
    const clusters = new Map<string, string[]>();
    for (const [object, cluster] of partition) clusters.set(cluster, [...(clusters.get(cluster) ?? []), object]);
    return clusters;
  };
  const sourceClusters = group(source);
  const targetClusters = group(target);
  const matchedSource = new Set<string>();
  const matchedTarget = new Set<string>();
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

describe('c2c_cvg', () => {
  it('matches strictly above the threshold, inclusive at 1, over full cluster sizes', () => {
    const hundred = objectNames(100);
    const source = new Map(hundred.map((id) => [id, 's']));
    const at = (count: number) => new Map(hundred.map((id, index) => [id, index < count ? 't' : 'u']));
    expect(c2cCvg(source, at(66))).toBe(0);
    expect(c2cCvg(source, at(67))).toBe(1);
    expect(c2cCvg(source, source)).toBe(1);
    expect(c2cCvg(new Map([['o1', 'x'], ['o2', 'x']]), new Map([['o1', 'y'], ['o2', 'y'], ['o3', 'y'], ['o4', 'y']]))).toBe(0);
  });

  it('reads "recovered 9 of 11 ground-truth modules" as c2cCvg(groundTruth, method)', () => {
    const truth = new Map<string, string>();
    const method = new Map<string, string>();
    for (let module = 0; module < 11; module++) {
      for (let file = 0; file < 5; file++) {
        truth.set(`m${module}/f${file}`, `gt${module}`);
        method.set(`m${module}/f${file}`, module < 9 ? `method${module}` : 'method-merged');
      }
    }
    expect(c2cCvg(truth, method)).toBe(9 / 11);
    expect(c2cCoverage(method, truth)).toMatchObject({ targetToSource: 9 / 11, sourceToTarget: 9 / 10 });
  });

  it('is 1 on itself, symmetric in its match relation, and equals a dense all-pairs count', () => {
    for (let trial = 0; trial < 200; trial++) {
      const objects = objectNames(1 + randomInt(80));
      const a = randomPartition(objects, 1 + randomInt(12), 'c');
      const b = new Map([...randomPartition(objects.filter(() => random() < 0.9), 1 + randomInt(12), 'd'), ...objectNames(randomInt(6), 'onlyB').map((id) => [id, 'd0'] as const)]);
      const threshold = [0, 0.5, 0.66][trial % 3]!;
      expect(c2cCvg(a, a)).toBe(1);
      expect(c2cCoverage(b, a).sourceToTarget).toBe(c2cCoverage(a, b).targetToSource);
      const [sourceToTarget, targetToSource] = denseCoverage(a, b, threshold);
      expect(c2cCoverage(a, b, { threshold })).toMatchObject({ sourceToTarget, targetToSource });
    }
  });
});

describe('cluster-count ratio', () => {
  it('counts both sides over the objects they share', () => {
    const predicted = new Map([['o1', 'p'], ['o2', 'q'], ['o3', 'r'], ['only-a', 's']]);
    const truth = new Map([['o1', 'x'], ['o2', 'x'], ['o3', 'y'], ['only-b', 'z']]);
    expect(clusterCountRatio(predicted, truth)).toBe(1.5);
  });
});

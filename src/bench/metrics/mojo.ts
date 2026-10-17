// MoJo and MoJoFM, ported from ARCADE usc-softarch/arcade_core
// @ 53e6f4f6e35098b260290e5cda794ec78f6df4df (BSD-3-Clause, USC):
//   src/main/java/mojo/MoJoCalculator.java  (commonPrep, tagAssignment, calculateCost, maxDistanceTo, mojofmValue)
//   src/main/java/mojo/Cluster.java         (addobject_mojo)
//   src/main/java/mojo/BipartiteGraph.java  (maximum bipartite matching)
// Algorithm: Wen & Tzerpos, IWPC 2003 (optimal mno); MoJoFM: Wen & Tzerpos, IWPC 2004.
// Ported from the G1 spike (spike/g1/metrics/mojo.mjs on branch spike/gates), validated there and in
// test/bench/metrics.test.ts against ARCADE's own oracle values.
//
// `a` is the source (the method's output), `b` the target (the ground truth). Everything is asymmetric:
// mno(A, B) ≠ mno(B, A) in general. Kept identical to ARCADE, including the parts that surprise:
// - Objects only in A are dropped (extraInA): A's clusters are built from the common objects only.
// - Objects only in B don't enter the cost, but they do enter max(mno(∀A, B)): ARCADE takes B's cluster sizes over
//   all of B's objects while n counts only common objects, so B-only objects shrink the max and lower MoJoFM (it can
//   go negative). The bench restricts both partitions to the same objects first.
// - MoJoFM = rint((1 − mno / max) × 10000) / 100: Java's Math.rint, half to even, at 2 decimals. With fewer than 2
//   common objects max is 0 and the result is NaN or −Infinity.
// - Only the size of the maximum matching enters the cost, so Kuhn's algorithm gives ARCADE's mno.
import type { Partition } from './partition.js';

export interface MojoDetails {
  /** Minimum number of Move and Join operations turning A into B. */
  mno: number;
  /** max(mno(∀A, B)) = n − g(B). */
  maxDistance: number;
  /** Objects in both partitions. */
  objects: number;
  extraInA: number;
  extraInB: number;
  clustersInA: number;
  clustersInB: number;
  /** Size of the maximum matching between A's clusters and the B clusters each could join. */
  groups: number;
}

export const mojo = (a: Partition, b: Partition) => mojoDetails(a, b).mno;

/** MoJoFM(A, B) = (1 − mno(A, B) / max(mno(∀A, B))) × 100, rounded to 2 decimals like ARCADE. */
export function mojoFm(a: Partition, b: Partition): number {
  const { mno, maxDistance } = mojoDetails(a, b);
  return roundLikeArcade(1 - mno / maxDistance);
}

export function mojoDetails(a: Partition, b: Partition): MojoDetails {
  // readTargetRSFFile: one tag per B cluster, cardinalities over all of B's objects.
  const tagOfClusterB = new Map<string, number>();
  const cardinalitiesInB: number[] = [];
  for (const cluster of b.values()) {
    let tag = tagOfClusterB.get(cluster);
    if (tag === undefined) {
      tag = cardinalitiesInB.length;
      tagOfClusterB.set(cluster, tag);
      cardinalitiesInB.push(0);
    }
    cardinalitiesInB[tag]! += 1;
  }

  // readSourceRSFfile + tagAssignment: per A cluster, how many of its objects sit in each B cluster.
  const tagCountsByClusterA = new Map<string, Map<number, number>>();
  let objects = 0;
  let extraInA = 0;
  for (const [object, cluster] of a) {
    const clusterB = b.get(object);
    if (clusterB === undefined) {
      extraInA += 1;
      continue;
    }
    objects += 1;
    let tagCounts = tagCountsByClusterA.get(cluster);
    if (!tagCounts) tagCountsByClusterA.set(cluster, (tagCounts = new Map()));
    const tag = tagOfClusterB.get(clusterB)!;
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  // calculateCost: moves = Σ (|Ai| − maxtag_i); each Ai may join any B cluster tying for its max.
  let moves = 0;
  const candidateGroups: number[][] = [];
  for (const tagCounts of tagCountsByClusterA.values()) {
    let total = 0;
    let maxTag = 0;
    for (const count of tagCounts.values()) {
      total += count;
      if (count > maxTag) maxTag = count;
    }
    moves += total - maxTag;
    candidateGroups.push([...tagCounts].filter(([, count]) => count === maxTag).map(([tag]) => tag));
  }
  const groups = maximumMatchingSize(candidateGroups, cardinalitiesInB.length);
  return {
    mno: moves + candidateGroups.length - groups,
    maxDistance: maxDistanceTo(cardinalitiesInB, objects),
    objects,
    extraInA,
    extraInB: b.size - objects,
    clustersInA: candidateGroups.length,
    clustersInB: cardinalitiesInB.length,
    groups,
  };
}

/** maxDistanceTo: n − g, where g walks B's sizes ascending and grows while g < size. */
function maxDistanceTo(cardinalitiesInB: number[], objects: number): number {
  let groupNumber = 0;
  for (const size of [...cardinalitiesInB].sort((x, y) => x - y)) if (groupNumber < size) groupNumber += 1;
  return objects - groupNumber;
}

const roundLikeArcade = (fraction: number) => javaRint(fraction * 10000) / 100;

/** java.lang.Math.rint: the nearest integer, ties to even. */
function javaRint(value: number): number {
  if (!Number.isFinite(value)) return value;
  const floor = Math.floor(value);
  const remainder = value - floor;
  if (remainder < 0.5) return floor;
  if (remainder > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Kuhn's augmenting paths; left = A clusters, right = B cluster tags. */
function maximumMatchingSize(adjacency: number[][], rightCount: number): number {
  const leftOfRight = new Int32Array(rightCount).fill(-1);
  let size = 0;
  for (let left = 0; left < adjacency.length; left++) if (augment(left, adjacency, leftOfRight, new Uint8Array(rightCount))) size += 1;
  return size;
}

function augment(left: number, adjacency: number[][], leftOfRight: Int32Array, visited: Uint8Array): boolean {
  for (const right of adjacency[left]!) {
    if (visited[right]) continue;
    visited[right] = 1;
    if (leftOfRight[right] === -1 || augment(leftOfRight[right]!, adjacency, leftOfRight, visited)) {
      leftOfRight[right] = left;
      return true;
    }
  }
  return false;
}

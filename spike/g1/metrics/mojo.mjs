// MoJo family (MoJo, MoJoFM, MoJoPlus, MoJoEvo), ported from ARCADE
// usc-softarch/arcade_core @ 53e6f4f6e35098b260290e5cda794ec78f6df4df (BSD-3-Clause, USC):
//   src/main/java/mojo/MoJoCalculator.java  (commonPrep, tagAssignment, calculateCost,
//                                             maxDistanceTo, mojofmValue, mojoEvoValue)
//   src/main/java/mojo/Cluster.java         (addobject_mojo, addobject_mojoplus)
//   src/main/java/mojo/BipartiteGraph.java  (maximum bipartite matching)
// Algorithm: Wen & Tzerpos, IWPC 2003 (optimal mno); MoJoFM: Wen & Tzerpos, IWPC 2004.
//
// Input: partitions as `Map<objectId, clusterId>` or plain `{ [objectId]: clusterId }`
// (see partition.mjs). `a` is the source (tool output), `b` the target (authoritative).
// Everything here is asymmetric: mno(A,B) != mno(B,A) in general.
//
// Semantics kept identical to ARCADE, including the parts that surprise:
// - Objects only in A are dropped (counted in extraInA). A's clusters are built from the
//   common objects only, so an A cluster with no common object does not exist.
// - Objects only in B are ignored by the cost, but NOT by max(mno(∀A,B)): ARCADE takes B's
//   cluster sizes over all of B's objects while n counts only common objects. With B-only
//   objects the max shrinks and MoJoFM drops (it can even go negative). Build both
//   partitions over the same object set; mojoDetails() reports extraInA / extraInB.
// - MoJoFM = rint((1 - mno/max) * 10000) / 100, i.e. Java Math.rint: half-to-even at
//   2 decimals. With fewer than 2 common objects max is 0 and the result is NaN or -Infinity.
// - Matching: ARCADE's augmenting-path search yields a maximum matching; only its size
//   enters the cost, so any maximum matching (Kuhn's algorithm here) gives the same mno.
import { toPartitionMap } from './partition.mjs';

// mno(A,B): minimum number of Move and Join operations turning A into B.
export function mojo(a, b) {
  return mojoDetails(a, b).mno;
}

// MoJoFM(A,B) = (1 - mno(A,B) / max(mno(∀A,B))) * 100, rounded to 2 decimals like ARCADE.
export function mojoFm(a, b) {
  const { mno, maxDistance } = mojoDetails(a, b);
  return roundLikeArcade(1 - mno / maxDistance);
}

// ARCADE MoJoCalculator.mojoplus(): every distinct B cluster inside an A cluster costs one move.
export function mojoPlus(a, b) {
  return mojoDetails(a, b, { mode: 'plus' }).mno;
}

// ARCADE MoJoCalculator.mojoev(): MoJoFM with extraInA + 2 * extraInB added to cost and max.
export function mojoEvo(a, b) {
  const { mno, maxDistance, extraInA, extraInB } = mojoDetails(a, b);
  const penalty = extraInA + 2 * extraInB;
  return roundLikeArcade(1 - (mno + penalty) / (maxDistance + penalty));
}

// Components of the computation; `mode` is 'mojo' (default) or 'plus'.
// Returns { mno, maxDistance, objects, extraInA, extraInB, clustersInA, clustersInB, groups }.
export function mojoDetails(a, b, { mode = 'mojo' } = {}) {
  if (mode !== 'mojo' && mode !== 'plus') throw new RangeError(`unknown MoJo mode: ${mode}`);
  const mapA = toPartitionMap(a);
  const mapB = toPartitionMap(b);

  // readTargetRSFFile: tag per B cluster, cardinalities over all of B's objects.
  const tagOfClusterB = new Map();
  const cardinalitiesInB = [];
  for (const clusterId of mapB.values()) {
    let tag = tagOfClusterB.get(clusterId);
    if (tag === undefined) {
      tag = cardinalitiesInB.length;
      tagOfClusterB.set(clusterId, tag);
      cardinalitiesInB.push(0);
    }
    cardinalitiesInB[tag] += 1;
  }

  // readSourceRSFfile + tagAssignment: per A cluster, how many of its objects sit in each B cluster.
  const tagCountsByClusterA = new Map();
  let objects = 0;
  let extraInA = 0;
  for (const [objectId, clusterId] of mapA) {
    if (!mapB.has(objectId)) {
      extraInA += 1;
      continue;
    }
    objects += 1;
    let tagCounts = tagCountsByClusterA.get(clusterId);
    if (!tagCounts) tagCountsByClusterA.set(clusterId, (tagCounts = new Map()));
    const tag = tagOfClusterB.get(mapB.get(objectId));
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const extraInB = mapB.size - objects;

  // calculateCost: moves = Σ (|Ai| - maxtag_i); each Ai may join any B cluster tying for its max.
  let moves = 0;
  const candidateGroups = [];
  for (const tagCounts of tagCountsByClusterA.values()) {
    if (mode === 'plus') {
      moves += tagCounts.size - 1;
      candidateGroups.push([...tagCounts.keys()]);
      continue;
    }
    let total = 0;
    let maxTag = 0;
    for (const count of tagCounts.values()) {
      total += count;
      if (count > maxTag) maxTag = count;
    }
    moves += total - maxTag;
    candidateGroups.push([...tagCounts].filter(([, count]) => count === maxTag).map(([tag]) => tag));
  }
  const clustersInA = candidateGroups.length;
  const groups = maximumMatchingSize(candidateGroups, cardinalitiesInB.length);

  return {
    mno: moves + clustersInA - groups,
    maxDistance: maxDistanceTo(cardinalitiesInB, objects),
    objects,
    extraInA,
    extraInB,
    clustersInA,
    clustersInB: cardinalitiesInB.length,
    groups,
  };
}

// maxDistanceTo: n - g, where g walks B's sizes ascending and grows while g < size.
function maxDistanceTo(cardinalitiesInB, objects) {
  const sorted = [...cardinalitiesInB].sort((x, y) => x - y);
  let groupNumber = 0;
  for (const size of sorted) if (groupNumber < size) groupNumber += 1;
  return objects - groupNumber;
}

function roundLikeArcade(fraction) {
  return javaRint(fraction * 10000) / 100;
}

// java.lang.Math.rint: nearest integer, ties to even.
function javaRint(value) {
  if (!Number.isFinite(value)) return value;
  const floor = Math.floor(value);
  const remainder = value - floor;
  if (remainder < 0.5) return floor;
  if (remainder > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

// Kuhn's augmenting paths; left = A clusters, right = B cluster tags.
function maximumMatchingSize(adjacency, rightCount) {
  const leftOfRight = new Int32Array(rightCount).fill(-1);
  let size = 0;
  for (let left = 0; left < adjacency.length; left++) {
    if (augment(left, adjacency, leftOfRight, new Uint8Array(rightCount))) size += 1;
  }
  return size;
}

function augment(left, adjacency, leftOfRight, visited) {
  for (const right of adjacency[left]) {
    if (visited[right]) continue;
    visited[right] = 1;
    if (leftOfRight[right] === -1 || augment(leftOfRight[right], adjacency, leftOfRight, visited)) {
      leftOfRight[right] = left;
      return true;
    }
  }
  return false;
}

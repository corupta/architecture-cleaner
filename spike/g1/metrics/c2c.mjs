// c2c similarity and c2c_cvg, ported from ARCADE usc-softarch/arcade_core
// @ 53e6f4f6e35098b260290e5cda794ec78f6df4df (BSD-3-Clause, USC):
//   src/main/java/edu/usc/softarch/arcade/metrics/evolution/Cvg.java (compute, defaults 0.66 / 1.0)
// Metric: Garcia, Ivkovic, Medvidovic, ASE 2013.
//
// Partitions as in partition.mjs.
// - sim(s, t) = |s ∩ t| / max(|s|, |t|) with full cluster sizes: objects missing from the other
//   partition still count in the denominator (ARCADE does not restrict to common objects).
// - A pair matches when threshold < sim <= upper (strict 0.66, inclusive 1.0 by default).
// - Direction: Cvg.run(source, target) returns cvgSourceToTarget =
//   |source clusters with at least one match| / |source clusters|. The other direction,
//   cvgTargetToSource, divides matched target clusters by |target clusters|.
//   For "recovered k of K ground-truth modules" use c2cCvg(groundTruth, tool), which equals
//   c2cCoverage(tool, groundTruth).targetToSource because the match relation is symmetric.
// - Not ported: RenameFixer.fix, which Cvg's constructor runs first to rename objects present in
//   only one partition when they share an 80% path suffix. It is a no-op when both partitions
//   cover the same objects, which is how G1 builds them.
import { clustersOf, toPartitionMap } from './partition.mjs';

export function c2cSimilarity(membersA, membersB) {
  const setB = membersB instanceof Set ? membersB : new Set(membersB);
  const setA = membersA instanceof Set ? membersA : new Set(membersA);
  let intersection = 0;
  for (const objectId of setA) if (setB.has(objectId)) intersection += 1;
  return intersection / Math.max(setA.size, setB.size);
}

// ARCADE Cvg.run(source, target): fraction of source clusters that some target cluster matches.
export function c2cCvg(source, target, options) {
  return c2cCoverage(source, target, options).sourceToTarget;
}

export function c2cCoverage(source, target, { threshold = 0.66, upper = 1.0 } = {}) {
  if (!(threshold >= 0 && threshold < upper)) throw new RangeError('need 0 <= threshold < upper');
  const sourceClusters = clustersOf(source);
  const targetClusters = clustersOf(target);
  const targetMap = toPartitionMap(target);

  // Only overlapping pairs can clear a non-negative threshold, so count overlaps sparsely.
  const matchedSource = new Set();
  const matchedTarget = new Set();
  for (const [sourceId, members] of sourceClusters) {
    const overlaps = new Map();
    for (const objectId of members) {
      if (!targetMap.has(objectId)) continue;
      const targetId = targetMap.get(objectId);
      overlaps.set(targetId, (overlaps.get(targetId) ?? 0) + 1);
    }
    for (const [targetId, intersection] of overlaps) {
      const similarity = intersection / Math.max(members.length, targetClusters.get(targetId).length);
      if (similarity > threshold && similarity <= upper) {
        matchedSource.add(sourceId);
        matchedTarget.add(targetId);
      }
    }
  }

  return {
    sourceToTarget: matchedSource.size / sourceClusters.size,
    targetToSource: matchedTarget.size / targetClusters.size,
    matchedSource: [...matchedSource],
    matchedTarget: [...matchedTarget],
    sourceClusters: sourceClusters.size,
    targetClusters: targetClusters.size,
  };
}

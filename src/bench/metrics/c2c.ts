// c2c_cvg, ported from ARCADE usc-softarch/arcade_core @ 53e6f4f6e35098b260290e5cda794ec78f6df4df (BSD-3-Clause, USC):
//   src/main/java/edu/usc/softarch/arcade/metrics/evolution/Cvg.java (compute, defaults 0.66 / 1.0)
// Metric: Garcia, Ivkovic, Medvidovic, ASE 2013. Ported from the G1 spike (spike/g1/metrics/c2c.mjs on branch spike/gates).
//
// - sim(s, t) = |s ∩ t| / max(|s|, |t|) over full cluster sizes: objects missing from the other partition still count
//   in the denominator (ARCADE doesn't restrict to common objects).
// - A pair matches when threshold < sim ≤ upper (strict 0.66, inclusive 1.0 by default).
// - Cvg.run(source, target) = |source clusters with a match| / |source clusters|. "Recovered k of K ground-truth
//   modules" is c2cCvg(groundTruth, method): the match relation is symmetric, so it equals
//   c2cCoverage(method, groundTruth).targetToSource.
// - Not ported: RenameFixer.fix (Cvg's constructor renames objects present in one partition only when they share an
//   80% path suffix). It is a no-op when both partitions cover the same objects, which is how the bench calls it.
import { clustersOf, type Partition } from './partition.js';

export interface C2cCoverage {
  sourceToTarget: number;
  targetToSource: number;
  sourceClusters: number;
  targetClusters: number;
}

export function c2cCoverage(source: Partition, target: Partition, { threshold = 0.66, upper = 1.0 } = {}): C2cCoverage {
  if (!(threshold >= 0 && threshold < upper)) throw new RangeError('c2c needs 0 <= threshold < upper');
  const sourceClusters = clustersOf(source);
  const targetClusters = clustersOf(target);

  // Only overlapping pairs can clear a non-negative threshold, so overlaps are counted sparsely.
  const matchedSource = new Set<string>();
  const matchedTarget = new Set<string>();
  for (const [sourceCluster, members] of sourceClusters) {
    const overlaps = new Map<string, number>();
    for (const object of members) {
      const targetCluster = target.get(object);
      if (targetCluster !== undefined) overlaps.set(targetCluster, (overlaps.get(targetCluster) ?? 0) + 1);
    }
    for (const [targetCluster, intersection] of overlaps) {
      const similarity = intersection / Math.max(members.length, targetClusters.get(targetCluster)!.length);
      if (similarity > threshold && similarity <= upper) {
        matchedSource.add(sourceCluster);
        matchedTarget.add(targetCluster);
      }
    }
  }
  return {
    sourceToTarget: matchedSource.size / sourceClusters.size,
    targetToSource: matchedTarget.size / targetClusters.size,
    sourceClusters: sourceClusters.size,
    targetClusters: targetClusters.size,
  };
}

/** ARCADE Cvg.run(source, target): the share of source clusters that some target cluster matches. */
export const c2cCvg = (source: Partition, target: Partition, options?: { threshold?: number; upper?: number }) =>
  c2cCoverage(source, target, options).sourceToTarget;

// Adjusted Rand Index (Hubert & Arabie 1985) over the objects present in both partitions. Symmetric; range [−0.5, 1];
// about 0 for random labels. The formulation and edge case of scikit-learn's adjusted_rand_score: the pair confusion
// matrix with exact integer pair counts, and 1 when no pair disagrees (which covers fewer than 2 objects).
// Ported from the G1 spike (spike/g1/metrics/ari.mjs on branch spike/gates).
import type { Partition } from './partition.js';

export function adjustedRandIndex(a: Partition, b: Partition): number {
  const contingency = new Map<string, Map<string, number>>();
  const sizesA = new Map<string, number>();
  const sizesB = new Map<string, number>();
  let objects = 0;
  for (const [object, clusterA] of a) {
    const clusterB = b.get(object);
    if (clusterB === undefined) continue;
    objects += 1;
    let row = contingency.get(clusterA);
    if (!row) contingency.set(clusterA, (row = new Map()));
    row.set(clusterB, (row.get(clusterB) ?? 0) + 1);
    sizesA.set(clusterA, (sizesA.get(clusterA) ?? 0) + 1);
    sizesB.set(clusterB, (sizesB.get(clusterB) ?? 0) + 1);
  }

  const sumOfSquares = (counts: Iterable<number>) => {
    let sum = 0n;
    for (const count of counts) sum += BigInt(count) * BigInt(count);
    return sum;
  };
  let cellSquares = 0n;
  for (const row of contingency.values()) cellSquares += sumOfSquares(row.values());
  const n = BigInt(objects);
  // Ordered pair counts, as in sklearn.metrics.cluster.pair_confusion_matrix.
  const together = cellSquares - n;
  const splitInA = sumOfSquares(sizesB.values()) - cellSquares;
  const splitInB = sumOfSquares(sizesA.values()) - cellSquares;
  const apart = n * n - splitInA - splitInB - cellSquares;

  if (splitInA === 0n && splitInB === 0n) return 1;
  const numerator = together * apart - splitInB * splitInA;
  const denominator = (together + splitInB) * (splitInB + apart) + (together + splitInA) * (splitInA + apart);
  return (2 * Number(numerator)) / Number(denominator);
}

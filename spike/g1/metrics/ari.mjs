// Adjusted Rand Index (Hubert & Arabie 1985) over the objects present in both partitions.
// Partitions as in partition.mjs. Symmetric; range [-0.5, 1]; about 0 for random labels.
// Same formulation and edge case as scikit-learn's adjusted_rand_score (pair confusion matrix,
// exact integer pair counts, 1.0 when no pair disagrees, which covers fewer than 2 objects).
import { toPartitionMap } from './partition.mjs';

export function adjustedRandIndex(a, b) {
  const mapA = toPartitionMap(a);
  const mapB = toPartitionMap(b);
  const contingency = new Map();
  const sizesA = new Map();
  const sizesB = new Map();
  let objects = 0;
  for (const [objectId, clusterA] of mapA) {
    if (!mapB.has(objectId)) continue;
    const clusterB = mapB.get(objectId);
    objects += 1;
    let row = contingency.get(clusterA);
    if (!row) contingency.set(clusterA, (row = new Map()));
    row.set(clusterB, (row.get(clusterB) ?? 0) + 1);
    sizesA.set(clusterA, (sizesA.get(clusterA) ?? 0) + 1);
    sizesB.set(clusterB, (sizesB.get(clusterB) ?? 0) + 1);
  }

  const sumOfSquares = (counts) => {
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

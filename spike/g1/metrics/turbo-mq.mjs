// TurboMQ, ported from ARCADE usc-softarch/arcade_core
// @ 53e6f4f6e35098b260290e5cda794ec78f6df4df (BSD-3-Clause, USC):
//   src/main/java/edu/usc/softarch/arcade/metrics/decay/TurboMQ.java
//   src/main/java/edu/usc/softarch/arcade/clustering/data/ReadOnlyArchitecture.java (buildFullGraph)
//   src/main/java/edu/usc/softarch/arcade/facts/DependencyGraph.java (readRsf)
// Metric: Mitchell & Mancoridis, TSE 2006. Label it "TurboMQ (ARCADE mean-CF)".
//
// Input: a partition (see partition.mjs) and an iterable of directed edges, each
// `{ from, to, weight? }` or `[from, to, weight?]`.
// - ARCADE builds a jgrapht SimpleDirectedGraph over the partition's objects: repeated
//   (from, to) pairs collapse into one edge, self-loops and edges with an endpoint outside the
//   partition are dropped, and weights are ignored. u→v and v→u stay two edges.
// - CF_i = 2μ_i / (2μ_i + ε_i): μ_i = edges inside cluster i, ε_i = inter-cluster edges with
//   either endpoint in cluster i. CF_i = 0 when μ_i = 0.
// - TurboMQ = Σ CF_i / number of clusters (Bunch's original is the unnormalised Σ CF).
import { toPartitionMap } from './partition.mjs';

export function turboMq(partition, edges) {
  const factors = turboMqClusterFactors(partition, edges);
  let sum = 0;
  for (const factor of factors.values()) sum += factor;
  return sum / factors.size;
}

// Map<clusterId, CF>, every cluster of the partition included.
export function turboMqClusterFactors(partition, edges) {
  const clusterOf = toPartitionMap(partition);
  const internal = new Map();
  const external = new Map();
  for (const clusterId of clusterOf.values()) {
    internal.set(clusterId, 0);
    external.set(clusterId, 0);
  }

  const seen = new Map();
  for (const edge of edges) {
    const [from, to] = Array.isArray(edge) ? edge : [edge.from, edge.to];
    if (!clusterOf.has(from) || !clusterOf.has(to) || from === to) continue;
    let targets = seen.get(from);
    if (!targets) seen.set(from, (targets = new Set()));
    if (targets.has(to)) continue;
    targets.add(to);

    const fromCluster = clusterOf.get(from);
    const toCluster = clusterOf.get(to);
    if (fromCluster === toCluster) {
      internal.set(fromCluster, internal.get(fromCluster) + 1);
    } else {
      external.set(fromCluster, external.get(fromCluster) + 1);
      external.set(toCluster, external.get(toCluster) + 1);
    }
  }

  const factors = new Map();
  for (const [clusterId, intra] of internal) {
    factors.set(clusterId, intra === 0 ? 0 : (2 * intra) / (2 * intra + external.get(clusterId)));
  }
  return factors;
}

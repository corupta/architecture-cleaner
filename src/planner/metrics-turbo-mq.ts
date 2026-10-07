// TurboMQ, ported from ARCADE usc-softarch/arcade_core
// @ 53e6f4f6e35098b260290e5cda794ec78f6df4df (BSD-3-Clause, USC):
//   src/main/java/edu/usc/softarch/arcade/metrics/decay/TurboMQ.java
//   src/main/java/edu/usc/softarch/arcade/clustering/data/ReadOnlyArchitecture.java (buildFullGraph)
//   src/main/java/edu/usc/softarch/arcade/facts/DependencyGraph.java (readRsf)
// Metric: Mitchell & Mancoridis, TSE 2006. Label it "TurboMQ (ARCADE mean-CF)"; the Bunch original is the sum.
// Ported from the G1 spike (spike/g1/metrics/turbo-mq.mjs on branch spike/gates).
//
// - ARCADE builds a jgrapht SimpleDirectedGraph over the partition's objects: repeated (from, to) pairs collapse into
//   one edge, self-loops and edges with an endpoint outside the partition are dropped, and weights are ignored.
//   u→v and v→u stay two edges.
// - CF_i = 2μ_i / (2μ_i + ε_i): μ_i = edges inside cluster i, ε_i = inter-cluster edges with either endpoint in
//   cluster i. CF_i = 0 when μ_i = 0.

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Cluster factor per cluster of `partition` (object → cluster), every cluster included, in cluster order. */
export function turboMqClusterFactors(partition: ReadonlyMap<string, string>, edges: Iterable<{ from: string; to: string }>): Map<string, number> {
  const internal = new Map<string, number>();
  const external = new Map<string, number>();
  for (const cluster of [...new Set(partition.values())].sort(byCodeUnit)) {
    internal.set(cluster, 0);
    external.set(cluster, 0);
  }

  const seen = new Map<string, Set<string>>();
  for (const { from, to } of edges) {
    const fromCluster = partition.get(from);
    const toCluster = partition.get(to);
    if (fromCluster === undefined || toCluster === undefined || from === to) continue;
    let targets = seen.get(from);
    if (!targets) seen.set(from, (targets = new Set()));
    if (targets.has(to)) continue;
    targets.add(to);

    if (fromCluster === toCluster) {
      internal.set(fromCluster, internal.get(fromCluster)! + 1);
    } else {
      external.set(fromCluster, external.get(fromCluster)! + 1);
      external.set(toCluster, external.get(toCluster)! + 1);
    }
  }

  const factors = new Map<string, number>();
  for (const [cluster, intra] of internal) factors.set(cluster, intra === 0 ? 0 : (2 * intra) / (2 * intra + external.get(cluster)!));
  return factors;
}

/** Bunch's TurboMQ (Σ CF) and ARCADE's normalised one (Σ CF / clusters); both 0 for an empty partition. */
export function turboMq(partition: ReadonlyMap<string, string>, edges: Iterable<{ from: string; to: string }>): { sum: number; mean: number } {
  const factors = turboMqClusterFactors(partition, edges);
  let sum = 0;
  for (const factor of factors.values()) sum += factor;
  return { sum, mean: factors.size ? sum / factors.size : 0 };
}

// The partition every bench metric takes: object (a package-relative file path) → cluster label. Each object is in
// exactly one cluster. Ported from the G1 spike (spike/g1/metrics/partition.mjs on branch spike/gates).

export type Partition = ReadonlyMap<string, string>;

/** Cluster → its objects, clusters in first-seen order; with `only`, objects outside it are skipped. */
export function clustersOf(partition: Partition, only?: ReadonlySet<string>): Map<string, string[]> {
  const clusters = new Map<string, string[]>();
  for (const [object, cluster] of partition) {
    if (only && !only.has(object)) continue;
    let members = clusters.get(cluster);
    if (!members) clusters.set(cluster, (members = []));
    members.push(object);
  }
  return clusters;
}

/** Objects present in both partitions, in `a`'s order. */
export function commonObjects(a: Partition, b: Partition): Set<string> {
  const common = new Set<string>();
  for (const object of a.keys()) if (b.has(object)) common.add(object);
  return common;
}

/** Predicted clusters / ground-truth clusters, both counted over the objects the two partitions share. */
export function clusterCountRatio(predicted: Partition, truth: Partition): number {
  const common = commonObjects(predicted, truth);
  return clustersOf(predicted, common).size / clustersOf(truth, common).size;
}

/** The partition restricted to `objects` (objects it doesn't have are skipped). */
export function restrict(partition: Partition, objects: Iterable<string>): Map<string, string> {
  const restricted = new Map<string, string>();
  for (const object of objects) {
    const cluster = partition.get(object);
    if (cluster !== undefined) restricted.set(object, cluster);
  }
  return restricted;
}

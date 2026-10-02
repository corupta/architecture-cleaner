// Partition input shared by every metric in this folder.
//
// A partition is `Map<objectId, clusterId>` or a plain object `{ [objectId]: clusterId }`.
// Object ids are compared as Map keys (plain-object keys are strings); cluster ids may be any
// value usable as a Map key. Each object belongs to exactly one cluster, so the format cannot
// express ARCADE's duplicate-object RSF edge cases (rsf.mjs rejects duplicates instead).

export function toPartitionMap(partition) {
  if (partition instanceof Map) return partition;
  if (partition && typeof partition === 'object') return new Map(Object.entries(partition));
  throw new TypeError('partition must be a Map<objectId, clusterId> or a plain object');
}

// Map<clusterId, objectId[]>, clusters in first-seen order.
export function clustersOf(partition, { onlyObjects } = {}) {
  const clusters = new Map();
  for (const [objectId, clusterId] of toPartitionMap(partition)) {
    if (onlyObjects && !onlyObjects.has(objectId)) continue;
    let members = clusters.get(clusterId);
    if (!members) clusters.set(clusterId, (members = []));
    members.push(objectId);
  }
  return clusters;
}

// Object ids present in both partitions, in `a`'s iteration order.
export function commonObjects(a, b) {
  const mapB = toPartitionMap(b);
  const common = new Set();
  for (const objectId of toPartitionMap(a).keys()) if (mapB.has(objectId)) common.add(objectId);
  return common;
}

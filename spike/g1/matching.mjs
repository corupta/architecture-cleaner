// Matched accuracy: share of files whose predicted cluster is paired with their ground-truth module under the
// best one-to-one pairing of clusters to modules (Hungarian algorithm on overlap counts).
function hungarianMaximize(weights) {
  const rows = weights.length;
  const columns = weights[0]?.length ?? 0;
  const size = Math.max(rows, columns);
  const maxWeight = Math.max(0, ...weights.flat());
  const cost = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => maxWeight - (weights[row]?.[column] ?? 0)));
  const u = new Array(size + 1).fill(0);
  const v = new Array(size + 1).fill(0);
  const match = new Array(size + 1).fill(0);
  const way = new Array(size + 1).fill(0);
  for (let row = 1; row <= size; row++) {
    match[0] = row;
    let column0 = 0;
    const minimum = new Array(size + 1).fill(Infinity);
    const used = new Array(size + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = match[column0];
      let delta = Infinity;
      let column1 = 0;
      for (let column = 1; column <= size; column++) {
        if (used[column]) continue;
        const current = cost[row0 - 1][column - 1] - u[row0] - v[column];
        if (current < minimum[column]) {
          minimum[column] = current;
          way[column] = column0;
        }
        if (minimum[column] < delta) {
          delta = minimum[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= size; column++) {
        if (used[column]) {
          u[match[column]] += delta;
          v[column] -= delta;
        } else minimum[column] -= delta;
      }
      column0 = column1;
    } while (match[column0] !== 0);
    do {
      const column1 = way[column0];
      match[column0] = match[column1];
      column0 = column1;
    } while (column0);
  }
  const pairs = new Map();
  for (let column = 1; column <= size; column++) if (match[column] && match[column] <= rows && column <= columns) pairs.set(match[column] - 1, column - 1);
  return pairs;
}

export function matchedAccuracy(predicted, truth, keys) {
  const clusters = [...new Set(keys.map((key) => predicted.get(key)))];
  const modules = [...new Set(keys.map((key) => truth.get(key)))];
  const clusterIndex = new Map(clusters.map((cluster, index) => [cluster, index]));
  const moduleIndex = new Map(modules.map((module, index) => [module, index]));
  const overlap = clusters.map(() => modules.map(() => 0));
  for (const key of keys) overlap[clusterIndex.get(predicted.get(key))][moduleIndex.get(truth.get(key))]++;
  const pairs = hungarianMaximize(overlap);
  const pairedModule = new Map([...pairs].map(([cluster, module]) => [clusters[cluster], modules[module]]));
  return (subset) => subset.filter((key) => pairedModule.get(predicted.get(key)) === truth.get(key)).length / (subset.length || 1);
}

// Clustering metrics for the G1 boundary spike. Partitions are Map<objectId, clusterId> or plain
// objects (partition.mjs); `a` is the tool output, `b` the ground truth unless a file says otherwise.
// `node spike/g1/metrics/validate.mjs` checks the ports against ARCADE's oracles.
import { clustersOf, commonObjects } from './partition.mjs';

export { mojo, mojoFm, mojoPlus, mojoEvo, mojoDetails } from './mojo.mjs';
export { adjustedRandIndex } from './ari.mjs';
export { c2cSimilarity, c2cCvg, c2cCoverage } from './c2c.mjs';
export { turboMq, turboMqClusterFactors } from './turbo-mq.mjs';
export { parseRsf, formatRsf, readRsf, writeRsf, parseRsfFacts, parseDependencyRsf, readDependencyRsf } from './rsf.mjs';
export { toPartitionMap, clustersOf, commonObjects } from './partition.mjs';

// Predicted-to-ground-truth cluster count, both counted over the objects the partitions share.
export function clusterCountRatio(a, b) {
  const onlyObjects = commonObjects(a, b);
  return clustersOf(a, { onlyObjects }).size / clustersOf(b, { onlyObjects }).size;
}

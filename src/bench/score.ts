// Scores of one method's partition (plan §7): against the ground truth on a scramble (MoJoFM, ARI, c2c_cvg, cluster
// ratio, MoJoFM on the hard files), and without it on every entry (TurboMQ, module-level back-edges against a DAG
// order of the partition, the measure R4's allow-list is cut with). Rounded like the G1 spike's tables.
import { backEdgesOf, dagOrder, type WeightedEdge } from '../boundaries/order.js';
import { plannedEdges } from '../planner/metrics.js';
import { turboMq } from '../planner/metrics-turbo-mq.js';
import { nameTokens } from '../planner/seeds.js';
import type { Facts } from '../planner/types.js';
import type { Assignment } from './baselines.js';
import { adjustedRandIndex } from './metrics/ari.js';
import { c2cCvg } from './metrics/c2c.js';
import { mojoFm } from './metrics/mojo.js';
import { clusterCountRatio, restrict } from './metrics/partition.js';

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** The scramble's answer key: each scored file's feature, the scored files, and the hard ones among them. */
export interface GroundTruth {
  truth: Map<string, string>;
  /** Feature files the facts can place (movable), sorted. */
  featureFiles: string[];
  /** Feature files whose anchored name token differs from their feature folder, sorted. */
  hardFiles: string[];
}

export interface TruthScores {
  mojoFm: number;
  ari: number;
  c2cCvg: number;
  clusterCountRatio: number;
  mojoFmHard: number | null;
}

export interface GraphScores {
  clusters: number;
  turboMq: { sum: number; mean: number };
  backEdges: number;
}

/** A ground-truth label as name tokens: `plugins/github` → github, `team-collections` → team-collection. */
export const truthTokens = (label: string) => nameTokens(label.split('/').pop()!).join('-');

export function truthScores(assignment: Assignment, groundTruth: GroundTruth): TruthScores {
  const predicted = restrict(assignment, groundTruth.featureFiles);
  const truth = restrict(groundTruth.truth, groundTruth.featureFiles);
  return {
    mojoFm: round(mojoFm(predicted, truth), 2),
    ari: round(adjustedRandIndex(predicted, truth), 3),
    // The share of ground-truth modules recovered (c2c > 0.66): ARCADE Cvg.run(groundTruth, method).
    c2cCvg: round(c2cCvg(truth, predicted, { threshold: 0.66 }), 3),
    clusterCountRatio: round(clusterCountRatio(predicted, truth), 2),
    mojoFmHard: groundTruth.hardFiles.length > 1
      ? round(mojoFm(restrict(assignment, groundTruth.hardFiles), restrict(groundTruth.truth, groundTruth.hardFiles)), 2)
      : null,
  };
}

/** Edges between clusters, weighted by the file pairs behind them (each (from, to) file pair once). */
export function clusterEdges(assignment: Assignment, facts: Facts): WeightedEdge[] {
  const edges = new Map<string, WeightedEdge>();
  for (const edge of plannedEdges(facts.edges, assignment)) {
    const from = assignment.get(edge.from)!;
    const to = assignment.get(edge.to)!;
    if (from === to) continue;
    const key = `${from}\0${to}`;
    const existing = edges.get(key);
    if (existing) existing.weight += 1;
    else edges.set(key, { from, to, weight: 1 });
  }
  return [...edges.values()];
}

/** TurboMQ over the facts' edges, and the cluster edges that point backwards in the partition's own DAG order. */
export function graphScores(assignment: Assignment, facts: Facts): GraphScores {
  const clusters = [...new Set(assignment.values())];
  const edges = clusterEdges(assignment, facts);
  const { sum, mean } = turboMq(assignment, facts.edges);
  return {
    clusters: clusters.length,
    turboMq: { sum: round(sum, 4), mean: round(mean, 4) },
    backEdges: backEdgesOf(dagOrder(clusters, edges), edges).length,
  };
}

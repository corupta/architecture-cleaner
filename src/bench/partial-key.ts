// A real entry's partial answer key (BenchEntry.groundTruth): an RSF file of `contain <feature> <path>` lines naming
// movable files by their package-relative paths, as the facts do. The files it labels are scored exactly as a
// scramble's feature files are (truthScores over them, hard files judged by the anchored name token): every method still
// places every movable file, and only the labeled ones count. A labeled path that is no movable file is reported, never
// dropped in silence. The result keeps each method's groups for the scored files, so every score can be recomputed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Facts } from '../planner/types.js';
import { nameTokenAnchored, type Assignment } from './baselines.js';
import { truthScores, truthTokens, type GroundTruth } from './score.js';
import type { BenchKeyScore, BenchPartialKey, MethodScore } from './types.js';

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round = (value: number, digits: number) => Number(value.toFixed(digits));

export interface PartialKeyFile {
  /** Feature by path, in file order. */
  labels: Map<string, string>;
  sha256: string;
}

/** Reads `contain <feature> <path>` lines (blank lines and `#` comments skipped); a path labeled twice is an error. */
export function readPartialKey(file: string): PartialKeyFile {
  if (!fs.existsSync(file)) throw new Error(`partial key ${file} not found`);
  const bytes = fs.readFileSync(file);
  const labels = new Map<string, string>();
  bytes.toString('utf8').split('\n').forEach((line, index) => {
    const text = line.trim();
    if (!text || text.startsWith('#')) return;
    const fields = text.split(/\s+/);
    if (fields.length !== 3 || fields[0] !== 'contain') throw new Error(`${file}:${index + 1}: not a \`contain <feature> <path>\` line: ${text}`);
    const [, feature, labeled] = fields as [string, string, string];
    if (labels.has(labeled)) throw new Error(`${file}:${index + 1}: ${labeled} is labeled twice`);
    labels.set(labeled, feature);
  });
  if (!labels.size) throw new Error(`${file}: labels no file`);
  return { labels, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

/**
 * The key over the files the facts can place: the scored files, the hard ones among them (their anchored name token,
 * on their own names, differs from their feature: groundTruthOf's definition for a scramble), and the labeled paths
 * that are no movable file.
 */
export function partialGroundTruthOf(labels: ReadonlyMap<string, string>, facts: Facts): GroundTruth & { notMovable: { path: string; feature: string }[] } {
  const movable = new Set(facts.files.map((file) => file.path));
  const truth = new Map([...labels].filter(([file]) => movable.has(file)).sort(([a], [b]) => byCodeUnit(a, b)));
  if (!truth.size) throw new Error(`the partial key labels none of the ${facts.files.length} movable files: its paths must be package-relative, as the facts name them (${facts.files[0]?.path ?? 'none'})`);
  const featureFiles = [...truth.keys()];
  const anchored = nameTokenAnchored(facts);
  return {
    truth,
    featureFiles,
    hardFiles: featureFiles.filter((file) => anchored.get(file) !== truthTokens(truth.get(file)!)),
    notMovable: [...labels].filter(([file]) => !movable.has(file)).map(([file, feature]) => ({ path: file, feature })).sort((a, b) => byCodeUnit(a.path, b.path)),
  };
}

/** One method's scores over the scored files, with its groups for them. */
export function keyScore(method: string, assignment: Assignment, groundTruth: GroundTruth): BenchKeyScore {
  const groups = Object.fromEntries(groundTruth.featureFiles.filter((file) => assignment.has(file)).map((file) => [file, assignment.get(file)!]));
  return { method, ...truthScores(assignment, groundTruth), assignment: groups };
}

/** A Louvain resolution's row: the mean of its seeds' scores, rounded as the scores are (the seeds keep the groups). */
export function keyMean(method: string, scores: BenchKeyScore[]): BenchKeyScore {
  const mean = (pick: (score: BenchKeyScore) => number | null, digits: number) => {
    const values = scores.map(pick);
    return values.every((value): value is number => value !== null) ? round(values.reduce((sum, value) => sum + value, 0) / values.length, digits) : null;
  };
  return {
    method,
    mojoFm: mean((score) => score.mojoFm, 2)!,
    ari: mean((score) => score.ari, 3)!,
    c2cCvg: mean((score) => score.c2cCvg, 3)!,
    clusterCountRatio: mean((score) => score.clusterCountRatio, 2)!,
    mojoFmHard: mean((score) => score.mojoFmHard, 2),
  };
}

/** The key's record in the result: its scope, the truth over the scored files, and the scores of every row. */
export function partialKeyRecord(
  key: { file: string; sha256: string; source: string | null; labeled: number },
  groundTruth: GroundTruth & { notMovable: { path: string; feature: string }[] },
  movableFiles: number,
  methods: readonly MethodScore[],
  scores: ReadonlyMap<string, BenchKeyScore>,
  louvainSeeds: Record<string, BenchKeyScore[]>,
): BenchPartialKey {
  const rows = methods.map((row) => scores.get(row.method)!);
  const kinds = new Map(methods.map((row) => [row.method, row.kind]));
  const best = rows.filter((row) => kinds.get(row.method) !== 'planner').reduce<BenchKeyScore | null>((top, row) => (!top || row.mojoFm > top.mojoFm ? row : top), null);
  return {
    ...key,
    scoredFiles: groundTruth.featureFiles.length,
    features: new Set(groundTruth.truth.values()).size,
    share: round(groundTruth.featureFiles.length / movableFiles, 3),
    hardFiles: groundTruth.hardFiles,
    notMovable: groundTruth.notMovable,
    truth: Object.fromEntries(groundTruth.truth),
    methods: rows,
    louvainSeeds,
    bestBaseline: best && { method: best.method, mojoFm: best.mojoFm },
  };
}

/** A key's scores by the method they score (the rows of `methods`). */
export const keyScoresByMethod = (key: BenchPartialKey) => new Map(key.methods.map((score) => [score.method, score]));

/**
 * The sentence summary.md and compare say about a key: what it covers, against the scrambles' complete keys.
 * `computed over the files immich's 2024 domain layer labels (44 of 269 movable files, 22 features, 3 hard), unlike the scrambles' complete keys`
 */
export function partialKeyScope(key: BenchPartialKey, movableFiles: number): string {
  const labeler = key.source ?? `the key ${key.file}`;
  const hard = `${key.hardFiles.length} hard`;
  return `computed over the files ${labeler} labels (${key.scoredFiles} of ${movableFiles} movable files, ${key.features} ${key.features === 1 ? 'feature' : 'features'}, ${hard}), unlike the scrambles' complete keys`;
}

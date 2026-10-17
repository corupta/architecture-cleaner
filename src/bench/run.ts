// `ac bench` (plan §7, contract S2): per manifest entry, a worktree of the target at its pinned commit (node_modules
// linked from the pristine checkout, which is never written), for a scramble entry `scrambleRepo` (our executor and
// certifier flatten its feature folders into type folders; the original folders are the ground truth), then the facts
// the planner would see, every baseline, the seeds draft and the planner (through a gateway on the entry's cassette:
// replay by default), each scored against the ground truth (scrambles) and with TurboMQ and back-edges (every entry).
// Writes bench/results/<entry>.json (BenchResult) and summary.md over every result in the out directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import { addWorktree, removeWorktrees } from '../certificate/certify.js';
import { loadProfile, type Profile } from '../certificate/profile.js';
import { packageDirectory } from '../certificate/toolchain.js';
import { GatewayError, type Gateway } from '../gateway/types.js';
import { branchExists, git, resolveRevision } from '../orchestrator/git.js';
import { buildFacts } from '../planner/facts.js';
import type { Facts, FileFact } from '../planner/types.js';
import { readScrambleManifest, scrambleRepo } from '../scramble/index.js';
import { readInventory } from '../scramble/inventory.js';
import { layoutScramble } from '../scramble/layout.js';
import type { ScrambleManifest, ScrambleOptions, ScrambleResult } from '../scramble/types.js';
import { baselinePartitions, louvainPartitions, nameTokenAnchored, underNames, type Assignment } from './baselines.js';
import { planPartition } from './planner.js';
import { graphScores, truthScores, truthTokens, type GroundTruth } from './score.js';
import { benchSummary } from './summary.js';
import type { BenchEntry, BenchManifest, BenchResult, MethodScore } from './types.js';

export interface BenchOptions {
  /** Entry names to run; null runs every entry. */
  only: string[] | null;
  /** null: no planner row (--no-llm). */
  gateway: ((entry: BenchEntry) => Gateway) | null;
  /** Certify each scramble commit (static checks). */
  certify: boolean;
  /** Where results/<entry>.json and summary.md go. */
  out: string;
  /** Scratch: one directory per entry (its worktree and the scramble's outputs); null makes a temporary one. */
  work: string | null;
  /** Keep the worktrees (default: removed after each entry; the scramble branches stay). */
  keep: boolean;
  log(message: string): void;
}

/** What the bench calls outside itself: the scramble (tests pass a fake). */
export interface BenchDependencies {
  scramble(options: ScrambleOptions): Promise<ScrambleResult>;
}

export interface BenchOutcome {
  results: BenchResult[];
  failures: { entry: string; error: string }[];
  /** The scratch directory used. */
  work: string;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round = (value: number, digits: number) => Number(value.toFixed(digits));
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const expandHome = (file: string) => (file === '~' || file.startsWith('~/') ? path.join(os.homedir(), file.slice(1)) : file);

/** Scramble manifests and cassettes are named relative to this package (`~/` is the home directory, as in target checkouts). */
export const packagePath = (file: string) => path.resolve(packageDirectory(), expandHome(file));

export function readBenchManifest(file: string): BenchManifest {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as BenchManifest;
  if (!Array.isArray(manifest.entries)) throw new Error(`${file}: no entries`);
  const names = new Set<string>();
  for (const entry of manifest.entries) {
    if (!/^[\w.-]+$/.test(entry.name ?? '')) throw new Error(`${file}: entry name ${JSON.stringify(entry.name)} is not a path segment`);
    if (names.has(entry.name)) throw new Error(`${file}: entry ${entry.name} twice`);
    names.add(entry.name);
    if (entry.kind !== 'scramble' && entry.kind !== 'real') throw new Error(`${file}: entry ${entry.name}: kind is scramble or real`);
    if (entry.kind === 'scramble' && !entry.scramble) throw new Error(`${file}: entry ${entry.name} needs a scramble manifest`);
    if (entry.kind === 'real' && !entry.sha) throw new Error(`${file}: entry ${entry.name} needs a sha`);
    if (!entry.repo || !entry.cassette) throw new Error(`${file}: entry ${entry.name} needs repo and cassette`);
  }
  return manifest;
}

/** Repo-relative directories (root '') whose node_modules the pristine checkout has installed. */
function installedDirectories(checkout: string, commit: string): string[] {
  const directories = ['', ...git(checkout, ['ls-tree', '-r', '-d', '-z', '--name-only', commit]).split('\0').filter(Boolean)];
  return directories.filter((directory) => !directory.split('/').includes('node_modules') && fs.existsSync(path.join(checkout, directory, 'node_modules')));
}

/**
 * The scramble's answer key over the files the facts can place. Hard files are the feature files whose anchored name
 * token, judged on the default variant's names, differs from their feature folder: where name-token goes wrong (G1's
 * definition). An H1 entry passes `defaultPaths` (original → default destination), so both variants score the same files.
 */
export function groundTruthOf(scramble: ScrambleResult, facts: Facts, defaultPaths: ReadonlyMap<string, string> | null = null): GroundTruth & { pinnedFeatureFiles: number } {
  const movable = new Set(facts.files.map((file) => file.path));
  const features = scramble.entities.filter((entity) => entity.truthKind === 'feature');
  const scored = features.filter((entity) => movable.has(entity.scrambled));
  const truth = new Map(scored.map((entity) => [entity.scrambled, entity.truth]));
  const featureFiles = [...truth.keys()].sort(byCodeUnit);
  const entityAt = new Map(scramble.entities.map((entity) => [entity.scrambled, entity]));
  const defaultName = (file: FileFact) => {
    const entity = entityAt.get(file.path);
    const moved = entity && entity.scrambled !== entity.original;
    return path.posix.basename(moved ? defaultPaths?.get(entity.original) ?? entity.scrambled : file.path);
  };
  const anchored = underNames(facts, defaultName, nameTokenAnchored);
  return {
    truth,
    featureFiles,
    hardFiles: featureFiles.filter((file) => anchored.get(file) !== truthTokens(truth.get(file)!)),
    pinnedFeatureFiles: features.length - scored.length,
  };
}

function methodScore(method: string, kind: MethodScore['kind'], assignment: Assignment, facts: Facts, groundTruth: GroundTruth | null): MethodScore {
  const graph = graphScores(assignment, facts);
  const truth = groundTruth ? truthScores(assignment, groundTruth) : null;
  return {
    method,
    kind,
    clusters: graph.clusters,
    mojoFm: truth?.mojoFm ?? null,
    ari: truth?.ari ?? null,
    c2cCvg: truth?.c2cCvg ?? null,
    clusterCountRatio: truth?.clusterCountRatio ?? null,
    mojoFmHard: truth?.mojoFmHard ?? null,
    turboMq: graph.turboMq,
    backEdges: graph.backEdges,
  };
}

/** One row for a resolution: the mean of its seeds' scores. */
function meanScore(method: string, scores: MethodScore[]): MethodScore {
  const field = (pick: (score: MethodScore) => number | null, digits: number) => {
    const values = scores.map(pick);
    return values.every((value): value is number => value !== null) ? round(mean(values), digits) : null;
  };
  return {
    method,
    kind: 'baseline',
    clusters: field((score) => score.clusters, 1)!,
    mojoFm: field((score) => score.mojoFm, 2),
    ari: field((score) => score.ari, 3),
    c2cCvg: field((score) => score.c2cCvg, 3),
    clusterCountRatio: field((score) => score.clusterCountRatio, 2),
    mojoFmHard: field((score) => score.mojoFmHard, 2),
    turboMq: { sum: field((score) => score.turboMq.sum, 4)!, mean: field((score) => score.turboMq.mean, 4)! },
    backEdges: field((score) => score.backEdges, 1)!,
    note: `mean of seeds ${scores.length === 1 ? '1' : `1-${scores.length}`}`,
  };
}

/** The best deterministic method (baselines and the seeds draft): by MoJoFM on a scramble, by TurboMQ (sum) on a real target. */
function bestDeterministic(methods: MethodScore[], scramble: boolean): BenchResult['bestBaseline'] {
  const candidates = methods.filter((score) => score.kind !== 'planner');
  const value = (score: MethodScore) => (scramble ? score.mojoFm ?? -Infinity : score.turboMq.sum);
  const best = candidates.reduce<MethodScore | null>((winner, score) => (!winner || value(score) > value(winner) ? score : winner), null);
  return best && { method: best.method, mojoFm: best.mojoFm, turboMq: best.turboMq.sum };
}

interface Target {
  checkout: string;
  sha: string;
  packageRoot: string;
  moduleRoot: string;
  manifest: ScrambleManifest | null;
}

function targetOf(entry: BenchEntry, profile: Profile | null): Target {
  const checkout = expandHome(entry.repo);
  if (entry.kind === 'scramble') {
    const manifest = readScrambleManifest(packagePath(entry.scramble!));
    return { checkout, sha: manifest.sha, packageRoot: manifest.packageRoot, moduleRoot: manifest.moduleRoot, manifest };
  }
  return {
    checkout,
    sha: entry.sha!,
    packageRoot: (entry.packageRoot ?? profile?.packageRoot ?? '').replace(/^\.\/?/, '').replace(/\/$/, ''),
    moduleRoot: entry.moduleRoot ?? profile?.plan?.moduleRoot ?? 'src',
    manifest: null,
  };
}

async function benchEntry(entry: BenchEntry, options: BenchOptions & { work: string }, dependencies: BenchDependencies): Promise<BenchResult> {
  const log = (message: string) => options.log(`${entry.name}: ${message}`);
  const profile = entry.profile ? loadProfile(entry.profile) : null;
  const target = targetOf(entry, profile);
  const variant = entry.variant ?? 'default';
  const base = resolveRevision(target.checkout, target.sha);
  const directory = path.resolve(options.work, entry.name);
  const worktree = path.join(directory, 'repo');
  fs.mkdirSync(directory, { recursive: true });
  log(`worktree of ${target.checkout} at ${base.slice(0, 12)}`);
  addWorktree(target.checkout, base, worktree, { checkout: target.checkout, linked: installedDirectories(target.checkout, base) });
  const notes: string[] = [];
  try {
    let scramble: ScrambleResult | null = null;
    let defaultPaths: Map<string, string> | null = null;
    if (target.manifest) {
      if (variant === 'H1') {
        // The default variant's destinations, read before the scramble from the base tree: hard files are judged on them.
        const layout = layoutScramble(target.manifest, 'default', readInventory(gitRepoFs(worktree), target.packageRoot, target.moduleRoot));
        defaultPaths = new Map(layout.entities.map((entity) => [entity.original, entity.scrambled]));
      }
      // The bench's own branch namespace: a previous bench run's branch is replaced, never another tool's.
      const branch = `ac-bench/${entry.name}`;
      if (branchExists(target.checkout, branch)) {
        log(`deleting the previous bench branch ${branch}`);
        git(target.checkout, ['branch', '-D', branch]);
      }
      scramble = await dependencies.scramble({
        repo: worktree, manifest: target.manifest, variant, out: path.join(directory, 'scramble'), branch, environment: target.checkout, profile,
        certify: options.certify, oracles: false, log,
      });
    }
    const repoFs = gitRepoFs(scramble?.worktree ?? worktree);
    const roots = { packageRoot: target.packageRoot, moduleRoot: target.moduleRoot };
    const facts = buildFacts(repoFs, { ...roots, pins: profile?.plan?.pins ?? [] });
    log(`facts: ${facts.files.length} movable files, ${facts.edges.length} edges, ${facts.pins.length} pinned`);
    const groundTruth = scramble ? groundTruthOf(scramble, facts, defaultPaths) : null;
    if (groundTruth?.pinnedFeatureFiles) {
      const count = groundTruth.pinnedFeatureFiles;
      notes.push(`${count} feature ${count === 1 ? 'file is' : 'files are'} pinned in the facts (no method can place ${count === 1 ? 'it' : 'them'}) and not scored.`);
    }

    const methods: MethodScore[] = baselinePartitions(facts).map((partition) => methodScore(partition.method, partition.kind, partition.assignment, facts, groundTruth));
    const louvainMojoFm: Record<string, number[]> = {};
    for (const [resolution, partitions] of louvainPartitions(facts)) {
      const scores = partitions.map((assignment) => methodScore(`Louvain r=${resolution}`, 'baseline', assignment, facts, groundTruth));
      methods.push(meanScore(`Louvain r=${resolution} (mean of seeds 1-${partitions.length})`, scores));
      louvainMojoFm[String(resolution)] = scores.map((score) => score.mojoFm!);
    }
    log(`${methods.length} deterministic methods scored`);

    let planner: BenchResult['planner'] = null;
    if (!options.gateway) {
      notes.push('The planner did not run (--no-llm).');
    } else {
      const gateway = options.gateway(entry);
      const spentBefore = gateway.spent().run;
      try {
        const planned = await planPartition(repoFs, gateway, profile ?? { name: entry.name, packageRoot: target.packageRoot, node: 'system' }, roots);
        const spentUsd = round(gateway.spent().run - spentBefore, 6);
        methods.push({ ...methodScore(planned.method, 'planner', planned.assignment, facts, groundTruth), ...(planned.errors.length ? { note: `invalid plan: ${planned.errors.length} validator errors` } : {}) });
        planner = { cassette: entry.cassette, recordedCostUsd: round(planned.recordedCostUsd, 6), spentUsd, replayed: spentUsd === 0, groups: planned.groups, planSha256: planned.planSha256 };
        if (planned.errors.length) notes.push(`The validator rejects the planner's plan (${planned.errors.slice(0, 3).join('; ')}); it is scored as it came back.`);
        log(`planner: ${planned.groups} groups, plan.yaml sha256 ${planned.planSha256.slice(0, 12)}, ${planner.replayed ? 'replayed' : `spent $${spentUsd.toFixed(4)}`}`);
      } catch (error) {
        if (!(error instanceof GatewayError && error.code === 'replay-miss')) throw error;
        notes.push(`The planner is not recorded in ${entry.cassette} for these facts (replay miss); record it with --mode auto --run <budget run>.`);
        log('planner: not recorded (replay miss)');
      }
    }

    const leaky = scramble ? new Set([...scramble.entities.filter((entity) => entity.leaky).map((entity) => entity.original), ...scramble.leakage.map((file) => file.path)]) : null;
    return {
      format: 'ac-bench/1',
      entry: entry.name,
      kind: entry.kind,
      variant,
      repo: entry.repo,
      sha: base,
      packageRoot: target.packageRoot,
      moduleRoot: target.moduleRoot,
      files: facts.files.length,
      featureFiles: groundTruth?.featureFiles.length ?? null,
      groundTruthModules: groundTruth ? new Set(groundTruth.truth.values()).size : null,
      hardFiles: groundTruth?.hardFiles.length ?? null,
      leakyFiles: leaky?.size ?? null,
      scramble: scramble && {
        commit: scramble.commit,
        tree: scramble.tree,
        moved: scramble.entities.filter((entity) => entity.scrambled !== entity.original).length,
        declined: scramble.declined.length,
        excluded: scramble.excluded.length,
        certificate: scramble.certificate && { verdict: scramble.certificate.verdict, scope: scramble.certificate.scope, digest: scramble.certificate.digest, failing: [...scramble.certificate.failing] },
      },
      methods,
      bestBaseline: bestDeterministic(methods, Boolean(scramble)),
      planner,
      louvainMojoFmByResolution: scramble ? louvainMojoFm : null,
      notes,
    };
  } finally {
    if (!options.keep) removeWorktrees(target.checkout, [worktree]);
  }
}

/** Every result file in `out`, in manifest order (entries not in the manifest last, by name). */
export function readResults(out: string, manifest: BenchManifest): BenchResult[] {
  if (!fs.existsSync(out)) return [];
  const order = new Map(manifest.entries.map((entry, index) => [entry.name, index]));
  return fs.readdirSync(out).filter((file) => file.endsWith('.json')).sort(byCodeUnit)
    .map((file) => JSON.parse(fs.readFileSync(path.join(out, file), 'utf8')) as BenchResult)
    .filter((result) => result.format === 'ac-bench/1')
    .sort((a, b) => (order.get(a.entry) ?? Infinity) - (order.get(b.entry) ?? Infinity) || byCodeUnit(a.entry, b.entry));
}

export async function runBench(manifest: BenchManifest, options: BenchOptions, dependencies: BenchDependencies = { scramble: scrambleRepo }): Promise<BenchOutcome> {
  const unknown = (options.only ?? []).filter((name) => !manifest.entries.some((entry) => entry.name === name));
  if (unknown.length) throw new Error(`no bench entry ${unknown.join(', ')} (entries: ${manifest.entries.map((entry) => entry.name).join(', ')})`);
  const entries = manifest.entries.filter((entry) => !options.only || options.only.includes(entry.name));
  const work = path.resolve(options.work ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ac-bench-')));
  fs.mkdirSync(options.out, { recursive: true });
  const results: BenchResult[] = [];
  const failures: BenchOutcome['failures'] = [];
  for (const entry of entries) {
    try {
      const result = await benchEntry(entry, { ...options, work }, dependencies);
      fs.writeFileSync(path.join(options.out, `${entry.name}.json`), `${JSON.stringify(result, null, 1)}\n`);
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.log(`${entry.name}: failed: ${message}`);
      failures.push({ entry: entry.name, error: message });
    }
  }
  fs.writeFileSync(path.join(options.out, 'summary.md'), benchSummary(readResults(options.out, manifest)));
  return { results, failures, work };
}


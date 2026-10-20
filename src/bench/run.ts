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
import { GatewayError, type CassetteMode, type Gateway } from '../gateway/types.js';
import { branchExists, git, resolveRevision } from '../orchestrator/git.js';
import { buildFacts } from '../planner/facts.js';
import type { Facts, FileFact } from '../planner/types.js';
import { readScrambleManifest, scrambleRepo } from '../scramble/index.js';
import { readInventory } from '../scramble/inventory.js';
import { layoutScramble } from '../scramble/layout.js';
import type { ScrambleManifest, ScrambleOptions, ScrambleResult } from '../scramble/types.js';
import { baselinePartitions, benchDraft, louvainPartitions, nameTokenAnchored, underNames, type Assignment } from './baselines.js';
import { planPartition, type PlannerPartition } from './planner.js';
import { graphScores, truthScores, truthTokens, type GroundTruth } from './score.js';
import { benchSummary } from './summary.js';
import type { BenchDraft, BenchEntry, BenchLeakage, BenchManifest, BenchResult, MethodScore } from './types.js';

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
  /** The gateway's cassette mode: a profile's pinned critic prompt applies to replays only. */
  mode: CassetteMode;
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
const counted = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;

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

/**
 * What the scrambled paths give away, over the files every method sees: the facts' movable files (the planner's prompt
 * lists them by path). A leaky file that the facts pin or don't read (a test without a subject, an asset, a declined
 * file with a pinned hazard) reaches no method and is counted apart, as unseen. `files`: the leaky files at their
 * scrambled paths, sorted.
 */
export function leakageOf(scramble: ScrambleResult, facts: Facts): { leakage: BenchLeakage; files: string[] } {
  const visible = new Set(facts.files.map((file) => file.path));
  const leakyRenames = scramble.entities.filter((entity) => entity.leaky);
  const renamed = leakyRenames.filter((entity) => visible.has(entity.scrambled)).map((entity) => entity.scrambled);
  const inFeatureFolder = scramble.leakage.filter((file) => visible.has(file.path)).map((file) => file.path);
  const modulePrefix = scramble.manifest.moduleRoot ? `${scramble.manifest.moduleRoot}/` : '';
  const subFolders = new Map<string, { files: string[]; features: Set<string> }>();
  for (const entity of scramble.entities) {
    if (entity.truthKind !== 'feature' || entity.scrambled === entity.original || !visible.has(entity.scrambled)) continue;
    // `<type folder>/<sub-folders of its feature…>/<name>` under the module root.
    const segments = entity.scrambled.slice(modulePrefix.length).split('/');
    if (segments.length < 3) continue;
    const folder = subFolders.get(segments[1]!) ?? { files: [], features: new Set<string>() };
    folder.files.push(entity.scrambled);
    folder.features.add(entity.truth);
    subFolders.set(segments[1]!, folder);
  }
  const underSubFolder = [...subFolders.values()].filter((folder) => folder.files.length > 1 && folder.features.size === 1).flatMap((folder) => folder.files);
  const unseenRenames = leakyRenames.length - renamed.length;
  return {
    leakage: {
      renamed: renamed.length,
      inFeatureFolder: inFeatureFolder.length,
      underSubFolder: underSubFolder.length,
      subFolders: [...subFolders].sort(([a], [b]) => byCodeUnit(a, b)).map(([folder, { files, features }]) => ({ folder, files: files.length, features: features.size })),
      unseen: scramble.leakage.length - inFeatureFolder.length + unseenRenames,
    },
    files: [...new Set([...renamed, ...inFeatureFolder, ...underSubFolder])].sort(byCodeUnit),
  };
}

/** The leakage in plain words, for the notes (summary.md and the site render them). */
export function leakageNote(leakage: BenchLeakage, leakyFiles: number, files: number): string {
  const kinds = [`${leakage.inFeatureFolder} still in a feature folder`, counted(leakage.renamed, 'leaky rename'), `${leakage.underSubFolder} in a sub-folder that only files of their feature share`];
  const overlap = leakage.inFeatureFolder + leakage.renamed + leakage.underSubFolder - leakyFiles;
  const folders = leakage.subFolders.map((folder) => `${folder.folder} (${counted(folder.files, 'file')}, ${counted(folder.features, 'feature')})`);
  return [
    `Leakage, over the ${counted(files, 'movable file')} every method sees: ${leakyFiles} give their feature away in their path (${kinds.join('; ')}${overlap ? `; ${overlap} counted under two kinds` : ''}).`,
    ...(folders.length ? [`Sub-folders kept under the type folders: ${folders.join(', ')}; the planner's prompt shows them, and no deterministic method groups by them.`] : []),
    ...(leakage.unseen ? [`${counted(leakage.unseen, 'more leaky file')} ${leakage.unseen === 1 ? 'is' : 'are'} pinned or not read by the facts, so no method sees ${leakage.unseen === 1 ? 'it' : 'them'}: not counted.`] : []),
  ].join(' ');
}

/**
 * The planner's draft, and how far the plan moved from it, in plain words; the planner row's short note. Moves that name
 * their file by id are said with what the rules did with them, so the text is right whether the planner kept its draft
 * because the rules dropped them (rules 1, the S7 results) or read them (rules 2).
 */
export function plannerNotes(planned: Pick<PlannerPartition, 'groups' | 'modules' | 'change' | 'errors' | 'rules'>, draft: BenchDraft, files: number): { notes: string[]; rowNote: string | null } {
  const { change } = planned;
  const { winner, critic } = change;
  const issues = winner ? Object.entries(winner.issues).sort(([a, countA], [b, countB]) => countB - countA || byCodeUnit(a, b)) : [];
  const issueCount = issues.reduce((sum, [, count]) => sum + count, 0);
  const byId = winner?.movesById ?? 0;
  const idMoves = byId ? ` (${byId === 1 ? '1 names its file' : `${byId} name their file`} by its id, not its path)` : '';
  const idRules = !byId ? '' : planned.rules === 1
    ? " Planner rules 1 read a move's file by its path only, so a move that names it by id is an unknown file."
    : ' Planner rules 2 read a file by the id the prompt showed for it.';
  const sentences = [
    change.samePartition
      ? `The planner's plan keeps the partition of its draft, the ${draft.method}: every file stays in its draft group, so the planner row scores the draft.`
      : `The planner's plan moves ${change.filesMoved} of ${files} files out of their draft group and merges ${counted(change.groupsMerged, 'draft group')} into others (${change.draftGroups} draft groups, ${planned.groups} plan groups).`,
    winner
      ? `The winning edit, ${winner.label}, had ${counted(winner.groupEntries, 'group entry', 'group entries')} and ${counted(winner.moves, 'move')}${idMoves}; ${issueCount ? `the validator found ${counted(issueCount, 'problem')} with it (${issues.map(([code, count]) => `${code} ${count}`).join(', ')}) and dropped or repaired each before applying it.` : 'the validator found no problem with it.'}${idRules}`
      : 'No edit came back, so the draft is the plan.',
    ...(critic ? [critic.suggestions ? `The critic made ${counted(critic.suggestions, 'suggestion')} and its gate kept ${critic.kept || 'none'}.` : 'The critic made no suggestion.'] : []),
  ];
  const notes = [
    `The planner starts from the ${draft.method}: plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave ${draft.contested.exportNames} against ${draft.contested.fileNames} (no ground truth is read).`,
    sentences.join(' '),
    ...(planned.modules ? [] : [`The plan has no feature modules: all ${counted(planned.groups, 'group')} are platform or shared.`]),
  ];
  const rowNote = [
    ...(planned.errors.length ? [`invalid plan: ${counted(planned.errors.length, 'validator error')}`] : []),
    ...(change.samePartition ? ["its draft's partition"] : []),
    ...(planned.modules ? [] : ['0 modules']),
  ].join('; ');
  return { notes, rowNote: rowNote || null };
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

    const draft = benchDraft(facts);
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
        const planned = await planPartition(repoFs, gateway, profile ?? { name: entry.name, packageRoot: target.packageRoot, node: 'system' }, roots, options.mode);
        const spentUsd = round(gateway.spent().run - spentBefore, 6);
        const described = plannerNotes(planned, draft, facts.files.length);
        methods.push({ ...methodScore(planned.method, 'planner', planned.assignment, facts, groundTruth), ...(described.rowNote ? { note: described.rowNote } : {}) });
        planner = {
          cassette: entry.cassette, recordedCostUsd: round(planned.recordedCostUsd, 6), spentUsd, replayed: spentUsd === 0, calls: planned.calls, rules: planned.rules,
          groups: planned.groups, modules: planned.modules, change: planned.change, planSha256: planned.planSha256,
        };
        if (planned.errors.length) notes.push(`The validator rejects the planner's plan (${planned.errors.slice(0, 3).join('; ')}); it is scored as it came back.`);
        notes.push(...described.notes);
        log(`planner: ${planned.groups} groups, plan.yaml sha256 ${planned.planSha256.slice(0, 12)}, ${planner.replayed ? 'replayed' : `spent $${spentUsd.toFixed(4)}`}`);
      } catch (error) {
        if (!(error instanceof GatewayError && error.code === 'replay-miss')) throw error;
        notes.push(`The planner is not recorded in ${entry.cassette} for these facts (replay miss); record it with --mode auto --run <budget run>.`);
        log('planner: not recorded (replay miss)');
      }
    }

    const leaky = scramble ? leakageOf(scramble, facts) : null;
    if (leaky) notes.push(leakageNote(leaky.leakage, leaky.files.length, facts.files.length));
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
      leakyFiles: leaky?.files.length ?? null,
      leakage: leaky?.leakage ?? null,
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
      draft,
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


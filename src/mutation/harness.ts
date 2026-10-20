// The mutation harness (plan §3.4 "Trusting the checker"): known-good results (applied executor fixtures, our
// branches on openhab-cloud and immich) are mutated one operator instance at a time, each mutant becomes a commit
// in a scratch repository, and the certifier runs in-process on base..mutant without K8. A mutant that certifies
// PASS is a soundness hole. The known-good result itself is certified first (the control).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { certify } from '../certificate/certify.js';
import { resolveCommit } from '../certificate/git-tree.js';
import { requireHermetic } from '../certificate/hermetic.js';
import { loadProfile, type Profile } from '../certificate/profile.js';
import { packageDirectory } from '../certificate/toolchain.js';
import type { Certificate, CheckId, CheckStatus } from '../certificate/types.js';
import type { TreeEdits } from './edits.js';
import { type Candidate, type Operator, operators } from './operators.js';
import { openSubject, type Subject, type SubjectCommits, type SubjectSpec } from './subject.js';

/** K0–K7 as implemented (K5 is K3a's compile context and K4's glob order): every mutant must die here, without K8. */
export const staticChecks: CheckId[] = ['K0', 'K1', 'K2', 'K3a', 'K3b', 'K3c', 'K4', 'K6', 'K7'];
/** Checks that read the committed trees only; the others run the target's runner or Node in worktrees of both commits. */
const treeOnlyChecks = new Set<CheckId>(['K0', 'K1', 'K2', 'K3a', 'K4', 'K7']);

/**
 * The certification stages of a mutant: with `staged`, the tree-only checks first and the runner/runtime checks only
 * when no tree-only check kills it (a mutant needs one kill; immich's runner probes take minutes per commit).
 */
export function stagesOf(checks: CheckId[], staged: boolean): CheckId[][] {
  if (!staged) return [checks];
  return [checks.filter((check) => treeOnlyChecks.has(check)), checks.filter((check) => !treeOnlyChecks.has(check))].filter((stage) => stage.length);
}

export interface MutantRecord {
  id: string;
  subject: string;
  target: string;
  operator: string;
  variant?: string;
  description: string;
  /** Mutant commit in the subject's scratch repository. */
  commit: string;
  repo: string;
  /** Checks that ran: all of them, or (staged) up to the first stage that killed. */
  checksRun: CheckId[];
  /** Checks that failed. */
  killedBy: CheckId[];
  /** Checks that crashed (no certificate, but no evidence either). */
  erroredBy: CheckId[];
  /**
   * Kills that aren't explained by the control: the check passes the good head, or it reports a violation here
   * that it doesn't report on the good head. A check that rejects both for the same reasons proves nothing.
   */
  effectiveKilledBy: CheckId[];
  survived: boolean;
  effectivelySurvived: boolean;
  statuses: Partial<Record<CheckId, CheckStatus>>;
  /** First violations of each failing check (why it was killed). */
  violations: Partial<Record<CheckId, string[]>>;
  durationMs: number;
  /** `git diff` good head → mutant, for survivors. */
  diff?: string;
}

export interface ControlRecord {
  subject: string;
  target: string;
  /** Hunt cases: which tree served as the known-good head. */
  kind?: string;
  repo: string;
  base: string;
  head: string;
  verdict: 'pass' | 'fail';
  failing: CheckId[];
  statuses: Partial<Record<CheckId, CheckStatus>>;
  violations: Partial<Record<CheckId, string[]>>;
  durationMs: number;
  checkDurationsMs: Partial<Record<CheckId, number>>;
}

export interface CapRecord {
  subject: string;
  operator: string;
  variant?: string;
  candidates: number;
  kept: number;
  /** Candidates tried before `kept` reached the cap that turned out not to apply (e.g. a specifier that can't keep its form). */
  unbuildable: number;
  keptKeys: string[];
}

export interface HarnessIssue {
  subject: string;
  operator?: string;
  detail: string;
}

export interface HarnessResult {
  startedAt: string;
  checks: CheckId[];
  staged: boolean;
  cap: number;
  mutants: MutantRecord[];
  controls: ControlRecord[];
  capped: CapRecord[];
  /** Operators without a single instance on a subject (no such site/file exists there). */
  notApplicable: { subject: string; operator: string }[];
  issues: HarnessIssue[];
  durationMs: number;
}

/** A case of the S3 hunt corpus (test/certificate/hunt/README.md): an executor output (before → after) that is wrong. */
export interface HuntCase {
  id: string;
  title: string;
  directory: string;
  /** The checks the corpus author expects to reject it. */
  expectedChecks: CheckId[];
  /** The installed node_modules the case needs (vitest: this package's; jest: $AC_HUNT_JEST_NODE_MODULES). */
  nodeModules?: string;
}

export interface HarnessOptions {
  subjects: SubjectSpec[];
  hunt: HuntCase[];
  operators?: string[];
  /** Instances per operator variant and subject (picked by a stable hash). */
  cap: number;
  checks: CheckId[];
  /** Stop at the first stage that kills (see stagesOf); controls always run every check. */
  staged: boolean;
  workDir: string;
  /** Drop the certifier's per-check progress lines. */
  quiet: boolean;
  /** The certifier's per-tree cache (CertifyOptions.cacheDir), shared by every control and mutant (off when unset). */
  cacheDir?: string;
  log(message: string): void;
}

const identity = {
  GIT_AUTHOR_NAME: 'ac-mutation', GIT_AUTHOR_EMAIL: 'mutation@ac.invalid', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'ac-mutation', GIT_COMMITTER_EMAIL: 'mutation@ac.invalid', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

function git(repo: string, args: string[], { input, env }: { input?: string | Buffer; env?: NodeJS.ProcessEnv } = {}): string {
  const run = spawnSync('git', ['-C', repo, ...args], { input, env: { ...process.env, ...env }, maxBuffer: 1 << 30 });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr.toString()}`);
  return run.stdout.toString('utf8');
}

const hash = (...parts: string[]) => createHash('sha256').update(parts.join('\0')).digest('hex');
const safeName = (name: string) => name.replace(/[^\w.-]+/g, '_');
let indexCounter = 0;
const scratchIndex = (repo: string) => path.join(git(repo, ['rev-parse', '--absolute-git-dir']).trim(), `ac-mutation-index-${process.pid}-${indexCounter++}`);

/** The good head with `edits` applied, committed on top of `parent` (git plumbing only: a private index, no checkout). */
export function commitEdits(repo: string, head: string, parent: string, edits: TreeEdits, message: string): string {
  const index = scratchIndex(repo);
  const env = { GIT_INDEX_FILE: index };
  try {
    git(repo, ['read-tree', head], { env });
    const removals = [...edits].filter(([, content]) => content === null).map(([file]) => file);
    const records = [...edits].flatMap(([file, content]) => (content ? [`${content.mode} ${git(repo, ['hash-object', '-w', '--stdin'], { input: content.bytes }).trim()}\t${file}`] : []));
    if (removals.length) git(repo, ['update-index', '-z', '--force-remove', '--stdin'], { env, input: `${removals.join('\0')}\0` });
    if (records.length) git(repo, ['update-index', '-z', '--index-info'], { env, input: `${records.join('\0')}\0` });
    const tree = git(repo, ['write-tree'], { env }).trim();
    return git(repo, ['commit-tree', tree, '-p', parent, '-m', message], { env: identity }).trim();
  } finally {
    fs.rmSync(index, { force: true });
  }
}

const storedDirectoryNames = new Map([['_node_modules', 'node_modules'], ['_dist', 'dist']]);

/** Copies a stored tree byte for byte (symlinks verbatim, modes kept), restoring `_node_modules`/`_dist` (corpus storage). */
function copyTree(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(source), path.join(to, entry.name));
    else if (entry.isDirectory()) copyTree(source, path.join(to, storedDirectoryNames.get(entry.name) ?? entry.name));
    else {
      fs.copyFileSync(source, path.join(to, entry.name));
      fs.chmodSync(path.join(to, entry.name), fs.statSync(source).mode);
    }
  }
}

/** Replaces the scratch repo's working tree with `tree` and commits it (fixed identity and date: same tree, same id). */
function commitWorkingTree(repo: string, tree: string, force: boolean, message: string): string {
  for (const entry of fs.readdirSync(repo)) if (entry !== '.git') fs.rmSync(path.join(repo, entry), { recursive: true, force: true });
  copyTree(tree, repo);
  git(repo, ['add', '-A', ...(force ? ['-f'] : [])]);
  git(repo, ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--allow-empty', '--no-verify', '-m', message], { env: identity });
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

export interface PairOptions {
  /** `git add -f`: commit files the tree's own .gitignore matches (the hunt corpus stores tracked files only). */
  force?: boolean;
  /** Untracked installs copied into the checkout after both commits. */
  environment?: string;
  /** An installed node_modules linked as the checkout's `node_modules` (a test runner the case needs). */
  nodeModules?: string;
}

/** A scratch repository with two commits, base = `before`, head = `after`; its checkout is the environment. */
export function materializePair(repo: string, before: string, after: string, options: PairOptions = {}): SubjectCommits {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  const base = commitWorkingTree(repo, before, options.force ?? false, 'base');
  const head = commitWorkingTree(repo, after, options.force ?? false, 'head');
  if (options.environment && fs.existsSync(options.environment)) copyTree(options.environment, repo);
  if (options.nodeModules && !fs.existsSync(path.join(repo, 'node_modules'))) fs.symlinkSync(path.resolve(options.nodeModules), path.join(repo, 'node_modules'));
  return { repo, environment: repo, base, head };
}

export function fixturesDirectory(): string {
  return path.join(packageDirectory(), 'test', 'fixtures');
}

/**
 * An installed test runner for scratch repos that have none: vitest is this package's own; Jest isn't a dependency
 * here, so $AC_HUNT_JEST_NODE_MODULES or G3's mcphub clone (Jest 30, ts-jest), as the hunt corpus README says.
 */
export function runnerNodeModules(kind: string): string | undefined {
  if (kind === 'vitest') return path.join(packageDirectory(), 'node_modules');
  if (kind !== 'jest') return undefined;
  const g3 = path.join(targetsDirectory(), 'g3', 'mcphub', 'node_modules');
  return process.env.AC_HUNT_JEST_NODE_MODULES ?? (fs.existsSync(path.join(g3, 'jest')) ? g3 : undefined);
}

/** The runner a fixture's tree configures at its root, so K3b/K6 can run on it (the fixtures ship no node_modules). */
function fixtureRunner(tree: string): string | undefined {
  const files = fs.readdirSync(tree);
  if (files.some((file) => /^(vitest|vite)\.config\./.test(file))) return 'vitest';
  const manifest = files.includes('package.json') ? JSON.parse(fs.readFileSync(path.join(tree, 'package.json'), 'utf8')) as { jest?: unknown; scripts?: Record<string, string> } : {};
  if (files.some((file) => /^jest\.config\./.test(file)) || manifest.jest || /^jest\b/.test(manifest.scripts?.test ?? '')) return 'jest';
  return undefined;
}

/** Every applied executor fixture as a known-good result: before/ and after/ as two commits, its runner linked. */
export function fixtureSubjects(directory = fixturesDirectory(), names?: string[]): SubjectSpec[] {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(directory, entry.name, 'after')) && (!names || names.includes(entry.name)))
    .map((entry) => entry.name)
    .sort()
    .filter((name) => JSON.parse(fs.readFileSync(path.join(directory, name, 'expected.json'), 'utf8')).outcome === 'applied')
    .map((name) => ({
      name: `fixture:${name}`,
      target: 'fixtures',
      packageRoot: '',
      profile: null,
      prepare(workDir: string) {
        const nodeModules = runnerNodeModules(fixtureRunner(path.join(directory, name, 'before')) ?? '');
        return materializePair(path.join(workDir, 'repos', `fixture-${name}`), path.join(directory, name, 'before'), path.join(directory, name, 'after'), nodeModules ? { nodeModules } : {});
      },
    }));
}

const targetsDirectory = () => path.join(os.homedir(), 'ac-targets');

/** Our known-good branches on real targets (plan §6, S3). */
export const knownTargets: Record<string, { checkout: string; base: string; head: string; profile: string }> = {
  'openhab-cloud': { checkout: 'openhab-cloud', base: '76966b5', head: 'ac/s3-bring-up', profile: 'openhab-cloud' },
  'immich-album': { checkout: 'immich', base: '02063972e', head: 'ac/s3-album', profile: 'immich' },
  'immich-r1': { checkout: 'immich', base: '02063972e', head: 'ac/s3-r1', profile: 'immich' },
};

/**
 * A known-good branch of a target. Mutant commits go to a `git clone --shared --no-checkout` scratch clone (objects
 * borrowed, nothing written to the original); the original checkout only serves its node_modules as environment.
 */
export function targetSubject(name: string, targets = targetsDirectory()): SubjectSpec {
  const known = knownTargets[name];
  if (!known) throw new Error(`unknown target '${name}' (known: ${Object.keys(knownTargets).join(', ')})`);
  const profile = loadProfile(known.profile);
  const checkout = path.join(targets, known.checkout);
  return {
    name,
    target: name,
    packageRoot: profile.packageRoot,
    profile,
    prepare(workDir) {
      const clone = path.join(workDir, 'clones', known.checkout);
      if (!fs.existsSync(path.join(clone, '.git'))) {
        fs.mkdirSync(path.dirname(clone), { recursive: true });
        const run = spawnSync('git', ['clone', '-q', '--shared', '--no-checkout', checkout, clone], { encoding: 'utf8' });
        if (run.status !== 0) throw new Error(`git clone --shared ${checkout} failed: ${run.stderr}`);
      }
      return { repo: clone, environment: checkout, base: resolveCommit(checkout, known.base), head: resolveCommit(checkout, known.head) };
    },
  };
}

export function huntDirectory(): string {
  return path.join(packageDirectory(), 'test', 'certificate', 'hunt');
}

/** Cases of the S3 hunt corpus with `"applicable": true` in case.json (test/certificate/hunt/<id>/). */
export function loadHuntCases(directory = huntDirectory()): HuntCase[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().flatMap((name) => {
    const caseFile = path.join(directory, name, 'case.json');
    if (!fs.existsSync(caseFile) || !fs.existsSync(path.join(directory, name, 'after'))) return [];
    const meta = JSON.parse(fs.readFileSync(caseFile, 'utf8')) as { applicable?: boolean; id?: string; title?: string; runner?: string; expectedChecks?: { check: CheckId }[] };
    if (meta.applicable !== true) return [];
    const nodeModules = meta.runner ? runnerNodeModules(meta.runner) : undefined;
    return [{ id: meta.id ?? name, title: meta.title ?? name, directory: path.join(directory, name), expectedChecks: (meta.expectedChecks ?? []).map((entry) => entry.check), ...(nodeModules ? { nodeModules } : {}) }];
  });
}

async function quietly<T>(enabled: boolean, run: () => Promise<T>): Promise<T> {
  if (!enabled) return run();
  const write = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => (String(chunk).startsWith('[certify]') ? true : (write as (...args: unknown[]) => boolean).call(process.stderr, chunk, ...rest))) as typeof process.stderr.write;
  try {
    return await run();
  } finally {
    process.stderr.write = write;
  }
}

interface Range extends SubjectCommits {
  packageRoot: string;
  profile: Profile | null;
}

interface Certified {
  certificate: Certificate;
  durationMs: number;
  workDir: string;
  repo: string;
}

async function certifyRange(range: Range, head: string, options: HarnessOptions, label: string, checks: CheckId[]): Promise<Certified> {
  const started = performance.now();
  const workDir = path.join(options.workDir, 'certify', safeName(label));
  const certificate = await quietly(options.quiet, () => certify({
    repo: range.repo,
    base: range.base,
    head,
    packageRoot: range.packageRoot,
    environment: range.environment,
    profile: range.profile,
    oracles: false,
    only: checks,
    workDir,
    keep: false,
    ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
  }));
  return { certificate, durationMs: Math.round(performance.now() - started), workDir, repo: range.repo };
}

const resultsOf = (outcomes: Certified[]) => outcomes.flatMap((outcome) => outcome.certificate.checks);
const statusesOf = (outcomes: Certified[]) => Object.fromEntries(resultsOf(outcomes).map((check) => [check.id, check.status])) as Partial<Record<CheckId, CheckStatus>>;
const withStatus = (outcomes: Certified[], status: CheckStatus) => resultsOf(outcomes).filter((check) => check.status === status).map((check) => check.id);
const violationText = (violation: { file?: string; detail: string }) => `${violation.file ? `${violation.file}: ` : ''}${violation.detail.split('\n')[0]!.slice(0, 300)}`;
/** A violation without what differs between any two runs (scratch directories, repositories, commit ids), so control and mutant compare. */
export function normalizedViolation(violation: { file?: string; detail: string }, { workDir, repo, commits }: { workDir: string; repo: string; commits: string[] }): string {
  let text = violationText(violation).split(workDir).join('<work>').split(repo).join('<repo>');
  for (const commit of commits) text = text.replace(new RegExp(`\\b${commit.slice(0, 7)}[0-9a-f]{0,33}\\b`, 'g'), '<commit>');
  return text.replace(/\/tmp\/[\w.-]*?(-[\w]{6})\b/g, '/tmp/<scratch>');
}
/** Every violation of each rejecting check, to tell a mutant's own violations from the control's. */
const allViolations = (outcomes: Certified[]) => new Map(outcomes.flatMap(({ certificate, workDir, repo }) => certificate.checks
  .filter((check) => check.status === 'fail' || check.status === 'error')
  .map((check) => [check.id, new Set(check.violations.map((violation) => normalizedViolation(violation, { workDir, repo, commits: [certificate.base, certificate.head] })))] as const)));
/** The failing checks whose rejection isn't explained by the control: it passes the good head, or reports something new here. */
export function effectiveKills(killedBy: CheckId[], own: Map<CheckId, Set<string>>, control: Map<CheckId, Set<string>>): CheckId[] {
  return killedBy.filter((check) => !control.has(check) || [...(own.get(check) ?? [])].some((violation) => !control.get(check)!.has(violation)));
}
const violationsOf = (outcomes: Certified[]) => Object.fromEntries(resultsOf(outcomes).filter((check) => check.status === 'fail' || check.status === 'error')
  .map((check) => [check.id, check.violations.slice(0, 3).map(violationText)]));

function diffOf(repo: string, from: string, to: string): string {
  const lines = git(repo, ['diff', '-M', '--no-color', from, to]).split('\n');
  return lines.length > 150 ? [...lines.slice(0, 150), `... ${lines.length - 150} more lines`].join('\n') : lines.join('\n');
}

/** Instances of one operator on one subject: per variant, ranked by a stable hash, the first `cap` that build. */
function pick(subject: Subject, operator: Operator, candidates: Candidate[], cap: number, capped: CapRecord[]): { candidate: Candidate; edits: TreeEdits }[] {
  const byVariant = new Map<string, Candidate[]>();
  for (const candidate of candidates) byVariant.set(candidate.variant ?? '', [...(byVariant.get(candidate.variant ?? '') ?? []), candidate]);
  const picked: { candidate: Candidate; edits: TreeEdits }[] = [];
  for (const [variant, group] of [...byVariant].sort(([a], [b]) => a.localeCompare(b))) {
    const ranked = [...new Map(group.map((candidate) => [candidate.key, candidate])).values()].sort((a, b) => hash(subject.name, operator.id, a.key).localeCompare(hash(subject.name, operator.id, b.key)));
    const kept: { candidate: Candidate; edits: TreeEdits }[] = [];
    let tried = 0;
    for (; tried < ranked.length && kept.length < cap; tried++) {
      const edits = ranked[tried]!.build();
      if (edits && edits.size) kept.push({ candidate: ranked[tried]!, edits });
    }
    if (tried < ranked.length) {
      capped.push({ subject: subject.name, operator: operator.id, ...(variant ? { variant } : {}), candidates: ranked.length, kept: kept.length, unbuildable: tried - kept.length, keptKeys: kept.map(({ candidate }) => candidate.key) });
    }
    picked.push(...kept);
  }
  return picked;
}

export async function runHarness(given: HarnessOptions): Promise<HarnessResult> {
  const started = performance.now();
  // Every control and mutant is certified under the work dir (its real path: violations are normalized by it), so a
  // work dir the certifier would refuse fails here, before the first subject.
  const options = { ...given, workDir: requireHermetic(given.workDir, 'the work dir', 'Pick a --work-dir with neither on its path.') };
  const result: HarnessResult = {
    startedAt: new Date().toISOString(), checks: options.checks, staged: options.staged, cap: options.cap, mutants: [], controls: [], capped: [], notApplicable: [], issues: [], durationMs: 0,
  };
  const selected = operators.filter((operator) => !options.operators || options.operators.includes(operator.id));
  const stages = stagesOf(options.checks, options.staged);
  const record = async (range: Range, head: string, meta: Pick<MutantRecord, 'id' | 'subject' | 'target' | 'operator' | 'description'> & { variant?: string }, controlViolations: Map<CheckId, Set<string>>, goodHead?: string) => {
    const outcomes: Certified[] = [];
    for (const [index, stage] of stages.entries()) {
      try {
        outcomes.push(await certifyRange(range, head, options, stages.length > 1 ? `${meta.id}/stage-${index + 1}` : meta.id, stage));
      } catch (error) {
        result.issues.push({ subject: meta.subject, operator: meta.operator, detail: `${meta.id}: certify threw ${(error as Error).message}` });
        return;
      }
      if (effectiveKills(withStatus(outcomes, 'fail'), allViolations(outcomes), controlViolations).length) break;
    }
    const killedBy = withStatus(outcomes, 'fail');
    const erroredBy = withStatus(outcomes, 'error');
    const effectiveKilledBy = effectiveKills(killedBy, allViolations(outcomes), controlViolations);
    const survived = outcomes.every((outcome) => outcome.certificate.verdict === 'pass');
    const durationMs = outcomes.reduce((total, outcome) => total + outcome.durationMs, 0);
    const mutant: MutantRecord = {
      ...meta,
      commit: head,
      repo: range.repo,
      checksRun: resultsOf(outcomes).map((check) => check.id),
      killedBy,
      erroredBy,
      effectiveKilledBy,
      survived,
      effectivelySurvived: effectiveKilledBy.length === 0,
      statuses: statusesOf(outcomes),
      violations: violationsOf(outcomes),
      durationMs,
    };
    if (mutant.effectivelySurvived) mutant.diff = diffOf(range.repo, goodHead ?? range.base, head);
    result.mutants.push(mutant);
    const verdict = survived ? 'SURVIVED'
      : !mutant.effectivelySurvived ? `killed by ${effectiveKilledBy.join(',')}`
        : killedBy.length ? `SURVIVED (${killedBy.join(',')} fail the control the same way)` : `SURVIVED (only crashes: ${erroredBy.join(',')})`;
    options.log(`  ${verdict}  ${meta.id} (${(durationMs / 1000).toFixed(1)} s)`);
  };

  /** Certifies a known-good result with every check; returns its violations (what a mutant's kill must go beyond). */
  const runControl = async (subject: string, target: string, range: Range, head: string, kind?: string): Promise<Map<CheckId, Set<string>> | null> => {
    let control: Certified;
    try {
      control = await certifyRange(range, head, options, `${subject}/control`, options.checks);
    } catch (error) {
      result.issues.push({ subject, detail: `control: certify threw ${(error as Error).stack ?? error}` });
      return null;
    }
    const controlRecord: ControlRecord = {
      subject,
      target,
      ...(kind ? { kind } : {}),
      repo: range.repo,
      base: range.base,
      head,
      verdict: control.certificate.verdict,
      failing: [...withStatus([control], 'fail'), ...withStatus([control], 'error')],
      statuses: statusesOf([control]),
      violations: violationsOf([control]),
      durationMs: control.durationMs,
      checkDurationsMs: Object.fromEntries(control.certificate.checks.map((check) => [check.id, check.durationMs])),
    };
    result.controls.push(controlRecord);
    options.log(`  control${kind ? ` (${kind})` : ''} ${controlRecord.verdict.toUpperCase()}${controlRecord.failing.length ? ` (${controlRecord.failing.join(',')})` : ''} (${(control.durationMs / 1000).toFixed(1)} s)`);
    return allViolations([control]);
  };

  for (const spec of options.subjects) {
    options.log(`subject ${spec.name}`);
    let subject: Subject;
    try {
      subject = openSubject(spec, options.workDir);
    } catch (error) {
      result.issues.push({ subject: spec.name, detail: `could not open: ${(error as Error).stack ?? error}` });
      continue;
    }
    const range: Range = { ...subject, packageRoot: spec.packageRoot, profile: spec.profile };
    const controlViolations = await runControl(spec.name, spec.target, range, subject.head);
    if (!controlViolations) continue;
    for (const operator of selected) {
      let candidates: Candidate[];
      try {
        candidates = operator.candidates(subject);
      } catch (error) {
        result.issues.push({ subject: spec.name, operator: operator.id, detail: `operator threw: ${(error as Error).stack ?? error}` });
        continue;
      }
      const picked = pick(subject, operator, candidates, options.cap, result.capped);
      if (!picked.length) {
        result.notApplicable.push({ subject: spec.name, operator: operator.id });
        continue;
      }
      for (const { candidate, edits } of picked) {
        const id = `${spec.name}/${operator.id}${candidate.variant ? `.${candidate.variant}` : ''}/${hash(candidate.key).slice(0, 8)}`;
        let commit: string;
        try {
          commit = commitEdits(subject.repo, subject.head, subject.base, edits, `mutant ${id}\n\n${candidate.description}`);
        } catch (error) {
          result.issues.push({ subject: spec.name, operator: operator.id, detail: `${id}: could not commit: ${(error as Error).message}` });
          continue;
        }
        await record(range, commit, { id, subject: spec.name, target: spec.target, operator: operator.id, ...(candidate.variant ? { variant: candidate.variant } : {}), description: candidate.description }, controlViolations, subject.head);
      }
    }
  }

  for (const huntCase of options.hunt) {
    options.log(`hunt ${huntCase.id}`);
    const subject = `hunt:${huntCase.id}`;
    // The case's control: its correct move (good/) when it has one, else the identity commit (before -> before).
    const good = fs.existsSync(path.join(huntCase.directory, 'good'));
    const pair = (name: string, head: string) => materializePair(path.join(options.workDir, 'repos', `hunt-${safeName(huntCase.id)}${name}`), path.join(huntCase.directory, 'before'),
      path.join(huntCase.directory, head), { force: true, environment: path.join(huntCase.directory, 'environment'), ...(huntCase.nodeModules ? { nodeModules: huntCase.nodeModules } : {}) });
    let commits: SubjectCommits;
    let controlCommits: SubjectCommits;
    try {
      commits = pair('', 'after');
      controlCommits = pair('-control', good ? 'good' : 'before');
    } catch (error) {
      result.issues.push({ subject, detail: `could not materialize: ${(error as Error).message}` });
      continue;
    }
    const controlViolations = await runControl(subject, 'hunt', { ...controlCommits, packageRoot: '', profile: null }, controlCommits.head, good ? 'before -> good' : 'before -> before');
    if (!controlViolations) continue;
    const expected = huntCase.expectedChecks.length ? ` (expected killers: ${huntCase.expectedChecks.join(', ')})` : '';
    await record({ ...commits, packageRoot: '', profile: null }, commits.head, { id: `hunt/${huntCase.id}`, subject, target: 'hunt', operator: 'hunt', variant: huntCase.id, description: `${huntCase.title}${expected}` }, controlViolations);
  }
  result.durationMs = Math.round(performance.now() - started);
  return result;
}

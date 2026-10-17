// R0's baseline (plan §2.3; §3.4 K8): every oracle of the target profile runs `runs` times on one commit, in a fresh
// worktree under K8's conditions (the target's Node, offline, hooks bypassed, the worktree reset before each oracle).
// Test outcomes are compared run to run (test identity: file + name + ordinal): a file or case whose outcome changes
// is flaky and becomes a quarantine entry, which K8 leaves out of its comparisons. A run whose report leaves out files
// another run lists stopped short: it is replaced (up to `extraRuns` more runs) and never read for flaky tests. The
// commit is green when `runs` complete runs of every oracle pass, flaky tests aside, and the flaky tests sit in at most
// flakyFileLimit files (more, and the suite is not reproducible here: plan §2.5 declines it). The first complete run
// of each oracle seeds K8's base cache, and the per-tree cache when one is given. The profile's oracle quarantines come
// back as entries too (`quarantined`), so that they follow the moves into later ranges like the flaky ones.
import fs from 'node:fs';
import path from 'node:path';
import { addWorktree, removeWorktrees } from './certify.js';
import { createEnvironment } from './commit-fs.js';
import { readCommitTree } from './git-tree.js';
import { effectiveExit, excludeTests, fileFails, flakyFileCount, flakyFileLimit, flakyTests, selectTests, sha256, shortReports, type TestReport, totalsOf } from './oracle-reports.js';
import {
  cacheDirectory, describeStep, type OracleRun, oracleCacheRoot, oracleRunKey, oracleRunKind, outsideScratch, readCachedRun, runOracle, stepBroken, stepOk, storeRun,
} from './oracle-runs.js';
import { linksOf, loadReport, resetWorktree, runnerQuarantine, validateOracles } from './oracles.js';
import type { OracleSpec, Profile } from './profile.js';
import { openTreeCache } from './tree-cache.js';

/**
 * A test left out of K8's comparisons. `file` is repo-relative at the certify base commit (K8 maps it to head through
 * the pathMap); `name` is the runner's full test name (jest/vitest: ancestor titles and title joined by ' > '; mocha:
 * its fullTitle), every case of that name in the file; no name is the whole file.
 */
export interface QuarantineEntry {
  file: string;
  name?: string;
  reason: string;
  /**
   * A profile oracle's own quarantine (`oracle.quarantine`): that oracle's runner leaves the whole file out of its
   * runs (`{quarantine}`), and the entry carries the file to the paths of a later range's base.
   */
  oracle?: string;
}

export interface BaselineOptions {
  /** The git repository holding `commit`. */
  repo: string;
  commit: string;
  /** The package the profile describes (informational: every oracle step names its own directory). */
  packageRoot: string;
  /** Checkout whose installed node_modules the worktree links. */
  environment: string;
  profile: Profile;
  runs: number;
  /** Runs added per tests oracle to replace runs that stopped short (default 2). */
  extraRuns?: number;
  workDir: string;
  /** Keep the worktree's logs (the worktree itself is always removed). */
  keep?: boolean;
  /** A per-tree cache (CertifyOptions.cacheDir) the first complete run of each oracle is stored in, as K8's base run. */
  cacheDir?: string;
  log?: (message: string) => void;
}

export interface BaselineOracleResult {
  name: string;
  kind: 'exit-zero' | 'tests' | 'artifact-identical';
  /** Every run passed (flaky tests aside) and, for an artifact, every run produced the same bytes. */
  ok: boolean;
  runs: { ok: boolean; exitCode: number | null; durationMs: number; summary: string }[];
  detail: string;
}

export interface BaselineResult {
  commit: string;
  tree: string;
  oracles: BaselineOracleResult[];
  /** Flaky tests as quarantine entries (the commit is the certify base of the first step). */
  flaky: QuarantineEntry[];
  /**
   * The profile's oracle quarantines as entries at this commit's paths, present when the profile has any: mapped
   * through each certified step like `flaky`, they give K8 the files at a later range's base.
   */
  quarantined?: QuarantineEntry[];
  /** Every oracle ok in every run, ignoring flaky tests. */
  green: boolean;
  durationMs: number;
}

const count = (value: number) => value.toLocaleString('en-US');
const mainStep = (oracle: OracleSpec, run: OracleRun) => run.steps[(oracle.setup ?? []).length];
const durationOf = (run: OracleRun) => Math.round(run.seconds * 1000);

/** A run whose every step exited 0. */
function stepsOk(oracle: OracleSpec, run: OracleRun): string | null {
  const failed = run.steps.find((step) => !stepOk(step));
  if (failed) return describeStep(failed);
  return run.steps.length === (oracle.setup ?? []).length + 1 ? null : 'not every step ran';
}

function exitZero(oracle: OracleSpec, runs: OracleRun[]): BaselineOracleResult {
  const results = runs.map((run) => {
    const problem = stepsOk(oracle, run);
    return { ok: problem === null, exitCode: mainStep(oracle, run)?.exitCode ?? null, durationMs: durationOf(run), summary: problem ?? 'exit 0' };
  });
  const ok = results.every((run) => run.ok);
  return { name: oracle.name, kind: oracle.kind, ok, runs: results, detail: ok ? `exit 0 in ${runs.length} runs` : `failed in ${results.filter((run) => !run.ok).length} of ${runs.length} runs` };
}

/** Indexes of the runs whose reports stopped short of another run's file list (a missing or unreadable report doesn't count here). */
function shortRuns(reports: (TestReport | string)[]): Set<number> {
  const parsed = reports.flatMap((report, index) => (typeof report === 'string' ? [] : [{ report, index }]));
  return new Set(shortReports(parsed.map((entry) => entry.report)).map((position) => parsed[position]!.index));
}

function tests(oracle: OracleSpec, profile: Profile, runs: OracleRun[], wanted: number): { result: BaselineOracleResult; flaky: QuarantineEntry[] } {
  const format = oracle.format ?? profile.runner?.kind;
  if (!format) throw new Error(`oracle ${oracle.name}: tests needs a format (or a profile runner)`);
  const reports = runs.map((run) => loadReport(run, format));
  const short = shortRuns(reports);
  const kept = reports.filter((report, index): report is TestReport => typeof report !== 'string' && !short.has(index));
  const flaky = flakyTests(kept);
  const excluded = selectTests(flaky);
  const results = runs.map((run, index) => {
    const report = reports[index]!;
    const setup = run.steps.slice(0, (oracle.setup ?? []).length).find((step) => !stepOk(step));
    const main = mainStep(oracle, run);
    const base = { exitCode: main?.exitCode ?? null, durationMs: durationOf(run) };
    if (setup) return { ...base, ok: false, summary: describeStep(setup) };
    if (!main || stepBroken(main)) return { ...base, ok: false, summary: main ? describeStep(main) : 'the runner did not run' };
    if (typeof report === 'string') return { ...base, ok: false, summary: report };
    const totals = totalsOf(report);
    const failures = [...excludeTests(report, excluded).report.files.values()].filter(fileFails).length;
    const exit = effectiveExit(main.exitCode, report, excluded);
    const summary = `exit ${main.exitCode}: ${count(totals.loaded)}/${count(totals.files)} files load, ${count(totals.passed)} passed, ${count(totals.failed)} failed, ${count(totals.skipped)} skipped`;
    if (short.has(index)) return { ...base, ok: false, summary: `${summary}; stopped short of another run's file list, so it was replaced and not read for flaky tests` };
    const ok = exit === 0 && failures === 0 && totals.cases > 0;
    return { ...base, ok, summary: totals.cases ? summary : `${summary}; no test case ran` };
  });
  const complete = results.filter((_, index) => !short.has(index));
  const files = Math.max(0, ...kept.map((report) => report.files.size));
  const flakyFiles = flakyFileCount(flaky);
  const reproducible = flakyFiles <= flakyFileLimit(files);
  const ok = complete.length >= wanted && complete.every((run) => run.ok) && reproducible;
  const failing = complete.filter((run) => !run.ok).length;
  const verdict = complete.length < wanted ? `only ${complete.length} of ${runs.length} runs complete (${wanted} needed)`
    : !reproducible ? `not reproducible: flaky tests in ${flakyFiles} of ${count(files)} files (at most ${flakyFileLimit(files)} allowed)`
      : failing ? `not green in ${failing} of ${complete.length} complete runs` : `green in ${complete.length} complete runs`;
  const detail = `${verdict}${short.size ? `; ${short.size} run${short.size === 1 ? '' : 's'} stopped short and replaced` : ''}${flaky.length ? `; ${flaky.length} flaky (${flaky.slice(0, 3).map((test) => `${test.file}${test.name ? ` '${test.name}'` : ''}`).join(', ')}${flaky.length > 3 ? ', …' : ''})` : '; no flaky test'}`;
  const entries = flaky.map((test) => ({ file: test.file, ...(test.name !== undefined ? { name: test.name } : {}), reason: `flaky in the baseline: ${oracle.name} gave ${test.outcomes.join(', ')} in ${kept.length} complete runs` }));
  return { result: { name: oracle.name, kind: oracle.kind, ok, runs: results, detail }, flaky: reproducible ? entries : [] };
}

function artifactIdentical(oracle: OracleSpec, runs: OracleRun[], reference: Buffer | undefined): BaselineOracleResult {
  const digests = runs.map((run) => (run.artifact ? sha256(fs.readFileSync(run.artifact)) : null));
  const results = runs.map((run, index) => {
    const problem = stepsOk(oracle, run) ?? (digests[index] ? null : `${oracle.artifact} was not produced`);
    const summary = problem ?? `${count(fs.statSync(run.artifact!).size)} bytes, sha256 ${digests[index]!.slice(0, 12)}`;
    return { ok: problem === null, exitCode: mainStep(oracle, run)?.exitCode ?? null, durationMs: durationOf(run), summary };
  });
  const produced = results.every((run) => run.ok);
  const identical = produced && new Set(digests).size === 1;
  const referenceNote = !oracle.reference || !identical ? '' : reference && sha256(reference) === digests[0]
    ? `; byte-identical to the tracked ${oracle.reference}` : `; differs from the tracked ${oracle.reference ?? ''} (K8 runs base to compare)`;
  const detail = !produced ? `failed in ${results.filter((run) => !run.ok).length} of ${runs.length} runs` : identical ? `byte-identical in ${runs.length} runs${referenceNote}` : `not reproducible: ${new Set(digests).size} different artifacts in ${runs.length} runs`;
  return { name: oracle.name, kind: oracle.kind, ok: identical, runs: results, detail };
}

export async function runBaseline(options: BaselineOptions): Promise<BaselineResult> {
  const started = performance.now();
  const log = options.log ?? ((message: string) => process.stderr.write(`[baseline] ${message}\n`));
  const { profile } = options;
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error(`runBaseline: runs must be a positive integer (got ${options.runs})`);
  const specs = profile.oracles ?? [];
  validateOracles(specs);
  fs.mkdirSync(options.workDir, { recursive: true });
  const tree = readCommitTree(options.repo, options.commit);
  const environment = createEnvironment(options.environment, [tree], path.join(options.workDir, 'shadow'));
  const root = addWorktree(options.repo, tree.commit, path.join(options.workDir, 'worktree'), environment);
  const links = linksOf(environment.linked);
  try {
    const missing = new Map(specs.map((oracle) => [oracle.name, (oracle.requires ?? []).filter((file) => !fs.existsSync(path.join(root, file)))]));
    // A quarantine that names no file of this commit was written at another layout: the runner would run those tests.
    const misplaced = new Map(specs.map((oracle) => [oracle.name, (oracle.quarantine ?? []).filter((file) => !tree.entries.has(file))]));
    const runnable = (oracle: OracleSpec) => !missing.get(oracle.name)!.length && !misplaced.get(oracle.name)!.length;
    const runs = new Map<string, OracleRun[]>(specs.map((oracle) => [oracle.name, []]));
    const runOnce = async (oracle: OracleSpec, label: string) => {
      resetWorktree(root, links);
      const index = runs.get(oracle.name)!.length + 1;
      log(`${oracle.name}: run ${index}${label}`);
      const directory = path.join(options.workDir, 'runs', String(index), oracle.name);
      runs.get(oracle.name)!.push(await runOracle({ profile, oracle, side: 'base', root, directory, quarantine: runnerQuarantine(oracle.quarantine ?? [], (file) => file) }));
    };
    for (let index = 0; index < options.runs; index++) {
      for (const oracle of specs) if (runnable(oracle)) await runOnce(oracle, ` of ${options.runs}`);
    }
    // A tests run that stopped short is replaced, so `runs` complete runs are compared.
    for (const oracle of specs) {
      const format = oracle.format ?? profile.runner?.kind;
      if (oracle.kind !== 'tests' || !format || !runnable(oracle)) continue;
      for (let extra = 0; extra < (options.extraRuns ?? 2); extra++) {
        const oracleRuns = runs.get(oracle.name)!;
        const reports = oracleRuns.map((run) => loadReport(run, format));
        if (oracleRuns.length - shortRuns(reports).size >= options.runs) break;
        await runOnce(oracle, `, replacing a run that stopped short`);
      }
    }
    resetWorktree(root, links);
    const cacheRoot = oracleCacheRoot();
    const treeCache = options.cacheDir ? openTreeCache(options.cacheDir, { packageRoot: options.packageRoot, environment }, log) : null;
    const oracles: BaselineOracleResult[] = [];
    const flaky: QuarantineEntry[] = [];
    for (const oracle of specs) {
      const absent = missing.get(oracle.name)!;
      if (absent.length) {
        oracles.push({ name: oracle.name, kind: oracle.kind, ok: false, runs: [], detail: `not run: the environment lacks ${absent.join(', ')} (prerequisite builds)` });
        continue;
      }
      const elsewhere = misplaced.get(oracle.name)!;
      if (elsewhere.length) {
        oracles.push({ name: oracle.name, kind: oracle.kind, ok: false, runs: [], detail: `not run: its quarantine names ${elsewhere.join(', ')}, not files of ${tree.commit.slice(0, 12)} (written at another layout)` });
        continue;
      }
      const oracleRuns = runs.get(oracle.name)!;
      const format = oracle.format ?? profile.runner?.kind;
      const short = oracle.kind === 'tests' && format ? shortRuns(oracleRuns.map((run) => loadReport(run, format))) : new Set<number>();
      const complete = oracleRuns.find((run, index) => !run.steps.some(stepBroken) && !short.has(index));
      if (cacheRoot && complete) {
        const cached = cacheDirectory(cacheRoot, { repo: options.repo, baseCommit: tree.commit, oracle, profile, checkout: environment.checkout, linked: environment.linked });
        if (!readCachedRun(cached)) storeRun(complete, cached);
      }
      if (treeCache && complete) {
        treeCache.writeFiles(oracleRunKind, tree.tree, oracleRunKey(profile, oracle, runnerQuarantine(oracle.quarantine ?? [], (file) => file), environment.checkout), complete.directory, (relative) => !outsideScratch(relative));
      }
      if (oracle.kind === 'tests') {
        const evaluated = tests(oracle, profile, oracleRuns, options.runs);
        oracles.push(evaluated.result);
        flaky.push(...evaluated.flaky);
      } else if (oracle.kind === 'exit-zero') oracles.push(exitZero(oracle, oracleRuns));
      else oracles.push(artifactIdentical(oracle, oracleRuns, oracle.reference ? tree.bytes(oracle.reference) : undefined));
    }
    for (const oracle of oracles) log(`${oracle.name}: ${oracle.ok ? 'ok' : 'NOT OK'}, ${oracle.detail}`);
    const quarantined = specs.flatMap((oracle) => (oracle.quarantine ?? []).map((file) => ({ file, reason: `the profile's ${oracle.name} oracle leaves it out of its runs`, oracle: oracle.name })));
    return {
      commit: tree.commit, tree: tree.tree, oracles, flaky, ...(quarantined.length ? { quarantined } : {}), green: oracles.every((oracle) => oracle.ok), durationMs: Math.round(performance.now() - started),
    };
  } finally {
    removeWorktrees(options.repo, [root]);
    if (!options.keep) fs.rmSync(options.workDir, { recursive: true, force: true });
  }
}

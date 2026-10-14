// R0's baseline (plan §2.3; §3.4 K8): every oracle of the target profile runs `runs` times on one commit, in a fresh
// worktree under K8's conditions (the target's Node, offline, hooks bypassed, the worktree reset before each oracle).
// Test outcomes are compared run to run (test identity: file + name + ordinal): a file or case whose outcome changes
// is flaky and becomes a quarantine entry, which K8 leaves out of its comparisons. The commit is green when every
// oracle passes in every run, flaky tests aside. The first complete run of each oracle seeds K8's base cache.
import fs from 'node:fs';
import path from 'node:path';
import { addWorktree, removeWorktrees } from './certify.js';
import { createEnvironment } from './commit-fs.js';
import { readCommitTree } from './git-tree.js';
import { effectiveExit, excludeTests, fileFails, flakyTests, selectTests, sha256, type TestReport, totalsOf } from './oracle-reports.js';
import { cacheDirectory, describeStep, type OracleRun, oracleCacheRoot, readCachedRun, runOracle, stepBroken, stepOk, storeRun } from './oracle-runs.js';
import { linksOf, loadReport, resetWorktree, runnerQuarantine, validateOracles } from './oracles.js';
import type { OracleSpec, Profile } from './profile.js';

/**
 * A test left out of K8's comparisons. `file` is repo-relative at the certify base commit (K8 maps it to head through
 * the pathMap); `name` is the runner's full test name (jest/vitest: ancestor titles and title joined by ' > '; mocha:
 * its fullTitle), every case of that name in the file; no name is the whole file.
 */
export interface QuarantineEntry {
  file: string;
  name?: string;
  reason: string;
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
  workDir: string;
  /** Keep the worktree's logs (the worktree itself is always removed). */
  keep?: boolean;
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

function tests(oracle: OracleSpec, profile: Profile, runs: OracleRun[]): { result: BaselineOracleResult; flaky: QuarantineEntry[] } {
  const format = oracle.format ?? profile.runner?.kind;
  if (!format) throw new Error(`oracle ${oracle.name}: tests needs a format (or a profile runner)`);
  const reports = runs.map((run) => loadReport(run, format));
  const parsed = reports.filter((report): report is TestReport => typeof report !== 'string');
  const flaky = flakyTests(parsed);
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
    const ok = exit === 0 && failures === 0 && totals.cases > 0;
    return { ...base, ok, summary: totals.cases ? summary : `${summary}; no test case ran` };
  });
  const ok = results.every((run) => run.ok);
  const failing = results.filter((run) => !run.ok).length;
  const detail = `${ok ? `green in ${runs.length} runs` : `not green in ${failing} of ${runs.length} runs`}${flaky.length ? `; ${flaky.length} flaky (${flaky.slice(0, 3).map((test) => `${test.file}${test.name ? ` '${test.name}'` : ''}`).join(', ')}${flaky.length > 3 ? ', …' : ''})` : '; no flaky test'}`;
  const entries = flaky.map((test) => ({ file: test.file, ...(test.name !== undefined ? { name: test.name } : {}), reason: `flaky in the baseline: ${oracle.name} gave ${test.outcomes.join(', ')} in ${runs.length} runs` }));
  return { result: { name: oracle.name, kind: oracle.kind, ok, runs: results, detail }, flaky: entries };
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
    const runs = new Map<string, OracleRun[]>(specs.map((oracle) => [oracle.name, []]));
    for (let index = 0; index < options.runs; index++) {
      for (const oracle of specs) {
        if (missing.get(oracle.name)!.length) continue;
        resetWorktree(root, links);
        log(`${oracle.name}: run ${index + 1} of ${options.runs}`);
        const directory = path.join(options.workDir, 'runs', String(index + 1), oracle.name);
        runs.get(oracle.name)!.push(await runOracle({ profile, oracle, side: 'base', root, directory, quarantine: runnerQuarantine(oracle, (file) => file) }));
      }
    }
    resetWorktree(root, links);
    const cacheRoot = oracleCacheRoot();
    const oracles: BaselineOracleResult[] = [];
    const flaky: QuarantineEntry[] = [];
    for (const oracle of specs) {
      const absent = missing.get(oracle.name)!;
      if (absent.length) {
        oracles.push({ name: oracle.name, kind: oracle.kind, ok: false, runs: [], detail: `not run: the environment lacks ${absent.join(', ')} (prerequisite builds)` });
        continue;
      }
      const oracleRuns = runs.get(oracle.name)!;
      const complete = oracleRuns.find((run) => !run.steps.some(stepBroken));
      if (cacheRoot && complete) {
        const cached = cacheDirectory(cacheRoot, { repo: options.repo, baseCommit: tree.commit, oracle, profile, checkout: environment.checkout, linked: environment.linked });
        if (!readCachedRun(cached)) storeRun(complete, cached);
      }
      if (oracle.kind === 'tests') {
        const evaluated = tests(oracle, profile, oracleRuns);
        oracles.push(evaluated.result);
        flaky.push(...evaluated.flaky);
      } else if (oracle.kind === 'exit-zero') oracles.push(exitZero(oracle, oracleRuns));
      else oracles.push(artifactIdentical(oracle, oracleRuns, oracle.reference ? tree.bytes(oracle.reference) : undefined));
    }
    for (const oracle of oracles) log(`${oracle.name}: ${oracle.ok ? 'ok' : 'NOT OK'}, ${oracle.detail}`);
    return { commit: tree.commit, tree: tree.tree, oracles, flaky, green: oracles.every((oracle) => oracle.ok), durationMs: Math.round(performance.now() - started) };
  } finally {
    removeWorktrees(options.repo, [root]);
    if (!options.keep) fs.rmSync(options.workDir, { recursive: true, force: true });
  }
}

// K8 Oracles on the commit (plan §3.4): the target's own tools (tsc, the unit suite, per-target artifacts) run in a
// fresh worktree of the head commit (hooks bypassed, HUSKY=0) under the target's Node, offline, and must agree with
// the base commit under the pathMap. Base runs happen only when a verdict needs them. With a per-tree cache, runs of
// either side are reused wherever their tree is certified again (oracle-runs.ts oracleRunKey), and the certificate's
// `run` facts say which came from it (`<oracle>.<side>.cached`); without one, base runs are cached per base commit.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  compareDiagnostics, compareTestReports, describeArtifactDifference, type Diagnostic, effectiveExit, escapeRegExp, excludeTests, flakyFileCount, flakyFileLimit, type FlakyTest, flakyTests,
  formatDiagnostic, parseTestReport, parseTscDiagnostics, reportFails, selectTests, sha256, shortReports, type TestReport, totalsOf,
} from './oracle-reports.js';
import {
  cacheDirectory, describeStep, type OracleRun, oracleCacheRoot, oracleRunKey, oracleRunKind, outsideScratch, readCachedRun, runOracle, stepBroken, stepOk, storeRun,
} from './oracle-runs.js';
import type { QuarantineEntry } from './baseline.js';
import type { OracleSpec, Profile } from './profile.js';
import { nodeBinary, targetEnvironment } from './toolchain.js';
import { type Check, type CertifyContext, type Finding, result, type Side, skipped, type Violation } from './types.js';

const title = 'Oracles on the commit';
const examples = 10;

type Metrics = Record<string, number | string | boolean>;

interface Evaluation {
  summary: string;
  violations: Violation[];
  findings: Finding[];
  /** The oracle couldn't be evaluated (a broken base run, a missing reference): never a pass. */
  errors: Violation[];
  metrics: Metrics;
  /** Facts about the runs (timings, log directories, cache use): the check's `run`. */
  run: Metrics;
}

const newEvaluation = (): Evaluation => ({ summary: '', violations: [], findings: [], errors: [], metrics: {}, run: {} });

const count = (value: number) => value.toLocaleString('en-US');

/** Repo-relative paths of the node_modules links materialize() puts into a worktree. */
export const linksOf = (linked: string[]) => new Set(linked.map((directory) => (directory ? `${directory}/node_modules` : 'node_modules')));

/** `git status` of a worktree: modified tracked files, and untracked or ignored entries other than the node_modules links. */
function worktreeState(root: string, links: ReadonlySet<string>): { modified: string[]; extra: string[] } {
  const output = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--ignored', '--untracked-files=normal'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const modified: string[] = [];
  const extra: string[] = [];
  const records = output.split('\0');
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (!record) continue;
    const code = record.slice(0, 2);
    const file = record.slice(3);
    if (code[0] === 'R' || code[0] === 'C') index++;
    if (code === '??' || code === '!!') {
      if (!links.has(file.replace(/\/$/, ''))) extra.push(file);
    } else modified.push(file);
  }
  return { modified, extra };
}

/**
 * Puts a worktree back to its commit before an oracle runs in it: tracked files restored, untracked and ignored files
 * removed (what earlier checks or oracles left, e.g. a dist/ a later oracle could pick up), the node_modules links
 * kept. Returns what it found.
 */
export function resetWorktree(root: string, links: ReadonlySet<string>): { modified: string[]; extra: string[] } {
  const found = worktreeState(root, links);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (found.modified.length) git('reset', '--hard', '-q');
  if (found.extra.length) git('clean', '-ffdxq', ...[...links].flatMap((link) => ['-e', `/${link}`]));
  const left = worktreeState(root, links);
  if (left.modified.length || left.extra.length) throw new Error(`the worktree ${root} could not be reset to its commit: ${[...left.modified, ...left.extra].slice(0, 5).join(', ')}`);
  return found;
}

/** The expansion of a `{quarantine}` argv element: the oracle's quarantined files (mapped to the side) as path patterns. */
export const runnerQuarantine = (files: readonly string[], map: (file: string) => string) => files.map((file) => `/${escapeRegExp(map(file))}$`);

/**
 * The files an oracle's runner leaves out (`{quarantine}`), at the base commit's paths. The profile writes them at
 * the target's original layout; a caller that knows where they are at this range's base (the orchestrator maps them
 * through every certified step, as it does the flaky entries) passes them as quarantine entries tagged with the
 * oracle, which then stand for the profile's list.
 */
export function quarantinedFiles(oracle: OracleSpec, entries: readonly QuarantineEntry[] = []): string[] {
  const mapped = entries.filter((entry) => entry.oracle === oracle.name).map((entry) => entry.file);
  return mapped.length ? mapped : oracle.quarantine ?? [];
}

/** The quarantine entries K8 leaves out of one oracle's comparison: the untagged ones (flaky tests) and its own. */
const entriesFor = (oracle: OracleSpec, entries: readonly QuarantineEntry[] = []) => entries.filter((entry) => entry.oracle === undefined || entry.oracle === oracle.name);

interface Session {
  context: CertifyContext;
  profile: Profile;
  head(oracle: OracleSpec): Promise<OracleRun>;
  base(oracle: OracleSpec): Promise<OracleRun>;
  /** Another fresh run of the oracle on a side (never from the cache), for telling flaky tests from differences. */
  again(oracle: OracleSpec, side: Side, attempt: number): Promise<OracleRun>;
  /** Resets the worktrees once more and returns what the resets found. */
  finish(): { findings: Finding[]; removed: number };
}

function createSession(context: CertifyContext, profile: Profile, headRoot: string): Session {
  const { options, pathMap } = context;
  const runs = new Map<string, Promise<OracleRun>>();
  const roots: Partial<Record<Side, string>> = { head: headRoot };
  const links = linksOf(context.environment.linked);
  const findings: Finding[] = [];
  let removed = 0;
  const previous: Record<Side, string> = { base: 'the checks before K8', head: 'the checks before K8' };
  const reset = (side: Side, next: string) => {
    const found = resetWorktree(roots[side]!, links);
    if (found.modified.length) findings.push({ kind: 'worktree-modified', detail: `${previous[side]} modified tracked files of the ${side} worktree (restored before ${next}): ${found.modified.slice(0, 5).join(', ')}${found.modified.length > 5 ? ', …' : ''}` });
    if (found.extra.length) context.log(`K8 removed ${found.extra.length} untracked or ignored entries ${previous[side]} left in the ${side} worktree: ${found.extra.slice(0, 5).join(', ')}`);
    removed += found.extra.length;
  };
  const quarantine = (oracle: OracleSpec, side: Side) => runnerQuarantine(quarantinedFiles(oracle, options.quarantine), side === 'head' ? pathMap.map : (file) => file);
  const run = (oracle: OracleSpec, side: Side, attempt = 0) => {
    roots[side] ??= context.materialize(side);
    reset(side, `the ${oracle.name} oracle`);
    previous[side] = `the ${oracle.name} oracle`;
    context.log(`K8 ${oracle.name} on ${side}${attempt ? ` (run ${attempt + 1})` : ''}`);
    const directory = attempt ? path.join(options.workDir, 'oracle-reruns', side, `${oracle.name}-${attempt + 1}`) : path.join(options.workDir, 'oracles', side, oracle.name);
    return runOracle({ profile, oracle, side, root: roots[side], directory, quarantine: quarantine(oracle, side) });
  };
  const memo = (key: string, create: () => Promise<OracleRun>) => {
    if (!runs.has(key)) runs.set(key, create());
    return runs.get(key)!;
  };
  /**
   * With a per-tree cache: the run stored for this side's tree (whichever side ran it), copied to where a fresh run
   * would have written it, so every text naming its logs is the same; else a fresh run, stored when complete.
   */
  const perTree = async (oracle: OracleSpec, side: Side): Promise<OracleRun> => {
    const cache = context.cache!;
    const tree = context[side].tree;
    const key = oracleRunKey(profile, oracle, quarantine(oracle, side), context.environment.checkout);
    const directory = path.join(options.workDir, 'oracles', side, oracle.name);
    const hit = cache.readFiles(oracleRunKind, tree, key, directory) ? readCachedRun(directory) : undefined;
    if (hit) {
      context.log(`K8 ${oracle.name} on ${side}: from the tree cache`);
      return { ...hit, side };
    }
    const fresh = await run(oracle, side);
    if (!fresh.steps.some(stepBroken)) cache.writeFiles(oracleRunKind, tree, key, fresh.directory, (relative) => !outsideScratch(relative));
    return fresh;
  };
  return {
    context,
    profile,
    head: (oracle) => memo(`head:${oracle.name}`, () => (context.cache ? perTree(oracle, 'head') : run(oracle, 'head'))),
    base: (oracle) => memo(`base:${oracle.name}`, async () => {
      if (context.cache) return perTree(oracle, 'base');
      const cacheRoot = oracleCacheRoot();
      const cached = cacheRoot ? cacheDirectory(cacheRoot, { repo: options.repo, baseCommit: context.base.commit, oracle, profile, checkout: context.environment.checkout, linked: context.environment.linked }) : undefined;
      const hit = cached ? readCachedRun(cached) : undefined;
      if (hit) {
        context.log(`K8 ${oracle.name} on base: from cache ${cached}`);
        return hit;
      }
      const fresh = await run(oracle, 'base');
      if (!cached) return fresh;
      storeRun(fresh, cached);
      const stored = readCachedRun(cached);
      return stored ? { ...stored, cached: false } : fresh;
    }),
    again: (oracle, side, attempt) => run(oracle, side, attempt),
    finish() {
      for (const side of ['head', 'base'] as const) if (roots[side]) reset(side, 'the end of K8');
      return { findings, removed };
    },
  };
}

function recordRun(evaluation: Evaluation, name: string, run: OracleRun) {
  const main = run.steps[run.steps.length - 1];
  evaluation.metrics[`${name}.${run.side}.exit`] = main?.timedOut ? 'timeout' : (main?.exitCode ?? main?.signal ?? 'not run');
  evaluation.metrics[`${name}.${run.side}.networkAttempts`] = run.networkAttempts;
  evaluation.run[`${name}.${run.side}.seconds`] = Math.round(run.seconds);
  evaluation.run[`${name}.${run.side}.logs`] = run.directory;
  evaluation.run[`${name}.${run.side}.cached`] = run.cached;
}

/** Setup steps (and, unless `exceptMain`, the command) must exit 0 on head, or fail the same way on base. */
async function judgeSteps(session: Session, oracle: OracleSpec, head: OracleRun, evaluation: Evaluation, { exceptMain }: { exceptMain: boolean }) {
  const judged = exceptMain ? head.steps.slice(0, (oracle.setup ?? []).length) : head.steps;
  for (const [index, step] of judged.entries()) {
    if (stepOk(step)) continue;
    if (stepBroken(step)) {
      evaluation.violations.push({ detail: `${oracle.name}: ${describeStep(step)} on head (log ${path.join(head.directory, step.log)})` });
      continue;
    }
    const base = await session.base(oracle);
    recordRun(evaluation, oracle.name, base);
    const counterpart = base.steps[index];
    if (!counterpart || stepBroken(counterpart)) evaluation.errors.push({ detail: `${oracle.name}: on base ${counterpart ? describeStep(counterpart) : `step ${index + 1} didn't run`} (log ${base.directory})` });
    else if (stepOk(counterpart)) evaluation.violations.push({ detail: `${oracle.name}: ${describeStep(step)} on head, exit 0 on base (log ${path.join(head.directory, step.log)})` });
    else if (counterpart.exitCode !== step.exitCode) evaluation.violations.push({ detail: `${oracle.name}: ${describeStep(step)} on head, exit ${counterpart.exitCode} on base` });
    else evaluation.findings.push({ kind: 'pre-existing-failure', detail: `${oracle.name}: ${describeStep(step)} on base too` });
  }
}

const readLog = (run: OracleRun, index: number) => {
  const step = run.steps[index];
  return step ? fs.readFileSync(path.join(run.directory, step.log), 'utf8') : '';
};

function diagnosticsOf(run: OracleRun): Diagnostic[] {
  return run.steps.flatMap((step, index) => parseTscDiagnostics(readLog(run, index), step.cwd, run.root, run.ranIn));
}

/**
 * Head must exit 0. A head that fails passes only if base fails with the same exit codes and the same diagnostics as
 * a multiset (file + code + message, base paths mapped); without a diagnostics format a failing base can't vouch for head.
 */
async function exitZero(session: Session, oracle: OracleSpec): Promise<Evaluation> {
  const { pathMap } = session.context;
  const evaluation = newEvaluation();
  const head = await session.head(oracle);
  recordRun(evaluation, oracle.name, head);
  const headDiagnostics = oracle.diagnostics === 'tsc' ? diagnosticsOf(head) : [];
  if (oracle.diagnostics === 'tsc') evaluation.metrics[`${oracle.name}.head.diagnostics`] = headDiagnostics.length;
  if (head.steps.every(stepOk) && head.steps.length === (oracle.setup ?? []).length + 1) {
    evaluation.summary = `${oracle.name} exit 0`;
    return evaluation;
  }
  const failed = head.steps.find((step) => !stepOk(step))!;
  if (stepBroken(failed)) {
    evaluation.violations.push({ detail: `${oracle.name}: ${describeStep(failed)} on head (log ${path.join(head.directory, failed.log)})` });
    evaluation.summary = `${oracle.name} ${describeStep(failed)}`;
    return evaluation;
  }
  const base = await session.base(oracle);
  recordRun(evaluation, oracle.name, base);
  if (base.steps.some(stepBroken)) {
    evaluation.errors.push({ detail: `${oracle.name}: on base ${describeStep(base.steps.find(stepBroken)!)} (log ${base.directory})` });
    evaluation.summary = `${oracle.name} could not run on base`;
    return evaluation;
  }
  const failing = (run: OracleRun) => run.steps.map((step) => (stepOk(step) ? 0 : step.exitCode)).join(',');
  const headFailure = `${describeStep(failed)} on head${oracle.diagnostics === 'tsc' ? ` (${count(headDiagnostics.length)} diagnostics)` : ''}`;
  const shortFailure = `${oracle.name} exited ${failed.exitCode} on head${oracle.diagnostics === 'tsc' ? ` (${count(headDiagnostics.length)} diagnostics)` : ''}`;
  if (base.steps.every(stepOk)) {
    evaluation.violations.push({ detail: `${oracle.name}: ${headFailure}, exit 0 on base (log ${path.join(head.directory, failed.log)})` });
    for (const diagnostic of headDiagnostics.slice(0, examples)) evaluation.violations.push({ ...(diagnostic.file ? { file: diagnostic.file } : {}), detail: `${oracle.name}: ${diagnostic.code} ${diagnostic.message}` });
    evaluation.summary = `${shortFailure}, 0 on base`;
    return evaluation;
  }
  if (oracle.diagnostics !== 'tsc') {
    evaluation.violations.push({ detail: `${oracle.name}: ${headFailure} and fails on base too; no diagnostics format declared to compare them` });
    evaluation.summary = `${shortFailure} and fails on base too`;
    return evaluation;
  }
  const baseDiagnostics = diagnosticsOf(base);
  evaluation.metrics[`${oracle.name}.base.diagnostics`] = baseDiagnostics.length;
  if (!baseDiagnostics.length) {
    evaluation.errors.push({ detail: `${oracle.name}: fails on base without diagnostics to compare (log ${base.directory})` });
    evaluation.summary = `${shortFailure} and fails on base too`;
    return evaluation;
  }
  const { onlyHead, onlyBase } = compareDiagnostics(baseDiagnostics, headDiagnostics, pathMap.map, pathMap.moves);
  if (failing(base) !== failing(head)) evaluation.violations.push({ detail: `${oracle.name}: exit codes ${failing(head)} on head, ${failing(base)} on base` });
  for (const diagnostic of onlyHead.slice(0, examples)) evaluation.violations.push({ ...(diagnostic.file ? { file: diagnostic.file } : {}), detail: `${oracle.name}: new on head: ${diagnostic.code} ${diagnostic.message}` });
  for (const diagnostic of onlyBase.slice(0, examples)) evaluation.violations.push({ ...(diagnostic.file ? { file: diagnostic.file } : {}), detail: `${oracle.name}: gone on head: ${formatDiagnostic(diagnostic)}` });
  if (onlyHead.length + onlyBase.length > 2 * examples) evaluation.violations.push({ detail: `${oracle.name}: ${count(onlyHead.length)} diagnostics new on head, ${count(onlyBase.length)} gone` });
  evaluation.metrics[`${oracle.name}.diagnosticsNewOnHead`] = onlyHead.length;
  evaluation.metrics[`${oracle.name}.diagnosticsGoneOnHead`] = onlyBase.length;
  if (!evaluation.violations.length) {
    evaluation.findings.push({ kind: 'pre-existing-failure', detail: `${oracle.name} fails on base too (${count(baseDiagnostics.length)} diagnostics); head has the same ones modulo the pathMap` });
    evaluation.summary = `${oracle.name} ${count(headDiagnostics.length)} diagnostics, the same as base modulo the pathMap`;
  } else evaluation.summary = `${oracle.name} ${count(onlyHead.length)} diagnostics new on head, ${count(onlyBase.length)} gone`;
  return evaluation;
}

export function loadReport(run: OracleRun, format: NonNullable<OracleSpec['format']>): TestReport | string {
  if (!run.report) return `no report (${describeStep(run.steps[run.steps.length - 1]!)}; log ${run.directory})`;
  try {
    return parseTestReport(format, JSON.parse(fs.readFileSync(run.report, 'utf8')), run.root);
  } catch (error) {
    return `unreadable report ${run.report}: ${(error as Error).message}`;
  }
}

/** What the runs of both commits say once the excluded tests are left out. */
interface TestVerdict {
  /** No pair of runs agrees on the runner's exit. */
  exitProblem: string | null;
  /** Exits agree only once the excluded tests' failures count as exit 0, which can't rule out an unattributed failure. */
  exitUnexplained: string | null;
  differences: { file: string; detail: string }[];
  snapshotProblems: string[];
  equalFiles: number;
  equalCases: number;
  compared: { head: TestReport; base: TestReport };
  /** Tests flaky on base, in head coordinates: left out on both sides. */
  flaky: FlakyTest[];
  /** Tests whose outcome changed between runs of head that neither base's runs nor the quarantine excuse. */
  unstableOnHead: FlakyTest[];
  /** Complete runs of base, read for flaky tests. */
  baseRuns: number;
  /** Sides whose every run stopped short of another's file list (each left out different files): nothing to compare. */
  noCompleteRun: Side[];
}

/**
 * Compares the first complete run of each commit with the quarantined tests and those flaky on base (outcomes that
 * change between complete runs of base) left out on both sides. A test whose outcome changes between runs of head
 * only is no instability base had: it stays in and is a difference the change may have made intermittent. A run whose
 * report leaves out files another run of its commit lists stopped short: it is neither compared nor read for flaky
 * tests (S6: under load vitest exited 0 listing 54 of 105 files, and every missing file would have looked flaky).
 * The runner's exit codes must agree for some pair of complete runs, a nonzero code next to a failing test on both
 * sides or on neither (with none, the code is an unattributed failure, an unhandled error). Codes that agree only once
 * the excluded tests' failures count as exit 0 can't rule out an unattributed failure in those runs: never a pass.
 */
function judgeTests(session: Session, oracle: OracleSpec, allRuns: Record<Side, OracleRun[]>, allReports: Record<Side, TestReport[]>): TestVerdict {
  const { pathMap, options } = session.context;
  const noCompleteRun: Side[] = [];
  const completeOf = (side: Side) => {
    const short = new Set(shortReports(allReports[side]));
    const complete = allRuns[side].flatMap((run, index) => (short.has(index) ? [] : [{ run, report: allReports[side][index]! }]));
    if (complete.length) return complete;
    // Every run left out files another listed: compare the first (the error recorded below keeps it from certifying).
    noCompleteRun.push(side);
    return [{ run: allRuns[side][0]!, report: allReports[side][0]! }];
  };
  const complete = { head: completeOf('head'), base: completeOf('base') };
  const runs = { head: complete.head.map((entry) => entry.run), base: complete.base.map((entry) => entry.run) };
  const reports = { head: complete.head.map((entry) => entry.report), base: complete.base.map((entry) => entry.report) };
  const flaky = flakyTests(reports.base).map((test) => ({ ...test, file: pathMap.map(test.file) }));
  const quarantined = entriesFor(oracle, options.quarantine).map((entry) => ({ ...entry, file: pathMap.map(entry.file) }));
  const excludedHead = selectTests([...quarantined, ...flaky]);
  const excluded: Record<Side, (file: string, fullName?: string) => boolean> = { head: excludedHead, base: (file, fullName) => excludedHead(pathMap.map(file), fullName) };
  const unstableOnHead = flakyTests(reports.head).filter((test) => !excludedHead(test.file, test.name));
  const compared = { head: excludeTests(reports.head[0]!, excluded.head).report, base: excludeTests(reports.base[0]!, excluded.base).report };
  const comparison = compareTestReports(compared.base, compared.head, pathMap.map);
  const mainIndex = (oracle.setup ?? []).length;
  const exitOf = (side: Side, index: number) => runs[side][index]!.steps[mainIndex]?.exitCode ?? null;
  const unattributed = (side: Side, index: number) => exitOf(side, index) !== 0 && !reportFails(reports[side][index]!);
  const effective = (side: Side, index: number) => effectiveExit(exitOf(side, index), reports[side][index]!, excluded[side]);
  const pairs = runs.head.flatMap((_, head) => runs.base.map((_, base) => [head, base] as const));
  const agree = pairs.some(([head, base]) => exitOf('head', head) === exitOf('base', base) && unattributed('head', head) === unattributed('base', base));
  const agreeEffectively = !agree && pairs.some(([head, base]) => effective('head', head) === effective('base', base));
  const describe = (side: Side) => {
    const codes = [...new Set(runs[side].map((_, index) => `${exitOf(side, index)}${unattributed(side, index) ? ' with no test failing' : ''}`))];
    return `${codes.join(' or ')} on ${side}${runs[side].length > 1 ? ` (${runs[side].length} runs)` : ''}`;
  };
  const exits = `the runner exited ${describe('head')}, ${describe('base')}`;
  return {
    exitProblem: agree || agreeEffectively ? null : exits,
    exitUnexplained: agreeEffectively ? `${exits}, and only failures of left-out tests account for that, which an exit code can't tell from an unattributed failure (an unhandled error)` : null,
    differences: comparison.differences, snapshotProblems: comparison.snapshotProblems, equalFiles: comparison.equalFiles, equalCases: comparison.equalCases,
    compared, flaky, unstableOnHead, baseRuns: runs.base.length, noCompleteRun,
  };
}

/**
 * Base always runs (or comes from the cache). Per test file (base paths mapped) the load status, the file status and
 * the ordered cases must equal base's, as must the runner's exit code and overall success; no snapshot may be written.
 * Quarantined tests (`CertifyOptions.quarantine`) are left out on both sides. On a difference both commits run again,
 * up to `flakyRetries` times: a test whose outcome changes between runs of base is flaky, a finding that is left out
 * like a quarantined one; one whose outcome changes between runs of head only, and whatever still differs, is a violation.
 */
async function tests(session: Session, oracle: OracleSpec): Promise<Evaluation> {
  const { options } = session.context;
  const evaluation = newEvaluation();
  const format = oracle.format ?? session.profile.runner?.kind;
  if (!format) throw new Error(`oracle ${oracle.name}: tests needs a format (or a profile runner)`);
  const head = await session.head(oracle);
  recordRun(evaluation, oracle.name, head);
  await judgeSteps(session, oracle, head, evaluation, { exceptMain: true });
  const base = await session.base(oracle);
  recordRun(evaluation, oracle.name, base);
  const mainIndex = (oracle.setup ?? []).length;
  const headMain = head.steps[mainIndex];
  const baseMain = base.steps[mainIndex];
  if (!headMain || stepBroken(headMain)) evaluation.violations.push({ detail: `${oracle.name}: ${headMain ? describeStep(headMain) : 'the runner did not run'} on head` });
  if (!baseMain || stepBroken(baseMain)) evaluation.errors.push({ detail: `${oracle.name}: on base ${baseMain ? describeStep(baseMain) : 'the runner did not run'} (log ${base.directory})` });
  const headReport = loadReport(head, format);
  const baseReport = loadReport(base, format);
  if (typeof headReport === 'string') evaluation.violations.push({ detail: `${oracle.name}: head: ${headReport}` });
  if (typeof baseReport === 'string') evaluation.errors.push({ detail: `${oracle.name}: base: ${baseReport}` });
  if (typeof headReport === 'string' || typeof baseReport === 'string') {
    if (headMain && baseMain && !stepBroken(headMain) && !stepBroken(baseMain) && headMain.exitCode !== baseMain.exitCode) {
      evaluation.violations.push({ detail: `${oracle.name}: the runner exited ${headMain.exitCode} on head, ${baseMain.exitCode} on base` });
    }
    evaluation.summary = `${oracle.name} has no report to compare`;
    return evaluation;
  }
  const totals = { head: totalsOf(headReport), base: totalsOf(baseReport) };
  for (const side of ['head', 'base'] as const) {
    for (const [key, value] of Object.entries(totals[side])) evaluation.metrics[`${oracle.name}.${side}.${key}`] = value;
  }
  if (!totals.base.cases) evaluation.errors.push({ detail: `${oracle.name}: no test case ran on base, so the comparison would certify nothing (log ${base.directory})` });

  const runs: Record<Side, OracleRun[]> = { head: [head], base: [base] };
  const reports: Record<Side, TestReport[]> = { head: [headReport], base: [baseReport] };
  let verdict = judgeTests(session, oracle, runs, reports);
  const retries = options.flakyRetries ?? 2;
  const differs = () => verdict.exitProblem !== null || verdict.exitUnexplained !== null || verdict.differences.length > 0 || verdict.snapshotProblems.length > 0 || verdict.unstableOnHead.length > 0;
  retrying: for (let attempt = 1; attempt <= retries && differs(); attempt++) {
    for (const side of ['head', 'base'] as const) {
      const again = await session.again(oracle, side, attempt);
      evaluation.run[`${oracle.name}.${side}.run${attempt + 1}.logs`] = again.directory;
      const report = loadReport(again, format);
      if (typeof report === 'string') {
        evaluation.errors.push({ detail: `${oracle.name}: run ${attempt + 1} on ${side}, to tell flaky tests from differences: ${report}` });
        break retrying;
      }
      runs[side].push(again);
      reports[side].push(report);
    }
    verdict = judgeTests(session, oracle, runs, reports);
  }
  const testName = (test: FlakyTest) => (test.name === undefined ? 'the file' : `'${test.name}'`);
  for (const side of verdict.noCompleteRun) evaluation.errors.push({ detail: `${oracle.name}: every run of ${side} left out test files another run of ${side} listed, so no complete run is there to compare` });
  if (verdict.exitProblem) evaluation.violations.push({ detail: `${oracle.name}: ${verdict.exitProblem}` });
  if (verdict.exitUnexplained) evaluation.errors.push({ detail: `${oracle.name}: ${verdict.exitUnexplained}` });
  for (const difference of verdict.differences) evaluation.violations.push({ file: difference.file, detail: `${oracle.name}: ${difference.detail}` });
  for (const test of verdict.unstableOnHead) {
    const baseRuns = `${verdict.baseRuns} complete run${verdict.baseRuns === 1 ? '' : 's'}`;
    evaluation.violations.push({ file: test.file, detail: `${oracle.name}: ${testName(test)} changed outcome between runs of head (${test.outcomes.join(', ')}) but not in base's ${baseRuns}: an intermittent difference, not flakiness` });
  }
  for (const problem of verdict.snapshotProblems) evaluation.violations.push({ detail: `${oracle.name}: ${problem}` });
  const flakyFiles = flakyFileCount(verdict.flaky);
  const limit = flakyFileLimit(Math.max(verdict.compared.head.files.size, verdict.compared.base.files.size, totals.base.files));
  if (flakyFiles > limit) {
    evaluation.violations.push({ detail: `${oracle.name}: not reproducible here: flaky tests in ${flakyFiles} files (at most ${limit} allowed), so leaving them out would certify too little` });
  }
  for (const test of verdict.flaky) {
    evaluation.findings.push({ kind: 'flaky-test', file: test.file, detail: `${oracle.name}: ${testName(test)} changed outcome between runs of base (${test.outcomes.join(', ')}); left out of the comparison` });
  }
  const entries = entriesFor(oracle, options.quarantine);
  for (const entry of entries) {
    const file = session.context.pathMap.map(entry.file);
    evaluation.findings.push({ kind: 'quarantined-test', file, detail: `${oracle.name}: ${entry.name === undefined ? 'every test in the file' : `'${entry.name}'`} left out of the comparison on both sides: ${entry.reason}` });
  }
  const runnerQuarantined = quarantinedFiles(oracle, options.quarantine).length;
  if (runnerQuarantined) evaluation.metrics[`${oracle.name}.quarantined`] = runnerQuarantined;
  if (entries.length) evaluation.metrics[`${oracle.name}.quarantineEntries`] = entries.length;
  if (runs.head.length > 1) evaluation.metrics[`${oracle.name}.runs`] = runs.head.length;
  evaluation.metrics[`${oracle.name}.flaky`] = verdict.flaky.length;
  const compared = { head: totalsOf(verdict.compared.head), base: totalsOf(verdict.compared.base) };
  if (compared.base.failed || compared.base.loaded < compared.base.files) {
    evaluation.findings.push({ kind: 'pre-existing-failure', detail: `${oracle.name} on base: ${count(compared.base.failed)} cases fail and ${count(compared.base.files - compared.base.loaded)} files fail to load; head is compared with that` });
  }
  const files = Math.max(compared.base.files, compared.head.files);
  const cases = Math.max(compared.base.cases, compared.head.cases);
  evaluation.metrics[`${oracle.name}.filesEqual`] = verdict.equalFiles;
  evaluation.metrics[`${oracle.name}.casesEqual`] = verdict.equalCases;
  const left = totals.head.cases - compared.head.cases;
  const { head: after } = totals;
  evaluation.summary = `${oracle.name} ${count(verdict.equalFiles)}/${count(files)} files and ${count(verdict.equalCases)}/${count(cases)} cases equal to base`
    + `${left || verdict.flaky.length ? ` (${count(left)} cases left out: ${verdict.flaky.length} flaky, ${entries.length} quarantined)` : ''}`
    + ` (head: ${count(after.loaded)}/${count(after.files)} files load, ${count(after.passed)} passed, ${count(after.failed)} failed, ${count(after.skipped)} skipped)`;
  return evaluation;
}

/**
 * The artifact head produces must be byte-identical to base's. With a `reference`, the base commit's tracked blob
 * stands for what base produces (G2 found immich's spec identical to two cold base runs); only a mismatch runs base,
 * which tells a stale tracked file (a finding) from a real difference.
 */
async function artifactIdentical(session: Session, oracle: OracleSpec): Promise<Evaluation> {
  const evaluation = newEvaluation();
  const head = await session.head(oracle);
  recordRun(evaluation, oracle.name, head);
  await judgeSteps(session, oracle, head, evaluation, { exceptMain: false });
  const stepFailures = evaluation.violations.length ? `, but ${evaluation.violations.length} step${evaluation.violations.length === 1 ? '' : 's'} failed on head` : '';
  if (!head.artifact) {
    evaluation.violations.push({ detail: `${oracle.name}: ${oracle.artifact} was not produced on head (log ${head.directory})` });
    evaluation.summary = `${oracle.name} produced nothing`;
    return evaluation;
  }
  const produced = fs.readFileSync(head.artifact);
  evaluation.metrics[`${oracle.name}.head.bytes`] = produced.length;
  evaluation.metrics[`${oracle.name}.head.sha256`] = sha256(produced);
  const reference = oracle.reference ? session.context.base.bytes(oracle.reference) : undefined;
  if (oracle.reference && !reference) evaluation.errors.push({ detail: `${oracle.name}: the reference ${oracle.reference} is not a tracked file of the base commit` });
  if (reference?.equals(produced)) {
    evaluation.metrics[`${oracle.name}.comparedWith`] = `base tree blob ${oracle.reference}`;
    evaluation.summary = `${oracle.name} byte-identical to the base's ${oracle.reference} (${count(produced.length)} bytes)${stepFailures}`;
    return evaluation;
  }
  const base = await session.base(oracle);
  recordRun(evaluation, oracle.name, base);
  if (!base.artifact) {
    evaluation.errors.push({ detail: `${oracle.name}: ${oracle.artifact} was not produced on base (log ${base.directory})` });
    evaluation.summary = `${oracle.name} produced nothing on base`;
    return evaluation;
  }
  const expected = fs.readFileSync(base.artifact);
  evaluation.metrics[`${oracle.name}.comparedWith`] = 'base run';
  evaluation.metrics[`${oracle.name}.base.sha256`] = sha256(expected);
  if (reference && !reference.equals(expected)) evaluation.findings.push({ kind: 'stale-tracked-artifact', file: oracle.reference!, detail: `${oracle.name}: the base commit's tracked ${oracle.reference} differs from what the base produces` });
  if (expected.equals(produced)) evaluation.summary = `${oracle.name} byte-identical to the base run's (${count(produced.length)} bytes)${stepFailures}`;
  else {
    evaluation.violations.push({ detail: `${oracle.name}: ${describeArtifactDifference(expected, produced)}` });
    evaluation.summary = `${oracle.name} differs from base`;
  }
  return evaluation;
}

const evaluators: Record<OracleSpec['kind'], (session: Session, oracle: OracleSpec) => Promise<Evaluation>> = { 'exit-zero': exitZero, tests, 'artifact-identical': artifactIdentical };

export function validateOracles(specs: OracleSpec[]): void {
  const names = new Set<string>();
  for (const spec of specs) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(spec.name) || names.has(spec.name)) throw new Error(`oracle names must be unique path segments: '${spec.name}'`);
    names.add(spec.name);
    if (!evaluators[spec.kind]) throw new Error(`oracle ${spec.name}: unknown kind '${spec.kind}'`);
    // Outputs must land in directories the run starts empty: a stale or tracked file must never stand in for one.
    const fresh = (output: string | undefined) => output !== undefined && /^\{(scratch|artifacts)\}\//.test(output);
    if (spec.kind === 'tests' && !fresh(spec.report)) throw new Error(`oracle ${spec.name}: tests needs a report path under {scratch} or {artifacts}`);
    if (spec.kind === 'artifact-identical' && !fresh(spec.artifact)) throw new Error(`oracle ${spec.name}: artifact-identical needs an artifact path under {scratch} or {artifacts}`);
  }
}

export const oracles: Check = {
  id: 'K8',
  title,
  async run(context) {
    const { options } = context;
    const profile = options.profile;
    if (!options.oracles) return skipped('K8', title, 'oracles not requested (--oracles)');
    if (!profile?.oracles?.length) return skipped('K8', title, `${profile ? `the profile ${profile.name}` : 'no profile'} has no oracles`);
    validateOracles(profile.oracles);
    const headRoot = context.materialize('head');
    const required = [...new Set(profile.oracles.flatMap((oracle) => oracle.requires ?? []))];
    const unreachable = required.filter((file) => !fs.existsSync(path.join(headRoot, file)));
    const absent = unreachable.filter((file) => !fs.existsSync(path.join(context.environment.checkout, file)));
    if (absent.length) return skipped('K8', title, `the environment ${context.environment.checkout} lacks ${absent.join(', ')} (prerequisite builds)`);
    if (unreachable.length) return result('K8', title, { status: 'error', summary: 'prerequisites not reachable from the worktree', violations: unreachable.map((file) => ({ file, detail: `present in the environment but not reachable through the worktree's node_modules links` })) });

    const metrics: Metrics = {
      node: execFileSync(nodeBinary(profile.node), ['--version'], { encoding: 'utf8' }).trim(),
      offline: Boolean(profile.offline),
      hooksBypassed: `core.hooksPath=/dev/null (worktree add and resets); HUSKY=${targetEnvironment({ node: profile.node, ...(profile.env ? { extra: profile.env } : {}) }).HUSKY}`,
      prerequisitesReachable: required.join(', ') || 'none declared',
    };
    const run: Metrics = { worktree: headRoot, logs: path.join(options.workDir, 'oracles'), cache: context.cache ? `per tree: ${context.cache.directory}` : oracleCacheRoot() ?? 'off' };
    const session = createSession(context, profile, headRoot);
    const evaluations: Evaluation[] = [];
    for (const oracle of profile.oracles) {
      // A quarantine at another layout's paths matches nothing here, and the runner would run what it should leave out;
      // tagged entries stand for the profile's whole list, one per file.
      const files = quarantinedFiles(oracle, options.quarantine);
      const misplaced = files.filter((file) => !context.base.entries.has(file));
      const partial = files.length !== (oracle.quarantine ?? []).length;
      if (misplaced.length || partial) {
        const errors = [
          ...misplaced.map((file) => ({ file, detail: `${oracle.name}: the quarantine names ${file}, which is not a file of the base commit, so the runner would not leave it out; pass the quarantine at this range's paths (quarantine entries tagged with the oracle)` })),
          ...(partial ? [{ detail: `${oracle.name}: ${files.length} quarantine entries tagged with the oracle stand for the profile's ${(oracle.quarantine ?? []).length} quarantined files` }] : []),
        ];
        evaluations.push({ ...newEvaluation(), summary: `${oracle.name} not run: its quarantine is not at the base's paths`, errors });
        continue;
      }
      const evaluation = await evaluators[oracle.kind](session, oracle);
      for (const side of ['head', 'base'] as const) {
        const attempts = evaluation.metrics[`${oracle.name}.${side}.networkAttempts`];
        if (typeof attempts === 'number' && attempts > 0) evaluation.findings.push({ kind: 'network-attempt', detail: `${oracle.name} on ${side}: ${attempts} network attempts refused (network.jsonl in the ${side} run's logs)` });
      }
      evaluations.push(evaluation);
    }
    const hygiene = session.finish();
    run.leftoversRemoved = hygiene.removed;
    const violations = evaluations.flatMap((evaluation) => evaluation.violations);
    const errors = evaluations.flatMap((evaluation) => evaluation.errors);
    return result('K8', title, {
      status: violations.length ? 'fail' : errors.length ? 'error' : 'pass',
      summary: evaluations.map((evaluation) => evaluation.summary).join('; '),
      violations: [...violations, ...errors.map((error) => ({ ...error, detail: `error: ${error.detail}` }))],
      findings: [...hygiene.findings, ...evaluations.flatMap((evaluation) => evaluation.findings)],
      metrics: Object.assign(metrics, ...evaluations.map((evaluation) => evaluation.metrics)),
      run: Object.assign(run, ...evaluations.map((evaluation) => evaluation.run)),
    });
  },
};

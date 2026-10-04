// K8 Oracles on the commit (plan §3.4): the target's own tools (tsc, the unit suite, per-target artifacts) run in a
// fresh worktree of the head commit (hooks bypassed, HUSKY=0) under the target's Node, offline, and must agree with
// the base commit under the pathMap. Base runs happen only when a verdict needs them and are cached per base commit.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  compareDiagnostics, compareTestReports, describeArtifactDifference, type Diagnostic, escapeRegExp, formatDiagnostic, parseTestReport,
  parseTscDiagnostics, sha256, type TestReport, totalsOf,
} from './oracle-reports.js';
import { cacheDirectory, describeStep, type OracleRun, oracleCacheRoot, readCachedRun, runOracle, stepBroken, stepOk, storeRun } from './oracle-runs.js';
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
}

const count = (value: number) => value.toLocaleString('en-US');

/** Repo-relative paths of the node_modules links materialize() puts into a worktree. */
const linksOf = (linked: string[]) => new Set(linked.map((directory) => (directory ? `${directory}/node_modules` : 'node_modules')));

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
function resetWorktree(root: string, links: ReadonlySet<string>): { modified: string[]; extra: string[] } {
  const found = worktreeState(root, links);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (found.modified.length) git('reset', '--hard', '-q');
  if (found.extra.length) git('clean', '-ffdxq', ...[...links].flatMap((link) => ['-e', `/${link}`]));
  const left = worktreeState(root, links);
  if (left.modified.length || left.extra.length) throw new Error(`the worktree ${root} could not be reset to its commit: ${[...left.modified, ...left.extra].slice(0, 5).join(', ')}`);
  return found;
}

interface Session {
  context: CertifyContext;
  profile: Profile;
  head(oracle: OracleSpec): Promise<OracleRun>;
  base(oracle: OracleSpec): Promise<OracleRun>;
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
  const quarantine = (oracle: OracleSpec, side: Side) => (oracle.quarantine ?? []).map((file) => `/${escapeRegExp(side === 'head' ? pathMap.map(file) : file)}$`);
  const run = (oracle: OracleSpec, side: Side) => {
    roots[side] ??= context.materialize(side);
    reset(side, `the ${oracle.name} oracle`);
    previous[side] = `the ${oracle.name} oracle`;
    context.log(`K8 ${oracle.name} on ${side}`);
    return runOracle({ profile, oracle, side, root: roots[side], directory: path.join(options.workDir, 'oracles', side, oracle.name), quarantine: quarantine(oracle, side) });
  };
  const memo = (key: string, create: () => Promise<OracleRun>) => {
    if (!runs.has(key)) runs.set(key, create());
    return runs.get(key)!;
  };
  return {
    context,
    profile,
    head: (oracle) => memo(`head:${oracle.name}`, () => run(oracle, 'head')),
    base: (oracle) => memo(`base:${oracle.name}`, async () => {
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
    finish() {
      for (const side of ['head', 'base'] as const) if (roots[side]) reset(side, 'the end of K8');
      return { findings, removed };
    },
  };
}

function recordRun(metrics: Metrics, name: string, run: OracleRun) {
  const main = run.steps[run.steps.length - 1];
  metrics[`${name}.${run.side}.exit`] = main?.timedOut ? 'timeout' : (main?.exitCode ?? main?.signal ?? 'not run');
  metrics[`${name}.${run.side}.seconds`] = Math.round(run.seconds);
  metrics[`${name}.${run.side}.logs`] = run.directory;
  metrics[`${name}.${run.side}.networkAttempts`] = run.networkAttempts;
  if (run.side === 'base') metrics[`${name}.base.cached`] = run.cached;
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
    recordRun(evaluation.metrics, oracle.name, base);
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
  const evaluation: Evaluation = { summary: '', violations: [], findings: [], errors: [], metrics: {} };
  const head = await session.head(oracle);
  recordRun(evaluation.metrics, oracle.name, head);
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
  recordRun(evaluation.metrics, oracle.name, base);
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

function loadReport(run: OracleRun, format: NonNullable<OracleSpec['format']>): TestReport | string {
  if (!run.report) return `no report (${describeStep(run.steps[run.steps.length - 1]!)}; log ${run.directory})`;
  try {
    return parseTestReport(format, JSON.parse(fs.readFileSync(run.report, 'utf8')), run.root);
  } catch (error) {
    return `unreadable report ${run.report}: ${(error as Error).message}`;
  }
}

/**
 * Base always runs (or comes from the cache). Per test file (base paths mapped) the load status, the file status and
 * the ordered cases must equal base's, as must the runner's exit code and overall success; no snapshot may be written.
 */
async function tests(session: Session, oracle: OracleSpec): Promise<Evaluation> {
  const { pathMap } = session.context;
  const evaluation: Evaluation = { summary: '', violations: [], findings: [], errors: [], metrics: {} };
  const format = oracle.format ?? session.profile.runner?.kind;
  if (!format) throw new Error(`oracle ${oracle.name}: tests needs a format (or a profile runner)`);
  const head = await session.head(oracle);
  recordRun(evaluation.metrics, oracle.name, head);
  await judgeSteps(session, oracle, head, evaluation, { exceptMain: true });
  const base = await session.base(oracle);
  recordRun(evaluation.metrics, oracle.name, base);
  const headMain = head.steps[(oracle.setup ?? []).length];
  const baseMain = base.steps[(oracle.setup ?? []).length];
  if (!headMain || stepBroken(headMain)) evaluation.violations.push({ detail: `${oracle.name}: ${headMain ? describeStep(headMain) : 'the runner did not run'} on head` });
  if (!baseMain || stepBroken(baseMain)) evaluation.errors.push({ detail: `${oracle.name}: on base ${baseMain ? describeStep(baseMain) : 'the runner did not run'} (log ${base.directory})` });
  if (headMain && baseMain && !stepBroken(headMain) && !stepBroken(baseMain) && headMain.exitCode !== baseMain.exitCode) {
    evaluation.violations.push({ detail: `${oracle.name}: the runner exited ${headMain.exitCode} on head, ${baseMain.exitCode} on base` });
  }
  const headReport = loadReport(head, format);
  const baseReport = loadReport(base, format);
  if (typeof headReport === 'string') evaluation.violations.push({ detail: `${oracle.name}: head: ${headReport}` });
  if (typeof baseReport === 'string') evaluation.errors.push({ detail: `${oracle.name}: base: ${baseReport}` });
  if (typeof headReport === 'string' || typeof baseReport === 'string') {
    evaluation.summary = `${oracle.name} has no report to compare`;
    return evaluation;
  }
  const totals = { head: totalsOf(headReport), base: totalsOf(baseReport) };
  for (const side of ['head', 'base'] as const) {
    for (const [key, value] of Object.entries(totals[side])) evaluation.metrics[`${oracle.name}.${side}.${key}`] = value;
  }
  if (!totals.base.cases) evaluation.errors.push({ detail: `${oracle.name}: no test case ran on base, so the comparison would certify nothing (log ${base.directory})` });
  const comparison = compareTestReports(baseReport, headReport, pathMap.map);
  for (const difference of comparison.differences) evaluation.violations.push({ file: difference.file, detail: `${oracle.name}: ${difference.detail}` });
  for (const problem of comparison.snapshotProblems) evaluation.violations.push({ detail: `${oracle.name}: ${problem}` });
  if (totals.base.failed || totals.base.loaded < totals.base.files) {
    evaluation.findings.push({ kind: 'pre-existing-failure', detail: `${oracle.name} on base: ${count(totals.base.failed)} cases fail and ${count(totals.base.files - totals.base.loaded)} files fail to load; head is compared with that` });
  }
  if (oracle.quarantine?.length) evaluation.metrics[`${oracle.name}.quarantined`] = oracle.quarantine.length;
  const files = Math.max(totals.base.files, totals.head.files);
  const cases = Math.max(totals.base.cases, totals.head.cases);
  evaluation.metrics[`${oracle.name}.filesEqual`] = comparison.equalFiles;
  evaluation.metrics[`${oracle.name}.casesEqual`] = comparison.equalCases;
  const { head: after } = totals;
  evaluation.summary = `${oracle.name} ${count(comparison.equalFiles)}/${count(files)} files and ${count(comparison.equalCases)}/${count(cases)} cases equal to base`
    + ` (head: ${count(after.loaded)}/${count(after.files)} files load, ${count(after.passed)} passed, ${count(after.failed)} failed, ${count(after.skipped)} skipped)`;
  return evaluation;
}

/**
 * The artifact head produces must be byte-identical to base's. With a `reference`, the base commit's tracked blob
 * stands for what base produces (G2 found immich's spec identical to two cold base runs); only a mismatch runs base,
 * which tells a stale tracked file (a finding) from a real difference.
 */
async function artifactIdentical(session: Session, oracle: OracleSpec): Promise<Evaluation> {
  const evaluation: Evaluation = { summary: '', violations: [], findings: [], errors: [], metrics: {} };
  const head = await session.head(oracle);
  recordRun(evaluation.metrics, oracle.name, head);
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
  recordRun(evaluation.metrics, oracle.name, base);
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

function validate(specs: OracleSpec[]) {
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
    validate(profile.oracles);
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
      worktree: headRoot,
      logs: path.join(options.workDir, 'oracles'),
      cache: oracleCacheRoot() ?? 'off',
      prerequisitesReachable: required.join(', ') || 'none declared',
    };
    const session = createSession(context, profile, headRoot);
    const evaluations: Evaluation[] = [];
    for (const oracle of profile.oracles) {
      const evaluation = await evaluators[oracle.kind](session, oracle);
      for (const side of ['head', 'base'] as const) {
        const attempts = evaluation.metrics[`${oracle.name}.${side}.networkAttempts`];
        if (typeof attempts === 'number' && attempts > 0) evaluation.findings.push({ kind: 'network-attempt', detail: `${oracle.name} on ${side}: ${attempts} network attempts refused (log ${evaluation.metrics[`${oracle.name}.${side}.logs`]}/network.jsonl)` });
      }
      evaluations.push(evaluation);
    }
    const hygiene = session.finish();
    metrics.leftoversRemoved = hygiene.removed;
    const violations = evaluations.flatMap((evaluation) => evaluation.violations);
    const errors = evaluations.flatMap((evaluation) => evaluation.errors);
    return result('K8', title, {
      status: violations.length ? 'fail' : errors.length ? 'error' : 'pass',
      summary: evaluations.map((evaluation) => evaluation.summary).join('; '),
      violations: [...violations, ...errors.map((error) => ({ ...error, detail: `error: ${error.detail}` }))],
      findings: [...hygiene.findings, ...evaluations.flatMap((evaluation) => evaluation.findings)],
      metrics: Object.assign(metrics, ...evaluations.map((evaluation) => evaluation.metrics)),
    });
  },
};

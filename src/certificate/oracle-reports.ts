// K8 comparisons, independent of how the runs happened: test-runner JSON reports (jest, vitest, mocha) normalized
// to per-file load status and per-case status, tsc diagnostics, and artifact bytes. Base is compared with head
// under the pathMap: a base path p stands for map(p) in head.
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { RunnerKind } from './profile.js';

export interface TestCase {
  /** Identity inside the file: the title path plus the ordinal among equal title paths (immich has duplicate names). */
  id: string;
  /** Readable name (the runner's full name). */
  name: string;
  /** The name a quarantine entry gives: ancestor titles and title joined by ' > ' (mocha: its fullTitle). */
  fullName: string;
  /** The runner's own status string (jest/vitest: passed, failed, pending, skipped, todo, disabled; mocha: passed, failed, pending). */
  status: string;
}

export interface TestFile {
  /** False when the file failed before any case ran (import error, syntax error, missing module). */
  loaded: boolean;
  /** The runner's file status (jest/vitest) or the worst case status (mocha). */
  status: string;
  cases: TestCase[];
}

export interface TestReport {
  /** Repo-relative path → outcome. */
  files: Map<string, TestFile>;
  /** jest/vitest aggregate snapshot counters. */
  snapshot?: Record<string, number>;
  /** jest/vitest `success` (false also for unhandled errors outside any case). */
  success?: boolean;
  /**
   * Tests that failed were left out (quarantined or flaky): the run-level outcome (`success`, the snapshot counters)
   * no longer describes the tests compared, so it isn't compared.
   */
  tainted?: boolean;
}

export interface TestTotals {
  files: number;
  loaded: number;
  cases: number;
  passed: number;
  failed: number;
  skipped: number;
}

/** Strips the worktree root from an absolute path; repo-relative paths with '/'. */
export function repoRelative(root: string, file: string): string {
  if (!path.isAbsolute(file)) return file.split(path.sep).join('/');
  const relative = path.relative(root, file);
  return !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : file;
}

interface RawCase {
  key: string;
  name: string;
  fullName: string;
  status: string;
}

const withOrdinals = (cases: RawCase[]): TestCase[] => {
  const seen = new Map<string, number>();
  return cases.map(({ key, name, fullName, status }) => {
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    return { id: `${key}#${ordinal}`, name: ordinal ? `${name} (#${ordinal + 1})` : name, fullName, status };
  });
};

interface JestLikeReport {
  success?: boolean;
  snapshot?: Record<string, unknown>;
  testResults?: {
    name: string;
    status?: string;
    message?: string;
    assertionResults?: { ancestorTitles?: string[]; title: string; fullName?: string; status: string }[];
  }[];
}

interface MochaTest {
  title: string;
  fullTitle: string;
  file?: string;
  err?: Record<string, unknown>;
}

interface MochaReport {
  tests?: MochaTest[];
  pending?: MochaTest[];
  failures?: MochaTest[];
}

/** A file reported twice (several runner projects include it) merges its runs: cases appended, the worst status. */
function parseJestLike(report: JestLikeReport, root: string): TestReport {
  const merged = new Map<string, { loaded: boolean; statuses: string[]; cases: RawCase[] }>();
  for (const result of report.testResults ?? []) {
    const assertions = result.assertionResults ?? [];
    const file = repoRelative(root, result.name);
    const entry = merged.get(file) ?? { loaded: true, statuses: [], cases: [] };
    merged.set(file, entry);
    entry.loaded &&= !(assertions.length === 0 && (result.message ?? '').trim() !== '');
    entry.statuses.push(result.status ?? 'unknown');
    entry.cases.push(...assertions.map((assertion) => ({
      key: JSON.stringify([...(assertion.ancestorTitles ?? []), assertion.title]),
      name: assertion.fullName ?? [...(assertion.ancestorTitles ?? []), assertion.title].join(' '),
      fullName: [...(assertion.ancestorTitles ?? []), assertion.title].join(' > '),
      status: assertion.status,
    })));
  }
  const files = new Map<string, TestFile>();
  for (const [file, { loaded, statuses, cases }] of merged) {
    files.set(file, { loaded, status: statuses.find((status) => status !== 'passed') ?? 'passed', cases: withOrdinals(cases) });
  }
  const snapshot = report.snapshot
    ? Object.fromEntries(Object.entries(report.snapshot).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
    : undefined;
  return { files, ...(snapshot ? { snapshot } : {}), ...(typeof report.success === 'boolean' ? { success: report.success } : {}) };
}

/** Mocha has no per-file records: files are those with at least one case; hook failures become failed cases. */
function parseMocha(report: MochaReport, root: string): TestReport {
  const fileOf = (test: MochaTest) => (test.file ? repoRelative(root, test.file) : '(no file)');
  const keyOf = (test: MochaTest) => `${fileOf(test)}\0${test.fullTitle}`;
  const count = (tests: MochaTest[] | undefined) => {
    const counts = new Map<string, number>();
    for (const test of tests ?? []) counts.set(keyOf(test), (counts.get(keyOf(test)) ?? 0) + 1);
    return counts;
  };
  const pending = count(report.pending);
  const failures = count(report.failures);
  const take = (counts: Map<string, number>, key: string) => {
    const left = counts.get(key) ?? 0;
    if (left > 0) counts.set(key, left - 1);
    return left > 0;
  };
  const byFile = new Map<string, RawCase[]>();
  const add = (test: MochaTest, status: string) => {
    const file = fileOf(test);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push({ key: JSON.stringify(test.fullTitle), name: test.fullTitle, fullName: test.fullTitle, status });
  };
  for (const test of report.tests ?? []) {
    const key = keyOf(test);
    if (test.err && Object.keys(test.err).length > 0) {
      take(failures, key);
      add(test, 'failed');
    } else if (take(pending, key)) add(test, 'pending');
    else add(test, 'passed');
  }
  for (const failure of report.failures ?? []) if (take(failures, keyOf(failure))) add(failure, 'failed');
  const files = new Map<string, TestFile>();
  for (const [file, cases] of byFile) {
    files.set(file, { loaded: true, status: cases.some((testCase) => testCase.status === 'failed') ? 'failed' : 'passed', cases: withOrdinals(cases) });
  }
  return { files };
}

export function parseTestReport(format: RunnerKind, report: unknown, root: string): TestReport {
  if (!report || typeof report !== 'object') throw new Error('the report is not a JSON object');
  return format === 'mocha' ? parseMocha(report as MochaReport, root) : parseJestLike(report as JestLikeReport, root);
}

export function totalsOf(report: TestReport): TestTotals {
  const totals: TestTotals = { files: report.files.size, loaded: 0, cases: 0, passed: 0, failed: 0, skipped: 0 };
  for (const file of report.files.values()) {
    if (file.loaded) totals.loaded++;
    for (const testCase of file.cases) {
      totals.cases++;
      if (testCase.status === 'passed') totals.passed++;
      else if (testCase.status === 'failed') totals.failed++;
      else totals.skipped++;
    }
  }
  return totals;
}

export interface TestComparison {
  /** One per test file whose outcome differs (missing, extra, load status, file status, cases). */
  differences: { file: string; detail: string }[];
  /** Head-path files and cases that are equal on both sides. */
  equalFiles: number;
  equalCases: number;
  snapshotProblems: string[];
}

/** Counters that must be zero on head (with --ci / CI=true nothing may be written) and those that must equal base. */
const snapshotWrites = ['added', 'filesAdded', 'updated', 'filesUpdated'];
const snapshotEquals = ['total', 'matched', 'unmatched', 'unchecked', 'filesUnmatched', 'filesRemoved'];

/** Per file (base paths mapped) the load status, file status and the ordered case list must be equal. */
export function compareTestReports(base: TestReport, head: TestReport, map: (file: string) => string): TestComparison {
  const differences: TestComparison['differences'] = [];
  const mappedBase = new Map<string, { from: string; file: TestFile }>();
  for (const [file, outcome] of base.files) mappedBase.set(map(file), { from: file, file: outcome });
  let equalFiles = 0;
  let equalCases = 0;
  const files = [...new Set([...mappedBase.keys(), ...head.files.keys()])].sort();
  for (const file of files) {
    const before = mappedBase.get(file);
    const after = head.files.get(file);
    const from = before && before.from !== file ? ` (base ${before.from})` : '';
    if (!after) {
      differences.push({ file, detail: `test file${from} ran on base (${before!.file.cases.length} cases) but not on head` });
      continue;
    }
    if (!before) {
      differences.push({ file, detail: `test file ran on head only (${after.loaded ? `${after.cases.length} cases` : 'failed to load'})` });
      continue;
    }
    if (before.file.loaded !== after.loaded) {
      differences.push({ file, detail: `test file${from} ${after.loaded ? 'loads on head but failed to load on base' : `failed to load on head (base: ${before.file.cases.length} cases)`}` });
      continue;
    }
    const baseCases = new Map(before.file.cases.map((testCase) => [testCase.id, testCase]));
    const headCases = new Map(after.cases.map((testCase) => [testCase.id, testCase]));
    const caseProblems: string[] = [];
    for (const testCase of before.file.cases) {
      const counterpart = headCases.get(testCase.id);
      if (!counterpart) caseProblems.push(`missing on head: ${testCase.name}`);
      else if (counterpart.status !== testCase.status) caseProblems.push(`${testCase.status} → ${counterpart.status}: ${testCase.name}`);
      else equalCases++;
    }
    for (const testCase of after.cases) if (!baseCases.has(testCase.id)) caseProblems.push(`only on head: ${testCase.name}`);
    const orderChanged = !caseProblems.length && before.file.cases.some((testCase, index) => after.cases[index]?.id !== testCase.id);
    if (orderChanged) caseProblems.push('the same cases ran in a different order');
    if (before.file.status !== after.status) caseProblems.unshift(`file status ${before.file.status} → ${after.status}`);
    if (caseProblems.length) {
      const shown = caseProblems.slice(0, 5).join('; ');
      differences.push({ file, detail: `${caseProblems.length} difference${caseProblems.length === 1 ? '' : 's'}${from}: ${shown}${caseProblems.length > 5 ? `; … ${caseProblems.length - 5} more` : ''}` });
    } else equalFiles++;
  }
  const snapshotProblems: string[] = [];
  if (head.snapshot) {
    for (const counter of snapshotWrites) if ((head.snapshot[counter] ?? 0) !== 0) snapshotProblems.push(`snapshot.${counter} is ${head.snapshot[counter]} on head (must be 0 in CI mode)`);
  }
  if (base.tainted || head.tainted) return { differences, equalFiles, equalCases, snapshotProblems };
  if (head.snapshot) {
    for (const counter of snapshotEquals) {
      const before = base.snapshot?.[counter] ?? 0;
      const after = head.snapshot[counter] ?? 0;
      if (before !== after) snapshotProblems.push(`snapshot.${counter} is ${after} on head, ${before} on base`);
    }
  }
  if (base.success !== undefined && head.success !== undefined && base.success !== head.success) snapshotProblems.push(`run success is ${head.success} on head, ${base.success} on base`);
  return { differences, equalFiles, equalCases, snapshotProblems };
}

const failing = (testCase: TestCase) => testCase.status === 'failed';

/** Whether a run's file outcome is a failure: it didn't load, it failed, or one of its cases did. */
export const fileFails = (file: TestFile) => !file.loaded || file.status === 'failed' || file.cases.some(failing);

/**
 * The report without the tests `excluded` names (a whole file: no name; a case: its fullName). A file that loses a
 * failing case gets the status of what is left, and a report that loses a failure is tainted.
 */
export function excludeTests(report: TestReport, excluded: (file: string, fullName?: string) => boolean): { report: TestReport; removed: number } {
  const files = new Map<string, TestFile>();
  let removed = 0;
  let tainted = report.tainted ?? false;
  for (const [file, outcome] of report.files) {
    if (excluded(file)) {
      removed += Math.max(1, outcome.cases.length);
      tainted ||= fileFails(outcome);
      continue;
    }
    const cases = outcome.cases.filter((testCase) => !excluded(file, testCase.fullName));
    if (cases.length === outcome.cases.length) {
      files.set(file, outcome);
      continue;
    }
    removed += outcome.cases.length - cases.length;
    const lostFailure = outcome.cases.some((testCase) => failing(testCase) && !cases.includes(testCase));
    tainted ||= lostFailure;
    files.set(file, { ...outcome, cases, status: lostFailure && !cases.some(failing) && outcome.status === 'failed' ? 'passed' : outcome.status });
  }
  return { report: { ...report, files, ...(tainted ? { tainted } : {}) }, removed };
}

/** Tests of one report's coordinates: a whole file (no name) or a case (its fullName). */
export type TestSelection = (file: string, fullName?: string) => boolean;

export function selectTests(entries: Iterable<{ file: string; name?: string }>): TestSelection {
  const files = new Set<string>();
  const cases = new Set<string>();
  for (const entry of entries) {
    if (entry.name === undefined) files.add(entry.file);
    else cases.add(`${entry.file}\0${entry.name}`);
  }
  return (file, fullName) => files.has(file) || (fullName !== undefined && cases.has(`${file}\0${fullName}`));
}

/**
 * The runner's exit as runs are compared: its exit code, or 0 when the only failures in the report are excluded
 * tests (the code is theirs). A failure the report doesn't attribute (an unhandled error) keeps the code.
 */
export function effectiveExit(exitCode: number | null, report: TestReport, excluded: TestSelection): number | null {
  if (exitCode === 0 || exitCode === null) return exitCode;
  let excludedFailure = false;
  for (const [file, outcome] of report.files) {
    if (excluded(file)) {
      excludedFailure ||= fileFails(outcome);
      continue;
    }
    const failed = outcome.cases.filter(failing);
    if (!outcome.loaded || failed.some((testCase) => !excluded(file, testCase.fullName)) || (outcome.status === 'failed' && !failed.length)) return exitCode;
    excludedFailure ||= failed.length > 0;
  }
  return excludedFailure ? 0 : exitCode;
}

export interface FlakyTest {
  file: string;
  /** The case's fullName; none when the file itself is unstable (load status, case list or file status). */
  name?: string;
  /** What each run gave, e.g. ['passed', 'failed']. */
  outcomes: string[];
}

/** Tests whose outcome differs between runs of one commit: whole files whose shape changed, else the cases that did. */
export function flakyTests(reports: readonly TestReport[]): FlakyTest[] {
  if (reports.length < 2) return [];
  const flaky: FlakyTest[] = [];
  const files = [...new Set(reports.flatMap((report) => [...report.files.keys()]))].sort();
  for (const file of files) {
    const outcomes = reports.map((report) => report.files.get(file));
    const shape = (outcome: TestFile | undefined) => (outcome === undefined ? 'not run' : !outcome.loaded ? 'failed to load' : `${outcome.cases.length} cases`);
    const signature = (outcome: TestFile | undefined) => (outcome === undefined ? 'not run' : JSON.stringify([outcome.loaded, outcome.cases.map((testCase) => testCase.id)]));
    if (new Set(outcomes.map(signature)).size > 1) {
      flaky.push({ file, outcomes: outcomes.map(shape) });
      continue;
    }
    const present = outcomes as TestFile[];
    const unstable = new Map<string, string[]>();
    present[0]!.cases.forEach((testCase, index) => {
      const statuses = present.map((outcome) => outcome.cases[index]!.status);
      if (new Set(statuses).size > 1 && !unstable.has(testCase.fullName)) unstable.set(testCase.fullName, statuses);
    });
    for (const [name, statuses] of unstable) flaky.push({ file, name, outcomes: statuses });
    if (!unstable.size && new Set(present.map((outcome) => outcome.status)).size > 1) flaky.push({ file, outcomes: present.map((outcome) => `file ${outcome.status}`) });
  }
  return flaky;
}

export interface Diagnostic {
  /** Repo-relative file ('' for global diagnostics). */
  file: string;
  code: string;
  message: string;
}

const diagnosticLine = /^(.+?)\((\d+),(\d+)\): (?:error|warning) (TS\d+): (.*)$/;
const globalDiagnosticLine = /^(?:error|warning) (TS\d+): (.*)$/;

/**
 * Diagnostics of `tsc --pretty false` output. Positions are dropped: specifier edits shift columns on their line,
 * and line numbers can't change under K2, so a diagnostic is file + code + message. Messages lose the worktree
 * root and say `{artifacts}` for the run directory (`artifacts`), which differs between runs.
 */
export function parseTscDiagnostics(output: string, cwd: string, root: string, artifacts?: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const rootPrefix = new RegExp(`${escapeRegExp(root)}/`, 'g');
  const artifactsPrefix = artifacts ? new RegExp(escapeRegExp(artifacts), 'g') : undefined;
  const normalize = (message: string) => {
    const relative = message.replace(rootPrefix, '');
    return artifactsPrefix ? relative.replace(artifactsPrefix, '{artifacts}') : relative;
  };
  for (const line of output.split(/\r?\n/)) {
    const located = diagnosticLine.exec(line);
    const global = located ? undefined : globalDiagnosticLine.exec(line);
    if (located) diagnostics.push({ file: repoRelative(root, path.resolve(cwd, located[1]!)), code: located[4]!, message: normalize(located[5]!) });
    else if (global) diagnostics.push({ file: '', code: global[1]!, message: normalize(global[2]!) });
    else if (/^\s+\S/.test(line) && diagnostics.length) diagnostics[diagnostics.length - 1]!.message += ` ${normalize(line.trim())}`;
  }
  return diagnostics;
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const sourceExtension = /(\.d)?\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/;

/**
 * Rewrites path-like tokens of base text that name a moved file, with or without its extension, repo-relative or
 * relative to an ancestor directory the move keeps (immich messages say 'src/x' for 'server/src/x').
 */
export function mapPathTokens(text: string, moves: ReadonlyMap<string, string>): string {
  if (!moves.size) return text;
  const stems = new Map<string, string>();
  const pairs = [...moves].map(([from, to]) => [from.replace(sourceExtension, ''), to.replace(sourceExtension, '')] as const);
  for (const [from, to] of pairs) stems.set(from, to);
  for (const [from, to] of pairs) {
    for (let slash = from.indexOf('/'); slash !== -1; slash = from.indexOf('/', slash + 1)) {
      const suffix = from.slice(slash + 1);
      if (suffix.includes('/') && to.startsWith(from.slice(0, slash + 1)) && !stems.has(suffix)) stems.set(suffix, to.slice(slash + 1));
    }
  }
  return text.replace(/[\w@.\/-]+/g, (token) => {
    const extension = sourceExtension.exec(token)?.[0] ?? '';
    const stem = stems.get(token.slice(0, token.length - extension.length));
    return stem === undefined ? token : stem + extension;
  });
}

const diagnosticKey = (diagnostic: Diagnostic) => `${diagnostic.file}\0${diagnostic.code}\0${diagnostic.message}`;

/** Multiset difference of head and mapped base diagnostics. */
export function compareDiagnostics(base: Diagnostic[], head: Diagnostic[], map: (file: string) => string, moves: ReadonlyMap<string, string>): { onlyHead: Diagnostic[]; onlyBase: Diagnostic[] } {
  const counts = new Map<string, number>();
  const mapped = base.map((diagnostic) => ({ file: diagnostic.file ? map(diagnostic.file) : '', code: diagnostic.code, message: mapPathTokens(diagnostic.message, moves) }));
  for (const diagnostic of mapped) counts.set(diagnosticKey(diagnostic), (counts.get(diagnosticKey(diagnostic)) ?? 0) + 1);
  const onlyHead: Diagnostic[] = [];
  for (const diagnostic of head) {
    const left = counts.get(diagnosticKey(diagnostic)) ?? 0;
    if (left > 0) counts.set(diagnosticKey(diagnostic), left - 1);
    else onlyHead.push(diagnostic);
  }
  const onlyBase: Diagnostic[] = [];
  for (const diagnostic of mapped) {
    const left = counts.get(diagnosticKey(diagnostic)) ?? 0;
    if (left > 0) {
      counts.set(diagnosticKey(diagnostic), left - 1);
      onlyBase.push(diagnostic);
    }
  }
  return { onlyHead, onlyBase };
}

export const formatDiagnostic = (diagnostic: Diagnostic) => `${diagnostic.file ? `${diagnostic.file}: ` : ''}${diagnostic.code} ${diagnostic.message}`;

export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Where two artifacts first differ, for the violation text. */
export function describeArtifactDifference(expected: Buffer, actual: Buffer): string {
  let offset = 0;
  const shortest = Math.min(expected.length, actual.length);
  while (offset < shortest && expected[offset] === actual[offset]) offset++;
  const excerpt = (bytes: Buffer) => JSON.stringify(bytes.subarray(Math.max(0, offset - 40), offset + 40).toString('utf8'));
  return `${actual.length} bytes vs ${expected.length} expected; first difference at byte ${offset}: head ${excerpt(actual)}, base ${excerpt(expected)}`;
}

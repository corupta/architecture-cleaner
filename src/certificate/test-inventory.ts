// K6 test inventory (plan §3.4, research 04b K6), from the target's installed runner in a worktree of each commit:
// - the runner's own test list is equal modulo the pathMap (vitest `globTestSpecifications`, `jest --listTests`,
//   mocha's own `collect-files` over the argv /bin/sh hands it, so an unquoted glob matches what `npm run` matches);
// - per test file (mapped): the load status and the ordered list of test full names (with skip/todo mode) are
//   equal, collected without running test bodies or hooks (vitest `collect`, jest with a never-matching
//   `--testNamePattern`, mocha's own loader with every file loaded on its own). G3: 2,337/2,337 cases passed
//   while 66 spec files failed to load, so load status is compared per file, not as totals;
// - jest's haste mock map (name → manual mock) is equal modulo the pathMap, with no new duplicate names;
// - jest: each test file's projects are equal (`--listTests` merges them; a project sets setupFiles, environment);
// - each test file's snapshot file, as the runner's own resolver computes it (`resolveSnapshotPath`, jest's
//   `snapshotResolver`), is the mapped base snapshot file, or untracked on both sides.
// Snapshot counters (`snapshot.added == 0` under `--ci`) need a real run: K8's.
// An inventory is a function of one tree (with the runner, the environment and the tool): with a tree cache
// (tree-cache.ts), step k's head inventory is step k+1's base inventory.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  firstWords, headRunner, installedRunner, mochaArguments, probeIdentity, probeSource, repoPath, type Runner, runnersOf, runProbe, sides, spawnTargetNode, unappliedArguments,
} from './runner-probe.js';
import { placesOf } from './tree-cache.js';
import { type Check, type CertifyContext, type CheckResult, type Finding, result, type Side, skipped, type Violation } from './types.js';

const title = 'Test inventory';
const probeTimeoutMs = 30 * 60_000;
// Matches no test name: every file loads and runs its describe blocks, every test is skipped (and still listed).
const noTestName = '(?!)';
const snapshotNote = 'snapshot files co-move with their tests (K1); snapshot.added == 0 under --ci needs a real run (K8)';

interface TestCase {
  name: string;
  /** run, skip, todo, only (vitest); pending, todo, disabled (jest); pending or run (mocha). */
  mode: string;
}

interface TestModule {
  project: string;
  /** Absolute path as the runner reports it. */
  file: string;
  loaded: boolean;
  error?: string;
  tests: TestCase[];
}

interface InventoryOutput {
  runner: { name: string; version: string };
  /** The runner's test list. */
  files: { project: string; file: string }[];
  modules: TestModule[];
  /** Errors not attributed to a file (vitest unhandled errors during collection). */
  unhandled?: string[];
  /** jest: the haste mock map (name → absolute path) and the duplicate names it warned about. */
  mocks?: Record<string, string>;
  duplicateMocks?: { name: string; paths: string[] }[];
  /** jest: every test file of every project, from each project's own SearchSource. */
  projectFiles?: { project: string; file: string }[];
  /** Each test file's snapshot file (absolute), from the runner's snapshot resolver. */
  snapshots?: { project: string; file: string; snapshot: string }[];
}

const vitestProbe = probeSource(String.raw`
async function main() {
  const { vitest, runner } = await openVitest();
  const specifications = await vitest.globTestSpecifications();
  const files = specifications.map((specification) => ({ project: specification.project.name, file: specification.moduleId }));
  // Load every file (vitest 5 defaults to parsing them statically, which never sees a broken import).
  const { testModules, unhandledErrors } = await vitest.collect(undefined, { staticParse: false });
  const snapshots = [];
  for (const specification of specifications) {
    const snapshot = await vitest.snapshot.resolvePath(specification.moduleId, { config: specification.project.serializedConfig });
    snapshots.push({ project: specification.project.name, file: specification.moduleId, snapshot });
  }
  const modules = testModules.map((module) => {
    const errors = module.errors();
    const record = {
      project: module.project.name,
      file: module.moduleId,
      loaded: errors.length === 0,
      tests: [...module.children.allTests()].map((test) => ({ name: test.fullName, mode: test.options.mode || 'run' })),
    };
    if (errors.length) record.error = errors.map((error) => error.message || error.name || String(error)).join('\n');
    return record;
  });
  await vitest.close();
  return { runner, files, modules, snapshots, unhandled: (unhandledErrors || []).map((error) => (error && error.message) || String(error)) };
}
`);

const jestMocksProbe = probeSource(String.raw`
async function main() {
  const { configs, Runtime, fromCore, runner } = await openJest();
  const { SearchSource } = fromCore('@jest/core');
  const { buildSnapshotResolver } = fromCore('jest-snapshot');
  const mocks = {};
  const duplicateMocks = [];
  const projectFiles = [];
  const snapshots = [];
  for (const [index, config] of configs.entries()) {
    const project = (config.displayName && (config.displayName.name || config.displayName)) || 'project ' + index;
    const warnings = [];
    const capture = (...parts) => warnings.push(parts.join(' '));
    const hasteConsole = { log: capture, info: capture, warn: capture, error: capture, debug: capture };
    const hasteMap = await Runtime.createHasteMap(config, { console: hasteConsole, maxWorkers: 2, resetCache: true, watch: false, watchman: false });
    const { hasteFS, moduleMap } = await hasteMap.build();
    for (const [name, file] of moduleMap.getRawModuleMap().mocks) mocks[project + '\u0000' + name] = path.resolve(config.rootDir, file);
    const searchSource = new SearchSource({ config, hasteFS, moduleMap, resolver: Runtime.createResolver(config, moduleMap) });
    const snapshotResolver = await buildSnapshotResolver(config);
    for (const file of hasteFS.getAllFiles()) {
      if (!searchSource.isTestFilePath(file)) continue;
      projectFiles.push({ project, file });
      snapshots.push({ project, file, snapshot: snapshotResolver.resolveSnapshotPath(file) });
    }
    for (const warning of warnings) {
      const match = /duplicate manual mock found: (\S+)/.exec(warning);
      if (!match) continue;
      const paths = [...warning.matchAll(/<rootDir>[\\/](\S+)/g)].map((found) => path.join(config.rootDir, found[1]));
      duplicateMocks.push({ name: project + '\u0000' + match[1], paths });
    }
  }
  return { runner, files: [], modules: [], mocks, duplicateMocks, projectFiles, snapshots };
}
`);

const mochaProbe = probeSource(String.raw`
async function main() {
  const { argv, Mocha, collectFiles, runner } = await openMocha();
  // As mocha's run command: positional specs (loadOptions puts them in _), default 'test'.
  const spec = argv._ && argv._.length ? argv._.map(String) : ['test'];
  const collected = collectFiles({ ignore: argv.ignore || [], extension: argv.extension || [], file: argv.file || [], recursive: Boolean(argv.recursive), sort: Boolean(argv.sort), spec });
  const files = (Array.isArray(collected) ? collected : collected.files).map((file) => path.resolve(file));
  const modules = [];
  for (const file of files) {
    const mocha = new Mocha({ ...argv, dryRun: true });
    mocha.files = [file];
    const record = { project: 'mocha', file, loaded: true, tests: [] };
    try {
      await mocha.loadFilesAsync();
    } catch (error) {
      record.loaded = false;
      record.error = message(error);
    }
    const walk = (suite) => {
      for (const test of suite.tests) record.tests.push({ name: test.fullTitle(), mode: test.isPending() ? 'pending' : 'run' });
      for (const child of suite.suites) walk(child);
    };
    walk(mocha.suite);
    modules.push(record);
  }
  return { runner, files: files.map((file) => ({ project: 'mocha', file })), modules };
}
`);

/** The JSON array `jest --listTests --json` prints (the last line that parses as one). */
function listedTests(stdout: string): string[] | null {
  for (const line of stdout.trim().split('\n').reverse()) {
    if (!line.startsWith('[')) continue;
    try {
      return JSON.parse(line) as string[];
    } catch {
      continue;
    }
  }
  return null;
}

interface JestReport {
  testResults: { name: string; status: string; message?: string; assertionResults: { fullName: string; status: string }[] }[];
}

/** jest through its own CLI (what CI runs): the test list, then every file loaded with every test skipped. */
async function jestInventory(context: CertifyContext, name: string, cwd: string, runner: Runner, root: string): Promise<{ ok: true; output: InventoryOutput; network: string } | { ok: false; failure: string; network: string }> {
  const scratch = path.join(context.options.workDir, 'runner-probe', name);
  fs.rmSync(scratch, { recursive: true, force: true });
  const binary = createRequire(path.join(cwd, 'package.json')).resolve('jest/bin/jest');
  const config = runner.config ? ['--config', path.join(root, runner.config)] : [];
  const common = [binary, ...config, '--ci', '--no-watchman', `--cacheDirectory=${path.join(scratch, 'jest-cache')}`];
  const list = await spawnTargetNode(context, path.join(scratch, 'list'), cwd, [...common, '--listTests', '--json'], probeTimeoutMs, runner.environment);
  const listed = listedTests(list.stdout);
  if (!listed) return { ok: false, failure: `jest --listTests exited with ${list.status}: ${firstWords(list.stderr || list.stdout, 2000)}`, network: list.network };
  const report = path.join(scratch, 'report.json');
  fs.rmSync(report, { force: true });
  const run = await spawnTargetNode(context, path.join(scratch, 'run'), cwd, [...common, '--json', `--outputFile=${report}`, `--testNamePattern=${noTestName}`, '--passWithNoTests', '--silent'], probeTimeoutMs, runner.environment);
  fs.writeFileSync(path.join(scratch, 'run.stderr.log'), run.stderr);
  if (!fs.existsSync(report)) return { ok: false, failure: `jest exited with ${run.status} without a report: ${firstWords(run.stderr, 2000)}`, network: run.network };
  const parsed = JSON.parse(fs.readFileSync(report, 'utf8')) as JestReport;
  const modules: TestModule[] = parsed.testResults.map((file) => {
    // With every test skipped, a failed file is one that threw while loading (testExecError).
    const loaded = file.status !== 'failed';
    return { project: 'jest', file: file.name, loaded, ...(loaded ? {} : { error: file.message ?? 'failed' }), tests: file.assertionResults.map((test) => ({ name: test.fullName, mode: test.status })) };
  });
  const mocks = await runProbe<InventoryOutput>(context, `${name}-mocks`, jestMocksProbe, { root, cwd, ...(runner.config ? { config: runner.config } : {}) }, probeTimeoutMs, runner.environment);
  if (!mocks.ok) return { ok: false, failure: `jest haste map: ${mocks.failure}`, network: mocks.network };
  return {
    ok: true,
    output: { ...mocks.output, files: listed.map((file) => ({ project: 'jest', file })), modules },
    network: [list.network, run.network, mocks.network].filter(Boolean).join('\n'),
  };
}

const sameCases = (a: TestCase[], b: TestCase[]) => a.length === b.length && a.every((test, index) => test.name === b[index]!.name && test.mode === b[index]!.mode);

/** The first case that differs, for the violation text. */
function firstCaseDifference(before: TestCase[], after: TestCase[]): string {
  const index = before.findIndex((test, position) => test.name !== after[position]?.name || test.mode !== after[position]?.mode);
  const at = index === -1 ? before.length : index;
  const show = (test: TestCase | undefined) => (test ? `'${test.name}' (${test.mode})` : 'nothing');
  return `case ${at + 1}: base ${show(before[at])}, head ${show(after[at])}`;
}

interface Comparison {
  violations: Violation[];
  findings: Finding[];
  metrics: Record<string, number | string | boolean>;
}

function compareInventories(context: CertifyContext, roots: Record<Side, string>, base: InventoryOutput, head: InventoryOutput): Comparison {
  const { pathMap } = context;
  const violations: Violation[] = [];
  const findings: Finding[] = [];
  const key = (project: string, file: string) => `${project}\0${file}`;
  const relative = (side: Side, file: string) => repoPath(file, roots[side]);
  const errorText = (side: Side, error = '') => firstWords([roots[side], fs.realpathSync(roots[side])].reduce((text, root) => text.split(`${root}/`).join(''), error));
  const baseFiles = base.files.map((entry) => ({ project: entry.project, file: relative('base', entry.file) }));
  const headFiles = head.files.map((entry) => ({ project: entry.project, file: relative('head', entry.file) }));
  const headListed = new Set(headFiles.map((entry) => key(entry.project, entry.file)));
  const baseListed = new Set(baseFiles.map((entry) => key(entry.project, entry.file)));
  const added = new Set(pathMap.added.map((entry) => entry.path));
  const baseModules = new Map(base.modules.map((module) => [key(module.project, relative('base', module.file)), module]));
  const headModules = new Map(head.modules.map((module) => [key(module.project, relative('head', module.file)), module]));
  let lostTests = 0;
  let droppedFiles = 0;
  let newFiles = 0;
  let loadRegressions = 0;
  let caseChanges = 0;
  for (const entry of baseFiles) {
    const to = pathMap.map(entry.file);
    if (headListed.has(key(entry.project, to))) continue;
    droppedFiles++;
    lostTests += baseModules.get(key(entry.project, entry.file))?.tests.length ?? 0;
    violations.push({ file: entry.file, detail: `no longer in the ${base.runner.name} test list${to === entry.file ? '' : ` (now at ${to})`}${pathMap.deleted.includes(entry.file) ? ': deleted' : ''}` });
  }
  for (const entry of headFiles) {
    const from = pathMap.inverse.get(entry.file) ?? entry.file;
    if (baseListed.has(key(entry.project, from))) continue;
    newFiles++;
    const module = headModules.get(key(entry.project, entry.file));
    const state = module ? (module.loaded ? `${module.tests.length} tests` : `fails to load: ${firstWords(module.error ?? '')}`) : 'not collected';
    violations.push({ file: entry.file, detail: `new in the ${head.runner.name} test list (${added.has(entry.file) ? 'added in head' : pathMap.inverse.has(entry.file) ? `was ${from}, not a test file in base` : 'not a test file in base'}; ${state})` });
  }
  let uncollected = 0;
  for (const baseKey of baseListed) {
    const [project, file] = baseKey.split('\0') as [string, string];
    const to = pathMap.map(file);
    if (!headListed.has(key(project, to))) continue;
    const before = baseModules.get(baseKey);
    const after = headModules.get(key(project, to));
    if (!before && !after) {
      uncollected++;
      findings.push({ kind: 'test-file-not-collected', file: to, detail: `listed by ${base.runner.name} in base and head but collected in neither: its load status and cases are not compared` });
      continue;
    }
    if (!before || !after) {
      if (before) lostTests += before.tests.length;
      violations.push({ file: to, detail: `listed by ${base.runner.name} in base and head, but collected only in ${before ? 'base' : 'head'}` });
      continue;
    }
    if (before.loaded !== after.loaded) {
      loadRegressions += before.loaded ? 1 : 0;
      if (before.loaded) lostTests += before.tests.length;
      violations.push({ file: to, detail: before.loaded ? `loads in base, fails to load in head: ${firstWords(after.error ?? '')}` : `fails to load in base (${firstWords(before.error ?? '')}), loads in head` });
      continue;
    }
    if (!before.loaded) {
      const [was, now] = [errorText('base', before.error), errorText('head', after.error)];
      if (was !== now) findings.push({ kind: 'load-error-changed', file: to, detail: `fails to load in base and head, with different errors: base ${was}; head ${now}` });
      continue;
    }
    if (sameCases(before.tests, after.tests)) continue;
    caseChanges++;
    const names = new Set(after.tests.map((test) => test.name));
    lostTests += before.tests.filter((test) => !names.has(test.name)).length;
    violations.push({ file: to, detail: `${before.tests.length} tests in base, ${after.tests.length} in head; ${firstCaseDifference(before.tests, after.tests)}` });
  }
  if (base.runner.name === 'mocha') {
    const order = (files: { file: string }[], map: (file: string) => string) => files.map((entry) => map(entry.file)).join('\n');
    if (order(baseFiles, pathMap.map) !== order(headFiles, (file) => file) && !violations.length) {
      findings.push({ kind: 'test-load-order', detail: 'mocha loads the same test files in a different order (one process: describe-time side effects run in the new order)' });
    }
  }
  const unhandled = { base: base.unhandled?.length ?? 0, head: head.unhandled?.length ?? 0 };
  if (unhandled.head > unhandled.base) violations.push({ detail: `${unhandled.head} errors during collection outside any test file in head, ${unhandled.base} in base: ${firstWords(head.unhandled![0] ?? '')}` });
  const mockMetrics = compareMocks(context, roots, base, head, violations);
  const projectChanges = compareProjects(context, roots, base, head, violations);
  const snapshotChanges = compareSnapshots(context, roots, base, head, violations);
  const count = (output: InventoryOutput) => output.modules.reduce((total, module) => total + module.tests.length, 0);
  const unloadable = (output: InventoryOutput) => output.modules.filter((module) => !module.loaded).length;
  return {
    violations,
    findings,
    metrics: {
      runner: base.runner.name,
      runnerVersion: base.runner.version,
      baseFiles: baseFiles.length,
      headFiles: headFiles.length,
      baseTests: count(base),
      headTests: count(head),
      baseUnloadable: unloadable(base),
      headUnloadable: unloadable(head),
      loadRegressions,
      droppedFiles,
      newFiles,
      caseChanges,
      lostTests,
      uncollected,
      ...mockMetrics,
      ...(base.projectFiles ? { projectChanges } : {}),
      snapshotFileChanges: snapshotChanges,
      snapshots: snapshotNote,
    },
  };
}

/** jest: every test file belongs to the same projects (mapped); a project brings its own setupFiles and environment. */
function compareProjects(context: CertifyContext, roots: Record<Side, string>, base: InventoryOutput, head: InventoryOutput, violations: Violation[]): number {
  if (!base.projectFiles || !head.projectFiles) return 0;
  const membership = (side: Side, output: InventoryOutput, map: (file: string) => string) => {
    const projects = new Map<string, string[]>();
    for (const entry of output.projectFiles!) {
      const file = map(repoPath(entry.file, roots[side]));
      projects.set(file, [...(projects.get(file) ?? []), entry.project].sort());
    }
    return projects;
  };
  const before = membership('base', base, context.pathMap.map);
  const after = membership('head', head, (file) => file);
  let changed = 0;
  for (const file of new Set([...before.keys(), ...after.keys()])) {
    const [was, now] = [before.get(file) ?? [], after.get(file) ?? []];
    if (was.join('\0') === now.join('\0')) continue;
    changed++;
    const list = (projects: string[]) => (projects.length ? projects.map((project) => `'${project}'`).join(', ') : 'none');
    violations.push({ file, detail: `jest projects: ${list(was)} in base${context.pathMap.inverse.has(file) && context.pathMap.inverse.get(file) !== file ? ` (as ${context.pathMap.inverse.get(file)})` : ''}, ${list(now)} in head (a project brings its own setupFiles, environment and transforms)` });
  }
  return changed;
}

/**
 * Each test file reads the snapshot file its runner's resolver names: in head it must be the mapped base snapshot
 * file, or untracked on both sides. A custom resolver (`resolveSnapshotPath`, `snapshotResolver`) that keys
 * snapshots by test path strands them when the test moves: under --ci the test fails, without it the snapshot is
 * rewritten and the assertion passes vacuously.
 */
function compareSnapshots(context: CertifyContext, roots: Record<Side, string>, base: InventoryOutput, head: InventoryOutput, violations: Violation[]): number {
  if (!base.snapshots || !head.snapshots) return 0;
  const key = (project: string, file: string) => `${project}\0${file}`;
  const headSnapshots = new Map(head.snapshots.map((entry) => [key(entry.project, repoPath(entry.file, roots.head)), repoPath(entry.snapshot, roots.head)]));
  let changed = 0;
  for (const entry of base.snapshots) {
    const file = repoPath(entry.file, roots.base);
    const to = context.pathMap.map(file);
    const after = headSnapshots.get(key(entry.project, to));
    if (after === undefined) continue;
    const before = repoPath(entry.snapshot, roots.base);
    const [trackedBefore, trackedAfter] = [context.base.entries.has(before), context.head.entries.has(after)];
    if (!trackedBefore && !trackedAfter) continue;
    if (trackedBefore && trackedAfter && context.pathMap.map(before) === after) continue;
    changed++;
    const state = (tracked: boolean) => (tracked ? 'tracked' : 'not tracked');
    violations.push({ file: to, detail: `snapshot file: base reads ${before} (${state(trackedBefore)}), head reads ${after} (${state(trackedAfter)})${trackedBefore ? `; ${before} is at ${context.pathMap.map(before)} in head` : ''}` });
  }
  return changed;
}

function compareMocks(context: CertifyContext, roots: Record<Side, string>, base: InventoryOutput, head: InventoryOutput, violations: Violation[]): Record<string, number> {
  if (!base.mocks || !head.mocks) return {};
  const { pathMap } = context;
  const describe = (name: string) => name.replace('\0', ': ');
  let changed = 0;
  for (const [name, file] of Object.entries(base.mocks)) {
    const expected = pathMap.map(repoPath(file, roots.base));
    const actual = head.mocks[name] === undefined ? undefined : repoPath(head.mocks[name]!, roots.head);
    if (actual === expected) continue;
    changed++;
    violations.push({ file: expected, detail: `jest manual mock '${describe(name)}' is ${expected} mapped from base, ${actual ?? 'gone'} in head` });
  }
  for (const [name, file] of Object.entries(head.mocks)) {
    if (base.mocks[name] !== undefined) continue;
    changed++;
    violations.push({ file: repoPath(file, roots.head), detail: `new jest manual mock name '${describe(name)}' in head (name lookups such as require('${name.split('\0')[1]}') now find it)` });
  }
  const baseDuplicates = new Set((base.duplicateMocks ?? []).map((duplicate) => duplicate.name));
  const newDuplicates = (head.duplicateMocks ?? []).filter((duplicate) => !baseDuplicates.has(duplicate.name));
  for (const duplicate of newDuplicates) {
    violations.push({ file: duplicate.paths[0] ? repoPath(duplicate.paths[0], roots.head) : undefined, detail: `new duplicate jest manual mock name '${describe(duplicate.name)}': ${duplicate.paths.map((file) => repoPath(file, roots.head)).join(', ')}` });
  }
  return { manualMocks: Object.keys(base.mocks).length, manualMockChanges: changed, newDuplicateMockNames: newDuplicates.length };
}

interface RunnerOutcome extends Partial<Comparison> {
  skip?: string;
  error?: string;
  /** Per side: probe time and, with a tree cache, whether the inventory came from it. */
  run?: Record<string, number | boolean>;
}

/** What an inventory depends on besides the tree, the environment and the tool: the runner as invoked, and the probe's Node and environment. */
export function inventoryKey(context: Pick<CertifyContext, 'options'>, runner: Runner): unknown {
  return {
    runner: { kind: runner.kind, cwd: runner.cwd, config: runner.config ?? null, args: runner.args ?? null, environment: runner.environment },
    probe: probeIdentity(context, runner.environment),
  };
}

type Inventory = ({ ok: true; output: InventoryOutput } | { ok: false; failure: string }) & { network: string; durationMs: number; cached: boolean };

/**
 * The runner's inventory of one side's worktree. With a tree cache, a complete inventory is stored per tree (paths
 * inside the worktree and the probe's scratch directory relocated), so the tree's next certification reads it.
 */
async function inventoryOf(context: CertifyContext, runner: Runner, side: Side, root: string, label: string): Promise<Inventory> {
  const started = performance.now();
  const cwd = path.join(root, runner.cwd);
  const name = `K6-${label}-${side}`;
  const tree = context[side].tree;
  const key = context.cache ? inventoryKey(context, runner) : null;
  const places = [...placesOf('root', root), ...placesOf('scratch', path.join(context.options.workDir, 'runner-probe', name))];
  const stored = context.cache?.read<{ output: InventoryOutput; network: string }>('K6-inventory', tree, key, places);
  if (stored) return { ok: true, ...stored, durationMs: Math.round(performance.now() - started), cached: true };
  const source = runner.kind === 'vitest' ? vitestProbe : mochaProbe;
  const outcome = runner.kind === 'jest' ? await jestInventory(context, name, cwd, runner, root) : await runProbe<InventoryOutput>(context, name, source, {
    root,
    cwd,
    ...(runner.config ? { config: runner.config } : {}),
    ...(runner.kind === 'mocha' ? { arguments: mochaArguments(root, runner) } : {}),
  }, probeTimeoutMs, runner.environment);
  if (outcome.ok) context.cache?.write('K6-inventory', tree, key, places, { output: outcome.output, network: outcome.network });
  return { ...outcome, durationMs: Math.round(performance.now() - started), cached: false };
}

async function checkRunner(context: CertifyContext, runner: Runner, label: string): Promise<RunnerOutcome> {
  if (!installedRunner(context, runner)) return { skip: `${runner.kind} is not installed in the environment (no node_modules/${runner.kind} at or above '${runner.cwd || '.'}')` };
  const unapplied = unappliedArguments(runner);
  if (unapplied) return { error: unapplied };
  const roots = { base: context.materialize('base'), head: context.materialize('head') };
  const specs = { base: runner, head: headRunner(runner, context.pathMap) };
  const findings: Finding[] = [];
  // One side at a time: the runners use every core.
  const outcomes: Inventory[] = [];
  for (const side of sides) outcomes.push(await inventoryOf(context, specs[side], side, roots[side], label));
  const [base, head] = outcomes as [Inventory, Inventory];
  const run = Object.fromEntries(sides.flatMap((side, index) => [[`${side}.ms`, outcomes[index]!.durationMs], ...(context.cache ? [[`${side}.cached`, outcomes[index]!.cached]] : [])]));
  sides.forEach((side, index) => {
    const network = outcomes[index]!.network;
    if (network) findings.push({ kind: 'runner-network', detail: `the ${runner.kind} inventory on ${side} tried to reach the network (refused): ${network.split('\n')[0]}` });
  });
  if (!base.ok) return { findings, run, error: `${runner.kind} could not list or load the tests of base: ${base.failure}` };
  if (!head.ok) return { findings, run, violations: [{ detail: `${runner.kind} could not list or load the tests of head: ${head.failure}` }], metrics: { runner: runner.kind, snapshots: snapshotNote } };
  if (!base.output.files.length && !head.output.files.length) return { run, skip: `${runner.kind} lists no test files in base or head` };
  if (base.output.files.length && !base.output.modules.length) return { findings, run, error: `${runner.kind} lists ${base.output.files.length} test files in base but collected none: nothing to compare` };
  const comparison = compareInventories(context, roots, base.output, head.output);
  return { ...comparison, run, findings: [...findings, ...comparison.findings] };
}

export const testInventory: Check = {
  id: 'K6',
  title,
  async run(context): Promise<CheckResult> {
    const runners = runnersOf(context);
    if (!runners.length) return skipped('K6', title, 'no test runner in the profile or the base tree (jest/vitest config, .mocharc, package.json scripts)');
    const violations: Violation[] = [];
    const findings: Finding[] = [];
    const metrics: Record<string, number | string | boolean> = {};
    const run: Record<string, number | boolean> = {};
    const skips: string[] = [];
    const errors: string[] = [];
    const summaries: string[] = [];
    for (const [index, runner] of runners.entries()) {
      const label = runners.length === 1 ? runner.kind : `${runner.kind}-${index}`;
      const outcome = await checkRunner(context, runner, label);
      for (const [key, value] of Object.entries(outcome.run ?? {})) run[runners.length === 1 ? key : `${label}.${key}`] = value;
      if (outcome.skip) {
        skips.push(outcome.skip);
        continue;
      }
      violations.push(...(outcome.violations ?? []));
      findings.push(...(outcome.findings ?? []));
      if (outcome.error) {
        errors.push(outcome.error);
        continue;
      }
      const runnerMetrics = outcome.metrics ?? {};
      for (const [key, value] of Object.entries(runnerMetrics)) metrics[runners.length === 1 ? key : `${label}.${key}`] = value;
      const name = `${runnerMetrics.runner ?? runner.kind}${runnerMetrics.runnerVersion ? ` ${runnerMetrics.runnerVersion}` : ''}`;
      if (outcome.violations?.length) {
        const unloadable = Number(runnerMetrics.headUnloadable) > Number(runnerMetrics.baseUnloadable) ? [`${runnerMetrics.headUnloadable} of ${runnerMetrics.headFiles} test files fail to load (base: ${runnerMetrics.baseUnloadable})`] : [];
        const parts = [['files that no longer load', runnerMetrics.loadRegressions], ['dropped test files', runnerMetrics.droppedFiles], ['new test files', runnerMetrics.newFiles],
          ['files with changed cases', runnerMetrics.caseChanges], ['lost tests', runnerMetrics.lostTests], ['manual mock changes', runnerMetrics.manualMockChanges], ['new duplicate mock names', runnerMetrics.newDuplicateMockNames],
          ['files in other jest projects', runnerMetrics.projectChanges], ['test files reading another snapshot file', runnerMetrics.snapshotFileChanges]]
          .filter(([, count]) => Number(count) > 0).map(([part, count]) => `${count} ${part}`);
        const counts = [...unloadable, ...parts];
        summaries.push(`${name}: ${outcome.violations.length} violations${counts.length ? ` (${counts.join(', ')})` : `: ${firstWords(outcome.violations[0]!.detail)}`}`);
      } else {
        summaries.push(`${name}: ${runnerMetrics.baseFiles} test files, ${runnerMetrics.baseTests} tests, per-file load status and case names equal${Number(runnerMetrics.baseUnloadable) ? ` (${runnerMetrics.baseUnloadable} files fail to load in both)` : ''}`);
      }
    }
    if (skips.length === runners.length) return { ...skipped('K6', title, skips.join('; ')), ...(Object.keys(run).length ? { run } : {}) };
    for (const skip of skips) findings.push({ kind: 'runner-not-installed', detail: `not checked: ${skip}` });
    if (errors.length) {
      return result('K6', title, { status: 'error', summary: firstWords(errors.join('; ')), violations: [...errors.map((detail) => ({ detail })), ...violations], findings, metrics, run });
    }
    return result('K6', title, { summary: summaries.join('; '), violations, findings, metrics, run });
  },
};

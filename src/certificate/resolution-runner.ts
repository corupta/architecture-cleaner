// K3b resolution identity under the test runner (plan §3.4): every reference site of every source file under the
// runner's cwd resolves, under the runner's OWN resolver loaded from the commit's worktree with its own config, to
// map(what it resolved to in base). That is ground truth for tests, independent of our TypeScript model (K3a):
// - vitest: the project's Vite environment (`ssr` for node tests) `pluginContainer.resolveId`, which is what the
//   module runner and `vi.mock` call; mock sites also ask `@vitest/mocker`'s `findMockRedirect` (`__mocks__`);
// - jest: `jest-config` readConfigs, then `jest-runtime`'s haste map and Resolver: `resolveModule` with the
//   runtime's conditions (CJS or ESM per `extensionsToTreatAsEsm`), `getMockModule`, `resolveStubModuleName`, and
//   whether a sibling `__mocks__/<basename>` exists (what jest-runtime checks before using a manual mock). Not
//   only the files in a project's `roots`: every module its tests and setup files load (resolved, mapped or
//   mocked), however far from the roots, since moduleNameMapper rewrites their specifiers too;
// - mocha: mocha's own option loading and `--require` handling (registers e.g. tsx), then Node's
//   `Module._resolveFilename` (CJS files) or `import.meta.resolve` (ESM files) through the registered hooks.
// Type-level sites (triple-slash, declare module, typeof import) and `new URL(…, import.meta.url)` are not module
// resolutions any runner performs; type-only imports are erased, so for them "unresolved" on both sides is equal.
import path from 'node:path';
import { moduleFormat } from '../analyzer/analyze.js';
import type { ReferenceSite, SiteKind } from '../analyzer/types.js';
import {
  classify, describeTarget, firstWords, headRunner, installedRunner, isUnder, mapTarget, mochaArguments, probeSource, type Runner, runnersOf, runProbe, sameTarget,
  sides, unappliedArguments,
} from './runner-probe.js';
import { type Check, type CertifyContext, type CheckResult, type Finding, result, type Side, skipped, type Violation } from './types.js';

const title = 'Resolution identity under the test runner';
const notResolvedByRunners = new Set<SiteKind>(['triple-slash', 'declare-module', 'typeof-import', 'url-reference']);
const probeTimeoutMs = 15 * 60_000;
const fieldNames = { mock: 'manual mock', stub: 'moduleNameMapper stub', sibling: 'sibling __mocks__ file' } as const;

interface SiteOutput {
  id: string | null;
  error?: string;
  /** vitest: the `__mocks__` redirect; jest: `getMockModule`. */
  mock?: string | null;
  /** jest: `resolveStubModuleName` (moduleNameMapper). */
  stub?: string | null;
  /** jest: `<dir>/__mocks__/<basename>` of the resolved module, when it exists. */
  sibling?: string | null;
}

interface ResolutionOutput {
  runner: { name: string; version: string };
  projects: { name: string; root: string; [detail: string]: unknown }[];
  /** project → repo-relative importer → one output per requested site. */
  results: Record<string, Record<string, SiteOutput[]>>;
  /** jest: project → the resolved importers outside its `roots` (loaded by its tests, never collected from). */
  outsideRoots?: Record<string, string[]>;
}

const vitestProbe = probeSource(String.raw`
async function main() {
  const { vitest, fromVitest, runner } = await openVitest();
  let findMockRedirect = null;
  try {
    ({ findMockRedirect } = await import(pathToFileURL(fromVitest.resolve('@vitest/mocker/redirect')).href));
  } catch (error) {
    // Unchecked __mocks__ redirects would pass silently.
    if (input.files.some((entry) => entry.sites.some((site) => site.mock))) throw new Error('vi.mock sites need @vitest/mocker findMockRedirect: ' + message(error));
  }
  const projects = [];
  const results = {};
  for (const project of vitest.projects) {
    const environmentName = ['jsdom', 'happy-dom'].includes(project.config.environment) ? 'client' : 'ssr';
    const environment = project.vite.environments[environmentName] || project.vite.environments.ssr;
    const moduleDirectories = (project.config.deps && project.config.deps.moduleDirectories) || ['/node_modules/'];
    projects.push({ name: project.name, root: project.config.root, environment: environmentName });
    const projectRoot = fs.realpathSync(project.config.root);
    const files = input.files.filter((entry) => path.join(input.root, entry.file).startsWith(projectRoot + path.sep));
    const output = (results[project.name] = {});
    const jobs = [];
    for (const entry of files) {
      output[entry.file] = [];
      entry.sites.forEach((site, position) => jobs.push({ entry, site, position }));
    }
    await pool(jobs, 64, async ({ entry, site, position }) => {
      const importer = path.join(input.root, entry.file);
      const record = { id: null };
      try {
        const resolved = await environment.pluginContainer.resolveId(site.specifier, importer);
        record.id = resolved ? resolved.id : null;
      } catch (error) {
        record.error = message(error);
      }
      if (site.mock && findMockRedirect) {
        const file = record.id ? record.id.replace(/[?#].*$/, '') : null;
        const external = !file || !path.isAbsolute(file) || moduleDirectories.some((directory) => file.includes(directory)) ? site.specifier : null;
        try {
          record.mock = findMockRedirect(project.config.root, file || site.specifier, external);
        } catch (error) {
          record.mock = null;
        }
      }
      output[entry.file][position] = record;
    });
  }
  await vitest.close();
  return { runner, projects, results };
}
`);

const jestProbe = probeSource(String.raw`
async function exportConditions(config, globalConfig) {
  try {
    const loaded = fromCwd(config.testEnvironment);
    const Environment = loaded.TestEnvironment || loaded.default || loaded;
    const environment = new Environment({ globalConfig, projectConfig: config }, { console, docblockPragmas: {}, testPath: path.join(config.rootDir, 'k3b.probe.js') });
    const conditions = typeof environment.exportConditions === 'function' ? environment.exportConditions() : [];
    if (typeof environment.teardown === 'function') await environment.teardown();
    return { conditions };
  } catch (error) {
    return { conditions: [], error: message(error) };
  }
}
async function main() {
  const { globalConfig, configs, Runtime, runner } = await openJest();
  const projects = [];
  const results = {};
  const outsideRoots = {};
  for (const [index, config] of configs.entries()) {
    const name = (config.displayName && (config.displayName.name || config.displayName)) || 'project ' + index;
    const hasteMap = await Runtime.createHasteMap(config, { maxWorkers: 2, resetCache: false, watch: false, watchman: false });
    const { moduleMap } = await hasteMap.build();
    const resolver = Runtime.createResolver(config, moduleMap);
    const Resolver = resolver.constructor;
    const environment = await exportConditions(config, globalConfig);
    const cjs = { conditions: [...new Set(['require', 'node', 'default', ...environment.conditions])] };
    const esm = { conditions: [...new Set(['import', 'default', ...environment.conditions])] };
    projects.push({ name, root: config.rootDir, roots: config.roots, testEnvironment: config.testEnvironment, conditions: environment.conditions, environmentError: environment.error || null });
    const output = (results[name] = {});
    const outside = (outsideRoots[name] = []);
    const entries = new Map(input.files.map((entry) => [path.join(input.root, entry.file), entry]));
    const inRoots = (file) => config.roots.some((root) => file.startsWith(root + path.sep));
    const pending = [...entries.keys()].filter(inRoots).concat(config.setupFiles, config.setupFilesAfterEnv);
    const visited = new Set();
    while (pending.length) {
      const from = pending.pop();
      const entry = entries.get(from);
      if (!entry || visited.has(from)) continue;
      visited.add(from);
      if (!inRoots(from)) outside.push(entry.file);
      const asEsm = typeof Resolver.unstable_shouldLoadAsEsm === 'function' && Resolver.unstable_shouldLoadAsEsm(from, config.extensionsToTreatAsEsm);
      const options = asEsm ? esm : cjs;
      const attempt = (call) => {
        try {
          return call() || null;
        } catch {
          return null;
        }
      };
      output[entry.file] = entry.sites.map((site) => {
        const record = { id: null };
        if (resolver.isCoreModule(site.specifier)) record.id = site.specifier;
        else {
          try {
            record.id = resolver.resolveModule(from, site.specifier, options);
          } catch (error) {
            record.error = message(error);
          }
        }
        record.mock = attempt(() => resolver.getMockModule(from, site.specifier, options));
        record.stub = attempt(() => resolver.resolveStubModuleName(from, site.specifier, options));
        const sibling = record.id && path.isAbsolute(record.id) ? path.join(path.dirname(record.id), '__mocks__', path.basename(record.id)) : null;
        record.sibling = sibling && fs.existsSync(sibling) ? sibling : null;
        return record;
      });
      for (const record of output[entry.file]) for (const id of [record.id, record.mock, record.stub, record.sibling]) if (id && path.isAbsolute(id)) pending.push(id);
    }
  }
  return { runner, projects, results, outsideRoots };
}
`);

const mochaProbe = probeSource(String.raw`
async function main() {
  const { argv, runner } = await openMocha();
  const output = {};
  for (const entry of input.files) {
    const importer = path.join(input.root, entry.file);
    const parent = new Module(importer, null);
    parent.filename = importer;
    parent.paths = Module._nodeModulePaths(path.dirname(importer));
    output[entry.file] = entry.sites.map((site) => {
      try {
        if (entry.format === 'esm') return { id: import.meta.resolve(site.specifier, pathToFileURL(importer).href) };
        return { id: Module._resolveFilename(site.specifier, parent, false) };
      } catch (error) {
        return { id: null, error: message(error) };
      }
    });
  }
  return { runner, projects: [{ name: 'mocha', root: input.cwd, require: argv.require || [] }], results: { mocha: output } };
}
`);

const probes = { vitest: vitestProbe, jest: jestProbe, mocha: mochaProbe };

interface PairedFile {
  base: string;
  head: string;
  /** Indices into the file's site list that the runner resolves. */
  positions: number[];
}

const resolvedByRunner = (site: ReferenceSite) => !notResolvedByRunners.has(site.kind);

/** Base/head file pairs under the runner's cwd with comparable site lists; files whose site lists differ are violations (K2 explains them). */
function pairFiles(context: CertifyContext, cwd: string): { pairs: PairedFile[]; added: string[]; violations: Violation[] } {
  const { pathMap, views } = context;
  const pairs: PairedFile[] = [];
  const violations: Violation[] = [];
  for (const [from, to] of pathMap.forward) {
    if (!isUnder(from, cwd) && !isUnder(to, cwd)) continue;
    const before = views.base(from);
    const after = views.head(to);
    if (!before?.source || !after?.source) continue;
    if (before.sites.length !== after.sites.length || before.sites.some((site, index) => site.kind !== after.sites[index]!.kind)) {
      violations.push({ file: to, detail: `reference sites differ from ${from} in base (${before.sites.length} -> ${after.sites.length}); see K2` });
      continue;
    }
    const positions = before.sites.flatMap((site, index) => (resolvedByRunner(site) ? [index] : []));
    if (positions.length) pairs.push({ base: from, head: to, positions });
  }
  const added = pathMap.added.map((entry) => entry.path).filter((file) => isUnder(file, cwd) && views.head(file)?.source);
  return { pairs, added, violations };
}

interface Tally {
  sites: number;
  files: number;
  dangling: number;
  retargeted: number;
  newlyResolved: number;
  unresolvedTextChanged: number;
  mockChanged: number;
  addedDangling: number;
  /** Importers under the runner's cwd that no project resolves (jest: outside its roots and loaded by none of its tests). */
  outsideRoots: number;
}

interface RunnerOutcome {
  violations: Violation[];
  findings: Finding[];
  metrics: Record<string, number | string | boolean>;
  error?: string;
  skip?: string;
}

async function checkRunner(context: CertifyContext, runner: Runner, label: string): Promise<RunnerOutcome> {
  if (!installedRunner(context, runner)) return { violations: [], findings: [], metrics: {}, skip: `${runner.kind} is not installed in the environment (no node_modules/${runner.kind} at or above '${runner.cwd || '.'}')` };
  const unapplied = unappliedArguments(runner);
  if (unapplied) return { violations: [], findings: [], metrics: {}, error: unapplied };
  const { pathMap } = context;
  const { pairs, added, violations } = pairFiles(context, runner.cwd);
  const findings: Finding[] = [];
  const roots = { base: context.materialize('base'), head: context.materialize('head') };
  const specs = { base: runner, head: headRunner(runner, pathMap) };
  const sitesOf = (side: Side, file: string, positions: number[]) => {
    const view = context.views[side](file)!;
    return positions.map((position) => ({ specifier: view.sites[position]!.specifier, mock: view.sites[position]!.kind === 'mock' }));
  };
  const headAdded = added.map((file) => {
    const positions = context.views.head(file)!.sites.flatMap((site, index) => (resolvedByRunner(site) ? [index] : []));
    return { file, positions };
  });
  const inputs = {
    base: pairs.map((pair) => ({ file: pair.base, format: moduleFormat(context.fs.base, pair.base), sites: sitesOf('base', pair.base, pair.positions) })),
    head: [...pairs.map((pair) => ({ file: pair.head, positions: pair.positions })), ...headAdded]
      .map(({ file, positions }) => ({ file, format: moduleFormat(context.fs.head, file), sites: sitesOf('head', file, positions) })),
  };
  const outcomes = await Promise.all(sides.map((side) => {
    const spec = specs[side];
    return runProbe<ResolutionOutput>(context, `K3b-${label}-${side}`, probes[runner.kind], {
      root: roots[side],
      cwd: path.join(roots[side], spec.cwd),
      ...(spec.config ? { config: spec.config } : {}),
      ...(runner.kind === 'mocha' ? { arguments: mochaArguments(roots[side], spec) } : {}),
      files: inputs[side],
    }, probeTimeoutMs, runner.environment);
  }));
  const [base, head] = outcomes as [typeof outcomes[0], typeof outcomes[1]];
  for (const [side, outcome] of [['base', base], ['head', head]] as const) {
    if (outcome.network) findings.push({ kind: 'runner-network', detail: `the ${runner.kind} probe on ${side} tried to reach the network (refused): ${outcome.network.split('\n')[0]}` });
  }
  if (!base.ok) return { violations, findings, metrics: { runner: runner.kind }, error: `${runner.kind} could not resolve in base: ${base.failure}` };
  const metrics: Record<string, number | string | boolean> = { runner: base.output.runner.name, runnerVersion: base.output.runner.version, projects: base.output.projects.map((project) => project.name).join(', ') };
  if (!head.ok) {
    violations.push({ detail: `${runner.kind} fails to load or resolve in head: ${head.failure}` });
    return { violations, findings, metrics };
  }
  const tally: Tally = { sites: 0, files: 0, dangling: 0, retargeted: 0, newlyResolved: 0, unresolvedTextChanged: 0, mockChanged: 0, addedDangling: 0, outsideRoots: 0 };
  const headProjects = new Set(head.output.projects.map((project) => project.name));
  for (const project of base.output.projects) {
    if (!headProjects.has(project.name)) {
      violations.push({ detail: `${runner.kind} project '${project.name}' is missing in head (head has: ${[...headProjects].join(', ')})` });
      continue;
    }
    const baseResults = base.output.results[project.name] ?? {};
    const headResults = head.output.results[project.name] ?? {};
    const outsideBefore = new Set(base.output.outsideRoots?.[project.name] ?? []);
    const outsideAfter = new Set(head.output.outsideRoots?.[project.name] ?? []);
    for (const pair of pairs) {
      const before = baseResults[pair.base];
      const after = headResults[pair.head];
      if (!before && !after) continue;
      const inRoots = { base: before !== undefined && !outsideBefore.has(pair.base), head: after !== undefined && !outsideAfter.has(pair.head) };
      if (inRoots.base !== inRoots.head) {
        const [was, now] = inRoots.base ? ['in', 'outside'] : ['outside', 'in'];
        violations.push({ file: pair.head, detail: `moved from ${was} to ${now} the roots of ${runner.kind} project '${project.name}' (was ${pair.base})` });
        continue;
      }
      if (!before || !after) {
        violations.push({ file: pair.head, detail: `loaded by the tests of ${runner.kind} project '${project.name}' in ${before ? 'base' : 'head'} only (was ${pair.base})` });
        continue;
      }
      tally.files++;
      const baseSites = context.views.base(pair.base)!.sites;
      const headSites = context.views.head(pair.head)!.sites;
      pair.positions.forEach((position, index) => {
        tally.sites++;
        const site = baseSites[position]!;
        const later = headSites[position]!;
        const was = before[index]!;
        const now = after[index]!;
        const expected = mapTarget(classify(was.id, roots.base, was.error), pathMap);
        const actual = classify(now.id, roots.head, now.error);
        const where = `site ${position} '${later.specifier}' (${later.kind}${site.specifier === later.specifier ? '' : `, was '${site.specifier}'`})`;
        const differences: string[] = [];
        if (expected.kind === 'unresolved' && actual.kind === 'unresolved') {
          if (site.specifier !== later.specifier && !site.typeOnly) {
            tally.unresolvedTextChanged++;
            differences.push('unresolved in base and head, but its text changed (a virtual mock or a dangling import must keep its exact text)');
          }
        } else if (!sameTarget(expected, actual)) {
          if (actual.kind === 'unresolved') tally.dangling++;
          else if (expected.kind === 'unresolved') tally.newlyResolved++;
          else tally.retargeted++;
          differences.push(`base ${describeTarget(expected)}, head ${describeTarget(actual)}`);
        }
        const mockDifferences = (['mock', 'stub', 'sibling'] as const).flatMap((field) => {
          if (was[field] === undefined && now[field] === undefined) return [];
          const expectedField = mapTarget(classify(was[field], roots.base), pathMap);
          const actualField = classify(now[field], roots.head);
          if (sameTarget(expectedField, actualField)) return [];
          return [`${fieldNames[field]} base ${describeTarget(expectedField)}, head ${describeTarget(actualField)}`];
        });
        if (mockDifferences.length && !differences.length) tally.mockChanged++;
        if (!differences.length && !mockDifferences.length) return;
        violations.push({ file: pair.head, detail: `${where}: ${[...differences, ...mockDifferences].join('; ')}` });
      });
    }
    for (const { file, positions } of headAdded) {
      const after = headResults[file];
      if (!after) continue;
      const headSites = context.views.head(file)!.sites;
      positions.forEach((position, index) => {
        const now = after[index]!;
        if (headSites[position]!.typeOnly || classify(now.id, roots.head, now.error).kind !== 'unresolved') return;
        tally.addedDangling++;
        violations.push({ file, detail: `site ${position} '${headSites[position]!.specifier}' (${headSites[position]!.kind}) in a file added in head does not resolve: ${describeTarget(classify(null, roots.head, now.error))}` });
      });
    }
  }
  const resolvedAnywhere = (output: ResolutionOutput, file: string) => Object.values(output.results).some((files) => files[file] !== undefined);
  tally.outsideRoots = pairs.filter((pair) => !resolvedAnywhere(base.output, pair.base) && !resolvedAnywhere(head.output, pair.head)).length;
  Object.assign(metrics, { ...tally, addedFiles: added.length });
  if (pairs.length && tally.outsideRoots === pairs.length) {
    return { violations, findings, metrics, error: `${runner.kind} resolved none of the ${pairs.length} source files under '${runner.cwd || '.'}' (none in its roots or loaded by its tests): nothing was compared` };
  }
  return { violations, findings, metrics };
}

export const runnerResolution: Check = {
  id: 'K3b',
  title,
  async run(context): Promise<CheckResult> {
    const runners = runnersOf(context);
    if (!runners.length) return skipped('K3b', title, 'no test runner in the profile or the base tree (jest/vitest config, .mocharc, package.json scripts)');
    const violations: Violation[] = [];
    const findings: Finding[] = [];
    const metrics: Record<string, number | string | boolean> = {};
    const skips: string[] = [];
    const errors: string[] = [];
    const summaries: string[] = [];
    for (const [index, runner] of runners.entries()) {
      const label = runners.length === 1 ? runner.kind : `${runner.kind}-${index}`;
      const outcome = await checkRunner(context, runner, label);
      if (outcome.skip) {
        skips.push(outcome.skip);
        continue;
      }
      violations.push(...outcome.violations);
      findings.push(...outcome.findings);
      if (outcome.error) errors.push(outcome.error);
      for (const [key, value] of Object.entries(outcome.metrics)) metrics[runners.length === 1 ? key : `${label}.${key}`] = value;
      const runnerName = `${outcome.metrics.runner ?? runner.kind}${outcome.metrics.runnerVersion ? ` ${outcome.metrics.runnerVersion}` : ''}`;
      if (outcome.error) summaries.push(`${runnerName}: error`);
      else if (outcome.violations.length) {
        const parts = [['dangling', outcome.metrics.dangling], ['retargeted', outcome.metrics.retargeted], ['newly resolved', outcome.metrics.newlyResolved],
          ['unresolved with changed text', outcome.metrics.unresolvedTextChanged], ['mock changes', outcome.metrics.mockChanged], ['dangling in added files', outcome.metrics.addedDangling]]
          .filter(([, count]) => Number(count) > 0).map(([name, count]) => `${count} ${name}`);
        summaries.push(`${runnerName}: ${outcome.violations.length} violations${parts.length ? ` (${parts.join(', ')})` : `: ${firstWords(outcome.violations[0]!.detail)}`}`);
      } else summaries.push(`${runnerName}: ${outcome.metrics.sites} sites in ${outcome.metrics.files} files resolve to map(base)`);
    }
    if (skips.length === runners.length) return skipped('K3b', title, skips.join('; '));
    for (const skip of skips) findings.push({ kind: 'runner-not-installed', detail: `not checked: ${skip}` });
    if (errors.length) {
      return result('K3b', title, { status: 'error', summary: firstWords(errors.join('; ')), violations: [...errors.map((detail) => ({ detail })), ...violations], findings, metrics });
    }
    return result('K3b', title, { summary: summaries.join('; '), violations, findings, metrics });
  },
};


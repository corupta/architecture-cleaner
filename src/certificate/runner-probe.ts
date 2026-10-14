// Driving a target's installed test runner (K3b, K6): which runners a repo has, whether the environment has
// them installed, and probes that run under the target's Node, offline, in a worktree of the commit. A probe is a
// script generated into the work dir (never into the worktree, where a runner could collect it) that loads the
// runner through its own API from the worktree and writes JSON. Nothing here models a runner: the probes ask it.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PathMap } from './path-map.js';
import type { RunnerKind, RunnerSpec } from './profile.js';
import { shellCommands } from './runtime-mechanism.js';
import { nodeBinary, targetEnvironment } from './toolchain.js';
import type { CertifyContext, Side } from './types.js';

export interface Runner extends RunnerSpec {
  /** 'profile' when the target profile names it, 'detected' when found in the trees. */
  origin: 'profile' | 'detected';
  /**
   * The resolution environment the package script that runs the runner sets (`NODE_PATH=src jest`): NODE_PATH adds
   * lookup roots for bare specifiers (Node's and jest-resolve's), NODE_OPTIONS node flags such as `--conditions`.
   */
  environment: Readonly<Record<string, string>>;
}

const resolutionVariables = ['NODE_PATH', 'NODE_OPTIONS'];
const launchers = new Set(['cross-env', 'npx', 'env', 'exec', 'pnpm', 'yarn', 'bun', 'npm']);

/** The NODE_PATH and NODE_OPTIONS that the first script running `kind` (`test` first) sets for it, inline or by `export`. */
function scriptEnvironment(manifest: string | undefined, kind: RunnerKind): Record<string, string> {
  let scripts: Record<string, unknown>;
  try {
    scripts = JSON.parse(manifest ?? '{}').scripts ?? {};
  } catch {
    return {};
  }
  for (const name of ['test', 'test:unit', ...Object.keys(scripts)]) {
    const script = scripts[name];
    if (typeof script !== 'string') continue;
    const exported: Record<string, string> = {};
    for (const command of shellCommands(script)) {
      const inline: Record<string, string> = {};
      let index = command[0] === 'export' ? 1 : 0;
      for (; index < command.length; index++) {
        const variable = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(command[index]!);
        if (variable) inline[variable[1]!] = variable[2]!;
        else if (!launchers.has(path.posix.basename(command[index]!)) && !['exec', 'run', '--'].includes(command[index]!)) break;
      }
      if (command[0] === 'export') Object.assign(exported, inline);
      else if (path.posix.basename(command[index] ?? '') === kind) {
        const environment = { ...exported, ...inline };
        return Object.fromEntries(resolutionVariables.filter((variable) => environment[variable] !== undefined).map((variable) => [variable, environment[variable]!]));
      }
    }
  }
  return {};
}

const jestConfigPattern = /(^|\/)jest\.config\.(js|cjs|mjs|ts|cts|mts|json)$/;
const vitestConfigPattern = /(^|\/)vitest\.config\.(js|cjs|mjs|ts|cts|mts)$/;
const viteConfigPattern = /(^|\/)vite\.config\.(js|cjs|mjs|ts|cts|mts)$/;
const mochaConfigPattern = /(^|\/)\.mocharc\.(js|cjs|mjs|json|jsonc|yaml|yml)$/;

const parentDirectory = (directory: string) => (directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : '');
const directoryOf = (file: string) => parentDirectory(file);

/** The nearest directory at or above `directory` holding a package.json (the directory npm scripts run in). */
function packageDirectoryOf(context: CertifyContext, directory: string): string {
  for (let current = directory; ; current = parentDirectory(current)) {
    if (context.base.entries.has(current ? `${current}/package.json` : 'package.json')) return current;
    if (current === '') return directory;
  }
}

function scriptsInvoking(manifest: string | undefined, command: string): string[] {
  if (!manifest) return [];
  try {
    const scripts = JSON.parse(manifest).scripts ?? {};
    return Object.values(scripts).filter((script): script is string => typeof script === 'string' && new RegExp(`(^|[\\s;&|/])${command}(\\s|$)`).test(script));
  } catch {
    return [];
  }
}

/** The runners of the base tree: the profile's, or every jest/vitest/mocha configuration found in the tree. */
export function runnersOf(context: CertifyContext): Runner[] {
  const environmentOf = (kind: RunnerKind, cwd: string) => scriptEnvironment(context.base.text(cwd ? `${cwd}/package.json` : 'package.json'), kind);
  const runner = context.options.profile?.runner;
  if (runner) return [{ ...runner, origin: 'profile', environment: environmentOf(runner.kind, runner.cwd) }];
  const found = new Map<string, Runner>();
  const add = (kind: RunnerKind, cwd: string, config?: string) => {
    const key = `${kind}\0${cwd}\0${config ?? ''}`;
    if (!found.has(key)) found.set(key, { kind, cwd, ...(config ? { config } : {}), origin: 'detected', environment: environmentOf(kind, cwd) });
  };
  const files = [...context.base.entries.keys()].filter((file) => !file.split('/').includes('node_modules')).sort();
  for (const file of files) {
    const cwd = () => packageDirectoryOf(context, directoryOf(file));
    if (jestConfigPattern.test(file)) add('jest', cwd(), file);
    else if (vitestConfigPattern.test(file)) add('vitest', cwd(), file);
    else if (viteConfigPattern.test(file) && /\btest\s*:/.test(context.base.text(file) ?? '')) add('vitest', cwd(), file);
    else if (mochaConfigPattern.test(file)) add('mocha', cwd());
  }
  // Packages without a config file: the `jest`/`mocha` key of package.json, or a script that runs the runner.
  const has = (kind: RunnerKind, cwd: string) => [...found.values()].some((known) => known.kind === kind && known.cwd === cwd);
  for (const file of files.filter((file) => path.posix.basename(file) === 'package.json')) {
    const directory = directoryOf(file);
    const manifest = context.base.text(file);
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(manifest ?? '{}');
    } catch {
      continue;
    }
    for (const kind of ['jest', 'vitest', 'mocha'] as const) {
      if (has(kind, directory)) continue;
      if ((kind !== 'vitest' && json[kind] !== undefined) || scriptsInvoking(manifest, kind).length) add(kind, directory);
    }
  }
  return [...found.values()];
}

/** The runner as seen in head: its config file follows the pathMap. */
export function headRunner(runner: Runner, pathMap: PathMap): Runner {
  return runner.config ? { ...runner, config: pathMap.map(runner.config) } : runner;
}

export interface InstalledRunner {
  /** Real directory of the runner package in the environment. */
  directory: string;
  version: string;
}

/** The runner package as Node would find it from the runner's cwd, in the environment's linked node_modules. */
export function installedRunner(context: CertifyContext, runner: RunnerSpec): InstalledRunner | null {
  const linked = new Set(context.environment.linked);
  for (let directory = runner.cwd; ; directory = parentDirectory(directory)) {
    if (linked.has(directory)) {
      const manifest = path.join(context.environment.checkout, directory, 'node_modules', runner.kind, 'package.json');
      if (fs.existsSync(manifest)) {
        const version = String(JSON.parse(fs.readFileSync(manifest, 'utf8')).version ?? 'unknown');
        return { directory: path.dirname(fs.realpathSync(manifest)), version };
      }
    }
    if (directory === '') return null;
  }
}

/** CI arguments shape mocha's file set and are applied; for jest and vitest they would be silently ignored. */
export const unappliedArguments = (runner: RunnerSpec): string | null =>
  (runner.kind !== 'mocha' && runner.args?.length ? `the profile passes ${runner.kind} the arguments '${runner.args.join(' ')}', which are applied for mocha only` : null);

export const isUnder = (file: string, directory: string) => directory === '' || file.startsWith(`${directory}/`);

export interface SpawnOutcome {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  /** Network attempts the offline preload refused (empty when none). */
  network: string;
}

const tail = (text: string, length = 4000) => (text.length > length ? `…${text.slice(-length)}` : text);

/** A probe's environment: the target's, offline, in CI mode, with a runner's script environment on top (NODE_OPTIONS add up). */
function probeEnvironment(context: Pick<CertifyContext, 'options'>, offlineLog: string, environment: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const profile = context.options.profile;
  const offline = targetEnvironment({ node: profile?.node ?? 'system', offlineLog, ...(profile?.env ? { extra: profile.env } : {}) });
  return { ...offline, ...environment, ...(environment.NODE_OPTIONS ? { NODE_OPTIONS: `${offline.NODE_OPTIONS ?? ''} ${environment.NODE_OPTIONS}`.trim() } : {}) };
}

/**
 * What a probe's result depends on besides the tree, the environment checkout and the tool (tree-cache.ts adds
 * those): the target's Node binary and a hash of the whole environment the probe runs with.
 */
export function probeIdentity(context: Pick<CertifyContext, 'options'>, environment: Readonly<Record<string, string>>): { node: unknown; environment: string } {
  const version = context.options.profile?.node ?? 'system';
  const binary = fs.realpathSync(nodeBinary(version));
  const stat = fs.statSync(binary);
  const variables = Object.entries(probeEnvironment(context, '{offline-log}', environment)).filter(([, value]) => value !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { node: [version, binary, stat.size, stat.mtimeMs], environment: createHash('sha256').update(JSON.stringify(variables)).digest('hex') };
}

/**
 * Runs `node <arguments>` under the target's Node, offline, in CI mode, from `cwd`, with `environment` (a runner's
 * script environment) on top; its NODE_OPTIONS add to the offline preload's.
 */
export function spawnTargetNode(context: CertifyContext, scratch: string, cwd: string, nodeArguments: string[], timeoutMs: number, environment: Readonly<Record<string, string>> = {}): Promise<SpawnOutcome> {
  fs.mkdirSync(scratch, { recursive: true });
  const offlineLog = path.join(scratch, 'network.log');
  fs.rmSync(offlineLog, { force: true });
  const env = probeEnvironment(context, offlineLog, environment);
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBinary(context.options.profile?.node ?? 'system'), nodeArguments, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      // Runner worker pools left behind by a probe that exited early.
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // the group is gone
      }
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        durationMs: Math.round(performance.now() - started),
        network: fs.existsSync(offlineLog) ? fs.readFileSync(offlineLog, 'utf8').trim() : '',
      });
    });
  });
}

export interface ProbeInput {
  /** Absolute worktree root. */
  root: string;
  /** Absolute directory the runner runs from. */
  cwd: string;
  /** Repo-relative config file, if the runner is invoked with one. */
  config?: string;
  [key: string]: unknown;
}

export type ProbeResult<T> = { ok: true; output: T; durationMs: number; network: string } | { ok: false; failure: string; durationMs: number; network: string };

/**
 * Writes `source` and `input` to `<workDir>/runner-probe/<name>/` and runs the source under the target's Node from
 * `input.cwd`. The source is a module built by `probeSource`: it reads the input and writes the output file.
 */
export async function runProbe<T>(context: CertifyContext, name: string, source: string, input: ProbeInput, timeoutMs: number, environment: Readonly<Record<string, string>> = {}): Promise<ProbeResult<T>> {
  const scratch = path.join(context.options.workDir, 'runner-probe', name);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  const script = path.join(scratch, 'probe.mjs');
  const inputPath = path.join(scratch, 'input.json');
  const outputPath = path.join(scratch, 'output.json');
  fs.writeFileSync(script, source);
  fs.writeFileSync(inputPath, JSON.stringify({ ...input, scratch }));
  const outcome = await spawnTargetNode(context, scratch, input.cwd, ['--experimental-import-meta-resolve', '--no-warnings', script, inputPath, outputPath], timeoutMs, environment);
  fs.writeFileSync(path.join(scratch, 'stderr.log'), outcome.stderr);
  fs.writeFileSync(path.join(scratch, 'stdout.log'), outcome.stdout);
  const failed = (failure: string): ProbeResult<T> => ({ ok: false, failure, durationMs: outcome.durationMs, network: outcome.network });
  if (outcome.timedOut) return failed(`timed out after ${timeoutMs / 1000} s`);
  if (!fs.existsSync(outputPath)) return failed(`exited with ${outcome.signal ?? outcome.status} without output: ${tail(outcome.stderr)}`);
  const output = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as T & { fatal?: string };
  if (output.fatal) return failed(output.fatal);
  return { ok: true, output, durationMs: outcome.durationMs, network: outcome.network };
}

/** Escapes a word for /bin/sh except its glob characters, so the shell expands globs and nothing else. */
function globWord(word: string): string {
  return word.split(/([*?[\]])/).map((part) => (/^[*?[\]]$/.test(part) ? part : part ? `'${part.replace(/'/g, `'\\''`)}'` : '')).join('');
}

/** The command text from `mocha` to the end of its shell command (before `&&`, `||`, `;` or `|`). */
function mochaCommand(script: string): string | null {
  const start = script.search(/(^|[\s;&|/])mocha(\s|$)/);
  if (start === -1) return null;
  const from = script.indexOf('mocha', start);
  let quote: string | null = null;
  for (let index = from; index < script.length; index++) {
    const char = script[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"') index++;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '\\') index++;
    else if (char === ';' || char === '|' || (char === '&' && script[index + 1] === '&')) return script.slice(from, index);
  }
  return script.slice(from);
}

/**
 * Mocha's argv as /bin/sh hands it over (`npm run` runs scripts with `sh -c`): unquoted globs are expanded by the
 * shell (dash: `**` is `*`), quoted ones reach mocha intact. From the profile's args, or the package's script
 * that invokes mocha (`test` first).
 */
export function mochaArguments(worktree: string, runner: RunnerSpec): string[] {
  const cwd = path.join(worktree, runner.cwd);
  let command: string | null = null;
  if (runner.args) command = `mocha ${runner.args.map(globWord).join(' ')}`;
  else {
    const manifest = path.join(cwd, 'package.json');
    const scripts: Record<string, unknown> = fs.existsSync(manifest) ? (JSON.parse(fs.readFileSync(manifest, 'utf8')).scripts ?? {}) : {};
    const ordered = ['test', 'test:unit', ...Object.keys(scripts)].map((key) => scripts[key]).filter((script): script is string => typeof script === 'string');
    for (const script of ordered) if ((command = mochaCommand(script))) break;
  }
  if (!command) return [];
  const run = spawnSync('/bin/sh', ['-c', `mocha() { printf '%s\\0' "$@"; }; ${command}`], { cwd, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`/bin/sh could not expand the mocha command '${command}': ${run.stderr}`);
  return run.stdout.split('\0').slice(0, -1);
}

/** A resolution as compared across the two trees: a repo file (compared modulo the pathMap) or anything else verbatim. */
export type Target = { kind: 'file'; path: string; suffix: string } | { kind: 'other'; id: string } | { kind: 'unresolved'; error?: string };

/** Classifies a runner's raw answer (absolute path, `file:` URL, builtin, virtual id or null) relative to a worktree. */
export function classify(raw: string | null | undefined, worktree: string, error?: string): Target {
  if (raw === null || raw === undefined || raw === '') return error ? { kind: 'unresolved', error } : { kind: 'unresolved' };
  let id = raw;
  if (id.startsWith('file://')) {
    try {
      id = decodeURIComponent(new URL(id).pathname);
    } catch {
      return { kind: 'other', id: raw };
    }
  }
  if (!path.isAbsolute(id)) return { kind: 'other', id };
  const query = id.search(/[?#]/);
  const file = query === -1 ? id : id.slice(0, query);
  const suffix = query === -1 ? '' : id.slice(query);
  // Vite answers an alias whose target is missing with the aliased path: loading it fails.
  if (!fs.existsSync(file)) return { kind: 'unresolved', error: `${repoPath(file, worktree)} does not exist` };
  for (const root of [worktree, realpathOr(worktree)]) {
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const posix = relative.split(path.sep).join('/');
    if (!posix.split('/').includes('node_modules')) return { kind: 'file', path: posix, suffix };
  }
  return { kind: 'other', id: realpathOr(file) + suffix };
}

function realpathOr(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

/** A base resolution carried into head coordinates. */
export const mapTarget = (target: Target, pathMap: PathMap): Target => (target.kind === 'file' ? { ...target, path: pathMap.map(target.path) } : target);

export function sameTarget(a: Target, b: Target): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'file' && b.kind === 'file') return a.path === b.path && a.suffix === b.suffix;
  if (a.kind === 'other' && b.kind === 'other') return a.id === b.id;
  return true;
}

/** An error message without its stack, on one line. */
export const firstWords = (error: string, length = 200) =>
  error.split(/\n\s+at /)[0]!.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim().slice(0, length);

export function describeTarget(target: Target): string {
  if (target.kind === 'file') return target.path + target.suffix;
  if (target.kind === 'other') return target.id;
  return `unresolved${target.error ? ` (${firstWords(target.error)})` : ''}`;
}

/** Repo-relative path of an absolute file inside a worktree (or the absolute path when outside). */
export function repoPath(file: string, worktree: string): string {
  for (const root of [worktree, realpathOr(worktree)]) {
    const relative = path.relative(root, file);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) return relative.split(path.sep).join('/');
  }
  return file;
}

/** Common head of every probe: input, output, a bounded-concurrency pool, and the runner's own API from its cwd. */
const prelude = String.raw`
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const [inputPath, outputPath] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
// Runners report real paths (Node's loader, jest-config and Vite realpath their roots); importers must match them.
input.root = fs.realpathSync(input.root);
input.cwd = fs.realpathSync(input.cwd);
const fromCwd = createRequire(path.join(input.cwd, 'package.json'));
const message = (error) => String((error && (error.stack || error.message)) || error).slice(0, 4000);
const versionOf = (manifest) => JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
async function pool(items, limit, task) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index], index);
    }
  }));
}
function finish(output) {
  fs.writeFileSync(outputPath, JSON.stringify(output));
  process.exit(0);
}
async function openVitest(options = {}) {
  const manifest = fromCwd.resolve('vitest/package.json');
  const fromVitest = createRequire(manifest);
  const { createVitest } = await import(pathToFileURL(fromVitest.resolve('vitest/node')).href);
  const cliOptions = { watch: false, reporters: [], passWithNoTests: true, ...options };
  if (input.config) cliOptions.config = path.join(input.root, input.config);
  const vitest = await createVitest('test', cliOptions, { cacheDir: path.join(input.scratch, 'vite-cache') });
  return { vitest, fromVitest, runner: { name: 'vitest', version: versionOf(manifest) } };
}
async function openJest() {
  const manifest = fromCwd.resolve('jest/package.json');
  const fromJest = createRequire(manifest);
  const fromCore = createRequire(fromJest.resolve('@jest/core'));
  const { readConfigs } = fromCore('jest-config');
  const runtime = fromCore('jest-runtime');
  const Runtime = runtime.default ?? runtime;
  // A cache of its own: a shared one could serve transforms (ts-jest diagnostics) computed for another tree.
  const argv = { _: [], $0: 'jest', ci: true, watchman: false, cacheDirectory: path.join(input.scratch, 'jest-cache') };
  fs.mkdirSync(argv.cacheDirectory, { recursive: true });
  if (input.config) argv.config = path.join(input.root, input.config);
  const { globalConfig, configs } = await readConfigs(argv, [input.cwd]);
  return { globalConfig, configs, Runtime, fromCore, runner: { name: 'jest', version: versionOf(manifest) } };
}
async function openMocha() {
  const manifest = fromCwd.resolve('mocha/package.json');
  const fromMocha = createRequire(manifest);
  const { loadOptions } = fromMocha('./lib/cli/options.js');
  const { handleRequires } = fromMocha('./lib/cli/run-helpers.js');
  const argv = loadOptions(input.arguments);
  Object.assign(argv, await handleRequires(argv.require || [], { ignoredPlugins: ['mochaGlobalSetup', 'mochaGlobalTeardown'] }));
  return { argv, Mocha: fromMocha('./lib/mocha.js'), collectFiles: fromMocha('./lib/cli/collect-files.js'), runner: { name: 'mocha', version: versionOf(manifest) } };
}
`;

/** A complete probe module: the prelude, then `body`, which must define `async function main()` returning the output. */
export const probeSource = (body: string) => `${prelude}\n${body}\nmain().then(finish, (error) => finish({ fatal: message(error) }));\n`;

export const sides: readonly Side[] = ['base', 'head'];

// K8 runs: an oracle's steps executed in a commit's fresh worktree under the target's Node (offline when the profile
// says so), each step's output in a log of the run directory. Base runs are cached by repo + base commit + oracle so
// repeated certifications of one base reuse them; head runs never are.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OracleSpec, OracleStep, Profile } from './profile.js';
import { targetEnvironment } from './toolchain.js';
import type { Side } from './types.js';

export interface StepRun {
  /** Absolute working directory. */
  cwd: string;
  /** argv after substitution. */
  command: string[];
  /** argv as the profile writes it (for messages: no run-specific paths). */
  template: string[];
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  /** Spawn failure (missing executable or cwd). */
  error?: string;
  seconds: number;
  /** Log file name inside the run directory (stdout and stderr interleaved). */
  log: string;
}

export interface OracleRun {
  side: Side;
  /** The worktree the run used (its realpath, as the tools' cwd shows it): absolute paths in its outputs start with it. */
  root: string;
  /** Holds run.json, the step logs, report.json, artifact and network.jsonl (the cache entry for a cached run). */
  directory: string;
  /** The run directory when the run happened: `{artifacts}` (and `{scratch}` under it) in its outputs. */
  ranIn: string;
  /** Setup steps, then the oracle's command. */
  steps: StepRun[];
  /** Absolute path of the report copy, when the command wrote one. */
  report?: string;
  /** Absolute path of the artifact copy, when the command produced one. */
  artifact?: string;
  /** Network attempts the offline preload refused. */
  networkAttempts: number;
  seconds: number;
  cached: boolean;
}

export const stepOk = (step: StepRun) => step.exitCode === 0 && !step.timedOut && !step.error;
/** A step that didn't run to completion: no verdict can be read from it. */
export const stepBroken = (step: StepRun) => step.timedOut || step.error !== undefined || (step.exitCode === null && step.signal !== null);

export function describeStep(step: StepRun): string {
  const command = step.template.join(' ');
  const outcome = step.error ? `failed to start (${step.error})` : step.timedOut ? `timed out after ${Math.round(step.seconds)} s` : step.exitCode === null ? `killed by ${step.signal}` : `exited ${step.exitCode}`;
  return `\`${command}\` ${outcome}`;
}

interface Placeholders {
  worktree: string;
  scratch: string;
  artifacts: string;
}

const substitute = (template: string, values: Placeholders) =>
  template.replaceAll('{worktree}', values.worktree).replaceAll('{scratch}', values.scratch).replaceAll('{artifacts}', values.artifacts);

const inside = (directory: string, file: string) => {
  const relative = path.relative(directory, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

function killGroup(pid: number | undefined) {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // the group is already gone
  }
}

/** Runs argv in its own process group; the group is killed at exit (stray workers) and on timeout. */
function runStep(command: string[], cwd: string, env: NodeJS.ProcessEnv, logFile: string, timeoutMs: number): Promise<Omit<StepRun, 'log' | 'template'>> {
  return new Promise((resolve) => {
    const started = performance.now();
    const output = fs.openSync(logFile, 'w');
    const executable = command[0]!.includes('/') ? path.resolve(cwd, command[0]!) : command[0]!;
    let settled = false;
    let timedOut = false;
    const finish = (fields: Pick<StepRun, 'exitCode' | 'signal'> & { error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killGroup(child.pid);
      if (fields.error) fs.writeSync(output, `\n[ac] ${fields.error}\n`);
      fs.closeSync(output);
      resolve({ cwd, command, ...fields, timedOut, seconds: (performance.now() - started) / 1000 });
    };
    const child = spawn(executable, command.slice(1), { cwd, env, stdio: ['ignore', output, output], detached: true });
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, timeoutMs);
    child.on('error', (error) => finish({ exitCode: null, signal: null, error: error.message }));
    child.on('exit', (exitCode, signal) => finish({ exitCode, signal }));
  });
}

export interface RunOptions {
  profile: Profile;
  oracle: OracleSpec;
  side: Side;
  /** The commit's worktree. */
  root: string;
  /** Run directory, recreated empty. */
  directory: string;
  /** Expansion of a `{quarantine}` argv element on this side. */
  quarantine: string[];
}

export async function runOracle({ profile, oracle, side, root: worktree, directory, quarantine }: RunOptions): Promise<OracleRun> {
  const started = performance.now();
  const root = fs.realpathSync(worktree);
  fs.rmSync(directory, { recursive: true, force: true });
  const scratch = path.join(directory, 'scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const values: Placeholders = { worktree: root, scratch, artifacts: directory };
  const networkLog = path.join(directory, 'network.jsonl');
  const env = targetEnvironment({ node: profile.node, ...(profile.offline ? { offlineLog: networkLog } : {}), ...(profile.env ? { extra: profile.env } : {}) });
  for (const [target, content] of Object.entries(oracle.files ?? {})) {
    const file = path.resolve(substitute(target, values));
    if (!inside(scratch, file)) throw new Error(`oracle ${oracle.name}: files may only be written under {scratch} (${target})`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, substitute(content, values));
  }
  const steps: StepRun[] = [];
  const all: OracleStep[] = [...(oracle.setup ?? []), oracle];
  for (const [index, step] of all.entries()) {
    const cwd = path.resolve(root, substitute(step.cwd, values));
    if (inside(scratch, cwd)) fs.mkdirSync(cwd, { recursive: true });
    const command = step.command.flatMap((argument) => (argument === '{quarantine}' ? quarantine : [substitute(argument, values)]));
    const log = `step-${index + 1}.log`;
    const run: StepRun = { ...(await runStep(command, cwd, env, path.join(directory, log), (oracle.timeoutSeconds ?? 1800) * 1000)), template: step.command, log };
    steps.push(run);
    if (stepBroken(run)) break;
  }
  const keep = (template: string | undefined, name: string) => {
    if (!template) return undefined;
    const produced = path.resolve(root, substitute(template, values));
    const copy = path.join(directory, name);
    if (!fs.statSync(produced, { throwIfNoEntry: false })?.isFile()) return undefined;
    if (produced !== copy) fs.copyFileSync(produced, copy);
    return copy;
  };
  const report = keep(oracle.kind === 'tests' ? oracle.report : undefined, 'report.json');
  const artifact = keep(oracle.kind === 'artifact-identical' ? oracle.artifact : undefined, 'artifact');
  const networkAttempts = fs.existsSync(networkLog) ? fs.readFileSync(networkLog, 'utf8').split('\n').filter(Boolean).length : 0;
  const run: OracleRun = {
    side, root, directory, ranIn: directory, steps, networkAttempts, seconds: (performance.now() - started) / 1000, cached: false,
    ...(report ? { report } : {}), ...(artifact ? { artifact } : {}),
  };
  fs.writeFileSync(path.join(directory, 'run.json'), `${JSON.stringify({ ...run, directory: undefined, report: report && 'report.json', artifact: artifact && 'artifact' }, null, 2)}\n`);
  return run;
}

/** ~/ac-work/s4/oracle-cache unless AC_ORACLE_CACHE names another directory ('off' disables the cache). */
export function oracleCacheRoot(): string | undefined {
  const configured = process.env.AC_ORACLE_CACHE;
  if (configured === 'off') return undefined;
  return configured || path.join(os.homedir(), 'ac-work', 's4', 'oracle-cache');
}

/** Version of run.json: part of the cache key, so a changed shape never reads old entries. */
const runFormat = 2;

/** Marker files that change when a node_modules tree is reinstalled. */
export const installMarkers = ['.modules.yaml', '.package-lock.json', '.yarn-state.yml', '.yarn-integrity'];

export interface CacheIdentity {
  repo: string;
  baseCommit: string;
  oracle: OracleSpec;
  profile: Profile;
  /** The environment checkout and its linked node_modules directories. */
  checkout: string;
  linked: string[];
}

/** Cache directory of a base run: a readable prefix plus a hash of everything the run depends on. */
export function cacheDirectory(cacheRoot: string, identity: CacheIdentity): string {
  const installs = identity.linked.map((directory) => {
    for (const marker of installMarkers) {
      const stat = fs.statSync(path.join(identity.checkout, directory, 'node_modules', marker), { throwIfNoEntry: false });
      if (stat) return [directory, marker, stat.size, Math.round(stat.mtimeMs)];
    }
    return [directory];
  });
  const { profile } = identity;
  const key = JSON.stringify({ format: runFormat, repo: fs.realpathSync(identity.repo), base: identity.baseCommit, oracle: identity.oracle, node: profile.node, env: profile.env ?? {}, offline: Boolean(profile.offline), checkout: identity.checkout, installs });
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return path.join(cacheRoot, `${path.basename(identity.repo)}-${identity.baseCommit.slice(0, 12)}-${identity.oracle.name}-${hash}`);
}

export function readCachedRun(directory: string): OracleRun | undefined {
  const file = path.join(directory, 'run.json');
  if (!fs.existsSync(file)) return undefined;
  const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as Omit<OracleRun, 'directory' | 'cached'>;
  return {
    ...stored, directory, cached: true,
    ...(stored.report ? { report: path.join(directory, stored.report) } : {}),
    ...(stored.artifact ? { artifact: path.join(directory, stored.artifact) } : {}),
  };
}

/** Stores a completed run (never one with a broken step); concurrent writers race harmlessly through a rename. */
export function storeRun(run: OracleRun, directory: string): void {
  if (run.steps.some(stepBroken)) return;
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  const staging = `${directory}.tmp-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  const scratch = path.join(run.directory, 'scratch');
  fs.cpSync(run.directory, staging, { recursive: true, filter: (source) => !inside(scratch, source) });
  try {
    fs.renameSync(staging, directory);
  } catch {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// Runs dependency-cruiser's own CLI (this package's dependency, the same command a target's developers run) from a
// package root, and reads what it wrote: a known-violations baseline, or a JSON cruise result with its violations.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { configFileName, knownViolationsFileName } from './rules.js';

const run = promisify(execFile);

export interface Violation {
  type?: string;
  from: string;
  to: string;
  rule: { name: string; severity: string };
  cycle?: { name: string }[];
}

export interface CruiseOutcome {
  /** Violations not softened by the baseline (severity error). */
  errors: Violation[];
  /** Violations the baseline matched. */
  known: number;
  modules: number;
  dependencies: number;
  durationMs: number;
}

/** Absolute path of dependency-cruiser's CLI, found the way Node finds the package from here. */
export function dependencyCruiserBin(): string {
  const require = createRequire(import.meta.url);
  for (const directory of require.resolve.paths('dependency-cruiser') ?? []) {
    const bin = path.join(directory, 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error('dependency-cruiser is not installed (npm install)');
}

/** The installed dependency-cruiser's version. */
export function dependencyCruiserVersion(): string {
  const manifest = path.join(path.dirname(path.dirname(dependencyCruiserBin())), 'package.json');
  return (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version: string }).version;
}

async function depcruise(cwd: string, args: string[]): Promise<number> {
  const started = performance.now();
  try {
    await run(process.execPath, [dependencyCruiserBin(), ...args], { cwd, maxBuffer: 1 << 28, timeout: 15 * 60_000, env: { ...process.env, NO_COLOR: '1' } });
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: string; stdout?: string; killed?: boolean };
    // dependency-cruiser exits non-zero when it reports errors; a crash leaves no output file (checked by the caller).
    if (typeof failure.code !== 'number' || failure.killed) throw new Error(`depcruise ${args.join(' ')} failed in ${cwd}: ${failure.stderr?.trim() || String(error)}`);
  }
  return performance.now() - started;
}

/** `depcruise <targets> --config .dependency-cruiser.json --output-type baseline`: the known-violations file's content. */
export async function writeBaseline(packageDirectory: string, targets: string[]): Promise<{ text: string; durationMs: number }> {
  const output = path.join(packageDirectory, knownViolationsFileName);
  fs.rmSync(output, { force: true });
  const durationMs = await depcruise(packageDirectory, [...targets, '--config', configFileName, '--output-type', 'baseline', '--output-to', knownViolationsFileName]);
  if (!fs.existsSync(output)) throw new Error(`depcruise wrote no baseline in ${packageDirectory}`);
  return { text: fs.readFileSync(output, 'utf8'), durationMs };
}

/** `depcruise <targets> --config .dependency-cruiser.json --ignore-known .dependency-cruiser-known-violations.json`. */
export async function checkWithBaseline(packageDirectory: string, targets: string[], outputFile: string): Promise<CruiseOutcome> {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.rmSync(outputFile, { force: true });
  const durationMs = await depcruise(packageDirectory, [
    ...targets, '--config', configFileName, '--ignore-known', knownViolationsFileName, '--output-type', 'json', '--output-to', outputFile,
  ]);
  let result: { modules: { dependencies: unknown[] }[]; summary: { violations: Violation[] } };
  try {
    result = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  } catch (error) {
    throw new Error(`depcruise wrote no readable result in ${packageDirectory}: ${(error as Error).message}`);
  }
  const violations = result.summary.violations;
  return {
    errors: violations.filter((violation) => violation.rule.severity === 'error'),
    known: violations.filter((violation) => violation.rule.severity === 'ignore').length,
    modules: result.modules.length,
    dependencies: result.modules.reduce((sum, module) => sum + module.dependencies.length, 0),
    durationMs,
  };
}

/** Violations per rule name in a known-violations file. */
export function baselineCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const violation of JSON.parse(text) as Violation[]) counts.set(violation.rule.name, (counts.get(violation.rule.name) ?? 0) + 1);
  return counts;
}

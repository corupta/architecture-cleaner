// Target profiles (profiles/<name>.json): how a target's own tools run. Data about a target, never target code.
// The profile names the Node version, package root and test runner (used by K3b/K6) and the oracle commands (K8).
import fs from 'node:fs';
import path from 'node:path';
import { packageDirectory } from './toolchain.js';

export type RunnerKind = 'jest' | 'vitest' | 'mocha';

export interface RunnerSpec {
  kind: RunnerKind;
  /** Repo-relative directory the runner runs from (its rootDir/root), e.g. 'server'. */
  cwd: string;
  /** Repo-relative config file, when the runner is invoked with one (`vitest --config test/vitest.config.mjs`). */
  config?: string;
  /** Extra arguments as the target's CI passes them (mocha: `--require tsx 'tests/mocha/unit/**\/*.ts'`). */
  args?: string[];
}

/**
 * A command of a K8 oracle. In every string `{worktree}` (the commit's fresh worktree), `{scratch}` (an empty
 * directory outside it) and `{artifacts}` (the run's log directory) are substituted; an argv element that is exactly
 * `{quarantine}` expands to the oracle's quarantine patterns.
 */
export interface OracleStep {
  /** Worktree-relative directory, or a directory under `{scratch}` (created). */
  cwd: string;
  /** argv; a relative executable with a slash (`node_modules/.bin/tsc`) is resolved against `cwd`. */
  command: string[];
}

/**
 * One K8 oracle, run on the head worktree and, when the verdict needs it, on the base worktree (base runs are cached).
 * exit-zero: every step exits 0 on head; when head and base both fail, their `diagnostics` must be equal modulo the pathMap.
 * tests: the runner's JSON `report` on head equals base's per file (load status) and per case (file + name + ordinal).
 * artifact-identical: the produced `artifact` is byte-identical to what the base produces.
 * Every step (setup included) must exit 0 on head unless it fails on base too; tests compare the exit code with base's.
 * Before each oracle the worktree is reset to its commit (tracked files restored, untracked and ignored files removed,
 * the node_modules links kept), so no oracle sees what an earlier check or oracle left behind.
 */
export interface OracleSpec extends OracleStep {
  /** Unique within the profile; a path segment ([A-Za-z0-9._-]). */
  name: string;
  kind: 'exit-zero' | 'tests' | 'artifact-identical';
  /** Steps run first, in order (builds the oracle needs). */
  setup?: OracleStep[];
  /** Files written before the steps: path under `{scratch}` → content (both substituted). */
  files?: Record<string, string>;
  /** Worktree-relative paths the environment must provide (prerequisite builds reached through node_modules links). */
  requires?: string[];
  /** exit-zero: format of the diagnostics compared when base fails too. */
  diagnostics?: 'tsc';
  /** tests: report format (default: the profile's runner kind). */
  format?: RunnerKind;
  /** tests: path of the JSON report the command writes. */
  report?: string;
  /** tests: base repo-relative test files left out on both sides (network-dependent); head gets their mapped paths. */
  quarantine?: string[];
  /** artifact-identical: path of the produced artifact. */
  artifact?: string;
  /**
   * artifact-identical: repo-relative path of a tracked file that is what the base produces (immich's OpenAPI spec).
   * Head is compared with that base blob; only on a mismatch does the base run too, to tell a stale file from a change.
   */
  reference?: string;
  /** Per step (default 1800). */
  timeoutSeconds?: number;
}

export interface Profile {
  name: string;
  /** Repo-relative package root ('' for the repo root). */
  packageRoot: string;
  /** Node for the target's tools: a version installed under ~/ac-targets/.node, or 'system'. */
  node: string;
  /** Extra environment for every target command (TZ, ...). */
  env?: Record<string, string>;
  /** Block the network for target commands (Node preload + dead proxy), as G2 measured them. */
  offline?: boolean;
  runner?: RunnerSpec;
  oracles?: OracleSpec[];
  /** `ac plan`: the package-relative directory to plan (default `src`) and extra package-relative pin globs. */
  plan?: { moduleRoot?: string; pins?: string[] };
}

/** A profile by name (profiles/<name>.json in this package) or by path. */
export function loadProfile(nameOrPath: string): Profile {
  const candidates = [nameOrPath, path.join(packageDirectory(), 'profiles', `${nameOrPath}.json`)];
  const file = candidates.find((candidate) => candidate.endsWith('.json') && fs.existsSync(candidate));
  if (!file) throw new Error(`no profile '${nameOrPath}' (looked in ${candidates.join(', ')})`);
  const profile = JSON.parse(fs.readFileSync(file, 'utf8')) as Profile;
  return { ...profile, packageRoot: profile.packageRoot ?? '' };
}

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

/** One K8 oracle: a command run in the head worktree (and, for `compare-base`, in the base worktree too). */
export interface OracleSpec {
  name: string;
  /** Repo-relative working directory inside the worktree. */
  cwd: string;
  /** argv; `{worktree}`, `{scratch}` and `{artifacts}` are substituted. */
  command: string[];
  /**
   * exit-zero: the command must exit 0.
   * tests: the runner's JSON report (`report` path) is compared per file and per case with the base run.
   * artifact-identical: the file `artifact` must be byte-identical between the base and head runs.
   */
  kind: 'exit-zero' | 'tests' | 'artifact-identical';
  /** For tests: path of the JSON report the command writes ({artifacts} substituted). */
  report?: string;
  /** For artifact-identical: path of the produced artifact ({scratch}/{worktree} substituted). */
  artifact?: string;
  /** Commands to run first in the same worktree (builds that the oracle needs). */
  setup?: string[][];
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
}

/** A profile by name (profiles/<name>.json in this package) or by path. */
export function loadProfile(nameOrPath: string): Profile {
  const candidates = [nameOrPath, path.join(packageDirectory(), 'profiles', `${nameOrPath}.json`)];
  const file = candidates.find((candidate) => candidate.endsWith('.json') && fs.existsSync(candidate));
  if (!file) throw new Error(`no profile '${nameOrPath}' (looked in ${candidates.join(', ')})`);
  const profile = JSON.parse(fs.readFileSync(file, 'utf8')) as Profile;
  return { ...profile, packageRoot: profile.packageRoot ?? '' };
}

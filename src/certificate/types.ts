// Vocabulary of the certifier: checks, their results, the certificate.
import type { RepoFs } from '../analyzer/repo-fs.js';
import type { Analysis } from '../analyzer/types.js';
import type { Environment } from './commit-fs.js';
import type { CommitTree } from './git-tree.js';
import type { PathMap } from './path-map.js';
import type { Profile } from './profile.js';
import type { SpanView } from './spans.js';

/** K3 has three resolvers: a = TypeScript (every program), b = the test runner's own, c = the runtime's. */
export type CheckId = 'K0' | 'K1' | 'K2' | 'K3a' | 'K3b' | 'K3c' | 'K4' | 'K6' | 'K8';

export type CheckStatus = 'pass' | 'fail' | 'skip' | 'error';

export interface Violation {
  file?: string;
  detail: string;
}

/** Non-blocking observations (docs that mention old paths, ...): reported, never fixed, never failing. */
export interface Finding {
  kind: string;
  file?: string;
  detail: string;
}

export interface CheckResult {
  id: CheckId;
  title: string;
  status: CheckStatus;
  /** One line for the readable summary. */
  summary: string;
  metrics: Record<string, number | string | boolean>;
  violations: Violation[];
  findings: Finding[];
  /** Why the check didn't run (status 'skip'). */
  skipReason?: string;
  durationMs: number;
}

export interface CertifyOptions {
  /** The git repository holding both commits. */
  repo: string;
  base: string;
  head: string;
  /** Repo-relative package root ('' for the repo root), e.g. 'server' for immich. */
  packageRoot: string;
  /** Checkout whose installed node_modules serve as the environment (default: `repo`). */
  environment: string;
  /** The target profile (Node version, runner, oracle commands), or null when none is known. */
  profile: Profile | null;
  /** Run the K8 oracles (needs a profile with `oracles`). */
  oracles: boolean;
  /** Only these checks run (default: all). */
  only?: CheckId[];
  /** Scratch directory for worktrees and logs. */
  workDir: string;
  /** Keep worktrees and logs after the run. */
  keep: boolean;
}

export type Side = 'base' | 'head';

export interface CertifyContext {
  options: CertifyOptions;
  base: CommitTree;
  head: CommitTree;
  views: Record<Side, (file: string) => SpanView | undefined>;
  pathMap: PathMap;
  environment: Environment;
  /** The analyzer's view of each commit (tracked content from git objects, node_modules from the environment). */
  fs: Record<Side, RepoFs>;
  /** Analyzer output for both trees, computed once on first use. */
  analyses(): Record<Side, Analysis>;
  /**
   * A fresh git worktree of the commit (hooks disabled) with the environment's node_modules linked in, for checks
   * that run the target's own tools. Created once per side; removed after the run unless `keep`.
   */
  materialize(side: Side): string;
  log(message: string): void;
}

export interface Check {
  id: CheckId;
  title: string;
  run(context: CertifyContext): CheckResult | Promise<CheckResult>;
}

export interface Certificate {
  format: 'ac-certificate/1';
  tool: { name: string; version: string };
  repo: string;
  base: string;
  head: string;
  packageRoot: string;
  environment: { checkout: string; node: string; linkedNodeModules: string[] };
  pathMap: {
    moves: number;
    unchanged: number;
    editedInPlace: number;
    deleted: string[];
    added: { path: string; copyOf?: string }[];
    ambiguousGroups: number;
    entries: Record<string, string>;
  };
  checks: CheckResult[];
  /** pass: every check that ran passed. */
  verdict: 'pass' | 'fail';
  /** full: K8 oracles ran; static: K0–K7 only. */
  scope: 'full' | 'static';
  residualRisk: string[];
  digest: string;
}

/** Result helper: status from violations, timing filled in by the runner. */
export function result(id: CheckId, title: string, fields: Partial<Omit<CheckResult, 'id' | 'title'>> & { summary: string }): CheckResult {
  const violations = fields.violations ?? [];
  return {
    id,
    title,
    status: fields.status ?? (violations.length ? 'fail' : 'pass'),
    summary: fields.summary,
    metrics: fields.metrics ?? {},
    violations,
    findings: fields.findings ?? [],
    ...(fields.skipReason ? { skipReason: fields.skipReason } : {}),
    durationMs: fields.durationMs ?? 0,
  };
}

export const skipped = (id: CheckId, title: string, reason: string): CheckResult => result(id, title, { status: 'skip', summary: `skipped: ${reason}`, skipReason: reason });

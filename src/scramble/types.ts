// Vocabulary of `ac scramble` (plan §7): flatten a feature-modular package into type folders with our own executor,
// check the move with our certifier (its verdict recorded, FAIL included), and keep the original feature folder of
// every file as the benchmark's ground truth.
import type { Profile } from '../certificate/profile.js';
import type { CheckId } from '../certificate/types.js';

/** How one repo is flattened (bench/scramble/<name>.json). Paths are package-root-relative posix strings. */
export interface ScrambleManifest {
  name: string;
  /** The pinned commit the scramble starts from. */
  sha: string;
  /** Repo-relative package directory, '' for the repo root. */
  packageRoot: string;
  /** Package-relative directory whose files are scrambled, e.g. `src`. */
  moduleRoot: string;
  /** Top folder under the module root → how many segments name its features (hoppscotch `orchestration`: 2). Default 1. */
  depth?: Record<string, number>;
  /** Top folders under the module root that are shared code, not features (ground truth `shared:<folder>`). */
  shared: string[];
  /** Regular expression sources over package-relative paths (`^src/migrations/`): files the scramble never moves or scores. */
  exclude: string[];
}

/** default: type folders with the original file names; H1: opaque file names (`s-1a2b.service.ts`). */
export type ScrambleVariant = 'default' | 'H1';

export interface ScrambleEntity {
  /** Package-relative path at the base commit. */
  original: string;
  /** Package-relative path at the scramble commit (equal to original when the file stays). */
  scrambled: string;
  /** Ground truth: the feature folder (`team-collection`, `orchestration/sort`), `shared:<folder>` or `root`. */
  truth: string;
  truthKind: 'feature' | 'shared' | 'root';
  /** Technical type (`service`, `controller`, …) and where it was read from. */
  type: string;
  typeVia: 'suffix' | 'folder' | 'ast';
  /** The scrambled name gives the feature away: a collision renamed with a module-token prefix, or counted (`-2`). */
  leaky: boolean;
}

export interface ScrambleResult {
  format: 'ac-scramble/1';
  manifest: ScrambleManifest;
  variant: ScrambleVariant;
  /** Repo checkout the scramble ran in, and the commits and trees around the scramble commit. */
  repo: string;
  base: string;
  baseTree: string;
  commit: string;
  tree: string;
  branch: string;
  /** Absolute path of a checkout at `commit` (the bench builds its facts there). */
  worktree: string;
  /** Every source file the scramble scored, moved or not. */
  entities: ScrambleEntity[];
  /** Files never moved nor scored: tests (they move with their subject), barrels, manifest excludes, outside the module root. */
  excluded: { path: string; reason: string }[];
  /** Files the executor declined: left in place, scored at their original path, counted as leakage. */
  declined: { path: string; code: string; detail: string }[];
  /** Files a scramble leaves in a feature folder (declined, excluded barrels, …): they give that folder's name away. */
  leakage: { path: string; reason: string }[];
  /** The scramble commit's certificate (base..commit), null when certification was off. */
  certificate: { file: string; verdict: 'pass' | 'fail'; scope: 'full' | 'static'; digest: string; failing: CheckId[] } | null;
}

export interface ScrambleOptions {
  /** A checkout the scramble may write to (a worktree, never the shared pristine checkout). */
  repo: string;
  manifest: ScrambleManifest;
  variant: ScrambleVariant;
  /** Directory for scramble.json, the pathMap and the certificate. */
  out: string;
  branch?: string;
  /** Checkout with node_modules for the certificate (K3b, K6, K8); default `repo`. */
  environment?: string;
  profile?: Profile | null;
  /** Certify the scramble commit (static checks); `oracles` adds K8. */
  certify?: boolean;
  oracles?: boolean;
  log?(message: string): void;
}

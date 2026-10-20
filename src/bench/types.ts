// Vocabulary of `ac bench` (plan §7): recovery scores of the planner next to deterministic baselines, on scrambled
// feature-modular repos (ground truth: their original feature folders) and on real type-sliced targets (no ground truth).

/** One entry of a bench manifest (bench/manifest.json). */
export interface BenchEntry {
  /** Unique, a path segment: `hoppscotch`, `hoppscotch-H1`, `immich`. */
  name: string;
  /** scramble: flatten a feature-modular repo and score recovery; real: a type-sliced target, scored without ground truth. */
  kind: 'scramble' | 'real';
  /** Checkout of the target (never written to: the bench makes its own worktree). */
  repo: string;
  /** scramble: the scramble manifest file (bench/scramble/<name>.json); real: unused. */
  scramble?: string;
  variant?: 'default' | 'H1';
  /** real: the pinned commit and the package and module roots. */
  sha?: string;
  packageRoot?: string;
  moduleRoot?: string;
  /** Profile (name or file) for pins and, with certification, the scramble's certificate. */
  profile?: string;
  /** The planner's cassette, replayed or recorded (repo-relative, e.g. cassettes/s7-bench.jsonl). */
  cassette: string;
}

export interface BenchManifest {
  entries: BenchEntry[];
}

export interface MethodScore {
  /** `B0 type folders`, `name-token (anchored)`, `Louvain r=4 (mean of seeds 1-5)`, `seeds draft`, `planner (Ultra)`. */
  method: string;
  kind: 'baseline' | 'draft' | 'planner';
  /** Clusters over every movable file the method partitions (Louvain rows: the mean over seeds). */
  clusters: number;
  /** Against the ground truth (scramble entries only; null on real targets). MoJoFM in 0–100. */
  mojoFm: number | null;
  ari: number | null;
  /** Share of ground-truth modules recovered (c2c ≥ 0.66). */
  c2cCvg: number | null;
  /** Predicted clusters / ground-truth clusters, over the files both partitions share. */
  clusterCountRatio: number | null;
  /** MoJoFM on the hard files only (their anchored name token differs from their feature folder). */
  mojoFmHard: number | null;
  /** Without ground truth (every entry): modularization quality and module-level back-edges against a DAG order. */
  turboMq: { sum: number; mean: number };
  backEdges: number;
  note?: string;
}

/** The seeds draft the planner starts from: plannerDraft's choice, which compares contested counts and reads no ground truth. */
export interface BenchDraft {
  /** The method row it is (kind `draft`). */
  method: string;
  source: 'file names' | 'export names';
  /** Files each seed source leaves contested: the exports win when they leave fewer. */
  contested: { fileNames: number; exportNames: number };
}

/**
 * What the scrambled paths give away, over the movable files in the facts: those are the files every method sees, and
 * the planner's prompt lists them by their module-root-relative paths. `leakyFiles` is the union of the three kinds.
 */
export interface BenchLeakage {
  /** Leaky renames: named after their feature by a collision (a feature prefix or a counter). */
  renamed: number;
  /** Still in a feature folder (declined by the executor, …): the folder names the feature. */
  inFeatureFolder: number;
  /**
   * Moved feature files in a sub-folder their feature kept under the type folder (`services/calculator/twr/`), when that
   * sub-folder (by its name, across type folders) holds two or more files and all of one feature: a path groups them.
   * The planner's prompt shows these paths; the deterministic methods group by file names, exports or imports, never
   * by a sub-folder. `subFolders` lists every kept sub-folder name, counted or not: its files and their features.
   */
  underSubFolder: number;
  subFolders: { folder: string; files: number; features: number }[];
  /** Leaky files no method sees (pinned or not read by the facts: tests, assets, declined files the facts pin): not in leakyFiles. */
  unseen: number;
}

/** The planner's final plan against the draft it started from: partitions compared, so renaming a group moves no file. */
export interface BenchPlannerChange {
  draftGroups: number;
  /** Every plan group is exactly one draft group: the row scores the draft. */
  samePartition: boolean;
  /** Files outside the plan group that holds most of their draft group. */
  filesMoved: number;
  /** Draft groups whose files mostly went to the same plan group as another draft group's: draft groups minus their distinct images. */
  groupsMerged: number;
  /**
   * The winning candidate's edit and the validator's issues with it by code (each issue is an entry or move it dropped,
   * or one it repaired, before applying the edit); null when the draft itself won. `movesById`: its moves that name their
   * file by an id the prompt showed, not by path (planner rules 2 read them, rules 1 drop them as unknown files); absent
   * in results written before S8.
   */
  winner: { label: string; groupEntries: number; moves: number; movesById?: number; issues: Record<string, number> } | null;
  /** The critic's suggestions and how many its gate kept; null when the critic didn't run. */
  critic: { suggestions: number; kept: number } | null;
}

/** bench/results/<entry>.json */
export interface BenchResult {
  format: 'ac-bench/1';
  entry: string;
  kind: 'scramble' | 'real';
  variant: 'default' | 'H1';
  repo: string;
  sha: string;
  packageRoot: string;
  moduleRoot: string;
  /** Files scored; for scrambles also the feature files, ground-truth modules, hard files and leakage. */
  files: number;
  featureFiles: number | null;
  groundTruthModules: number | null;
  hardFiles: number | null;
  /**
   * Movable files whose scrambled path gives their feature away (the union in `leakage`). Results written before the
   * S7 fix round counted every leaky rename and every file left in a feature folder instead, files no method sees included.
   */
  leakyFiles: number | null;
  /** The split behind leakyFiles (scrambles; absent in results written before the S7 fix round). */
  leakage?: BenchLeakage | null;
  scramble: {
    commit: string;
    tree: string;
    moved: number;
    declined: number;
    excluded: number;
    certificate: { verdict: 'pass' | 'fail'; scope: 'full' | 'static'; digest: string; failing: string[] } | null;
  } | null;
  methods: MethodScore[];
  /** The best deterministic method (baselines and the seeds draft) by MoJoFM (scrambles) or by TurboMQ's sum (real targets). */
  bestBaseline: { method: string; mojoFm: number | null; turboMq: number } | null;
  planner: {
    cassette: string;
    /** What the plan cost when it was recorded, and what this run spent (0 on a replay). */
    recordedCostUsd: number;
    spentUsd: number;
    replayed: boolean;
    /** The planner's calls answered from the cassette and recorded into it by this run (absent before S8). */
    calls?: { replayed: number; recorded: number };
    /** The planner rules the answers were read and ranked with (src/planner/types.ts PlannerRules; absent before S8: 1). */
    rules?: number;
    groups: number;
    /** Feature modules among the groups (0: every group is platform or shared). Absent before the S7 fix round, like `change`. */
    modules?: number;
    change?: BenchPlannerChange;
    planSha256: string;
  } | null;
  /** The seeds draft the planner starts from (absent in results written before the S7 fix round). */
  draft?: BenchDraft;
  /** Louvain MoJoFM per resolution, one value per seed. */
  louvainMojoFmByResolution: Record<string, number[]> | null;
  /**
   * Plain-words remarks: the planner not run or not recorded, an invalid plan, its draft and how far the plan moved
   * from it, feature files the facts pin, the leakage.
   */
  notes?: string[];
}

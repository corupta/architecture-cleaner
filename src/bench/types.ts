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
  leakyFiles: number | null;
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
    groups: number;
    planSha256: string;
  } | null;
  /** Louvain MoJoFM per resolution, one value per seed. */
  louvainMojoFmByResolution: Record<string, number[]> | null;
  /** Plain-words remarks: the planner not run or not recorded, an invalid plan, feature files the facts pin. */
  notes?: string[];
}

// Vocabulary of `ac run` (plan §2.3, §3.2): the rungs, the run directory's files (contract C7) and the injected R4
// hook (contract C6). Every shape written to the run directory is defined here.
//
// <run-dir>/
//   run.json                       RunState: versioned state, rewritten (atomically) at every transition; --resume reads it
//   events.jsonl                   RunEvent per line, in order, with durations
//   plan/plan.yaml                 the plan the run executes (byte copy, or the planner's output)
//   plan/plan.md, plan.json, ...   the planner's other outputs, only when the run planned in-process
//   plan/steps/<NN>-<kind>-<name>.json   every step as `ac move --map` reads it (R3 steps added when R3 starts)
//   preflight.json                 Preflight
//   baseline.json                  the baseline result (contract C2), when R0 ran it
//   certificates/<NNN>-<rung>-<kind>-<name>.{json,txt}   the passing static certificate of each step (json + summary)
//   certificates/failed/<NNN>-<rung>-<kind>-<name>-attempt<k>.{json,txt}   certificates of failed attempts
//   rungs/<rung>.{json,txt}        the rung's cumulative full certificate (rung start..rung end, oracles included);
//                                  R4's one commit has only this one
//   rungs/failed/<rung>.{json,txt}, rungs/bisect/<rung>-<NNN>.{json,txt}   the rung certificate a K8 bisect superseded, its probes
//   certificate.{json,txt}         the whole PR: run base..final commit, oracles included
//   boundaries/report.json         R4's report (contract C6), when R4 ran
//   report.md                      the readable report (timeline, verdicts, totals, cost, findings)
//   work/                          scratch for certifications (removed after each)
//   cache/                         the certifier's per-tree cache (~1.7 MB per immich tree): scratch, never published
import type { QuarantineEntry } from '../certificate/baseline.js';
import type { Profile } from '../certificate/profile.js';
import type { CheckId } from '../certificate/types.js';
import type { PlanFile } from '../planner/plan-file.js';

export type RungId = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
export const rungIds: readonly RungId[] = ['R0', 'R1', 'R2', 'R3', 'R4'];

/** Contract C6: what the R4 boundary-rules implementation returns. */
export interface BoundaryRungResult {
  /** Repo-relative path → full content to add (the dependency-cruiser config and its baseline). */
  files: Map<string, string>;
  /** Written by the orchestrator to <run-dir>/boundaries/report.json. */
  report: unknown;
  antiVacuity: { rule: string; fired: boolean; detail: string }[];
  summary: string;
}

export interface BoundaryRungInput {
  repo: string;
  environment: string;
  packageRoot: string;
  moduleRoot: string;
  planFile: PlanFile;
  workDir: string;
  log(message: string): void;
}

/** Contract C6: injected into the orchestrator; none is wired yet, so R4 reports "not available". */
export type BoundaryRung = (input: BoundaryRungInput) => Promise<BoundaryRungResult>;

/** A finding of the run (recorded, never fixed): pins, skips, declines, an injected fault, executor findings. */
export interface RunFinding {
  kind: string;
  step?: number;
  rung?: RungId;
  /** Repo-relative paths at the run's base commit (pins) or where the finding names them. */
  files: string[];
  detail: string;
}

/** A file the run leaves where it is: the plan entry it belongs to (subject and tests) didn't move. */
export interface PinRecord {
  /** Repo-relative path the step would have moved it from (the run's base for R1 and R2). */
  file: string;
  step: number;
  group: string;
  /** The finding kind that pinned it. */
  reason: string;
}

/** A certificate the run stored. */
export interface CertificateRecord {
  /** Run-dir-relative path of the certificate JSON (the summary sits next to it as .txt). */
  file: string;
  verdict: 'pass' | 'fail';
  scope: 'full' | 'static';
  digest: string;
  base: string;
  head: string;
  /** Checks that failed or crashed. */
  failing: CheckId[];
}

/**
 * executing → declined | unverified | error (nothing committed), or → committed → certifying → passed | failed
 * (rolled back). An attempt found in flight by --resume becomes interrupted and doesn't count as a replan.
 */
export type AttemptState = 'executing' | 'declined' | 'unverified' | 'error' | 'committed' | 'certifying' | 'passed' | 'failed' | 'interrupted';

export interface AttemptRecord {
  /** 1-based over the step's whole life. */
  attempt: number;
  /** The step's round when the attempt ran. */
  round: number;
  state: AttemptState;
  /** The commit the attempt started from. */
  parent: string;
  /** Requested moves after pins. */
  moves: number;
  /** The step's commit as certified (before the trailers were added). */
  commit?: string;
  certificate?: CertificateRecord;
  injectedFault?: { operator: string; description: string };
  /** Repo-relative paths at the parent that the failure names. */
  offending: string[];
  /** Files this attempt's failure pinned. */
  pinned: string[];
  detail: string;
  startedAt: string;
  durationMs: number;
  timings: { moveMs?: number; commitMs?: number; faultMs?: number; certifyMs?: number; amendMs?: number; rollbackMs?: number };
}

/**
 * pending → running → certified, or skipped (nothing left to move), or pinned (every file pinned: after two replans,
 * an unattributable failure, or a rung bisect).
 */
export type StepStatus = 'pending' | 'running' | 'certified' | 'skipped' | 'pinned';

export interface StepRecord {
  /** 1-based execution order: R1 and R2 as `ac steps` numbers them, then R3, then R4. */
  index: number;
  rung: RungId;
  group: string;
  /** Requested moves before pins: repo-relative old path → new path. */
  moves: Record<string, string>;
  /** Files pinned together (a plan entry: its subject, then its tests), repo-relative at the run's base. */
  entries: string[][];
  status: StepStatus;
  /** 1, then 2 once a rung's K8 bisect sends the step back to pending: replans are counted per round. */
  round: number;
  attempts: AttemptRecord[];
  /** The step's commit on the branch (with the trailers). */
  commit?: string;
  tree?: string;
  parent?: string;
  certificate?: CertificateRecord;
  /** --jobs above 1: the certificate trailers, until the rewrite pass at the rung's end writes them onto the commit. */
  pendingTrailers?: string[];
  counts?: { filesMoved: number; specifierEdits: number; filesEdited: number };
  /** Base path → head path of every file the commit moved (the certificate's pathMap). */
  pathMap?: Record<string, string>;
  durationMs: number;
}

export type RungStatus = 'pending' | 'running' | 'passed' | 'declined' | 'certified' | 'failed' | 'skipped' | 'not-available' | 'not-requested';

export interface BisectRecord {
  probes: { step: number; commit: string; k8: 'pass' | 'fail' | 'error' | 'skip'; certificate: string; durationMs: number }[];
  firstFailingStep: number;
  durationMs: number;
}

export interface RungRecord {
  id: RungId;
  status: RungStatus;
  /** The commit the rung starts from, and its last commit. */
  start?: string;
  end?: string;
  /** The rung's cumulative full certificate; partial when the run stopped inside the rung (--max-steps). */
  certificate?: CertificateRecord & { partial: boolean };
  bisect?: BisectRecord;
  note?: string;
  durationMs: number;
}

export interface FaultRecord {
  /** Step index or group key, as given to --inject-fault. */
  step: string;
  operator: string;
  /** Set once applied (the mutant replaced the step's first commit). */
  appliedTo?: number;
  description?: string;
  mutantCommit?: string;
  /** Why it couldn't be applied (no instance of the operator on that step). */
  notApplied?: string;
}

/** run.json. */
export interface RunState {
  format: 'ac-run/1';
  status: 'running' | 'declined' | 'completed' | 'stopped' | 'failed';
  tool: { name: string; version: string };
  repo: string;
  /** Checkout whose node_modules the certifier and oracles use. */
  environment: string;
  profile: Profile;
  packageRoot: string;
  moduleRoot: string;
  /** The plan's sha: the branch starts here. */
  base: string;
  baseTree: string;
  branch: string;
  /** The last certified commit on the branch (base until the first). */
  head: string;
  plan: {
    /** Run-dir-relative copy. */
    file: string;
    /** Where it came from: a plan.yaml path, or `planner` (planned in-process). */
    source: string;
    sha256: string;
    steps: number;
    moves: number;
  };
  rungsRequested: RungId[];
  options: { jobs: number; injectFault: { step: string; operator: string } | null };
  rungs: RungRecord[];
  steps: StepRecord[];
  pins: PinRecord[];
  findings: RunFinding[];
  /** The baseline's flaky tests at the run's base paths (contract C2); K8 leaves them out, mapped per range. */
  quarantine: QuarantineEntry[];
  fault: FaultRecord | null;
  /** The whole PR: run base..final commit, oracles included. */
  certificate?: CertificateRecord;
  cost: {
    /** Budget run the gateway charged (null when no planner ran in this run). */
    budgetRun: string | null;
    mode: 'replay' | 'record' | 'auto' | null;
    /** LLM spend of this run from the gateway ledger ($0 on a replay). */
    llmUsd: number;
    /** What the plan cost when it was recorded (plan.md's "Cost:" line, or the planner run's own). */
    planRecordedUsd: number | null;
  };
  timeline: {
    startedAt: string;
    finishedAt?: string;
    /** Wall time over every invocation (resumes included). */
    durationMs: number;
    preflightMs: number;
    baselineMs: number;
    stepsMs: number;
    rungCertificationMs: number;
    bisectMs: number;
    runCertificationMs: number;
    resumedAt: string[];
  };
  error?: string;
}

export type RunEventKind =
  | 'run-start' | 'resume' | 'preflight' | 'baseline' | 'branch' | 'rung-start' | 'rung-skip' | 'step-start' | 'move' | 'commit'
  | 'fault' | 'certify' | 'amend' | 'rollback' | 'pin' | 'step-end' | 'rung-certify' | 'bisect-probe' | 'bisect' | 'run-certify'
  | 'run-end';

/** events.jsonl. */
export interface RunEvent {
  ts: string;
  event: RunEventKind;
  durationMs?: number;
  rung?: RungId;
  step?: number;
  group?: string;
  attempt?: number;
  detail?: string;
  [field: string]: unknown;
}

/** preflight.json. */
export interface Preflight {
  format: 'ac-preflight/1';
  base: string;
  plan: { sha: string; resolved: string; matchesBranchStart: boolean; missingFiles: string[] };
  inventory: { trackedFiles: number; packageFiles: number; analyzedFiles: number; sites: number; hazards: Record<string, number> } | null;
  /** K0 over base..(base with every planned move applied as a pure rename). */
  envelope: { plannedMoves: number; violations: { file?: string; detail: string }[]; metrics: Record<string, number> } | null;
  baseline: { green: boolean; flaky: number; durationMs: number } | null;
  declines: { code: string; file?: string; detail: string }[];
  declined: boolean;
  durationMs: number;
}

// The findings log's vocabulary (plan §2.3 "Findings log", §3.2 "Findings narrator"): deterministic findings about the
// target, recorded and never fixed, each with a stable id and evidence text; narration is optional prose on top.
import crypto from 'node:crypto';
import fs from 'node:fs';

/** Where a finding came from. */
export type FindingSource =
  /** <run-dir>/boundaries/report.json (contract C8). */
  | 'boundaries'
  /** The planner's facts at the run's base commit, grouped by the run's plan. */
  | 'plan-graph'
  /** The planner's facts at the base commit (tables, injected members). */
  | 'facts'
  /** The analyzer's resolved imports at the base commit. */
  | 'analyzer'
  /** The plan validator, recomputed on the run's plan. */
  | 'validator'
  /** A check of a certificate the run stored. */
  | 'certificate'
  /** run.json: pins, replans, skips, declines, executor findings. */
  | 'run';

export interface Finding {
  /** `F-` + 12 hex of sha256(kind, key): the same finding gets the same id in every run of the same inputs. */
  id: string;
  kind: string;
  title: string;
  /** Repo-relative paths (at the run's base commit, unless a certificate or the run named them elsewhere), sorted. */
  files: string[];
  /** Deterministic text: what was found, with numbers and names. Narration may only restate it. */
  evidence: string;
  source: FindingSource;
  /** Steps whose certificate or record reported it, ascending. */
  steps: number[];
  /** Run-dir-relative rung and whole-PR certificates that reported it (certificate findings). */
  certificates: string[];
  /** Orders the findings of one kind, larger first (a cycle's size, a table's writer groups, file pairs, ...). */
  weight: number;
  /** 1–2 sentences by the narrator that passed the guard, else null. */
  narration: string | null;
}

/** A finding as a collector builds it: no id, no narration yet. */
export type CollectedFinding = Omit<Finding, 'id' | 'narration' | 'steps' | 'certificates'> & { key: string; steps?: number[]; certificates?: string[] };

export const findingId = (kind: string, key: string) => `F-${crypto.createHash('sha256').update(`${kind}\0${key}`).digest('hex').slice(0, 12)}`;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function toFinding(collected: CollectedFinding): Finding {
  const { key, ...rest } = collected;
  return {
    ...rest,
    id: findingId(collected.kind, key),
    files: [...new Set(collected.files)].sort(byCodeUnit),
    steps: [...new Set(collected.steps ?? [])].sort((a, b) => a - b),
    certificates: [...new Set(collected.certificates ?? [])].sort(byCodeUnit),
    narration: null,
  };
}

/** What `findings/findings.json` holds. */
export interface FindingsDocument {
  format: 'ac-findings/1';
  run: { base: string; head: string; branch: string; status: string; packageRoot: string; profile: string };
  /** What each source contributed, or why it couldn't (a missing boundary report, an unreadable base commit). */
  sources: { name: FindingSource | 'target'; detail: string }[];
  narration: NarrationRecord | null;
  findings: Finding[];
}

export interface NarrationRecord {
  /** Token Factory model id. */
  model: string;
  /** `Nemotron 3.5 Lightning (thinking off)`. */
  label: string;
  calls: number;
  /** What the calls cost when recorded (a replay spends nothing now). */
  costUsd: number;
  replayed: boolean;
  narrated: number;
  /** Narrations the guard dropped, with why; their findings keep only the deterministic evidence. */
  dropped: { id: string; reason: string }[];
  /** Findings sent whose answer had no narration for them (with the answer's error, if any); evidence only too. */
  notReturned: { id: string; reason: string }[];
  /** Why narration stopped early (a replay miss, a refused budget), if it did. */
  error?: string;
}

/**
 * A findings.json as this version writes it, or null when there is none. One written before S8 lists the findings the
 * model returned no narration for among `dropped`, by their reason; they move to `notReturned`.
 */
export function readFindingsDocument(file: string): FindingsDocument | null {
  if (!fs.existsSync(file)) return null;
  const document = JSON.parse(fs.readFileSync(file, 'utf8')) as FindingsDocument;
  const record = document.narration as (Omit<NarrationRecord, 'notReturned'> & { notReturned?: NarrationRecord['notReturned'] }) | null;
  if (!record || record.notReturned) return document;
  const notReturned = record.dropped.filter((drop) => drop.reason.startsWith('no narration returned'));
  return { ...document, narration: { ...record, dropped: record.dropped.filter((drop) => !notReturned.includes(drop)), notReturned } };
}

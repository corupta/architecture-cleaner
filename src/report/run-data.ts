// Everything one run report shows, read from a run directory (contract C7, src/orchestrator/types.ts) and from this
// package's committed artifacts (the budget ledger, runs/g3/ab.json). Pure reading: the only derived file is
// graph.json (graph.ts), which needs the repo and is written by the command, not here.
import fs from 'node:fs';
import path from 'node:path';
import { compare } from '../boundaries/folder-graph.js';
import { type FindingsDocument, readFindingsDocument } from '../findings/types.js';
import { readRunState } from '../orchestrator/run-directory.js';
import type { AttemptRecord, AttemptState, RungRecord, RunState, StepRecord } from '../orchestrator/types.js';
import { readPlanYaml, type PlanFile } from '../planner/plan-file.js';
import type { FileFact } from '../planner/types.js';
import { abTableFor, abTableView, readAbDocument, type AbTableView } from './ab.js';
import { certificateSummary, readCertificate, type CertificateView } from './certificates.js';
import { readRunGraph, type RunGraph } from './graph.js';
import { finalGroups, planGroupOrder, tableHeatmap, type TableHeatmap } from './heatmap.js';
import { readLedger, type Ledger } from './ledger.js';

export interface StoredCertificate {
  /** Run-dir-relative path of the JSON. */
  file: string;
  view: CertificateView;
  summary: string;
}

export interface AttemptView {
  attempt: AttemptRecord;
  certificate: StoredCertificate | null;
}

export interface StepView {
  step: StepRecord;
  attempts: AttemptView[];
}

export interface RungView {
  rung: RungRecord;
  certificate: StoredCertificate | null;
  /** Bisect probes' certificates, in probe order. */
  probes: StoredCertificate[];
}

export interface PlanSummary {
  groups: { module: number; platform: number; shared: number };
  files: number;
  /** Placements by who decided them: the deterministic draft, the planner (Nemotron's edit), the critic. */
  bySource: Record<string, number>;
  contested: number;
  /** Placements the planner or critic made, with their rationale, in path order. */
  decisions: { path: string; group: string; source: string; rationale: string | null }[];
  /** Labels of the candidates a model edited (plan.json: `ultra#1`, ...), in plan.json order; null without a plan.json. */
  editors: string[] | null;
  /** Whether a critic call ran (plan.json has a critic block); null without a plan.json. */
  critic: boolean | null;
  /** The critic's review (plan.json), when one ran. */
  criticReview: string | null;
  /** The critic's suggestions and how many the gate accepted (plan.json), when one ran. */
  criticSuggestions: { total: number; accepted: number } | null;
  winner: string | null;
  recordedCostUsd: number | null;
}

export interface RunReportData {
  /** The run dir's name (runs/<name>). */
  name: string;
  state: RunState;
  graph: RunGraph | null;
  steps: StepView[];
  rungs: RungView[];
  whole: StoredCertificate | null;
  /** Certificates in the run dir that nothing in run.json points to (a superseded rung certificate, a -2 copy). */
  otherCertificates: StoredCertificate[];
  findings: FindingsDocument | null;
  plan: PlanSummary | null;
  heatmap: TableHeatmap | null;
  ledger: Ledger | null;
  ab: AbTableView | null;
  /** Run-dir-relative files the bundle copies next to index.html (certificate JSON, plan, findings). */
  attachments: string[];
}

export interface ReadOptions {
  /** This package's directory: budget/ and runs/g3/ab.json are read from it. */
  packageDirectory: string;
}

/**
 * Attempt states that ended in a failure: certified FAIL and rolled back, declined or unverified by the executor, or an
 * error (those three committed nothing). A passed or interrupted attempt is not a failure; executing, committed and
 * certifying are still in flight (a run killed mid-attempt). The run report and the site's run cards both count these.
 */
export const failedAttemptStates: ReadonlySet<AttemptState> = new Set<AttemptState>(['failed', 'declined', 'unverified', 'error']);

export const failedAttempts = (step: StepRecord): AttemptRecord[] => step.attempts.filter((attempt) => failedAttemptStates.has(attempt.state));

/** The run's failed attempts by state, in the order of failedAttemptStates. */
export function failedAttemptCounts(state: RunState): { state: AttemptState; count: number }[] {
  const attempts = state.steps.flatMap(failedAttempts);
  return [...failedAttemptStates].map((attemptState) => ({ state: attemptState, count: attempts.filter((attempt) => attempt.state === attemptState).length })).filter((entry) => entry.count);
}

const readJson = <T>(file: string): T | null => (fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : null);

/** Every certificate JSON under the run dir's certificates/ and rungs/ (and certificate.json), run-dir-relative, sorted. */
export function certificateFiles(runDirectory: string): string[] {
  const files: string[] = [];
  const walk = (relative: string) => {
    const absolute = path.join(runDirectory, relative);
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.json')) files.push(child);
    }
  };
  walk('certificates');
  walk('rungs');
  if (fs.existsSync(path.join(runDirectory, 'certificate.json'))) files.push('certificate.json');
  return files.sort(compare);
}

/** The parts of plan.json the report reads. */
export interface PlanJson {
  winner?: string;
  candidates?: { label: string; edit?: unknown }[];
  critic?: { critiques?: { review?: string }[]; suggestions?: { accepted?: boolean }[] } | null;
  facts?: { files: FileFact[] };
}

export function planSummary(planFile: PlanFile, planJson: PlanJson | null, recordedCostUsd: number | null): PlanSummary {
  const groups = { module: 0, platform: 0, shared: 0 };
  const bySource: Record<string, number> = {};
  const decisions: PlanSummary['decisions'] = [];
  let files = 0;
  let contested = 0;
  for (const [key, entries] of planFile.groups) {
    groups[key.split('/')[0] as keyof typeof groups]++;
    for (const entry of entries) {
      files++;
      const source = entry.source ?? 'draft';
      bySource[source] = (bySource[source] ?? 0) + 1;
      if (entry.contested) contested++;
      if (source !== 'draft') decisions.push({ path: entry.path, group: key, source, rationale: entry.rationale ?? null });
    }
  }
  return {
    groups, files, bySource, contested,
    decisions: decisions.sort((left, right) => compare(left.path, right.path)),
    editors: planJson ? (planJson.candidates ?? []).filter((candidate) => candidate.edit !== undefined).map((candidate) => candidate.label) : null,
    critic: planJson ? Boolean(planJson.critic) : null,
    criticReview: planJson?.critic?.critiques?.[0]?.review ?? null,
    criticSuggestions: planJson?.critic?.suggestions
      ? { total: planJson.critic.suggestions.length, accepted: planJson.critic.suggestions.filter((suggestion) => suggestion.accepted === true).length }
      : null,
    winner: planJson?.winner ?? null,
    recordedCostUsd,
  };
}

export function readRunReport(runDirectory: string, options: ReadOptions): RunReportData {
  const root = path.resolve(runDirectory);
  const state = readRunState(root);
  const stored = new Map<string, StoredCertificate>();
  const certificate = (file: string | undefined): StoredCertificate | null => {
    if (!file) return null;
    const cached = stored.get(file);
    if (cached) return cached;
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) return null;
    const { certificate: json, view } = readCertificate(absolute);
    const entry = { file, view, summary: certificateSummary(absolute, json) };
    stored.set(file, entry);
    return entry;
  };
  const steps = state.steps.map((step): StepView => ({
    step,
    attempts: step.attempts.map((attempt) => ({ attempt, certificate: certificate(attempt.certificate?.file) })),
  }));
  for (const step of state.steps) certificate(step.certificate?.file);
  const rungs = state.rungs.map((rung): RungView => ({
    rung,
    certificate: certificate(rung.certificate?.file),
    probes: (rung.bisect?.probes ?? []).map((probe) => certificate(probe.certificate)).filter((entry): entry is StoredCertificate => entry !== null),
  }));
  const whole = certificate(state.certificate?.file);
  const referenced = new Set(stored.keys());
  const otherCertificates = certificateFiles(root).filter((file) => !referenced.has(file)).map((file) => certificate(file)!);

  const planDirectory = path.join(root, path.dirname(state.plan.file));
  const planYaml = path.join(root, state.plan.file);
  const planFile = fs.existsSync(planYaml) ? readPlanYaml(fs.readFileSync(planYaml, 'utf8')) : null;
  const planJson = readJson<PlanJson>(path.join(planDirectory, 'plan.json'));
  const heatmap = planFile && planJson?.facts
    ? tableHeatmap(planJson.facts.files, finalGroups(planFile, state.pins.map((pin) => pin.file)), planGroupOrder(planFile))
    : null;

  const ab = readAbDocument(path.join(options.packageDirectory, 'runs', 'g3', 'ab.json'));
  const abTable = ab && abTableFor(ab, state);
  const attachments = [
    ...certificateFiles(root),
    ...['plan/plan.yaml', 'plan/plan.md', 'findings/findings.json', 'findings/findings.md', 'findings/pr-body.md', 'boundaries/report.json']
      .filter((file) => fs.existsSync(path.join(root, file))),
  ].sort(compare);
  return {
    name: path.basename(root),
    state,
    graph: readRunGraph(root, state),
    steps,
    rungs,
    whole,
    otherCertificates,
    findings: readFindingsDocument(path.join(root, 'findings', 'findings.json')),
    plan: planFile ? planSummary(planFile, planJson, state.cost.planRecordedUsd) : null,
    heatmap,
    ledger: readLedger(path.join(options.packageDirectory, 'budget', 'ledger.jsonl'), path.join(options.packageDirectory, 'budget', 'runs.json')),
    ab: abTable ? abTableView(abTable, options.packageDirectory) : null,
    attachments,
  };
}

// What the findings log reads from a run directory (contract C7): run.json, the plan the run executed, the stored
// certificates of commits the branch still has (each step's, each rung's, the whole PR's) and R4's boundary report
// (contract C8) when R4 committed its rules.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Certificate } from '../certificate/types.js';
import { readRunState } from '../orchestrator/run-directory.js';
import type { RunState } from '../orchestrator/types.js';

/** Contract C8: <run-dir>/boundaries/report.json, as R4 writes it. */
export interface BoundaryEdge {
  from: string;
  to: string;
  files: number;
  sample: { from: string; to: string }[];
}

export interface BoundaryReport {
  version: 1;
  packageRoot: string;
  moduleRoot: string;
  /** key: module/<m> | platform/<c> | shared | other:<package-relative dir>. */
  folders: { key: string; path: string; files: number }[];
  edges: BoundaryEdge[];
  /** Strongly connected folder sets of size > 1. */
  sccs: string[][];
  /** The DAG order over module keys the allow-list uses. */
  order: string[];
  backEdges: BoundaryEdge[];
  publicFiles: Record<string, string[]>;
  rules: { name: string; kind: string; severity: string; comment: string }[];
  baseline: { rule: string; count: number }[];
  antiVacuity: { rule: string; fired: boolean; detail: string }[];
}

export interface StoredCertificate {
  /** Run-dir-relative path. */
  file: string;
  /** The step a step certificate belongs to (certificates/<NNN>-...), null for rung and whole-PR certificates. */
  step: number | null;
  certificate: Certificate;
}

export interface RunData {
  root: string;
  state: RunState;
  /** plan/plan.yaml as the run executed it; null when absent. */
  planText: string | null;
  /** The planner's plan.md: plan/plan.md, else the one next to the plan's source file while that file is unchanged. */
  planMarkdown: string | null;
  certificates: StoredCertificate[];
  /** null unless R4 is certified: a failed R4's report describes rules and a baseline the run never committed. */
  boundaries: BoundaryReport | null;
}

const readText = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

function readCertificate(root: string, file: string): Certificate | null {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as Certificate;
    return typeof value === 'object' && value !== null && Array.isArray(value.checks) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The certificates run.json names (each certified step's, each rung's, the whole PR's), kept only when their head tree
 * is a certified step's tree, i.e. the branch still has the commit they certify. Files of failed attempts, bisect
 * probes, steps a bisect rolled back and an R4 the run reset stay on disk, and are left out.
 */
function readCertificates(root: string, state: RunState): StoredCertificate[] {
  const certified = state.steps.filter((step) => step.status === 'certified');
  const trees = new Set(certified.map((step) => step.tree));
  const rungFiles = new Set(state.rungs.flatMap((rung) => (rung.certificate ? [rung.certificate.file] : [])));
  const named = [
    ...certified.flatMap((step) => (step.certificate && !rungFiles.has(step.certificate.file) ? [{ file: step.certificate.file, step: step.index }] : [])),
    ...[...rungFiles].map((file) => ({ file, step: null })),
    ...(state.certificate ? [{ file: state.certificate.file, step: null }] : []),
  ];
  return named.flatMap(({ file, step }) => {
    const certificate = readCertificate(root, file);
    return certificate && trees.has(certificate.headTree) ? [{ file, step, certificate }] : [];
  });
}

function readBoundaries(root: string): BoundaryReport | null {
  const text = readText(path.join(root, 'boundaries', 'report.json'));
  if (text === null) return null;
  const report = JSON.parse(text) as BoundaryReport;
  if (report.version !== 1) throw new Error(`${path.join(root, 'boundaries', 'report.json')}: unknown version ${String(report.version)}`);
  return report;
}

/** plan.md next to the plan file the run copied, when that file still has the bytes the run executed. */
function planMarkdownBesideSource(state: RunState): string | null {
  const source = state.plan.source;
  const text = path.isAbsolute(source) ? readText(source) : null;
  if (text === null || crypto.createHash('sha256').update(text).digest('hex') !== state.plan.sha256) return null;
  return readText(path.join(path.dirname(source), 'plan.md'));
}

export function readRunData(runDirectory: string): RunData {
  const root = path.resolve(runDirectory);
  const state = readRunState(root);
  return {
    root,
    state,
    planText: readText(path.join(root, state.plan.file)),
    planMarkdown: readText(path.join(root, 'plan', 'plan.md')) ?? planMarkdownBesideSource(state),
    certificates: readCertificates(root, state),
    boundaries: state.rungs.some((rung) => rung.id === 'R4' && rung.status === 'certified') ? readBoundaries(root) : null,
  };
}

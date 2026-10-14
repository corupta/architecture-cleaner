// What the findings log reads from a run directory (contract C7): run.json, the plan the run executed, the stored
// certificates (each step's, each rung's, the whole PR's) and R4's boundary report (contract C8) when R4 ran.
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
  boundaries: BoundaryReport | null;
}

const readText = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function jsonFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name).sort(byCodeUnit);
}

function readCertificate(root: string, file: string): Certificate | null {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as Certificate;
    return typeof value === 'object' && value !== null && Array.isArray(value.checks) ? value : null;
  } catch {
    return null;
  }
}

/** Passing step certificates, rung certificates and the whole PR's; failed attempts and bisect probes are left out. */
function readCertificates(root: string): StoredCertificate[] {
  const listed = [
    ...jsonFiles(path.join(root, 'certificates')).map((name) => ({ file: `certificates/${name}`, step: Number(/^(\d+)-/.exec(name)?.[1] ?? Number.NaN) })),
    ...jsonFiles(path.join(root, 'rungs')).map((name) => ({ file: `rungs/${name}`, step: Number.NaN })),
    ...(fs.existsSync(path.join(root, 'certificate.json')) ? [{ file: 'certificate.json', step: Number.NaN }] : []),
  ];
  return listed.flatMap(({ file, step }) => {
    const certificate = readCertificate(root, file);
    return certificate ? [{ file, step: Number.isNaN(step) ? null : step, certificate }] : [];
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
    certificates: readCertificates(root),
    boundaries: readBoundaries(root),
  };
}

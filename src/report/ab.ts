// The A/B (plan §4 "Outputs"): G3's generic agent (opencode + Nemotron 3 Super) next to ac on the same pinned commits.
// The measured numbers are typed into runs/g3/ab.json, each row naming its source doc; the certificate rows are read
// from the certificate files the arms name, so the verdicts and check statuses can't drift from the evidence.
import fs from 'node:fs';
import path from 'node:path';
import type { CheckId, CheckStatus } from '../certificate/types.js';
import { certificateSummary, readCertificate, type CertificateView } from './certificates.js';

export interface AbArm {
  id: string;
  label: string;
  who: string;
  branch: string;
  session: string;
  /** architecture-cleaner's own arm. */
  ours: boolean;
  /** Package-relative path of the arm's certificate JSON. */
  certificate: string | null;
  /** runs/<run> when the arm is a committed run dir with its own report. */
  run?: string;
}

export interface AbRow {
  metric: string;
  /** Arm id → the measured value, as the source states it. */
  values: Record<string, string>;
  source: string;
}

export interface AbTable {
  id: string;
  title: string;
  target: { name: string; origin: string; base: string; packageRoot: string; profile: string | null };
  baseline: string;
  arms: AbArm[];
  rows: AbRow[];
  notes: { text: string; source: string }[];
}

/** runs/g3/ab.json */
export interface AbDocument {
  format: 'ac-ab/1';
  about: string;
  tables: AbTable[];
}

export interface AbCertificate {
  /** Package-relative path. */
  file: string;
  view: CertificateView;
  summary: string;
}

export interface AbCheckRow {
  id: CheckId;
  title: string;
  /** Arm id → status; null when the arm's certificate has no such check (format 1 has no K7) or the arm has none. */
  statuses: Record<string, CheckStatus | null>;
}

export interface AbTableView {
  table: AbTable;
  certificates: Record<string, AbCertificate | null>;
  checkRows: AbCheckRow[];
}

export const checkOrder: CheckId[] = ['K0', 'K1', 'K2', 'K3a', 'K3b', 'K3c', 'K4', 'K6', 'K7', 'K8'];

export function readAbDocument(file: string): AbDocument | null {
  if (!fs.existsSync(file)) return null;
  const document = JSON.parse(fs.readFileSync(file, 'utf8')) as AbDocument;
  if (document.format !== 'ac-ab/1') throw new Error(`${file}: unknown format ${String(document.format)}`);
  for (const table of document.tables) {
    const armIds = new Set(table.arms.map((arm) => arm.id));
    for (const row of table.rows) {
      const unknown = Object.keys(row.values).filter((id) => !armIds.has(id));
      if (unknown.length) throw new Error(`${file}: table ${table.id}, row "${row.metric}" names unknown arms ${unknown.join(', ')}`);
    }
  }
  return document;
}

/** The table's certificates (read from `root`, the package directory) and the check-by-arm status rows. */
export function abTableView(table: AbTable, root: string): AbTableView {
  const certificates: Record<string, AbCertificate | null> = {};
  for (const arm of table.arms) {
    const file = arm.certificate ? path.join(root, arm.certificate) : null;
    if (!file || !fs.existsSync(file)) {
      certificates[arm.id] = null;
      continue;
    }
    const { certificate, view } = readCertificate(file);
    certificates[arm.id] = { file: arm.certificate!, view, summary: certificateSummary(file, certificate) };
  }
  const titles = new Map<CheckId, string>();
  for (const certificate of Object.values(certificates)) for (const check of certificate?.view.checks ?? []) titles.set(check.id, check.title);
  const checkRows = checkOrder.filter((id) => titles.has(id)).map((id): AbCheckRow => ({
    id,
    title: titles.get(id)!,
    statuses: Object.fromEntries(table.arms.map((arm) => [arm.id, certificates[arm.id]?.view.checks.find((check) => check.id === id)?.status ?? null])),
  }));
  return { table, certificates, checkRows };
}

/** The A/B table about the run's own target (same base commit and package root), if ab.json has one. */
export function abTableFor(document: AbDocument, run: { base: string; packageRoot: string }): AbTable | null {
  return document.tables.find((table) => table.target.base === run.base && table.target.packageRoot === run.packageRoot) ?? null;
}

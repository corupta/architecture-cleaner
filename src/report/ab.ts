// The A/B (plan §4 "Outputs"): G3's generic agent (opencode + Nemotron 3 Super) next to ac on the same pinned commits.
// The measured numbers are typed into runs/g3/ab.json, each row naming its source doc; the certificate rows are read
// from the certificate files the arms name, so the verdicts and check statuses can't drift from the evidence. A row
// that measures something the certifier counts too names that count, and each cell shows the certificate's number
// under the gate's: the two are measured differently (the row says why), and the page shows both.
import fs from 'node:fs';
import path from 'node:path';
import type { CheckId, CheckStatus } from '../certificate/types.js';
import { certificateSummary, oracleSummary, readCertificate, type CertificateView } from './certificates.js';
import { count } from './html.js';

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

/** A count the certificates hold: a check (K1, K2, K3b, K4) or one oracle of K8. */
export type CertificateCount = 'K1' | 'K2' | 'K3b' | 'K4' | 'K8 tsc' | 'K8 unit' | 'K8 openapi';

export const certificateCounts: readonly CertificateCount[] = ['K1', 'K2', 'K3b', 'K4', 'K8 tsc', 'K8 unit', 'K8 openapi'];

export interface AbRow {
  metric: string;
  /** Arm id → the measured value, as the source states it. */
  values: Record<string, string>;
  source: string;
  /** The certificate count of the same quantity, shown under each arm's value. */
  certificate?: CertificateCount;
  /** Why the source's number and the certificate's differ, where they do. */
  differs?: string;
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
      if (row.certificate !== undefined && !certificateCounts.includes(row.certificate)) throw new Error(`${file}: table ${table.id}, row "${row.metric}" names unknown certificate count ${String(row.certificate)}`);
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

const metric = (metrics: Record<string, number | string | boolean>, key: string) => (typeof metrics[key] === 'number' ? metrics[key] : 0);

/**
 * The certificate's own count of a quantity, as text: K1's pairing of files, K2's specifier spans, K3b's and K4's
 * summaries, one oracle's part of K8's. Null when the certificate has no such check or oracle.
 */
export function certificateCount(view: CertificateView, kind: CertificateCount): string | null {
  const [id, oracle] = kind.split(' ') as [CheckId, string | undefined];
  const check = view.checks.find((candidate) => candidate.id === id);
  if (!check) return null;
  const number = (key: string) => metric(check.metrics, key);
  switch (id) {
    case 'K1': {
      const copies = number('copies');
      const inert = number('inertAdditions');
      const notes = [copies ? `${count(copies)} of them copies of files that still exist` : '', inert ? `${count(inert)} inert tool configs` : ''].filter(Boolean);
      return `K1: ${count(number('moves'))} moved, ${count(number('editedInPlace'))} edited in place, ${count(number('added'))} added${notes.length ? ` (${notes.join('; ')})` : ''}, ${count(number('deleted'))} deleted`;
    }
    case 'K2':
      if (check.status === 'pass' && number('comparedFiles') === 0 && unpairedFiles(view)) return `K2: no file paired with a base file changed, so there was nothing to compare; ${k2Unpaired(view)}`;
      return `K2: ${check.summary}`;
    case 'K8': {
      const summary = oracleSummary(view, oracle!);
      return summary === null ? null : `K8: ${summary}`;
    }
    default:
      return `${id}: ${check.summary}`;
  }
}

/** The files the certifier could not pair with a base file: K1's added files. */
function unpairedFiles(view: CertificateView): number {
  const k1 = view.checks.find((check) => check.id === 'K1');
  return k1 ? metric(k1.metrics, 'added') : view.pathMap.added;
}

/** Where K2's comparison ends. */
const k2Unpaired = (view: CertificateView) => `K1 counts the ${count(unpairedFiles(view))} added ${unpairedFiles(view) === 1 ? 'file' : 'files'}`;

/** A note for a check row's cell, read from the certificate: why a K2 PASS on a branch with added files says little. */
export function checkNote(view: CertificateView, id: CheckId): string | null {
  const check = view.checks.find((candidate) => candidate.id === id);
  if (id !== 'K2' || !check || check.status !== 'pass' || metric(check.metrics, 'comparedFiles') !== 0 || !unpairedFiles(view)) return null;
  return `nothing to compare: ${k2Unpaired(view)}`;
}

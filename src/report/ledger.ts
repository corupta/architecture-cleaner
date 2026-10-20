// The cost ledger (budget/ledger.jsonl, the gateway's source of truth for spend) summed by budget run, in the order the
// runs first appear: the spike's runs carried over as one line each, the reconciliation with the Nebius bill, then
// every paid call of the product's runs, then the budget runs that have a cap but no spend yet. A reservation without
// an outcome line counts at its estimate, as the gateway counts it (src/gateway/budget.ts readSpent).
import fs from 'node:fs';
import { models } from '../gateway/models.js';

export interface LedgerRun {
  run: string;
  /** Paid calls: a carried line's count, plus one per call line. */
  calls: number;
  costUsd: number;
  /** Reservations with no outcome line (a crash between send and outcome), at their estimate; included in costUsd. */
  openReservationsUsd: number;
  promptTokens: number;
  completionTokens: number;
  /** Model labels of the run's call lines, sorted. */
  models: string[];
  /** Carried-over and reconciliation lines, as written. */
  notes: string[];
  /** The run's cap in budget/runs.json, when it has one. */
  capUsd: number | null;
}

export interface Ledger {
  runs: LedgerRun[];
  totalUsd: number;
  globalCapUsd: number | null;
}

interface LedgerLine {
  runId?: string;
  costUsd?: number;
  callId?: string;
  reservedUsd?: number;
  model?: string;
  carried?: string;
  paidCalls?: number;
  reconciled?: string;
  promptTokens?: number;
  completionTokens?: number;
}

const modelLabels = new Map(Object.values(models).map((model) => [model.id, model.name]));

export const modelLabel = (id: string) => modelLabels.get(id) ?? id;

export function summarizeLedger(ledgerText: string, runsConfig: { globalCap?: number; runs?: Record<string, { cap: number }> } | null): Ledger {
  const byRun = new Map<string, LedgerRun>();
  const runOf = (id: string) => {
    let run = byRun.get(id);
    if (!run) {
      byRun.set(id, (run = {
        run: id, calls: 0, costUsd: 0, openReservationsUsd: 0, promptTokens: 0, completionTokens: 0, models: [], notes: [],
        capUsd: runsConfig?.runs?.[id]?.cap ?? null,
      }));
    }
    return run;
  };
  const reservations = new Map<string, { run: string; usd: number }>();
  const settled = new Set<string>();
  for (const text of ledgerText.split('\n')) {
    if (!text.trim()) continue;
    const line = JSON.parse(text) as LedgerLine;
    const run = runOf(line.runId ?? 'unknown');
    if (typeof line.callId === 'string') {
      if (typeof line.reservedUsd === 'number') reservations.set(line.callId, { run: run.run, usd: line.reservedUsd });
      else settled.add(line.callId);
    }
    if (typeof line.costUsd !== 'number') continue;
    run.costUsd += line.costUsd;
    if (line.carried) {
      run.calls += line.paidCalls ?? 0;
      run.notes.push(`carried over from ${line.carried}: ${line.paidCalls ?? 0} paid calls, $${line.costUsd.toFixed(4)}`);
    } else if (line.reconciled) {
      run.notes.push(`reconciled, $${line.costUsd.toFixed(4)}: ${line.reconciled}`);
    } else {
      run.calls++;
      run.promptTokens += line.promptTokens ?? 0;
      run.completionTokens += line.completionTokens ?? 0;
      if (line.model && !run.models.includes(modelLabel(line.model))) run.models.push(modelLabel(line.model));
    }
  }
  for (const [callId, reservation] of reservations) {
    if (settled.has(callId)) continue;
    const run = runOf(reservation.run);
    run.openReservationsUsd += reservation.usd;
    run.costUsd += reservation.usd;
  }
  // A budget run with a cap and no spend yet still shows, at $0.
  for (const id of Object.keys(runsConfig?.runs ?? {})) runOf(id);
  const runs = [...byRun.values()].map((run) => ({ ...run, models: run.models.sort() }));
  return { runs, totalUsd: runs.reduce((total, run) => total + run.costUsd, 0), globalCapUsd: runsConfig?.globalCap ?? null };
}

export function readLedger(ledgerFile: string, runsFile: string): Ledger | null {
  if (!fs.existsSync(ledgerFile)) return null;
  const runs = fs.existsSync(runsFile) ? (JSON.parse(fs.readFileSync(runsFile, 'utf8')) as { globalCap?: number; runs?: Record<string, { cap: number }> }) : null;
  return summarizeLedger(fs.readFileSync(ledgerFile, 'utf8'), runs);
}

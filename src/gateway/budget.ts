// Hard budget caps (plan §3.6, §5). The append-only ledger is the source of truth for spend: it is re-read for every
// check, so it covers the spike's carried lines, this process's calls and any other process sharing the file. A live
// call reserves its pre-send estimate until its outcome is appended; reservations are process-wide per ledger file.
import fs from 'node:fs';
import path from 'node:path';
import { models } from './models.js';
import type { RequestBody } from './request.js';
import { GatewayError, type ModelKey, type Usage } from './types.js';

export interface RunsConfig {
  globalCap: number;
  runs: Record<string, { cap: number }>;
}

/** A conservative token estimate for request bytes; JSON-heavy prompts run well above 3 bytes per token. */
const bytesPerTokenEstimate = 3;

const reservationsByLedger = new Map<string, Set<{ runId: string; usd: number }>>();

export function readRuns(runsPath: string): RunsConfig {
  if (!fs.existsSync(runsPath)) return { globalCap: 0, runs: {} };
  const config = JSON.parse(fs.readFileSync(runsPath, 'utf8')) as RunsConfig;
  if (typeof config.globalCap !== 'number' || typeof config.runs !== 'object' || config.runs === null) throw new Error(`${runsPath}: needs globalCap and runs`);
  return config;
}

export function readSpent(ledgerPath: string, runId: string): { run: number; global: number } {
  let run = 0;
  let global = 0;
  if (!fs.existsSync(ledgerPath)) return { run, global };
  for (const line of fs.readFileSync(ledgerPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as { runId?: string; costUsd?: number };
    if (typeof entry.costUsd !== 'number') continue;
    global += entry.costUsd;
    if (entry.runId === runId) run += entry.costUsd;
  }
  return { run, global };
}

export function appendLedger(ledgerPath: string, entry: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`);
}

/** Pre-send estimate: body bytes / 3 as input tokens, plus every choice running to max_tokens. */
export function estimateUsd(model: ModelKey, body: RequestBody): number {
  const price = models[model];
  const inputTokens = Buffer.byteLength(JSON.stringify(body), 'utf8') / bytesPerTokenEstimate;
  const outputTokens = body.max_tokens * (body.n ?? 1);
  return (inputTokens * price.inputUsdPerMillion + outputTokens * price.outputUsdPerMillion) / 1e6;
}

export function costUsd(model: ModelKey, usage: Usage): number {
  const price = models[model];
  return (usage.promptTokens * price.inputUsdPerMillion + usage.completionTokens * price.outputUsdPerMillion) / 1e6;
}

/**
 * Reserves the estimate against the run cap and the global cap, or appends a refused line and throws
 * GatewayError('budget'). An unknown run is refused without a ledger line. Returns the release function.
 */
export function reserve(options: { ledgerPath: string; runsPath: string; runId: string; modelId: string; key: string; estimateUsd: number }): () => void {
  const { ledgerPath, runsPath, runId, estimateUsd } = options;
  const config = readRuns(runsPath);
  const run = Object.hasOwn(config.runs, runId) ? config.runs[runId] : undefined;
  if (!run) throw new GatewayError(`gateway refused: run ${runId} is not in ${runsPath}`, 'budget');
  const reservations = reservationsByLedger.get(ledgerPath) ?? new Set();
  reservationsByLedger.set(ledgerPath, reservations);
  const spent = readSpent(ledgerPath, runId);
  let runSpent = spent.run;
  let globalSpent = spent.global;
  for (const reservation of reservations) {
    globalSpent += reservation.usd;
    if (reservation.runId === runId) runSpent += reservation.usd;
  }
  if (runSpent + estimateUsd > run.cap || globalSpent + estimateUsd > config.globalCap) {
    // runSpent and globalSpent include in-flight reservations: they are what the caps were checked against.
    appendLedger(ledgerPath, { ts: new Date().toISOString(), runId, model: options.modelId, key: options.key, refused: true, estimateUsd, runSpent, runCap: run.cap, globalSpent, globalCap: config.globalCap, costUsd: 0 });
    throw new GatewayError(
      `gateway refused: estimate $${estimateUsd.toFixed(4)} would cross a cap (run ${runId} at $${runSpent.toFixed(4)} of $${run.cap}, global $${globalSpent.toFixed(4)} of $${config.globalCap})`,
      'budget',
    );
  }
  const reservation = { runId, usd: estimateUsd };
  reservations.add(reservation);
  return () => reservations.delete(reservation);
}

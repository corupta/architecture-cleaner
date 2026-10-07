// Hard budget caps (plan §3.6, §5). The append-only ledger is the source of truth for spend, re-read for every check.
// Before a live call sends, a reservation line charges its pre-send estimate, appended under an exclusive lock file
// around read-check-append, so the caps hold across every process sharing the ledger. The call's outcome line carries
// the same callId and the real cost; a reservation without one (a call in flight, or a killed process) stays charged.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { models } from './models.js';
import type { RequestBody } from './request.js';
import { GatewayError, type ModelKey, type Usage } from './types.js';

export interface RunsConfig {
  globalCap: number;
  runs: Record<string, { cap: number }>;
}

/** Appends a call's outcome line, tied to its reservation. */
export type Settle = (outcome: Record<string, unknown>) => Promise<void>;

/**
 * Body bytes per prompt token, as an upper bound: a token encodes at least one byte, and the body's JSON keys and
 * escapes outweigh the chat template's few tokens per message. Real prompts run denser than 3 (a recorded critic
 * request: 2.90).
 */
const bytesPerTokenEstimate = 1;
/** A holder keeps the lock for one synchronous read-check-append; a lock this old was left by a process that died. */
const staleLockMilliseconds = 30_000;
const lockPollMilliseconds = 20;

const isCap = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Fails closed: a run without a finite numeric cap would compare against undefined and never be refused. */
export function readRuns(runsPath: string): RunsConfig {
  if (!fs.existsSync(runsPath)) return { globalCap: 0, runs: {} };
  const config = JSON.parse(fs.readFileSync(runsPath, 'utf8')) as { globalCap?: unknown; runs?: unknown };
  if (!isCap(config.globalCap) || typeof config.runs !== 'object' || config.runs === null) throw new Error(`${runsPath}: needs a numeric globalCap and runs`);
  for (const [runId, run] of Object.entries(config.runs)) {
    if (typeof run !== 'object' || run === null || !isCap((run as { cap?: unknown }).cap)) throw new Error(`${runsPath}: run ${runId} needs a numeric cap`);
  }
  return config as RunsConfig;
}

/** Every line's costUsd, plus the estimate of each reservation that has no outcome line yet. */
export function readSpent(ledgerPath: string, runId: string): { run: number; global: number } {
  let run = 0;
  let global = 0;
  if (!fs.existsSync(ledgerPath)) return { run, global };
  const reservations = new Map<string, { runId?: string; usd: number }>();
  const settled = new Set<string>();
  for (const line of fs.readFileSync(ledgerPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as { runId?: string; costUsd?: number; callId?: string; reservedUsd?: number };
    if (typeof entry.callId === 'string') {
      if (typeof entry.reservedUsd === 'number') reservations.set(entry.callId, { runId: entry.runId, usd: entry.reservedUsd });
      else settled.add(entry.callId);
    }
    if (typeof entry.costUsd !== 'number') continue;
    global += entry.costUsd;
    if (entry.runId === runId) run += entry.costUsd;
  }
  for (const [callId, reservation] of reservations) {
    if (settled.has(callId)) continue;
    global += reservation.usd;
    if (reservation.runId === runId) run += reservation.usd;
  }
  return { run, global };
}

export function appendLedger(ledgerPath: string, entry: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`);
}

/** Runs `critical`, which must be synchronous, while holding `<ledger>.lock` (an O_EXCL create). */
async function withLedgerLock<T>(ledgerPath: string, critical: () => T): Promise<T> {
  const lockPath = `${ledgerPath}.lock`;
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  for (;;) {
    let descriptor: number;
    try {
      descriptor = fs.openSync(lockPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const lockedAt = fs.statSync(lockPath, { throwIfNoEntry: false })?.mtimeMs;
      if (lockedAt !== undefined && Date.now() - lockedAt > staleLockMilliseconds) fs.rmSync(lockPath, { force: true });
      else if (lockedAt !== undefined) await pause(lockPollMilliseconds);
      continue;
    }
    try {
      fs.writeSync(descriptor, `${process.pid}\n`);
      return critical();
    } finally {
      fs.closeSync(descriptor);
      fs.rmSync(lockPath, { force: true });
    }
  }
}

/** Pre-send estimate: body bytes as input tokens, plus every choice running to max_tokens. */
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
 * Checks the estimate against the run cap and the global cap and appends a reservation line charging it, or appends a
 * refused line and throws GatewayError('budget'). An unknown run is refused without a ledger line. Returns the function
 * that appends the call's outcome line.
 */
export async function reserve(options: { ledgerPath: string; runsPath: string; runId: string; modelId: string; key: string; estimateUsd: number }): Promise<Settle> {
  const { ledgerPath, runsPath, runId, estimateUsd } = options;
  const config = readRuns(runsPath);
  const run = Object.hasOwn(config.runs, runId) ? config.runs[runId] : undefined;
  if (!run) throw new GatewayError(`gateway refused: run ${runId} is not in ${runsPath}`, 'budget');
  const callId = crypto.randomUUID();
  await withLedgerLock(ledgerPath, () => {
    // Includes every reservation still in flight, from any process: that is what the caps are checked against.
    const { run: runSpent, global: globalSpent } = readSpent(ledgerPath, runId);
    const ts = new Date().toISOString();
    if (runSpent + estimateUsd > run.cap || globalSpent + estimateUsd > config.globalCap) {
      appendLedger(ledgerPath, { ts, runId, model: options.modelId, key: options.key, refused: true, estimateUsd, runSpent, runCap: run.cap, globalSpent, globalCap: config.globalCap, costUsd: 0 });
      throw new GatewayError(
        `gateway refused: estimate $${estimateUsd.toFixed(4)} would cross a cap (run ${runId} at $${runSpent.toFixed(4)} of $${run.cap}, global $${globalSpent.toFixed(4)} of $${config.globalCap})`,
        'budget',
      );
    }
    appendLedger(ledgerPath, { ts, runId, model: options.modelId, key: options.key, callId, reservedUsd: estimateUsd });
  });
  return (outcome) => withLedgerLock(ledgerPath, () => appendLedger(ledgerPath, { ...outcome, callId }));
}

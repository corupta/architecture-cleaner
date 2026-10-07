// The in-process recording LLM gateway (plan §3.6). No listening server: `structured` validates the request rules,
// serves or records a cassette record, holds the budget caps and appends the ledger. Live calls are serialized per
// model (Super and Ultra send no rate-limit headers, so the client paces them) and retried on 429, 5xx and transport
// errors; only the final outcome is recorded, a non-2xx one included, so a replay fails the same way.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendLedger, costUsd, estimateUsd, readSpent, reserve } from './budget.js';
import { appendCassette, type CassetteRecord, loadCassette, recordedHeaders, requestHash } from './cassette.js';
import { finishReasonsOf, readChoices, usageOf } from './completion.js';
import { buildRequestBody, type RequestBody } from './request.js';
import { apiKeyFrom, createSdkTransport, type Transport, type TransportResponse, TransportTimeoutError } from './transport.js';
import { type CassetteMode, type Gateway, GatewayError, type ModelKey, type StructuredRequest, type StructuredResult } from './types.js';

export interface GatewayOptions {
  runId: string;
  mode: CassetteMode;
  cassettePath: string;
  /** Defaults to $AC_LEDGER, else <repo>/budget/ledger.jsonl. */
  ledgerPath?: string;
  /** Defaults to <repo>/budget/runs.json. */
  runsPath?: string;
  /** Defaults to NEBIUS_API_KEY from the environment, else from <repo>/.env; read on the first live call only. */
  apiKey?: string;
  /** Defaults to the openai SDK against Token Factory. */
  transport?: Transport;
  /** Waits between retries; tests pass a recorder. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/** src/gateway and dist/gateway both sit two levels below the repo root. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const maxRetries = 4;
const maxBackoffSeconds = 60;
const isSuccess = (status: number) => status >= 200 && status < 300;
const isTransient = (status: number) => status === 429 || status >= 500;
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One live call in flight per model, process-wide. */
const lanes = new Map<string, Promise<void>>();

function inLane<T>(modelId: string, task: () => Promise<T>): Promise<T> {
  const result = (lanes.get(modelId) ?? Promise.resolve()).then(task);
  lanes.set(modelId, result.then(() => undefined, () => undefined));
  return result;
}

function retryDelayMilliseconds(attempt: number, retryAfter: string | undefined): number {
  let seconds = 2 ** attempt;
  if (retryAfter !== undefined && retryAfter.trim() !== '') {
    const asNumber = Number(retryAfter);
    const asDate = Date.parse(retryAfter);
    if (Number.isFinite(asNumber)) seconds = asNumber;
    else if (!Number.isNaN(asDate)) seconds = (asDate - Date.now()) / 1000;
  }
  return Math.min(Math.max(seconds, 0), maxBackoffSeconds) * 1000;
}

type SendOutcome = { attempts: number; response: TransportResponse } | { attempts: number; error: unknown };

async function sendWithRetries(send: Transport, body: RequestBody, sleep: (milliseconds: number) => Promise<void>): Promise<SendOutcome> {
  for (let attempt = 0; ; attempt++) {
    let response: TransportResponse;
    try {
      response = await send(body);
    } catch (error) {
      if (error instanceof TransportTimeoutError || attempt >= maxRetries) return { attempts: attempt + 1, error };
      await sleep(retryDelayMilliseconds(attempt, undefined));
      continue;
    }
    if (!isTransient(response.status) || attempt >= maxRetries) return { attempts: attempt + 1, response };
    const retryAfter = Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
    await sleep(retryDelayMilliseconds(attempt, retryAfter));
  }
}

function answer<T>(record: CassetteRecord, parse: (value: unknown) => T, replayed: boolean): StructuredResult<T> {
  const { status, body } = record.response;
  if (!isSuccess(status)) throw new GatewayError(`${record.model} answered ${status}: ${body.slice(0, 500)}`, 'http', status);
  const choices = readChoices(body, parse);
  if (!choices) throw new GatewayError(`${record.model} answered ${status} with a body that is not a chat completion: ${body.slice(0, 200)}`, 'http', status);
  return { choices, usage: record.usage, costUsd: record.costUsd, replayed, key: record.key };
}

export function createGateway(options: GatewayOptions): Gateway {
  const { runId, mode, cassettePath } = options;
  const ledgerPath = options.ledgerPath ?? process.env.AC_LEDGER ?? path.join(repoRoot, 'budget/ledger.jsonl');
  const runsPath = options.runsPath ?? path.join(repoRoot, 'budget/runs.json');
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const occurrences = new Map<string, number>();
  let cassette: Map<string, CassetteRecord> | undefined;
  let transport: Promise<Transport> | undefined;
  const liveTransport = () => (transport ??= options.transport ? Promise.resolve(options.transport) : createSdkTransport(options.apiKey ?? apiKeyFrom(repoRoot)));

  async function callLive(model: ModelKey, body: RequestBody, hash: string, occurrence: number): Promise<CassetteRecord> {
    const key = `${hash}:${occurrence}`;
    const estimate = estimateUsd(model, body);
    const release = reserve({ ledgerPath, runsPath, runId, modelId: body.model, key, estimateUsd: estimate });
    try {
      const send = await liveTransport();
      const startedAt = performance.now();
      const outcome = await sendWithRetries(send, body, sleep);
      const entry = { ts: new Date().toISOString(), runId, model: body.model, key, n: body.n ?? 1, attempts: outcome.attempts, estimateUsd: estimate, latencyMs: Math.round(performance.now() - startedAt) };
      if ('error' in outcome) {
        // A timed-out call may have run to completion upstream, so it is charged the estimate to keep the caps hard.
        const timedOut = outcome.error instanceof TransportTimeoutError;
        appendLedger(ledgerPath, { ...entry, status: null, costUsd: timedOut ? estimate : 0, error: errorMessage(outcome.error) });
        throw new GatewayError(`${body.model} call failed in transport after ${outcome.attempts} attempt(s): ${errorMessage(outcome.error)}`, 'transport');
      }
      const { status, headers, bodyText } = outcome.response;
      const usage = usageOf(bodyText);
      // A 2xx answer without usage is charged the full estimate, so the caps stay hard.
      const cost = usage ? costUsd(model, usage) : isSuccess(status) ? estimate : 0;
      const kept = recordedHeaders(headers);
      const rateLimit = Object.fromEntries(Object.entries(kept).filter(([name]) => name.startsWith('x-ratelimit-')));
      appendLedger(ledgerPath, {
        ...entry,
        status,
        promptTokens: usage?.promptTokens ?? null,
        completionTokens: usage?.completionTokens ?? null,
        reasoningTokens: usage?.reasoningTokens ?? null,
        costUsd: cost,
        finishReasons: finishReasonsOf(bodyText),
        rateLimit,
      });
      const record: CassetteRecord = { key, hash, occurrence, runId, model: body.model, request: body, response: { status, headers: kept, body: bodyText }, usage, costUsd: cost };
      appendCassette(cassettePath, record);
      return record;
    } finally {
      release();
    }
  }

  async function structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const body = buildRequestBody(request as StructuredRequest<unknown>);
    const hash = requestHash(body);
    const occurrence = occurrences.get(hash) ?? 0;
    occurrences.set(hash, occurrence + 1);
    if (mode !== 'record') {
      cassette ??= loadCassette(cassettePath);
      const hit = cassette.get(`${hash}:${occurrence}`);
      // auto re-records a transient failure (429/5xx after every retry); replay reproduces it.
      if (hit && !(mode === 'auto' && isTransient(hit.response.status))) return answer(hit, request.parse, true);
      if (mode === 'replay') throw new GatewayError(`replay miss: no ${request.model} record ${hash}:${occurrence} in ${cassettePath}`, 'replay-miss');
    }
    const record = await inLane(body.model, () => callLive(request.model, body, hash, occurrence));
    return answer(record, request.parse, false);
  }

  return {
    structured,
    spent: () => readSpent(ledgerPath, runId),
  };
}

// The in-process recording LLM gateway (plan §3.6). No listening server: `structured` validates the request rules,
// serves or records a cassette record, holds the budget caps and appends the ledger. Live calls are serialized per
// model (Super and Ultra send no rate-limit headers, so the client paces them) and retried on 429, 5xx and transport
// errors, except those that may have been billed (a timeout, an answer lost after its headers, a gateway timeout); only
// the final outcome is recorded, a non-2xx one included, so a replay fails the same way.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { costUsd, estimateUsd, readSpent, reserve } from './budget.js';
import { appendCassette, type CassetteRecord, loadCassette, recordedHeaders, requestHash } from './cassette.js';
import { finishReasonsOf, readChoices, usageOf } from './completion.js';
import { buildRequestBody, type RequestBody } from './request.js';
import { apiKeyFrom, createSdkTransport, PossiblyBilledError, type Transport, type TransportResponse } from './transport.js';
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
/** Retried, and re-recorded by auto. */
const isTransient = (status: number) => status === 429 || status >= 500;
/** An intermediary gave up waiting; the generation may have run on and been billed, so it is never resent. */
const isGatewayTimeout = (status: number) => status === 504 || status === 524;
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
      if (error instanceof PossiblyBilledError || attempt >= maxRetries) return { attempts: attempt + 1, error };
      await sleep(retryDelayMilliseconds(attempt, undefined));
      continue;
    }
    if (!isTransient(response.status) || isGatewayTimeout(response.status) || attempt >= maxRetries) return { attempts: attempt + 1, response };
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
    const settle = await reserve({ ledgerPath, runsPath, runId, modelId: body.model, key, estimateUsd: estimate });
    let send: Transport;
    try {
      send = await liveTransport();
    } catch (error) {
      // Nothing was sent, so the reservation settles at $0.
      await settle({ ts: new Date().toISOString(), runId, model: body.model, key, n: body.n ?? 1, attempts: 0, estimateUsd: estimate, status: null, costUsd: 0, error: errorMessage(error) });
      throw error;
    }
    // From here an unexpected throw leaves the reservation charged at the estimate, as for a call that may have run.
    const startedAt = performance.now();
    const outcome = await sendWithRetries(send, body, sleep);
    const entry = { ts: new Date().toISOString(), runId, model: body.model, key, n: body.n ?? 1, attempts: outcome.attempts, estimateUsd: estimate, latencyMs: Math.round(performance.now() - startedAt) };
    if ('error' in outcome) {
      // A call that may have run upstream (a timeout, a lost answer) is charged the estimate to keep the caps hard.
      const possiblyBilled = outcome.error instanceof PossiblyBilledError;
      await settle({ ...entry, status: null, costUsd: possiblyBilled ? estimate : 0, error: errorMessage(outcome.error) });
      throw new GatewayError(`${body.model} call failed in transport after ${outcome.attempts} attempt(s): ${errorMessage(outcome.error)}`, 'transport');
    }
    const { status, headers, bodyText } = outcome.response;
    const usage = usageOf(bodyText);
    // A 2xx answer or a gateway timeout without usage is charged the full estimate, so the caps stay hard.
    const cost = usage ? costUsd(model, usage) : isSuccess(status) || isGatewayTimeout(status) ? estimate : 0;
    const kept = recordedHeaders(headers);
    const rateLimit = Object.fromEntries(Object.entries(kept).filter(([name]) => name.startsWith('x-ratelimit-')));
    await settle({
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
  }

  async function structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const body = buildRequestBody(request as StructuredRequest<unknown>);
    const hash = requestHash(body);
    const occurrence = occurrences.get(hash) ?? 0;
    occurrences.set(hash, occurrence + 1);
    if (mode !== 'record') {
      cassette ??= loadCassette(cassettePath);
      const hit = cassette.get(`${hash}:${occurrence}`);
      // auto re-records a transient failure (a final 429 or 5xx); replay reproduces it.
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

// How a live call leaves the process. The default transport is the openai SDK pointed at Token Factory; the gateway
// creates it on the first live call, so replays need neither the SDK, the key nor the network. Tests inject a fake.
// Whether a failed call may have been billed turns on one fact: was the whole request written before the connection
// failed? undici reports it per request (its dispatch handler's onRequestSent), so DNS, refused connects and TLS
// failures stay retryable and free, and a connection lost after the send is charged and never resent. A streamed
// request (above 64k max_tokens, S8c) is answered with headers at once and then its events: once the headers came,
// anything short of a complete stream (a break, an idle stall, the total cap, no [DONE], no usage or a choice that never
// finished) is charged. A server that answers such a request whole, as JSON, is read as a non-streamed answer.
import fs from 'node:fs';
import path from 'node:path';
import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import type { Dispatcher } from 'undici';
import type { RequestBody } from './request.js';
import { createCompletionAssembler, createEventReader, formatDuration, type CompletionAssembler } from './stream.js';

export interface TransportResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string>;
  bodyText: string;
  /** The body was assembled from a stream's events (stream.ts), not read as sent. */
  streamed?: true;
}

/** Sends one chat completion and resolves with the raw answer, whatever its status; rejects only when no answer came. */
export type Transport = (body: RequestBody) => Promise<TransportResponse>;

/** No answer arrived, yet the server may have run and billed the call: it outlived the timeout, the connection dropped
 * after the whole request was sent, the answer was lost after its headers, or a stream ended incomplete. The gateway
 * never retries it and charges its estimate. */
export class PossiblyBilledError extends Error {}

/** Per request: set once the whole request (headers and body) has been written to the socket. */
export interface RequestProgress {
  requestSent: boolean;
}

/** fetch, plus the progress of the one request it makes; a plain fetch (tests) never reports the send. */
export type SendRequest = (input: string | URL | Request, init: RequestInit | undefined, progress: RequestProgress) => Promise<Response>;

export const tokenFactoryBaseUrl = 'https://api.tokenfactory.nebius.com/v1/';
/** Ultra with n=3 and 64k max_tokens, not streamed, can run many minutes. */
export const requestTimeoutMilliseconds = 20 * 60_000;
/** A floor on generation speed, well under the catalog's (Super VL 282 tokens/s), for a request's own timeout. */
const slowestTokensPerSecond = 100;
/** Room for Super VL reasoning toward a 512k cap at the floor speed (85 min, plus 5), with a margin (S8c). */
const longestRequestTimeoutMilliseconds = 120 * 60_000;

/**
 * A request's timeout: 20 min, or longer when its max_tokens could take longer at the slowest speed we allow (Super VL
 * reasoning toward a 512k cap, S8c: about 90 min), plus 5 min, and at most 2 h. A timeout is never resent and is
 * charged, so it must not cut off an answer that is still coming. Every request above 64k streams, so for those it is
 * the cap on the whole stream.
 */
export function requestTimeoutFor(body: { max_tokens?: number }): number {
  const generation = Math.ceil((body.max_tokens ?? 0) / slowestTokensPerSecond) * 1000 + 5 * 60_000;
  return Math.min(longestRequestTimeoutMilliseconds, Math.max(requestTimeoutMilliseconds, generation));
}

/** How a streamed call is watched. */
export interface StreamSettings {
  /**
   * No byte for this long ends a stream, before its headers too. 11 min by default: the probe's 504 came after exactly
   * 600 s, when Token Factory's nginx gives up on an upstream that has sent nothing (proxy_read_timeout counts between
   * reads, so a flowing stream never meets it), and Super VL's first bytes may wait on the queue and prompt processing.
   * A stream silent for longer than nginx allows is dead already; one more minute keeps us from ever giving up before
   * it does, and catches a connection that went silent without closing.
   */
  idleTimeoutMilliseconds: number;
  /** A progress line this often, so a call of half an hour is visibly alive. */
  progressIntervalMilliseconds: number;
  /** Where progress lines go (stderr); nothing of them reaches the cassette. */
  log: (line: string) => void;
  /** The cap on the whole call, headers included. */
  timeoutFor: (body: { max_tokens?: number }) => number;
}

export const defaultStreamSettings: StreamSettings = {
  idleTimeoutMilliseconds: 11 * 60_000,
  progressIntervalMilliseconds: 60_000,
  log: (line) => process.stderr.write(`${line}\n`),
  timeoutFor: requestTimeoutFor,
};

export function readEnvFile(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
  }
  return values;
}

/** NEBIUS_API_KEY from the environment, else from the repo's gitignored .env. */
export function apiKeyFrom(repoRoot: string): string {
  const envFile = path.join(repoRoot, '.env');
  const key = process.env.NEBIUS_API_KEY || readEnvFile(envFile).NEBIUS_API_KEY;
  if (!key) throw new Error(`NEBIUS_API_KEY is in neither the environment nor ${envFile}`);
  return key;
}

const headerRecord = (headers: Headers) => Object.fromEntries(headers.entries());
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** undici's connect timeout (TCP and TLS) or the OS's: the request was never sent. */
function isConnectTimeout(error: unknown): boolean {
  let current = error;
  while (current instanceof Error) {
    const { code, syscall } = current as NodeJS.ErrnoException;
    if (code === 'UND_ERR_CONNECT_TIMEOUT' || (code === 'ETIMEDOUT' && syscall === 'connect')) return true;
    if (current instanceof AggregateError && current.errors.some(isConnectTimeout)) return true;
    current = current.cause;
  }
  return false;
}

/** The innermost cause's message: the SDK says "Connection error.", undici's cause says what happened. */
function rootMessage(error: unknown): string {
  let current = error;
  while (current instanceof Error && current.cause instanceof Error) current = current.cause;
  return errorMessage(current);
}

/** undici calls a dispatch handler's (legacy) onRequestSent once the whole request is written; every other member of
 * fetch's handler is forwarded untouched, bound to the handler itself. */
function reportingRequestSent(handler: Dispatcher.DispatchHandler, progress: RequestProgress): Dispatcher.DispatchHandler {
  return new Proxy(handler, {
    get(target, property) {
      if (property === 'onRequestSent') {
        return () => {
          progress.requestSent = true;
          return (target as { onRequestSent?: () => void }).onRequestSent?.();
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * undici's fetch with header and body timeouts past the request timeout (a non-streamed completion sends its headers
 * only when it is done, and undici's default headersTimeout is 300 s), reporting when each request was fully sent.
 * Every call gets a fresh connection, so a connection lost after the send is never a server closing an idle reused
 * socket just as the request went out (charged, though nothing ran). undici's fetch already closes the socket after a
 * POST with a streamed body; pipelining 0 (no keep-alive) states it rather than relying on that.
 */
async function patientFetch(): Promise<SendRequest> {
  const { Agent, Dispatcher: DispatcherBase, fetch: undiciFetch } = await import('undici');
  const patience = longestRequestTimeoutMilliseconds + 60_000;
  const agent = new Agent({ headersTimeout: patience, bodyTimeout: patience, pipelining: 0 });
  class ProgressDispatcher extends DispatcherBase {
    readonly #progress: RequestProgress;

    constructor(progress: RequestProgress) {
      super();
      this.#progress = progress;
    }

    override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
      return agent.dispatch(options, reportingRequestSent(handler, this.#progress));
    }
  }
  return async (input, init, progress) =>
    (await undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher: new ProgressDispatcher(progress) })) as unknown as Response;
}

/**
 * Reads a streamed answer's events into `assembler` until `[DONE]`, and returns the assembled body. Throws when the
 * stream breaks, stays silent for the idle timeout, outlives the call's cap, or ends without `[DONE]`, without usage or
 * with a choice that never got its finish_reason.
 */
async function readEvents(response: Response, assembler: CompletionAssembler, caps: { idleMilliseconds: number; totalMilliseconds: number; remainingMilliseconds: number }): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('the answer has no body');
  const events = createEventReader();
  const decoder = new TextDecoder();
  let stalled: string | undefined;
  const stallAfter = (milliseconds: number, reason: string) =>
    setTimeout(() => {
      stalled = reason;
      reader.cancel().catch(() => undefined);
    }, Math.max(0, milliseconds));
  const idleReason = `no byte for ${formatDuration(caps.idleMilliseconds)}`;
  const total = stallAfter(caps.remainingMilliseconds, `no complete answer within ${formatDuration(caps.totalMilliseconds)}`);
  let idle = stallAfter(caps.idleMilliseconds, idleReason);
  const add = (datas: string[]) => {
    for (const data of datas) if (!assembler.done) assembler.add(data);
  };
  try {
    while (!assembler.done) {
      const chunk = await reader.read().catch((error: unknown) => {
        throw new Error(stalled ?? errorMessage(error));
      });
      if (stalled) throw new Error(stalled);
      if (chunk.done) {
        add(events.feed(decoder.decode()));
        add(events.end());
        break;
      }
      clearTimeout(idle);
      idle = stallAfter(caps.idleMilliseconds, idleReason);
      add(events.feed(decoder.decode(chunk.value, { stream: true })));
    }
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
    // After [DONE] only the connection's end is left; before it, this drops the connection.
    reader.cancel().catch(() => undefined);
  }
  if (!assembler.done) throw new Error('the stream ended without [DONE]');
  if (!assembler.usage) throw new Error('the stream ended without usage');
  // A non-streamed answer always gives every choice its finish_reason; one missing means the choice was cut off.
  const unfinished = assembler.unfinished;
  if (unfinished.length) throw new Error(`${unfinished.length === 1 ? 'choice' : 'choices'} ${unfinished.map((index) => `#${index}`).join(', ')} never finished`);
  return assembler.body();
}

/** A streamed call from its send to its end: the headers' timeout, a progress line every interval, and the reading of
 * its events, where every failure is possibly billed (the headers came, so the generation started), or of the whole
 * JSON body a server that ignored `stream` answered. */
function startStreamedCall(body: RequestBody, settings: StreamSettings) {
  const startedAt = performance.now();
  const elapsed = () => performance.now() - startedAt;
  const assembler = createCompletionAssembler(body.n ?? 1);
  const totalMilliseconds = settings.timeoutFor(body);
  const report = (what: string, after = '') => settings.log(`[gateway] ${body.model} ${what} ${formatDuration(elapsed())}: ${assembler.progress()}${after}`);
  const progress = setInterval(() => report('streaming for'), settings.progressIntervalMilliseconds);
  progress.unref();
  return {
    headersTimeout: Math.min(settings.idleTimeoutMilliseconds, totalMilliseconds),
    stop: () => clearInterval(progress),
    async read(response: Response): Promise<TransportResponse> {
      // Asked for a stream, answered whole (a server that ignores `stream`): the answer as sent, read, recorded and
      // charged as a non-streamed one. Any other type is read as events, so a mislabelled stream is never kept raw.
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.split(';')[0]!.trim().toLowerCase() === 'application/json') {
        const answer = await readWholeBody(response);
        settings.log(`[gateway] ${body.model} answered whole in ${formatDuration(elapsed())}, not as a stream (${contentType})`);
        return answer;
      }
      try {
        const bodyText = await readEvents(response, assembler, { idleMilliseconds: settings.idleTimeoutMilliseconds, totalMilliseconds, remainingMilliseconds: totalMilliseconds - elapsed() });
        // The rough count beside the true one: usage counts every choice's tokens together.
        report('streamed its answer in', `; usage: ${String(assembler.usage?.completion_tokens)} completion tokens`);
        return { status: response.status, headers: headerRecord(response.headers), bodyText, streamed: true };
      } catch (error) {
        throw new PossiblyBilledError(`${response.status} stream lost after ${formatDuration(elapsed())} (${assembler.progress()}): ${errorMessage(error)}`);
      }
    },
  };
}

/** Headers came, so the completion ran (a non-streamed one sends them only when done): a lost body is a lost billed answer. */
async function readWholeBody(response: Response): Promise<TransportResponse> {
  try {
    return { status: response.status, headers: headerRecord(response.headers), bodyText: await response.text() };
  } catch (error) {
    throw new PossiblyBilledError(`${response.status} answer lost while reading its body: ${errorMessage(error)}`);
  }
}

/** `send` replaces the network (tests); by default requests go through undici with long timeouts. `baseUrl` points the
 * SDK elsewhere (tests: a local server). `streamSettings` changes how a streamed call is watched (tests: shorter). */
export async function createSdkTransport(apiKey: string, send?: SendRequest, baseUrl = tokenFactoryBaseUrl, streamSettings: Partial<StreamSettings> = {}): Promise<Transport> {
  const { default: OpenAI, APIConnectionTimeoutError } = await import('openai');
  const sendRequest = send ?? (await patientFetch());
  const client = new OpenAI({ apiKey, baseURL: baseUrl, maxRetries: 0, timeout: requestTimeoutMilliseconds, organization: null, project: null });
  const settings: StreamSettings = { ...defaultStreamSettings, ...streamSettings };

  /** One send: the answer's headers within `timeout`, then `readBody`; a non-2xx answer comes back with its exact body. */
  async function sendOnce(body: RequestBody, timeout: number, readBody: (response: Response) => Promise<TransportResponse>): Promise<TransportResponse> {
    // The SDK throws on a non-2xx answer after consuming its body; keep the exact text so the cassette can hold it.
    let failure: TransportResponse | undefined;
    let connectTimedOut = false;
    const progress: RequestProgress = { requestSent: false };
    const fetchKeepingFailures = async (input: string | URL | Request, init?: RequestInit) => {
      let response: Response;
      try {
        response = await sendRequest(input, init, progress);
      } catch (error) {
        connectTimedOut = isConnectTimeout(error);
        throw error;
      }
      if (!response.ok) failure = { status: response.status, headers: headerRecord(response.headers), bodyText: await response.clone().text() };
      return response;
    };
    let response: Response;
    try {
      const params = body as unknown as ChatCompletionCreateParams;
      response = await client.withOptions({ fetch: fetchKeepingFailures }).chat.completions.create(params, { timeout }).asResponse();
    } catch (error) {
      if (failure) return failure;
      // The SDK reports a connect timeout as a timeout too, but nothing was sent then: an ordinary, retryable failure.
      if (connectTimedOut) throw new Error('connect timed out, nothing was sent', { cause: error });
      if (error instanceof APIConnectionTimeoutError) throw new PossiblyBilledError(`no answer within ${Math.round(timeout / 60_000)} min`);
      // The server had the whole request when the connection dropped, so the generation may have run (and been billed).
      if (progress.requestSent) throw new PossiblyBilledError(`connection lost after the request was sent, before the answer's headers: ${rootMessage(error)}`);
      // DNS, a refused connect, TLS: nothing reached the server.
      throw error;
    }
    return readBody(response);
  }

  return async (body) => {
    if (body.stream !== true) return sendOnce(body, requestTimeoutFor(body), readWholeBody);
    const call = startStreamedCall(body, settings);
    try {
      return await sendOnce(body, call.headersTimeout, (response) => call.read(response));
    } finally {
      call.stop();
    }
  };
}

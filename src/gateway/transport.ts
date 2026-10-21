// How a live call leaves the process. The default transport is the openai SDK pointed at Token Factory; the gateway
// creates it on the first live call, so replays need neither the SDK, the key nor the network. Tests inject a fake.
// Whether a failed call may have been billed turns on one fact: was the whole request written before the connection
// failed? undici reports it per request (its dispatch handler's onRequestSent), so DNS, refused connects and TLS
// failures stay retryable and free, and a connection lost after the send is charged and never resent.
import fs from 'node:fs';
import path from 'node:path';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type { Dispatcher } from 'undici';
import type { RequestBody } from './request.js';

export interface TransportResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string>;
  bodyText: string;
}

/** Sends one chat completion and resolves with the raw answer, whatever its status; rejects only when no answer came. */
export type Transport = (body: RequestBody) => Promise<TransportResponse>;

/** No answer arrived, yet the server may have run and billed the call: it outlived the timeout, the connection dropped
 * after the whole request was sent, or the answer was lost after its headers. The gateway never retries it and charges
 * its estimate. */
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
const longestRequestTimeoutMilliseconds = 90 * 60_000;

/**
 * A request's timeout: 20 min, or longer when its max_tokens could take longer at the slowest speed we allow (Super VL
 * reasoning toward a 256k cap, S8c), plus 5 min. A timeout is never resent and is charged, so it must not cut off an
 * answer that is still coming.
 */
export function requestTimeoutFor(body: { max_tokens?: number }): number {
  const generation = Math.ceil((body.max_tokens ?? 0) / slowestTokensPerSecond) * 1000 + 5 * 60_000;
  return Math.min(longestRequestTimeoutMilliseconds, Math.max(requestTimeoutMilliseconds, generation));
}

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

/** `send` replaces the network (tests); by default requests go through undici with long timeouts. `baseUrl` points the
 * SDK elsewhere (tests: a local server). */
export async function createSdkTransport(apiKey: string, send?: SendRequest, baseUrl = tokenFactoryBaseUrl): Promise<Transport> {
  const { default: OpenAI, APIConnectionTimeoutError } = await import('openai');
  const sendRequest = send ?? (await patientFetch());
  const client = new OpenAI({ apiKey, baseURL: baseUrl, maxRetries: 0, timeout: requestTimeoutMilliseconds, organization: null, project: null });
  return async (body) => {
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
    const timeout = requestTimeoutFor(body as { max_tokens?: number });
    try {
      const params = body as unknown as ChatCompletionCreateParamsNonStreaming;
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
    // Headers came, so the completion ran (a non-streamed one sends them only when done): a lost body is a lost billed answer.
    try {
      return { status: response.status, headers: headerRecord(response.headers), bodyText: await response.text() };
    } catch (error) {
      throw new PossiblyBilledError(`${response.status} answer lost while reading its body: ${errorMessage(error)}`);
    }
  };
}

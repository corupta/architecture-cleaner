// How a live call leaves the process. The default transport is the openai SDK pointed at Token Factory; the gateway
// creates it on the first live call, so replays need neither the SDK, the key nor the network. Tests inject a fake.
import fs from 'node:fs';
import path from 'node:path';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type { RequestBody } from './request.js';

export interface TransportResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string>;
  bodyText: string;
}

/** Sends one chat completion and resolves with the raw answer, whatever its status; rejects only when no answer came. */
export type Transport = (body: RequestBody) => Promise<TransportResponse>;

/** The call outlived the timeout. The server may still have run and billed it, so the gateway never retries it. */
export class TransportTimeoutError extends Error {}

export const tokenFactoryBaseUrl = 'https://api.tokenfactory.nebius.com/v1/';
/** Ultra with n=3 and 64k max_tokens, not streamed, can run many minutes. */
export const requestTimeoutMilliseconds = 20 * 60_000;

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

/** undici's fetch with header and body timeouts past the request timeout: a non-streamed completion sends its headers
 * only when it is done, and undici's default headersTimeout is 300 s. */
async function patientFetch(): Promise<typeof fetch> {
  const { Agent, fetch: undiciFetch } = await import('undici');
  const patience = requestTimeoutMilliseconds + 60_000;
  const dispatcher = new Agent({ headersTimeout: patience, bodyTimeout: patience });
  return async (input, init) =>
    (await undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher })) as unknown as Response;
}

/** `send` replaces the network (tests); by default requests go through undici with long timeouts. */
export async function createSdkTransport(apiKey: string, send?: typeof fetch): Promise<Transport> {
  const { default: OpenAI, APIConnectionTimeoutError } = await import('openai');
  const sendRequest = send ?? (await patientFetch());
  const client = new OpenAI({ apiKey, baseURL: tokenFactoryBaseUrl, maxRetries: 0, timeout: requestTimeoutMilliseconds, organization: null, project: null });
  return async (body) => {
    // The SDK throws on a non-2xx answer after consuming its body; keep the exact text so the cassette can hold it.
    let failure: TransportResponse | undefined;
    const fetchKeepingFailures = async (input: string | URL | Request, init?: RequestInit) => {
      const response = await sendRequest(input, init);
      if (!response.ok) failure = { status: response.status, headers: headerRecord(response.headers), bodyText: await response.clone().text() };
      return response;
    };
    try {
      const params = body as unknown as ChatCompletionCreateParamsNonStreaming;
      const response = await client.withOptions({ fetch: fetchKeepingFailures }).chat.completions.create(params).asResponse();
      return { status: response.status, headers: headerRecord(response.headers), bodyText: await response.text() };
    } catch (error) {
      if (failure) return failure;
      if (error instanceof APIConnectionTimeoutError) throw new TransportTimeoutError(`no answer within ${requestTimeoutMilliseconds / 60_000} min`);
      throw error;
    }
  };
}

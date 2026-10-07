// The default transport: the real openai SDK over an injected fetch, so nothing leaves the process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRequestBody } from '../../src/gateway/request.js';
import { apiKeyFrom, createSdkTransport, TransportTimeoutError } from '../../src/gateway/transport.js';
import type { StructuredRequest } from '../../src/gateway/types.js';

const body = buildRequestBody({
  model: 'lightning',
  messages: [{ role: 'user', content: 'Answer.' }],
  schemaName: 'answer',
  schema: { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'], additionalProperties: false },
  parse: (value) => value,
  maxTokens: 64,
  n: 2,
  templateKwargs: { enable_thinking: true },
} satisfies StructuredRequest<unknown>);

interface FetchCall {
  url: string;
  init: RequestInit;
}

let answer: () => Promise<Response> = async () => {
  throw new Error('no answer stubbed');
};
const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  calls.push({ url: input instanceof Request ? input.url : String(input), init });
  return answer();
}) as typeof fetch;
let calls: FetchCall[] = [];

function stubFetch(next: () => Promise<Response>): FetchCall[] {
  answer = next;
  calls = [];
  return calls;
}

describe('SDK transport', () => {
  it('posts the exact body to Token Factory and returns the raw text and headers', async () => {
    const bodyText = '{"id":"x",  "choices":[],\n "usage":null}';
    const calls = stubFetch(async () => new Response(bodyText, { status: 200, headers: { 'content-type': 'application/json', 'X-RateLimit-Remaining-Requests': '599' } }));
    const response = await (await createSdkTransport('test-key', fakeFetch))(body);
    expect(response.status).toBe(200);
    expect(response.bodyText).toBe(bodyText);
    expect(response.headers['x-ratelimit-remaining-requests']).toBe('599');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.tokenfactory.nebius.com/v1/chat/completions');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(body);
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer test-key');
  });

  it('returns a non-2xx answer with its exact body instead of throwing, and never retries it', async () => {
    const errorBody = '{"detail": "n must be 1 when using greedy sampling"}';
    const calls = stubFetch(async () => new Response(errorBody, { status: 400, headers: { 'x-request-id': 'req-9' } }));
    const send = await createSdkTransport('test-key', fakeFetch);
    expect(await send(body)).toEqual({ status: 400, headers: expect.objectContaining({ 'x-request-id': 'req-9' }), bodyText: errorBody });
    const failing = stubFetch(async () => new Response('upstream exploded', { status: 503 }));
    expect(await send(body)).toMatchObject({ status: 503, bodyText: 'upstream exploded' });
    expect(calls).toHaveLength(1);
    expect(failing).toHaveLength(1);
  });

  it('reports a timeout as TransportTimeoutError and other failures as they are', async () => {
    const send = await createSdkTransport('test-key', fakeFetch);
    stubFetch(async () => {
      throw new TypeError('fetch failed', { cause: new Error('Connect Timeout Error') });
    });
    await expect(send(body)).rejects.toBeInstanceOf(TransportTimeoutError);
    stubFetch(async () => {
      throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
    });
    const error = await send(body).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TransportTimeoutError);
  });
});

describe('API key', () => {
  it('comes from the environment first, else from the .env file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-env-'));
    const savedKey = process.env.NEBIUS_API_KEY;
    try {
      fs.writeFileSync(path.join(root, '.env'), 'OTHER=1\nNEBIUS_API_KEY="from-file"\n');
      delete process.env.NEBIUS_API_KEY;
      expect(apiKeyFrom(root)).toBe('from-file');
      process.env.NEBIUS_API_KEY = 'from-env';
      expect(apiKeyFrom(root)).toBe('from-env');
      delete process.env.NEBIUS_API_KEY;
      fs.rmSync(path.join(root, '.env'));
      expect(() => apiKeyFrom(root)).toThrow(/NEBIUS_API_KEY/);
    } finally {
      if (savedKey === undefined) delete process.env.NEBIUS_API_KEY;
      else process.env.NEBIUS_API_KEY = savedKey;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

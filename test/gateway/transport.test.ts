// The default transport: the real openai SDK over an injected fetch, or over undici against a local server, so nothing
// leaves the machine.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { errors as undiciErrors } from 'undici';
import { describe, expect, it } from 'vitest';
import { createGateway } from '../../src/gateway/gateway.js';
import { buildRequestBody } from '../../src/gateway/request.js';
import { apiKeyFrom, createSdkTransport, PossiblyBilledError, type SendRequest, type Transport } from '../../src/gateway/transport.js';
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

  const failureOf = (promise: Promise<unknown>) => promise.then(
    () => undefined,
    (failure: unknown) => failure,
  );

  it('reports a timeout after the request was sent as possibly billed, and other failures as they are', async () => {
    const send = await createSdkTransport('test-key', fakeFetch);
    stubFetch(async () => {
      throw new TypeError('fetch failed', { cause: new undiciErrors.HeadersTimeoutError() });
    });
    await expect(send(body)).rejects.toBeInstanceOf(PossiblyBilledError);
    stubFetch(async () => {
      throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
    });
    const error = await failureOf(send(body));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PossiblyBilledError);
  });

  it('reports a connect timeout, which sent nothing, as an ordinary failure, though the SDK calls it a timeout', async () => {
    const send = await createSdkTransport('test-key', fakeFetch);
    const connectTimeouts = [new undiciErrors.ConnectTimeoutError(), Object.assign(new Error('connect ETIMEDOUT 10.0.0.1:443'), { code: 'ETIMEDOUT', syscall: 'connect' })];
    for (const cause of connectTimeouts) {
      stubFetch(async () => {
        throw new TypeError('fetch failed', { cause });
      });
      const error = await failureOf(send(body));
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(PossiblyBilledError);
      expect((error as Error).message).toBe('connect timed out, nothing was sent');
    }
  });

  it('reports a connection lost after the fetch reported the whole request sent as possibly billed', async () => {
    const sentThenLost: SendRequest = async (_input, _init, progress) => {
      progress.requestSent = true;
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
    };
    const error = await failureOf((await createSdkTransport('test-key', sentThenLost))(body));
    expect(error).toBeInstanceOf(PossiblyBilledError);
    expect((error as Error).message).toBe("connection lost after the request was sent, before the answer's headers: other side closed");
  });

  it('reports a 2xx answer whose body is lost as possibly billed', async () => {
    const send = await createSdkTransport('test-key', fakeFetch);
    stubFetch(async () => lostBody());
    const error = await failureOf(send(body));
    expect(error).toBeInstanceOf(PossiblyBilledError);
    expect((error as Error).message).toBe('200 answer lost while reading its body: terminated');
  });
});

/** A 200 whose connection drops mid-body, as undici reports a socket closed after the headers. */
const lostBody = () =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":"x","choices":['));
        controller.error(new TypeError('terminated'));
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

/** A local HTTP server; `onRequest` sees each request after its whole body arrived. */
async function localServer(onRequest: (request: http.IncomingMessage, body: string, response: http.ServerResponse) => void) {
  const bodies: string[] = [];
  let connections = 0;
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      bodies.push(text);
      onRequest(request, text, response);
    });
  });
  server.on('connection', () => connections++);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const close = () => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
  return { port, bodies, connections: () => connections, close };
}

/** A port on 127.0.0.1 that refuses connections: bound once, then closed. */
async function refusingPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('SDK transport over undici, against a local server', () => {
  const failureOf = (promise: Promise<unknown>) => promise.then(() => undefined, (failure: unknown) => failure);

  it('reports a connection dropped after the server read the whole request, before any header, as possibly billed', async () => {
    const server = await localServer((request) => request.socket.destroy());
    try {
      const send = await createSdkTransport('test-key', undefined, `http://127.0.0.1:${server.port}/v1/`);
      const error = await failureOf(send(body));
      expect(error).toBeInstanceOf(PossiblyBilledError);
      expect((error as Error).message).toMatch(/^connection lost after the request was sent, before the answer's headers: /);
      expect(server.bodies.map((text) => JSON.parse(text))).toEqual([body]);
    } finally {
      await server.close();
    }
  });

  it('reports a refused connection, which sent nothing, as an ordinary failure', async () => {
    const send = await createSdkTransport('test-key', undefined, `http://127.0.0.1:${await refusingPort()}/v1/`);
    const error = await failureOf(send(body));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PossiblyBilledError);
  });

  it('reports a failed TLS handshake, which sent nothing, as an ordinary failure', async () => {
    const server = await localServer((_request, _text, response) => response.end('{}'));
    try {
      const send = await createSdkTransport('test-key', undefined, `https://127.0.0.1:${server.port}/v1/`);
      const error = await failureOf(send(body));
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(PossiblyBilledError);
      expect(server.bodies).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('returns an answer with its exact body, over a fresh connection for every call', async () => {
    const answerText = '{"id":"x","choices":[],"usage":null}';
    const server = await localServer((_request, _text, response) => response.writeHead(200, { 'content-type': 'application/json' }).end(answerText));
    try {
      const send = await createSdkTransport('test-key', undefined, `http://127.0.0.1:${server.port}/v1/`);
      expect(await send(body)).toMatchObject({ status: 200, bodyText: answerText });
      expect(await send(body)).toMatchObject({ status: 200, bodyText: answerText });
      expect(server.connections()).toBe(2);
    } finally {
      await server.close();
    }
  });
});

describe('SDK transport behind the gateway', () => {
  const answer = JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"answer": 1}' } }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
  const request = { model: 'ultra', messages: [{ role: 'user', content: 'Answer.' }], schemaName: 'answer', schema: {}, parse: (value) => value, maxTokens: 64_000, n: 3 } satisfies StructuredRequest<unknown>;

  async function liveGateway(transport?: Transport) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-transport-'));
    const runsPath = path.join(directory, 'runs.json');
    fs.writeFileSync(runsPath, JSON.stringify({ globalCap: 50, runs: { test: { cap: 3 } } }));
    const ledgerPath = path.join(directory, 'ledger.jsonl');
    const cassettePath = path.join(directory, 'cassette.jsonl');
    const sleeps: number[] = [];
    const gateway = createGateway({ runId: 'test', mode: 'record', cassettePath, ledgerPath, runsPath, transport: transport ?? (await createSdkTransport('test-key', fakeFetch)), sleep: async (milliseconds) => void sleeps.push(milliseconds) });
    const outcomes = () => fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((line) => line.reservedUsd === undefined);
    return { gateway, sleeps, outcomes, cassetteWritten: () => fs.existsSync(cassettePath), cleanUp: () => fs.rmSync(directory, { recursive: true, force: true }) };
  }

  it('never resends a request whose connection dropped after the send, and charges its estimate', async () => {
    const server = await localServer((request) => request.socket.destroy());
    const { gateway, sleeps, outcomes, cassetteWritten, cleanUp } = await liveGateway(await createSdkTransport('test-key', undefined, `http://127.0.0.1:${server.port}/v1/`));
    try {
      await expect(gateway.structured(request)).rejects.toMatchObject({ code: 'transport' });
      expect(server.bodies).toHaveLength(1);
      expect(sleeps).toEqual([]);
      const [line] = outcomes();
      expect(line).toMatchObject({ attempts: 1, status: null, error: expect.stringMatching(/^connection lost after the request was sent/) });
      expect(line.costUsd).toBe(line.estimateUsd);
      expect(cassetteWritten()).toBe(false);
    } finally {
      cleanUp();
      await server.close();
    }
  });

  it('retries a refused connection and books it at $0', async () => {
    const { gateway, sleeps, outcomes, cleanUp } = await liveGateway(await createSdkTransport('test-key', undefined, `http://127.0.0.1:${await refusingPort()}/v1/`));
    try {
      await expect(gateway.structured(request)).rejects.toMatchObject({ code: 'transport' });
      expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
      expect(outcomes()).toMatchObject([{ attempts: 5, status: null, costUsd: 0 }]);
    } finally {
      cleanUp();
    }
  });

  it('never resends an answer lost after its 2xx headers, and charges its estimate', async () => {
    const { gateway, sleeps, outcomes, cleanUp } = await liveGateway();
    try {
      const calls = stubFetch(async () => lostBody());
      await expect(gateway.structured(request)).rejects.toMatchObject({ code: 'transport' });
      expect(calls).toHaveLength(1);
      expect(sleeps).toEqual([]);
      const [line] = outcomes();
      expect(line).toMatchObject({ attempts: 1, status: null, error: '200 answer lost while reading its body: terminated' });
      expect(line.costUsd).toBe(line.estimateUsd);
    } finally {
      cleanUp();
    }
  });

  it('retries a connect timeout and charges only the answer', async () => {
    const { gateway, sleeps, outcomes, cleanUp } = await liveGateway();
    try {
      let attempt = 0;
      const calls = stubFetch(async () => {
        if (attempt++ === 0) throw new TypeError('fetch failed', { cause: new undiciErrors.ConnectTimeoutError() });
        return new Response(answer, { status: 200 });
      });
      expect((await gateway.structured(request)).choices[0]!.value).toEqual({ answer: 1 });
      expect(calls).toHaveLength(2);
      expect(sleeps).toEqual([1000]);
      expect(outcomes()).toMatchObject([{ attempts: 2, status: 200, costUsd: 0.00013 }]);
    } finally {
      cleanUp();
    }
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

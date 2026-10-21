// The default transport: the real openai SDK over an injected fetch, or over undici against a local server, so nothing
// leaves the machine. Streamed calls (above 64k max_tokens, S8c) go against a local server sending server-sent events.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { errors as undiciErrors } from 'undici';
import { describe, expect, it } from 'vitest';
import { costUsd, estimateUsd } from '../../src/gateway/budget.js';
import type { CassetteRecord } from '../../src/gateway/cassette.js';
import { createGateway } from '../../src/gateway/gateway.js';
import { buildRequestBody } from '../../src/gateway/request.js';
import { apiKeyFrom, createSdkTransport, PossiblyBilledError, requestTimeoutFor, requestTimeoutMilliseconds, type SendRequest, type StreamSettings, type Transport } from '../../src/gateway/transport.js';
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

describe('requestTimeoutFor', () => {
  it('keeps 20 min for every cap up to 64k tokens, so recorded calls time out as before', () => {
    for (const maxTokens of [undefined, 512, 32_000, 64_000]) expect(requestTimeoutFor({ max_tokens: maxTokens })).toBe(requestTimeoutMilliseconds);
  });

  it('waits for a long cap at 100 tokens/s plus 5 min (Super VL toward 512k: about 90 min, its 256k critic 48), at most 2 h', () => {
    expect(requestTimeoutFor({ max_tokens: 512_000 })).toBe(5_120_000 + 300_000);
    expect(requestTimeoutFor({ max_tokens: 256_000 })).toBe(2_560_000 + 300_000);
    expect(requestTimeoutFor({ max_tokens: 1_000_000 })).toBe(120 * 60_000);
  });
});

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

const answerSchema = { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'], additionalProperties: false };
const streamedRequest = { model: 'super-vl', messages: [{ role: 'user', content: 'Answer.' }], schemaName: 'answer', schema: answerSchema, parse: (value) => value, maxTokens: 512_000, n: 3 } satisfies StructuredRequest<unknown>;
const streamedBody = buildRequestBody(streamedRequest);
const streamUsage = { prompt_tokens: 120, completion_tokens: 1_000_040, total_tokens: 1_000_160, completion_tokens_details: { reasoning_tokens: 1_000_000 } };
/** What the three choices say, piece by piece. */
const spoken = [
  { reasoning: ['Count', ' the', ' integers', '.'], content: ['{"answer"', ': 120}'], finishReason: 'stop' },
  { reasoning: ['A', ' long', ' thought', ' cut', ' off'], content: [], finishReason: 'length' },
  { reasoning: ['Quick', '.'], content: ['{"answer": 7}'], finishReason: 'stop' },
];
/** The body a non-streamed call would answer with the same choices. */
const nonStreamedAnswer = {
  id: 'chatcmpl-sse',
  choices: spoken.map((choice, index) => ({ index, message: { role: 'assistant', content: choice.content.join('') || null, reasoning_content: choice.reasoning.join('') || null }, finish_reason: choice.finishReason })),
  created: 1761000000,
  model: 'nvidia/Nemotron-3.5-Super-VL',
  object: 'chat.completion',
  usage: streamUsage,
};
const sseChunk = (choices: object[], usage: object | null = null) =>
  `data: ${JSON.stringify({ id: 'chatcmpl-sse', object: 'chat.completion.chunk', created: 1761000000, model: 'nvidia/Nemotron-3.5-Super-VL', choices, usage })}\n\n`;

/** That answer's events as vLLM streams them: a role delta per choice, the choices' deltas round-robin, a finish per
 * choice, the usage chunk (stream_options.include_usage) and [DONE]. */
function sseEvents(): string[] {
  const events = spoken.map((_, index) => sseChunk([{ index, delta: { role: 'assistant', content: '' }, logprobs: null, finish_reason: null }]));
  const queues = spoken.map((choice) => [...choice.reasoning.map((text) => ({ reasoning_content: text })), ...choice.content.map((text) => ({ content: text }))]);
  while (queues.some((queue) => queue.length)) {
    queues.forEach((queue, index) => {
      const delta = queue.shift();
      if (delta) events.push(sseChunk([{ index, delta, logprobs: null, finish_reason: null }]));
    });
  }
  spoken.forEach((choice, index) => events.push(sseChunk([{ index, delta: {}, logprobs: null, finish_reason: choice.finishReason }])));
  events.push(sseChunk([], streamUsage), 'data: [DONE]\n\n');
  return events;
}

/** Sends the stream's headers and `text` in 61-byte writes, so events and lines are split across writes. */
function writeEvents(response: http.ServerResponse, text: string) {
  if (!response.headersSent) response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'req-sse' });
  for (let start = 0; start < text.length; start += 61) response.write(text.slice(start, start + 61));
}

describe('streamed calls over undici, against a local server sending events', () => {
  const failureOf = (promise: Promise<unknown>) => promise.then(() => undefined, (failure: unknown) => failure);
  const transportTo = (port: number, settings: Partial<StreamSettings> = {}) => createSdkTransport('test-key', undefined, `http://127.0.0.1:${port}/v1/`, { log: () => undefined, ...settings });

  it('ask for a stream with usage above 64k max_tokens, and assemble three interleaved choices into the non-streamed body', async () => {
    const events = sseEvents();
    const half = Math.floor(events.length / 2);
    const server = await localServer((_request, _text, response) => {
      writeEvents(response, events.slice(0, half).join(''));
      setTimeout(() => {
        writeEvents(response, events.slice(half).join(''));
        response.end();
      }, 150);
    });
    try {
      const lines: string[] = [];
      const send = await transportTo(server.port, { progressIntervalMilliseconds: 40, log: (line) => lines.push(line) });
      const response = await send(streamedBody);
      expect(response).toMatchObject({ status: 200, streamed: true, headers: expect.objectContaining({ 'x-request-id': 'req-sse' }) });
      expect(JSON.parse(response.bodyText)).toEqual(nonStreamedAnswer);
      const sent = JSON.parse(server.bodies[0]!);
      expect(sent).toEqual(streamedBody);
      expect(sent).toMatchObject({ model: 'nvidia/Nemotron-3.5-Super-VL', max_tokens: 512_000, n: 3, stream: true, stream_options: { include_usage: true } });
      // A progress line while the call runs, and one when it is done; none of it is in the answer.
      expect(lines.some((line) => /^\[gateway\] nvidia\/Nemotron-3\.5-Super-VL streaming for \d+ms: ~tokens per choice: #0 \d+ \w+, #1 \d+ \w+, #2 \d+ \w+$/.test(line)), lines.join('\n')).toBe(true);
      expect(lines.at(-1)).toMatch(/^\[gateway\] nvidia\/Nemotron-3\.5-Super-VL streamed its answer in \d+ms: ~tokens per choice: #0 6 stop, #1 5 length, #2 3 stop; usage: 1000040 completion tokens$/);
    } finally {
      await server.close();
    }
  });

  it('read a request of 64k max_tokens whole, as before: no stream in its body', async () => {
    const atCap = buildRequestBody({ ...streamedRequest, maxTokens: 64_000 });
    const answerText = JSON.stringify(nonStreamedAnswer);
    const server = await localServer((_request, _text, response) => response.writeHead(200, { 'content-type': 'application/json' }).end(answerText));
    try {
      const response = await (await transportTo(server.port))(atCap);
      expect(response).toEqual({ status: 200, headers: expect.any(Object), bodyText: answerText });
      const sent = JSON.parse(server.bodies[0]!);
      expect(sent).toEqual(atCap);
      expect(Object.keys(sent)).not.toContain('stream');
      expect(Object.keys(sent)).not.toContain('stream_options');
    } finally {
      await server.close();
    }
  });

  it('report a refused connection, which sent nothing, as an ordinary failure, as before', async () => {
    const lines: string[] = [];
    const error = await failureOf((await transportTo(await refusingPort(), { progressIntervalMilliseconds: 10, log: (line) => lines.push(line) }))(streamedBody));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PossiblyBilledError);
    const logged = lines.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lines).toHaveLength(logged);
  });

  it('return an HTTP error that came before the stream with its exact body, as before', async () => {
    const page = '<html>\r\n<head><title>504 Gateway Time-out</title></head>\r\n</html>\r\n';
    const server = await localServer((_request, _text, response) => response.writeHead(504, { 'content-type': 'text/html' }).end(page));
    try {
      expect(await (await transportTo(server.port))(streamedBody)).toEqual({ status: 504, headers: expect.any(Object), bodyText: page });
    } finally {
      await server.close();
    }
  });

  it.each([
    ['a whole completion', 'application/json', JSON.stringify(nonStreamedAnswer)],
    ['an error', 'application/json; charset=utf-8', '{"error": {"message": "stream is not supported", "code": 400}}'],
  ] as const)('return %s answered as JSON instead of a stream with its exact body, as a non-streamed call', async (_case, contentType, answerText) => {
    const server = await localServer((_request, _text, response) => response.writeHead(200, { 'content-type': contentType }).end(answerText));
    try {
      const lines: string[] = [];
      const response = await (await transportTo(server.port, { log: (line) => lines.push(line) }))(streamedBody);
      expect(response).toStrictEqual({ status: 200, headers: expect.objectContaining({ 'content-type': contentType }), bodyText: answerText });
      expect(server.bodies).toHaveLength(1);
      expect(lines).toEqual([expect.stringMatching(new RegExp(`^\\[gateway\\] nvidia/Nemotron-3\\.5-Super-VL answered whole in \\d+ms, not as a stream \\(${contentType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`))]);
    } finally {
      await server.close();
    }
  });

  it('read a stream whose content type is not JSON as events, whatever it says, so a mislabelled stream is never kept raw', async () => {
    const server = await localServer((_request, _text, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      writeEvents(response, sseEvents().join(''));
      response.end();
    });
    try {
      const response = await (await transportTo(server.port))(streamedBody);
      expect(response).toMatchObject({ status: 200, streamed: true });
      expect(JSON.parse(response.bodyText)).toEqual(nonStreamedAnswer);
    } finally {
      await server.close();
    }
  });

  it('report a stream broken after its headers as possibly billed, with how far it got', async () => {
    const server = await localServer((request, _text, response) => {
      writeEvents(response, sseEvents().slice(0, 5).join(''));
      setTimeout(() => request.socket.destroy(), 50);
    });
    try {
      const error = await failureOf((await transportTo(server.port))(streamedBody));
      expect(error).toBeInstanceOf(PossiblyBilledError);
      expect((error as Error).message).toMatch(/^200 stream lost after \d+ms \(~tokens per choice: #0 1 thinking, #1 1 thinking, #2 0 thinking\): terminated$/);
    } finally {
      await server.close();
    }
  });

  it('give up on a stream silent for the idle timeout, drop its connection, and report it as possibly billed', async () => {
    let closed = false;
    const server = await localServer((request, _text, response) => {
      request.socket.on('close', () => (closed = true));
      writeEvents(response, sseEvents().slice(0, 4).join(''));
    });
    try {
      const startedAt = performance.now();
      const error = await failureOf((await transportTo(server.port, { idleTimeoutMilliseconds: 300 }))(streamedBody));
      expect(error).toBeInstanceOf(PossiblyBilledError);
      expect((error as Error).message).toMatch(/^200 stream lost after \d+ms \(~tokens per choice: #0 1 thinking, #1 0 thinking, #2 0 thinking\): no byte for 300ms$/);
      expect(performance.now() - startedAt).toBeLessThan(5000);
      await expect.poll(() => closed).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("give up on a stream that outlives the call's cap though bytes keep coming", async () => {
    const server = await localServer((request, _text, response) => {
      writeEvents(response, sseEvents().slice(0, 3).join(''));
      const trickle = setInterval(() => writeEvents(response, sseChunk([{ index: 0, delta: { reasoning_content: ' more' }, finish_reason: null }])), 30);
      request.socket.on('close', () => clearInterval(trickle));
    });
    try {
      const error = await failureOf((await transportTo(server.port, { idleTimeoutMilliseconds: 1000, timeoutFor: () => 400 }))(streamedBody));
      expect(error).toBeInstanceOf(PossiblyBilledError);
      expect((error as Error).message).toMatch(/^200 stream lost after \d+ms \(~tokens per choice: #0 \d+ thinking, .*\): no complete answer within 400ms$/);
    } finally {
      await server.close();
    }
  });

  it.each([
    ['without [DONE]', (events: string[]) => events.slice(0, -1), 'the stream ended without [DONE]'],
    ['without usage', (events: string[]) => [...events.slice(0, -2), events.at(-1)!], 'the stream ended without usage'],
    ['with an error event', (events: string[]) => [...events.slice(0, 4), 'data: {"error": {"message": "engine died", "code": 500}}\n\n', 'data: [DONE]\n\n'], 'the stream reported an error: {"error": {"message": "engine died", "code": 500}}'],
    // [DONE] and usage, but choice #2's finish chunk never came: a non-streamed answer always has every finish_reason.
    ['with a choice that never finished', (events: string[]) => [...events.slice(0, -3), ...events.slice(-2)], 'choice #2 never finished'],
    ['with choices that never finished', (events: string[]) => [...events.slice(0, -5), events.at(-4)!, ...events.slice(-2)], 'choices #0, #2 never finished'],
  ] as const)('report a stream that ends %s as possibly billed', async (_case, cut, reason) => {
    const server = await localServer((_request, _text, response) => {
      writeEvents(response, cut(sseEvents()).join(''));
      response.end();
    });
    try {
      const error = await failureOf((await transportTo(server.port))(streamedBody));
      expect(error).toBeInstanceOf(PossiblyBilledError);
      expect((error as Error).message.endsWith(`: ${reason}`), (error as Error).message).toBe(true);
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
    const ledger = () => fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const outcomes = () => ledger().filter((line) => line.reservedUsd === undefined);
    const cassette = () => fs.readFileSync(cassettePath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as CassetteRecord);
    const replaying = () => createGateway({ runId: 'test', mode: 'replay', cassettePath, ledgerPath, runsPath });
    return { gateway, sleeps, ledger, outcomes, cassette, replaying, cassetteWritten: () => fs.existsSync(cassettePath), cleanUp: () => fs.rmSync(directory, { recursive: true, force: true }) };
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

  const streamingTransport = (port: number) => createSdkTransport('test-key', undefined, `http://127.0.0.1:${port}/v1/`, { log: () => undefined });

  it('records a streamed answer as its assembled body, marked streamed, settles its reservation at its usage, and replays it', async () => {
    const server = await localServer((_request, _text, response) => {
      writeEvents(response, sseEvents().join(''));
      response.end();
    });
    const { gateway, ledger, cassette, replaying, cleanUp } = await liveGateway(await streamingTransport(server.port));
    try {
      const live = await gateway.structured(streamedRequest);
      const choices = [
        { index: 0, finishReason: 'stop', reasoning: 'Count the integers.', value: { answer: 120 } },
        { index: 1, finishReason: 'length', reasoning: 'A long thought cut off', error: 'truncated' },
        { index: 2, finishReason: 'stop', reasoning: 'Quick.', value: { answer: 7 } },
      ];
      expect(live.choices).toEqual(choices);
      const cost = costUsd('super-vl', { promptTokens: 120, completionTokens: 1_000_040, reasoningTokens: 1_000_000 });
      expect(live).toMatchObject({ replayed: false, costUsd: cost, usage: { promptTokens: 120, completionTokens: 1_000_040, reasoningTokens: 1_000_000 } });

      const [reservation, outcome] = ledger();
      const estimate = estimateUsd('super-vl', streamedBody);
      expect(estimate).toBeCloseTo((Buffer.byteLength(JSON.stringify(streamedBody)) * 0.3 + 3 * 512_000 * 0.9) / 1e6, 12);
      expect(reservation).toMatchObject({ runId: 'test', model: 'nvidia/Nemotron-3.5-Super-VL', key: live.key, reservedUsd: estimate });
      expect(outcome).toMatchObject({ callId: reservation.callId, status: 200, n: 3, attempts: 1, estimateUsd: estimate, costUsd: cost, promptTokens: 120, completionTokens: 1_000_040, reasoningTokens: 1_000_000, finishReasons: ['stop', 'length', 'stop'] });

      const [record] = cassette();
      expect(Object.keys(record!)).toEqual(['key', 'hash', 'occurrence', 'runId', 'model', 'request', 'response', 'streamed', 'usage', 'costUsd']);
      expect(record).toMatchObject({ key: live.key, streamed: true, request: streamedBody, response: { status: 200, headers: { 'x-request-id': 'req-sse' } } });
      expect(JSON.parse(record!.response.body)).toEqual(nonStreamedAnswer);

      const replayed = await replaying().structured(streamedRequest);
      expect(replayed).toMatchObject({ replayed: true, key: live.key, costUsd: cost });
      expect(replayed.choices).toEqual(choices);
      expect(server.bodies).toHaveLength(1);
      expect(ledger()).toHaveLength(2);
    } finally {
      cleanUp();
      await server.close();
    }
  });

  it('records a whole JSON answer to a streamed request as a non-streamed one, settled at its usage, and replays it', async () => {
    const server = await localServer((_request, _text, response) => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(nonStreamedAnswer)));
    const { gateway, outcomes, cassette, replaying, cleanUp } = await liveGateway(await streamingTransport(server.port));
    try {
      const live = await gateway.structured(streamedRequest);
      const cost = costUsd('super-vl', { promptTokens: 120, completionTokens: 1_000_040, reasoningTokens: 1_000_000 });
      expect(live).toMatchObject({ replayed: false, costUsd: cost });
      expect(live.choices.map((choice) => choice.finishReason)).toEqual(['stop', 'length', 'stop']);
      expect(outcomes()).toMatchObject([{ status: 200, attempts: 1, costUsd: cost }]);
      const [record] = cassette();
      expect(Object.keys(record!)).toEqual(['key', 'hash', 'occurrence', 'runId', 'model', 'request', 'response', 'usage', 'costUsd']);
      expect(record).toMatchObject({ key: live.key, request: streamedBody, response: { status: 200, body: JSON.stringify(nonStreamedAnswer) } });
      expect(await replaying().structured(streamedRequest)).toMatchObject({ replayed: true, key: live.key, costUsd: cost, choices: live.choices });
      expect(server.bodies).toHaveLength(1);
    } finally {
      cleanUp();
      await server.close();
    }
  });

  it('never resends a stream broken after its headers, charges its estimate and records nothing', async () => {
    const server = await localServer((request, _text, response) => {
      writeEvents(response, sseEvents().slice(0, 6).join(''));
      setTimeout(() => request.socket.destroy(), 50);
    });
    const { gateway, sleeps, outcomes, cassetteWritten, cleanUp } = await liveGateway(await streamingTransport(server.port));
    try {
      await expect(gateway.structured(streamedRequest)).rejects.toMatchObject({ code: 'transport' });
      expect(server.bodies).toHaveLength(1);
      expect(sleeps).toEqual([]);
      const [line] = outcomes();
      expect(line).toMatchObject({ attempts: 1, status: null, error: expect.stringMatching(/^200 stream lost after \d+ms \(~tokens per choice: /) });
      expect(line.costUsd).toBe(line.estimateUsd);
      expect(line.costUsd).toBe(estimateUsd('super-vl', streamedBody));
      expect(cassetteWritten()).toBe(false);
    } finally {
      cleanUp();
      await server.close();
    }
  });

  it('records a 504 that came before the stream as before: never resent, charged its estimate, replayed as the same error', async () => {
    const page = '<html><head><title>504 Gateway Time-out</title></head></html>';
    const server = await localServer((_request, _text, response) => response.writeHead(504, { 'content-type': 'text/html' }).end(page));
    const { gateway, sleeps, outcomes, cassette, replaying, cleanUp } = await liveGateway(await streamingTransport(server.port));
    try {
      await expect(gateway.structured(streamedRequest)).rejects.toMatchObject({ code: 'http', status: 504 });
      expect(server.bodies).toHaveLength(1);
      expect(sleeps).toEqual([]);
      const [line] = outcomes();
      expect(line).toMatchObject({ attempts: 1, status: 504 });
      expect(line.costUsd).toBe(line.estimateUsd);
      const [record] = cassette();
      expect(Object.keys(record!)).toEqual(['key', 'hash', 'occurrence', 'runId', 'model', 'request', 'response', 'usage', 'costUsd']);
      expect(record!.response).toEqual({ status: 504, headers: {}, body: page });
      await expect(replaying().structured(streamedRequest)).rejects.toMatchObject({ code: 'http', status: 504, message: expect.stringContaining('504 Gateway Time-out') });
    } finally {
      cleanUp();
      await server.close();
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

// The recording gateway (plan §3.6), with no network: replays come from hand-written cassettes, live calls go through
// a fake transport against a temporary ledger and runs.json. The openai SDK is mocked to prove replays never build it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type CassetteRecord, requestHash } from '../../src/gateway/cassette.js';
import { createGateway } from '../../src/gateway/gateway.js';
import { buildRequestBody, type RequestBody, RequestRuleError } from '../../src/gateway/request.js';
import { type Transport, type TransportResponse, TransportTimeoutError } from '../../src/gateway/transport.js';
import { type CassetteMode, GatewayError, type StructuredRequest } from '../../src/gateway/types.js';

const sdk = vi.hoisted(() => ({ constructed: 0 }));
vi.mock('openai', () => ({
  default: class {
    constructor() {
      sdk.constructed++;
      throw new Error('the SDK was constructed');
    }
  },
  APIConnectionTimeoutError: class extends Error {},
}));

type Answer = { answer: number };
const answerSchema = z.object({ answer: z.number() });
const strictSchema = { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'], additionalProperties: false };

const ask = (overrides: Partial<StructuredRequest<Answer>> = {}): StructuredRequest<Answer> => ({
  model: 'ultra',
  messages: [
    { role: 'system', content: 'Answer in JSON.' },
    { role: 'user', content: 'How many integers?' },
  ],
  schemaName: 'answer',
  schema: strictSchema,
  parse: (value) => answerSchema.parse(value),
  maxTokens: 1000,
  ...overrides,
});

interface FakeChoice {
  content?: string | null;
  finishReason?: string;
  reasoningContent?: string;
  reasoning?: string;
}
const defaultUsage = { prompt_tokens: 1000, completion_tokens: 2000, completion_tokens_details: { reasoning_tokens: 1500 } };
const completion = (choices: FakeChoice[], usage: object | null = defaultUsage) =>
  JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: choices.map((choice, index) => ({
      index,
      finish_reason: choice.finishReason ?? 'stop',
      message: { role: 'assistant', content: choice.content ?? null, reasoning_content: choice.reasoningContent ?? null, ...(choice.reasoning ? { reasoning: choice.reasoning } : {}) },
    })),
    ...(usage ? { usage } : {}),
  });
const ok = (bodyText: string, headers: Record<string, string> = {}): TransportResponse => ({ status: 200, headers, bodyText });
const answered = (answer: number) => ok(completion([{ content: JSON.stringify({ answer }) }]));

function fakeTransport(...responses: (TransportResponse | Error)[]) {
  const bodies: RequestBody[] = [];
  const send: Transport = async (body) => {
    bodies.push(body);
    const next = responses.shift();
    if (!next) throw new Error('fake transport: no response left');
    if (next instanceof Error) throw next;
    return next;
  };
  return { send, bodies };
}

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-gateway-'));
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

const readJsonLines = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

function setup(options: { runs?: object; ledgerLines?: object[] } = {}) {
  const runsPath = path.join(directory, 'runs.json');
  fs.writeFileSync(runsPath, JSON.stringify(options.runs ?? { globalCap: 50, runs: { test: { cap: 3 } } }));
  const ledgerPath = path.join(directory, 'budget', 'ledger.jsonl');
  if (options.ledgerLines) {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, options.ledgerLines.map((line) => `${JSON.stringify(line)}\n`).join(''));
  }
  const cassettePath = path.join(directory, 'cassettes', 'test.jsonl');
  const sleeps: number[] = [];
  const gateway = (mode: CassetteMode, transport?: Transport, runId = 'test') =>
    createGateway({ runId, mode, cassettePath, ledgerPath, runsPath, transport, sleep: async (milliseconds) => void sleeps.push(milliseconds) });
  return { ledgerPath, cassettePath, sleeps, gateway, ledger: () => readJsonLines(ledgerPath), cassette: () => readJsonLines(cassettePath) as CassetteRecord[] };
}

function handWrittenRecord(request: StructuredRequest<Answer>, occurrence: number, bodyText: string, status = 200): CassetteRecord {
  const body = buildRequestBody(request as StructuredRequest<unknown>);
  const hash = requestHash(body);
  return {
    key: `${hash}:${occurrence}`,
    hash,
    occurrence,
    runId: 'recorded-run',
    model: body.model,
    request: body,
    response: { status, headers: {}, body: bodyText },
    usage: { promptTokens: 1000, completionTokens: 2000, reasoningTokens: 1500 },
    costUsd: 0.007,
  };
}

function writeCassette(file: string, records: CassetteRecord[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((record) => `${JSON.stringify(record)}\n`).join(''));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('cassette keys', () => {
  it('hash the canonical body: key order at any depth never matters, values and message order do', () => {
    const messages = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
    const base = requestHash({ model: 'm', messages, max_tokens: 5, response_format: { type: 'json_schema', json_schema: { name: 'x', strict: true } } });
    expect(requestHash({ response_format: { json_schema: { strict: true, name: 'x' }, type: 'json_schema' }, max_tokens: 5, messages, model: 'm' })).toBe(base);
    expect(requestHash({ model: 'm', messages, max_tokens: 6, response_format: { type: 'json_schema', json_schema: { name: 'x', strict: true } } })).not.toBe(base);
    expect(requestHash({ model: 'm', messages: [...messages].reverse(), max_tokens: 5, response_format: { type: 'json_schema', json_schema: { name: 'x', strict: true } } })).not.toBe(base);
  });

  it('are pinned for a known request, so recorded cassettes stay valid', () => {
    // Cross-checked with Python: sha256(json.dumps(doc, sort_keys=True, separators=(',', ':'))).
    expect(requestHash(buildRequestBody(ask() as StructuredRequest<unknown>))).toBe('3bf7bec51b15c8bac41f22e7f1a96a2823bcda9cb2415319ec0199260d53364e');
  });

  it('count occurrences per hash, so identical sequential requests get distinct records, and replay them in order', async () => {
    const { gateway, cassette } = setup();
    const fake = fakeTransport(answered(1), answered(2), answered(3));
    const recording = gateway('auto', fake.send);
    const first = await recording.structured(ask());
    const second = await recording.structured(ask());
    const other = await recording.structured(ask({ maxTokens: 2000 }));
    const [hash] = first.key.split(':');
    expect([first.key, second.key]).toEqual([`${hash}:0`, `${hash}:1`]);
    expect(other.key.endsWith(':0') && !other.key.startsWith(hash!)).toBe(true);
    expect(cassette().map((record) => [record.key, record.occurrence])).toEqual([[first.key, 0], [second.key, 1], [other.key, 0]]);

    const replaying = gateway('replay', fakeTransport().send);
    const replayed = [await replaying.structured(ask()), await replaying.structured(ask()), await replaying.structured(ask({ maxTokens: 2000 }))];
    expect(replayed.map((result) => [result.key, result.choices[0]!.value, result.replayed])).toEqual([
      [first.key, { answer: 1 }, true],
      [second.key, { answer: 2 }, true],
      [other.key, { answer: 3 }, true],
    ]);
  });
});

describe('replay', () => {
  it('serves hand-written records with no transport, no key, no SDK and no ledger', async () => {
    const { gateway, cassettePath, ledgerPath } = setup();
    writeCassette(cassettePath, [handWrittenRecord(ask(), 0, completion([{ content: '{"answer": 120}', reasoningContent: 'Count them.' }]))]);
    const savedKey = process.env.NEBIUS_API_KEY;
    delete process.env.NEBIUS_API_KEY;
    try {
      const result = await gateway('replay').structured(ask());
      expect(result).toMatchObject({ replayed: true, costUsd: 0.007, usage: { promptTokens: 1000, completionTokens: 2000, reasoningTokens: 1500 } });
      expect(result.choices).toEqual([{ index: 0, finishReason: 'stop', reasoning: 'Count them.', value: { answer: 120 } }]);
    } finally {
      if (savedKey !== undefined) process.env.NEBIUS_API_KEY = savedKey;
    }
    expect(sdk.constructed).toBe(0);
    expect(fs.existsSync(ledgerPath)).toBe(false);
  });

  it('throws replay-miss on a miss without calling the transport', async () => {
    const { gateway, cassettePath } = setup();
    writeCassette(cassettePath, [handWrittenRecord(ask(), 0, completion([{ content: '{"answer": 1}' }]))]);
    const fake = fakeTransport(answered(9));
    const replaying = gateway('replay', fake.send);
    await replaying.structured(ask());
    const error = await rejection(replaying.structured(ask()));
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).code).toBe('replay-miss');
    expect(fake.bodies).toHaveLength(0);
  });

  it('takes the last record when a key repeats', async () => {
    const { gateway, cassettePath } = setup();
    writeCassette(cassettePath, [handWrittenRecord(ask(), 0, completion([{ content: '{"answer": 1}' }])), handWrittenRecord(ask(), 0, completion([{ content: '{"answer": 2}' }]))]);
    expect((await gateway('replay').structured(ask())).choices[0]!.value).toEqual({ answer: 2 });
  });
});

describe('record', () => {
  it('always calls live, even on a recorded key, and the appended record wins on replay', async () => {
    const { gateway, cassettePath, cassette } = setup();
    writeCassette(cassettePath, [handWrittenRecord(ask(), 0, completion([{ content: '{"answer": 1}' }]))]);
    const fake = fakeTransport(answered(2));
    expect((await gateway('record', fake.send).structured(ask())).choices[0]!.value).toEqual({ answer: 2 });
    expect(fake.bodies).toHaveLength(1);
    expect(cassette()).toHaveLength(2);
    expect((await gateway('replay').structured(ask())).choices[0]!.value).toEqual({ answer: 2 });
  });

  it('defaults to the repo ledger, which AC_LEDGER overrides', () => {
    const savedLedger = process.env.AC_LEDGER;
    delete process.env.AC_LEDGER;
    try {
      const cassettePath = path.join(directory, 'unused.jsonl');
      // budget/ledger.jsonl starts with the spike's carried $7.537.
      expect(createGateway({ runId: 's5', mode: 'replay', cassettePath }).spent().global).toBeGreaterThan(7.5);
      const { ledgerPath } = setup({ ledgerLines: [{ runId: 's5', costUsd: 0.5 }, { runId: 'other', costUsd: 0.25 }] });
      process.env.AC_LEDGER = ledgerPath;
      expect(createGateway({ runId: 's5', mode: 'replay', cassettePath }).spent()).toEqual({ run: 0.5, global: 0.75 });
    } finally {
      if (savedLedger === undefined) delete process.env.AC_LEDGER;
      else process.env.AC_LEDGER = savedLedger;
    }
  });
});

describe('choices', () => {
  it('never parse the content of a truncated choice, even when it is valid JSON', async () => {
    const { gateway } = setup();
    const parse = vi.fn((value: unknown) => answerSchema.parse(value));
    const fake = fakeTransport(ok(completion([{ content: '{"answer": 4}', finishReason: 'length' }, { content: 'We need to count integers', finishReason: 'length' }])));
    const result = await gateway('record', fake.send).structured(ask({ n: 2, parse }));
    expect(result.choices.map((choice) => [choice.finishReason, choice.error, choice.value])).toEqual([
      ['length', 'truncated', undefined],
      ['length', 'truncated', undefined],
    ]);
    expect(parse).not.toHaveBeenCalled();
  });

  it('take reasoning from reasoning_content only, never from the mirrored reasoning field', async () => {
    const { gateway } = setup();
    const fake = fakeTransport(ok(completion([{ content: '{"answer": 1}', reasoning: 'mirror only' }, { content: '{"answer": 2}', reasoningContent: 'real', reasoning: 'real' }])));
    const result = await gateway('record', fake.send).structured(ask({ n: 2 }));
    expect(result.choices.map((choice) => choice.reasoning)).toEqual([null, 'real']);
  });

  it('turn unparseable or invalid content into that choice’s error instead of throwing', async () => {
    const { gateway } = setup();
    const fake = fakeTransport(ok(completion([{ content: '{"answer": 4}' }, { content: '{"answer": "four"}' }, { content: 'not json' }, { content: null }])));
    const result = await gateway('record', fake.send).structured(ask({ n: 4 }));
    expect(result.choices[0]).toMatchObject({ value: { answer: 4 } });
    expect(result.choices[0]!.error).toBeUndefined();
    expect(result.choices[1]!.error).toMatch(/^content does not validate: /);
    expect(result.choices[2]!.error).toMatch(/^content is not JSON: /);
    expect(result.choices[3]!.error).toBe('no content');
    expect(result.choices.slice(1).every((choice) => choice.value === undefined)).toBe(true);
  });
});

describe('budget', () => {
  it('refuses past the run cap, counting n × max_tokens, before anything is sent', async () => {
    // Ultra at $3/M out: 3000 tokens is $0.009 (fits under $0.01 with the prompt), n=2 doubles it.
    const { gateway, ledger } = setup({ runs: { globalCap: 50, runs: { test: { cap: 0.01 } } } });
    const fake = fakeTransport(ok(completion([{ content: '{"answer": 1}' }], { prompt_tokens: 100, completion_tokens: 100 })));
    const live = gateway('record', fake.send);
    const error = await rejection(live.structured(ask({ maxTokens: 3000, n: 2 })));
    expect((error as GatewayError).code).toBe('budget');
    expect(fake.bodies).toHaveLength(0);
    const [refused] = ledger();
    expect(refused).toMatchObject({ runId: 'test', model: 'nvidia/Nemotron-3-Ultra-550b-a55b', refused: true, runSpent: 0, globalSpent: 0, costUsd: 0 });
    expect(refused.estimateUsd).toBeGreaterThan(0.018);
    expect((await live.structured(ask({ maxTokens: 3000 }))).choices[0]!.value).toEqual({ answer: 1 });
    expect(fake.bodies).toHaveLength(1);
  });

  it('refuses past the global cap, counting the carried spend', async () => {
    const { gateway, ledger } = setup({ ledgerLines: [{ ts: '2026-10-02T14:02:05.867Z', runId: 'g1', carried: 'spike', costUsd: 49.995 }] });
    const fake = fakeTransport(answered(1));
    const live = gateway('record', fake.send);
    expect(live.spent()).toEqual({ run: 0, global: 49.995 });
    const error = await rejection(live.structured(ask({ model: 'lightning', maxTokens: 30_000 })));
    expect((error as GatewayError).code).toBe('budget');
    expect(fake.bodies).toHaveLength(0);
    expect(ledger()[1]).toMatchObject({ refused: true, globalSpent: 49.995, costUsd: 0 });
    expect(live.spent()).toEqual({ run: 0, global: 49.995 });
  });

  it('refuses a run missing from runs.json without a ledger line', async () => {
    const { gateway, ledgerPath } = setup();
    const fake = fakeTransport(answered(1));
    const error = await rejection(gateway('record', fake.send, 'unknown-run').structured(ask()));
    expect((error as GatewayError).code).toBe('budget');
    expect((error as GatewayError).message).toMatch(/unknown-run/);
    expect(fake.bodies).toHaveLength(0);
    expect(fs.existsSync(ledgerPath)).toBe(false);
  });

  const tightCaps: [string, Parameters<typeof setup>[0]][] = [
    ['run', { runs: { globalCap: 50, runs: { test: { cap: 0.015 } } } }],
    ['global', { ledgerLines: [{ runId: 'g1', costUsd: 49.985 }] }],
  ];
  it.each(tightCaps)('holds in-flight reservations against the %s cap until the call settles', async (_cap, caps) => {
    const { gateway } = setup(caps);
    let finishUltra!: (response: TransportResponse) => void;
    const bodies: RequestBody[] = [];
    const send: Transport = (body) => {
      bodies.push(body);
      if (body.model.includes('Ultra')) return new Promise((resolve) => (finishUltra = resolve));
      return Promise.resolve(ok(completion([{ content: '{"answer": 2}' }], { prompt_tokens: 10, completion_tokens: 10 })));
    };
    const live = gateway('record', send);
    // $0.009 + prompt for Ultra in flight, then $0.0072 + prompt for Lightning would cross the $0.015 left.
    const ultra = live.structured(ask({ maxTokens: 3000 }));
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    try {
      const error = await rejection(live.structured(ask({ model: 'lightning', maxTokens: 30_000 })));
      expect((error as GatewayError).code).toBe('budget');
    } finally {
      // Lanes are process-wide: a call left hanging would block Ultra for every later test.
      finishUltra(ok(completion([{ content: '{"answer": 1}' }], { prompt_tokens: 10, completion_tokens: 10 })));
      await ultra;
    }
    expect((await live.structured(ask({ model: 'lightning', maxTokens: 30_000 }))).choices[0]!.value).toEqual({ answer: 2 });
  });

  it('charges a 2xx answer without usage the full estimate', async () => {
    const { gateway, ledger } = setup();
    const result = await gateway('record', fakeTransport(ok(completion([{ content: '{"answer": 1}' }], null))).send).structured(ask());
    const [line] = ledger();
    expect(result.usage).toBeNull();
    expect(line.costUsd).toBe(line.estimateUsd);
    expect(result.costUsd).toBe(line.estimateUsd);
  });
});

describe('ledger and cassette records', () => {
  it('get one line per live call and nothing for replays; the cassette holds content only', async () => {
    const { gateway, ledger, cassette } = setup();
    const headers = { 'x-ratelimit-remaining-requests': '599', 'x-request-id': 'req-1', 'content-type': 'application/json', 'set-cookie': 'session=1' };
    const auto = gateway('auto', fakeTransport(ok(completion([{ content: '{"answer": 1}' }]), headers)).send);
    const live = await auto.structured(ask({ templateKwargs: { medium_effort: true } }));
    expect(live).toMatchObject({ replayed: false, costUsd: 0.007, usage: { promptTokens: 1000, completionTokens: 2000, reasoningTokens: 1500 } });
    const [line] = ledger();
    expect(Object.keys(line).sort()).toEqual(
      ['attempts', 'completionTokens', 'costUsd', 'estimateUsd', 'finishReasons', 'key', 'latencyMs', 'model', 'n', 'promptTokens', 'rateLimit', 'reasoningTokens', 'runId', 'status', 'ts'].sort(),
    );
    expect(line).toMatchObject({ runId: 'test', model: 'nvidia/Nemotron-3-Ultra-550b-a55b', key: live.key, status: 200, n: 1, attempts: 1, promptTokens: 1000, completionTokens: 2000, reasoningTokens: 1500, costUsd: 0.007, finishReasons: ['stop'], rateLimit: { 'x-ratelimit-remaining-requests': '599' } });
    const [record] = cassette();
    expect(Object.keys(record!)).toEqual(['key', 'hash', 'occurrence', 'runId', 'model', 'request', 'response', 'usage', 'costUsd']);
    expect(record!.response.headers).toEqual({ 'x-ratelimit-remaining-requests': '599', 'x-request-id': 'req-1' });
    expect(record!.request).toEqual(buildRequestBody(ask({ templateKwargs: { medium_effort: true } }) as StructuredRequest<unknown>));

    const again = gateway('auto', fakeTransport().send);
    expect(await again.structured(ask({ templateKwargs: { medium_effort: true } }))).toMatchObject({ replayed: true, key: live.key, costUsd: 0.007 });
    expect(ledger()).toHaveLength(1);
    expect(again.spent()).toEqual({ run: 0.007, global: 0.007 });
  });
});

describe('http answers and retries', () => {
  it('record a 4xx answer, throw it, and replay it as the same GatewayError', async () => {
    const { gateway, ledger, cassette } = setup();
    const errorBody = '{"detail": "n must be 1 when using greedy sampling"}';
    const fake = fakeTransport({ status: 400, headers: {}, bodyText: errorBody });
    const error = await rejection(gateway('record', fake.send).structured(ask({ n: 3 })));
    expect(error).toMatchObject({ code: 'http', status: 400 });
    expect(fake.bodies).toHaveLength(1);
    expect(cassette()[0]!.response).toEqual({ status: 400, headers: {}, body: errorBody });
    expect(ledger()[0]).toMatchObject({ status: 400, costUsd: 0, promptTokens: null });

    const replayed = await rejection(gateway('replay', fakeTransport().send).structured(ask({ n: 3 })));
    expect(replayed).toMatchObject({ code: 'http', status: 400 });
    expect((replayed as GatewayError).message).toMatch(/n must be 1/);
    const auto = await rejection(gateway('auto', fakeTransport().send).structured(ask({ n: 3 })));
    expect(auto).toMatchObject({ code: 'http', status: 400 });
    expect(ledger()).toHaveLength(1);
  });

  it('retry 429 and 5xx with backoff, honour retry-after up to 60 s, and record only the final answer', async () => {
    const { gateway, ledger, cassette, sleeps } = setup();
    const fake = fakeTransport(
      { status: 503, headers: {}, bodyText: 'busy' },
      { status: 429, headers: { 'Retry-After': '7' }, bodyText: 'slow down' },
      { status: 502, headers: { 'retry-after': '120' }, bodyText: 'bad gateway' },
      answered(5),
    );
    const result = await gateway('record', fake.send).structured(ask());
    expect(result.choices[0]!.value).toEqual({ answer: 5 });
    expect(sleeps).toEqual([1000, 7000, 60_000]);
    expect(cassette().map((record) => record.response.status)).toEqual([200]);
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({ status: 200, attempts: 4 });
  });

  it('give up after 4 retries, record the final 5xx; replay reproduces it while auto calls again', async () => {
    const { gateway, cassette, sleeps } = setup();
    const failing = fakeTransport(...Array.from({ length: 5 }, () => ({ status: 500, headers: {}, bodyText: 'down' })));
    expect(await rejection(gateway('record', failing.send).structured(ask()))).toMatchObject({ code: 'http', status: 500 });
    expect(failing.bodies).toHaveLength(5);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
    expect(cassette().map((record) => record.response.status)).toEqual([500]);

    expect(await rejection(gateway('replay', fakeTransport().send).structured(ask()))).toMatchObject({ code: 'http', status: 500 });
    const healed = fakeTransport(answered(6));
    expect((await gateway('auto', healed.send).structured(ask())).choices[0]!.value).toEqual({ answer: 6 });
    expect(healed.bodies).toHaveLength(1);
    expect((await gateway('replay', fakeTransport().send).structured(ask())).choices[0]!.value).toEqual({ answer: 6 });
  });

  it('retry transport errors, but never a timeout, which is charged its estimate', async () => {
    const { gateway, ledger, cassette, sleeps } = setup();
    const flaky = fakeTransport(new Error('socket hang up'), answered(7));
    expect((await gateway('record', flaky.send).structured(ask())).choices[0]!.value).toEqual({ answer: 7 });
    expect(sleeps).toEqual([1000]);

    const timingOut = fakeTransport(new TransportTimeoutError('no answer within 20 min'), answered(8));
    expect(await rejection(gateway('record', timingOut.send).structured(ask()))).toMatchObject({ code: 'transport' });
    expect(timingOut.bodies).toHaveLength(1);
    const timedOut = ledger()[1];
    expect(timedOut).toMatchObject({ status: null, attempts: 1, error: 'no answer within 20 min' });
    expect(timedOut.costUsd).toBe(timedOut.estimateUsd);
    expect(cassette()).toHaveLength(1);
  });
});

describe('request rules', () => {
  it('build the body: json_schema strict, temperature 1.0, top_p 0.95, max_tokens, n above 1, top-level kwargs, store false', () => {
    const body = buildRequestBody(ask({ n: 3, templateKwargs: { medium_effort: true, enable_thinking: true } }) as StructuredRequest<unknown>);
    expect(body).toEqual({
      model: 'nvidia/Nemotron-3-Ultra-550b-a55b',
      messages: ask().messages,
      max_tokens: 1000,
      temperature: 1,
      top_p: 0.95,
      n: 3,
      response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: strictSchema } },
      chat_template_kwargs: { enable_thinking: true, medium_effort: true },
      store: false,
    });
    const plain = buildRequestBody(ask({ model: 'super', n: 1 }) as StructuredRequest<unknown>);
    expect(Object.keys(plain)).toEqual(['model', 'messages', 'max_tokens', 'temperature', 'top_p', 'response_format', 'store']);
    expect(plain.model).toBe('nvidia/nemotron-3-super-120b-a12b');
  });

  const refusals: [string, Record<string, unknown>][] = [
    ['medium_effort on super', { model: 'super', templateKwargs: { medium_effort: true } }],
    ['low_effort on ultra', { templateKwargs: { low_effort: true } }],
    ['low_effort on lightning', { model: 'lightning', templateKwargs: { low_effort: false } }],
    ['an unlisted chat_template_kwargs flag', { templateKwargs: { force_nonempty_content: true } }],
    ['a non-boolean flag', { templateKwargs: { enable_thinking: 'yes' } }],
    ['reasoning_effort smuggled in', { reasoning_effort: 'high' }],
    ['a caller-chosen temperature', { temperature: 0 }],
    ['tools', { tools: [] }],
    ['an unpinned model', { model: 'nano' }],
    ['no messages', { messages: [] }],
    ['a tool role', { messages: [{ role: 'tool', content: 'x' }] }],
    ['maxTokens 0', { maxTokens: 0 }],
    ['fractional maxTokens', { maxTokens: 1.5 }],
    ['n 0', { n: 0 }],
    ['a bad schema name', { schemaName: 'has spaces' }],
  ];
  it.each(refusals)('refuse %s before anything is sent', async (_name, overrides) => {
    const { gateway, ledgerPath, cassettePath } = setup();
    const fake = fakeTransport(answered(1));
    const error = await rejection(gateway('auto', fake.send).structured({ ...ask(), ...overrides } as StructuredRequest<Answer>));
    expect(error).toBeInstanceOf(RequestRuleError);
    expect(fake.bodies).toHaveLength(0);
    expect(fs.existsSync(ledgerPath) || fs.existsSync(cassettePath)).toBe(false);
  });

  it('accept the documented flags on their own models', async () => {
    const { gateway } = setup();
    const fake = fakeTransport(answered(1), answered(2), answered(3));
    const live = gateway('record', fake.send);
    await live.structured(ask({ model: 'super', templateKwargs: { low_effort: true, enable_thinking: true } }));
    await live.structured(ask({ model: 'ultra', templateKwargs: { medium_effort: true } }));
    await live.structured(ask({ model: 'lightning', templateKwargs: { enable_thinking: false } }));
    expect(fake.bodies.map((body) => body.chat_template_kwargs)).toEqual([{ enable_thinking: true, low_effort: true }, { medium_effort: true }, { enable_thinking: false }]);
  });
});

describe('pacing and the default transport', () => {
  it('keep one live call in flight per model while different models overlap', async () => {
    const { gateway } = setup();
    const inFlight = new Map<string, number>();
    const peak = new Map<string, number>();
    const send: Transport = async (body) => {
      inFlight.set(body.model, (inFlight.get(body.model) ?? 0) + 1);
      peak.set(body.model, Math.max(peak.get(body.model) ?? 0, inFlight.get(body.model)!));
      peak.set('all', Math.max(peak.get('all') ?? 0, [...inFlight.values()].reduce((sum, count) => sum + count, 0)));
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight.set(body.model, inFlight.get(body.model)! - 1);
      return answered(1);
    };
    const live = gateway('record', send);
    await Promise.all([live.structured(ask()), live.structured(ask()), live.structured(ask({ model: 'lightning' })), live.structured(ask({ model: 'lightning' }))]);
    expect(peak.get('nvidia/Nemotron-3-Ultra-550b-a55b')).toBe(1);
    expect(peak.get('nvidia/Nemotron-3_5-Lightning')).toBe(1);
    expect(peak.get('all')).toBe(2);
  });

  it('build the SDK only on the first live call, after the budget check', async () => {
    const { gateway, ledgerPath } = setup();
    const savedKey = process.env.NEBIUS_API_KEY;
    process.env.NEBIUS_API_KEY = 'test-key';
    try {
      expect(await rejection(gateway('record', undefined, 'unknown-run').structured(ask()))).toMatchObject({ code: 'budget' });
      expect(sdk.constructed).toBe(0);
      expect(await rejection(gateway('auto').structured(ask()))).toMatchObject({ message: 'the SDK was constructed' });
      expect(sdk.constructed).toBe(1);
    } finally {
      if (savedKey === undefined) delete process.env.NEBIUS_API_KEY;
      else process.env.NEBIUS_API_KEY = savedKey;
    }
    expect(fs.existsSync(ledgerPath)).toBe(false);
  });
});

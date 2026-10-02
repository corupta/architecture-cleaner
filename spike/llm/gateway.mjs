// Recording gateway with a hard budget ledger, in front of Nebius Token Factory.
// Every LLM call in the gate session (our scripts and opencode) goes through here.
//
//   node spike/llm/gateway.mjs            # listens on 127.0.0.1:8787 (never 0.0.0.0: it spends our key)
//   client base URL: http://127.0.0.1:8787/run/<runId>/v1
//
// Caps and modes live in runs.json, prices in prices.json. The ledger (ledger.jsonl) is the
// source of truth for spend and is replayed on startup. Cassettes go outside the tree.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const upstream = 'https://api.tokenfactory.nebius.com/v1';
const port = Number(process.env.AC_GATEWAY_PORT ?? 8787);
const ledgerPath = path.join(here, 'ledger.jsonl');
const cassetteDir = process.env.AC_CASSETTE_DIR ?? path.join(os.homedir(), 'ac-work/cassettes');
const defaultMaxTokens = 8192;
const bytesPerTokenEstimate = 3;

const apiKey = readEnvFile(path.join(repoRoot, '.env')).NEBIUS_API_KEY;
if (!apiKey) throw new Error('NEBIUS_API_KEY missing from .env');

const prices = JSON.parse(fs.readFileSync(path.join(here, 'prices.json'), 'utf8'));
const loadRunConfig = () => JSON.parse(fs.readFileSync(path.join(here, 'runs.json'), 'utf8'));

const spentByRun = new Map();
const reservedByRun = new Map();
let spentGlobal = 0;
let reservedGlobal = 0;
for (const line of readLines(ledgerPath)) {
  const entry = JSON.parse(line);
  spentByRun.set(entry.runId, (spentByRun.get(entry.runId) ?? 0) + entry.costUsd);
  spentGlobal += entry.costUsd;
}

const cassettes = new Map();
fs.mkdirSync(cassetteDir, { recursive: true });

function readEnvFile(file) {
  const values = {};
  for (const line of readLines(file)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim());
}

function cassetteFor(runId) {
  if (!cassettes.has(runId)) {
    const byKey = new Map();
    for (const line of readLines(path.join(cassetteDir, `${runId}.jsonl`))) {
      const record = JSON.parse(line);
      byKey.set(record.key, record);
    }
    cassettes.set(runId, byKey);
  }
  return cassettes.get(runId);
}

function costOf(model, usage) {
  const price = prices[model];
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  return (promptTokens * price.input + completionTokens * price.output) / 1e6;
}

function estimateCost(model, rawBody, body) {
  const price = prices[model];
  const inputTokens = rawBody.length / bytesPerTokenEstimate;
  const outputTokens = body.max_tokens ?? body.max_completion_tokens ?? defaultMaxTokens;
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}

function canonicalKey(urlPath, body) {
  return crypto.createHash('sha256').update(JSON.stringify({ urlPath, body })).digest('hex').slice(0, 32);
}

function rateLimitHeaders(headers) {
  const picked = {};
  for (const [name, value] of headers) {
    if (name.startsWith('x-ratelimit') || name === 'retry-after' || name === 'x-request-id') picked[name] = value;
  }
  return picked;
}

function usageFromSse(text) {
  let usage = null;
  let finishReason = null;
  let serviceTier = null;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const chunk = JSON.parse(data);
      if (chunk.usage) usage = chunk.usage;
      if (chunk.service_tier) serviceTier = chunk.service_tier;
      const reason = chunk.choices?.[0]?.finish_reason;
      if (reason) finishReason = reason;
    } catch {
      // partial or non-JSON line; usage is taken from whichever chunk parses
    }
  }
  return { usage, finishReason, serviceTier };
}

function appendLedger(entry) {
  fs.appendFileSync(ledgerPath, JSON.stringify(entry) + '\n');
  spentByRun.set(entry.runId, (spentByRun.get(entry.runId) ?? 0) + entry.costUsd);
  spentGlobal += entry.costUsd;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function status() {
  const config = loadRunConfig();
  const runs = {};
  for (const [runId, run] of Object.entries(config.runs)) {
    runs[runId] = { cap: run.cap, spent: spentByRun.get(runId) ?? 0, reserved: reservedByRun.get(runId) ?? 0, mode: run.mode };
  }
  return { globalCap: config.globalCap, spentGlobal, reservedGlobal, runs };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function handle(request, response) {
  if (request.url === '/status') return sendJson(response, 200, status());

  const match = request.url.match(/^\/run\/([\w.-]+)\/v1(\/.*)$/);
  if (!match) return sendJson(response, 404, { error: { message: 'use /run/<runId>/v1/...' } });
  const [, runId, apiPath] = match;
  const config = loadRunConfig();
  const run = config.runs[runId];
  if (!run) return sendJson(response, 403, { error: { message: `unknown run ${runId}` } });

  const rawBody = await readBody(request);
  const startedAt = Date.now();

  if (request.method === 'GET') {
    const upstreamResponse = await fetch(upstream + apiPath, { headers: { authorization: `Bearer ${apiKey}` } });
    const text = await upstreamResponse.text();
    appendLedger({ ts: new Date().toISOString(), runId, method: 'GET', apiPath, status: upstreamResponse.status, costUsd: 0, latencyMs: Date.now() - startedAt, rateLimit: rateLimitHeaders(upstreamResponse.headers) });
    fs.appendFileSync(path.join(cassetteDir, `${runId}.jsonl`), JSON.stringify({ key: canonicalKey(apiPath, null), ts: new Date().toISOString(), request: { method: 'GET', apiPath }, response: { status: upstreamResponse.status, headers: rateLimitHeaders(upstreamResponse.headers), body: text } }) + '\n');
    response.writeHead(upstreamResponse.status, { 'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json' });
    return response.end(text);
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return sendJson(response, 400, { error: { message: 'gateway: body is not JSON' } });
  }
  const model = body.model;
  if (!prices[model]) return sendJson(response, 403, { error: { message: `gateway: model ${model} has no pinned price; refused` } });
  if (run.allowedModels && !run.allowedModels.includes(model)) return sendJson(response, 403, { error: { message: `gateway: model ${model} not allowed in run ${runId}` } });

  const key = canonicalKey(apiPath, body);
  if (run.mode === 'auto' || run.mode === 'replay') {
    const hit = cassetteFor(runId).get(key);
    if (hit) {
      appendLedger({ ts: new Date().toISOString(), runId, model, apiPath, status: hit.response.status, costUsd: 0, replay: true, key });
      response.writeHead(hit.response.status, { 'content-type': hit.response.contentType ?? 'application/json', 'x-ac-replay': '1' });
      return response.end(hit.response.body);
    }
    if (run.mode === 'replay') return sendJson(response, 409, { error: { message: `gateway: cassette miss in replay mode (${key})` } });
  }

  if (body.stream) body.stream_options = { ...(body.stream_options ?? {}), include_usage: true };
  const outgoing = JSON.stringify(body);
  const estimate = estimateCost(model, outgoing, body);
  const runSpent = (spentByRun.get(runId) ?? 0) + (reservedByRun.get(runId) ?? 0);
  if (runSpent + estimate > run.cap || spentGlobal + reservedGlobal + estimate > config.globalCap) {
    appendLedger({ ts: new Date().toISOString(), runId, model, apiPath, status: 402, costUsd: 0, refused: true, estimateUsd: estimate, runSpent, spentGlobal });
    return sendJson(response, 402, { error: { type: 'budget_exceeded', message: `gateway: refused, estimate $${estimate.toFixed(4)} would cross the cap (run ${runId} at $${runSpent.toFixed(4)} of $${run.cap}, global $${spentGlobal.toFixed(4)} of $${config.globalCap})` } });
  }
  reservedByRun.set(runId, (reservedByRun.get(runId) ?? 0) + estimate);
  reservedGlobal += estimate;

  let ledgerEntry = { ts: new Date().toISOString(), runId, model, apiPath, stream: Boolean(body.stream), key, estimateUsd: estimate };
  let recorded = { status: 0, contentType: null, body: '' };
  try {
    const upstreamResponse = await fetch(upstream + apiPath, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: outgoing,
    });
    const contentType = upstreamResponse.headers.get('content-type') ?? 'application/json';
    response.writeHead(upstreamResponse.status, { 'content-type': contentType });
    let text = '';
    const decoder = new TextDecoder();
    for await (const chunk of upstreamResponse.body) {
      text += decoder.decode(chunk, { stream: true });
      response.write(chunk);
    }
    response.end();

    let usage = null;
    let finishReason = null;
    let serviceTier = null;
    if (contentType.includes('text/event-stream')) {
      ({ usage, finishReason, serviceTier } = usageFromSse(text));
    } else {
      try {
        const parsed = JSON.parse(text);
        usage = parsed.usage ?? null;
        finishReason = parsed.choices?.[0]?.finish_reason ?? null;
        serviceTier = parsed.service_tier ?? null;
      } catch {
        // non-JSON error body; no usage
      }
    }
    const ok = upstreamResponse.status < 400;
    // A successful call without usage is charged the full reservation, so the cap stays hard.
    const costUsd = usage ? costOf(model, usage) : ok ? estimate : 0;
    ledgerEntry = {
      ...ledgerEntry,
      status: upstreamResponse.status,
      latencyMs: Date.now() - startedAt,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
      cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
      usageMissing: ok && !usage,
      costUsd,
      finishReason,
      serviceTier,
      rateLimit: rateLimitHeaders(upstreamResponse.headers),
    };
    recorded = { status: upstreamResponse.status, contentType, body: text };
  } catch (error) {
    ledgerEntry = { ...ledgerEntry, status: 599, costUsd: 0, error: String(error) };
    if (!response.headersSent) sendJson(response, 502, { error: { message: `gateway: upstream failure ${error}` } });
    else response.end();
  } finally {
    reservedByRun.set(runId, reservedByRun.get(runId) - estimate);
    reservedGlobal -= estimate;
  }
  appendLedger(ledgerEntry);
  if (recorded.status) {
    const record = { key, ts: ledgerEntry.ts, request: { apiPath, body }, response: recorded };
    fs.appendFileSync(path.join(cassetteDir, `${runId}.jsonl`), JSON.stringify(record) + '\n');
    if (recorded.status < 400) cassetteFor(runId).set(key, record);
  }
}

http
  .createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (!response.headersSent) sendJson(response, 500, { error: { message: `gateway: ${error}` } });
      else response.end();
    });
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`gateway on 127.0.0.1:${port}, spent so far $${spentGlobal.toFixed(4)}, cassettes in ${cassetteDir}`);
  });

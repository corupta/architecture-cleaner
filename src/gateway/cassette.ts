// Cassettes (plan §3.6): one JSONL record per call, keyed by the request hash plus the occurrence of that hash in the
// gateway instance. A record holds only reproducible content (the exact body sent, the status, a few headers, the raw
// body text, usage and cost); timestamps and latency go to the ledger.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Usage } from './types.js';

export interface RecordedResponse {
  status: number;
  /** x-ratelimit-*, x-request-id and retry-after only. */
  headers: Record<string, string>;
  /** The raw response body text. */
  body: string;
}

export interface CassetteRecord {
  key: string;
  hash: string;
  occurrence: number;
  runId: string;
  /** The Token Factory model id. */
  model: string;
  /** The exact body sent. */
  request: unknown;
  response: RecordedResponse;
  usage: Usage | null;
  costUsd: number;
}

const codeUnitOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** JSON with object keys sorted recursively and undefined members dropped, so key order never changes a hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort(codeUnitOrder);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** sha256 of the canonical {model, messages, tools, params}, where params is the rest of the body. */
export function requestHash(body: object): string {
  const { model, messages, tools, ...params } = body as Record<string, unknown>;
  return crypto.createHash('sha256').update(canonicalJson({ model, messages, tools: tools ?? null, params })).digest('hex');
}

export function recordedHeaders(headers: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {};
  const names = Object.keys(headers).sort(codeUnitOrder);
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.startsWith('x-ratelimit-') || lower === 'x-request-id' || lower === 'retry-after') picked[lower] = headers[name]!;
  }
  return picked;
}

/** Records by key; when a key repeats (a re-recording appended later), the last record wins. */
export function loadCassette(cassettePath: string): Map<string, CassetteRecord> {
  const byKey = new Map<string, CassetteRecord>();
  if (!fs.existsSync(cassettePath)) return byKey;
  const lines = fs.readFileSync(cassettePath, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const record = JSON.parse(line) as CassetteRecord;
    if (typeof record.key !== 'string' || typeof record.response?.status !== 'number' || typeof record.response.body !== 'string') {
      throw new Error(`${cassettePath}:${index + 1}: not a cassette record`);
    }
    byKey.set(record.key, record);
  });
  return byKey;
}

export function appendCassette(cassettePath: string, record: CassetteRecord): void {
  fs.mkdirSync(path.dirname(cassettePath), { recursive: true });
  fs.appendFileSync(cassettePath, `${JSON.stringify(record)}\n`);
}

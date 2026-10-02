// Ledger totals for one G3 run window: node g3/cost.mjs <runId> <startedAtISO> <finishedAtISO>
import fs from 'node:fs';
const [runId, from, to] = process.argv.slice(2);
const entries = fs.readFileSync(new URL('../llm/ledger.jsonl', import.meta.url), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  .filter((entry) => entry.runId === runId && entry.model && entry.ts >= from && entry.ts <= (to ?? '9999'));
const sum = (field) => entries.reduce((total, entry) => total + (entry[field] ?? 0), 0);
console.log(JSON.stringify({
  runId, calls: entries.filter((entry) => entry.status === 200).length, refused: entries.filter((entry) => entry.refused).length,
  errors: entries.filter((entry) => entry.status >= 400 && !entry.refused).length,
  promptTokens: sum('promptTokens'), completionTokens: sum('completionTokens'), reasoningTokens: sum('reasoningTokens'),
  costUsd: +sum('costUsd').toFixed(4), maxPromptTokens: Math.max(0, ...entries.map((entry) => entry.promptTokens ?? 0)),
}));

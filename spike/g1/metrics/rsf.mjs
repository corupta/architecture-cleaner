// ARCADE RSF: one fact per line, `<relation> <a> <b>`. Partitions are `contain <cluster> <object>`
// lines (MoJo ground truth, ARCADE clusterings); dependency graphs are `depends <from> <to>`.
// Tokens are whitespace-separated; a token with whitespace is wrapped in double quotes, which the
// parser strips. Blank lines are skipped; any other line must have exactly 3 tokens (as in
// ARCADE's MoJoCalculator readers).
import fs from 'node:fs';
import { toPartitionMap } from './partition.mjs';

const tokenPattern = /"[^"]*"|\S+/g;

export function parseRsfFacts(text) {
  const facts = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const tokens = (line.match(tokenPattern) ?? []).map(unquote);
    if (tokens.length !== 3) throw new SyntaxError(`RSF line ${index + 1}: expected 3 tokens, got ${tokens.length}: ${line}`);
    facts.push({ relation: tokens[0], a: tokens[1], b: tokens[2], line: index + 1 });
  });
  return facts;
}

// Map<objectId, clusterId> from `contain` facts (case-insensitive, other relations ignored, like
// MoJoCalculator). An object listed twice is not a partition and throws.
export function parseRsf(text) {
  const partition = new Map();
  for (const { relation, a: clusterId, b: objectId, line } of parseRsfFacts(text)) {
    if (relation.toLowerCase() !== 'contain') continue;
    if (partition.has(objectId)) throw new SyntaxError(`RSF line ${line}: object ${objectId} already in cluster ${partition.get(objectId)}`);
    partition.set(objectId, clusterId);
  }
  return partition;
}

export function formatRsf(partition) {
  let text = '';
  for (const [objectId, clusterId] of toPartitionMap(partition)) {
    text += `contain ${quote(String(clusterId))} ${quote(String(objectId))}\n`;
  }
  return text;
}

export function readRsf(path) {
  return parseRsf(fs.readFileSync(path, 'utf8'));
}

export function writeRsf(path, partition) {
  fs.writeFileSync(path, formatRsf(partition));
}

// Edges `{ from, to }` from every fact regardless of relation, like ARCADE DependencyGraph.readRsf.
export function parseDependencyRsf(text) {
  return parseRsfFacts(text).map(({ a, b }) => ({ from: a, to: b }));
}

export function readDependencyRsf(path) {
  return parseDependencyRsf(fs.readFileSync(path, 'utf8'));
}

function unquote(token) {
  return token.length >= 2 && token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token;
}

function quote(token) {
  if (!token || token.includes('"')) throw new RangeError(`token not representable in RSF: ${JSON.stringify(token)}`);
  return /\s/.test(token) ? `"${token}"` : token;
}

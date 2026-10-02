// Deterministic baselines for G1 (plan §6): B0 type-folders, name-token, Louvain, seeds + label propagation.
// They see only the scrambled view: { nodes: [{ key, type, exports, tables, decorators }], edges: [{ from, to, weight }] }.
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import path from 'node:path';

// Anchor roles name a domain noun (album.service.ts); controllers/resolvers are excluded because Hono-style
// repos name them after verbs (create-task.ts), and Nest repos have a noun service next to each anyway.
const entityRoles = new Set(['module', 'service', 'repository', 'entity', 'model', 'route', 'schema', 'table']);
const genericTokens = new Set(['get', 'create', 'update', 'delete', 'remove', 'list', 'set', 'is', 'has', 'handle', 'by', 'from', 'to', 'all',
  'new', 'sync', 'import', 'export', 'validate', 'check', 'build', 'parse', 'use', 'with', 'for', 'and', 'of', 'the', 'a', 'on', 'in', 'add',
  'find', 'fetch', 'send', 'make', 'load', 'save', 'run', 'process', 'resolve', 'test', 'mock', 'base', 'default', 'main', 'app', 'api',
  'bulk', 'count', 'move', 'next', 'can', 'should', 'ensure', 'assert', 'normalize', 'format', 'map', 'to', 'v2', 'v1']);
const roleSuffix = /\.(controller|service|module|resolver|model|entity|dto|args|input|guard|strategy|decorator|interceptor|filter|pipe|middleware|repository|gateway|processor|mapper|schema|interface|enum|constants|config|handler|command|query|event|subscriber|validator|mock)$/;
const roleWordsInStem = new Set(['controller', 'service', 'module', 'resolver', 'model', 'entity', 'dto', 'guard', 'strategy', 'decorator', 'interceptor', 'repository', 'handler', 'index', 'schema', 'types', 'type', 'util', 'utils', 'helper', 'helpers']);

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const singular = (token) => (token.length > 3 && token.endsWith('ies') ? `${token.slice(0, -3)}y` : token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token);

export function nameTokens(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase().split(/[-._]+/).filter(Boolean).map(singular).filter((token) => !roleWordsInStem.has(token));
}

export function stemTokens(key) {
  return nameTokens(path.posix.basename(key).replace(/\.(ts|tsx|mts|cts)$/, '').replace(roleSuffix, ''));
}

// Tokens of the primary exported symbol (TeamCollectionService → team-collection); survives opaque file names (H1).
export function exportTokens(node) {
  const symbol = node.primaryExport ?? node.exports?.[0];
  return symbol && symbol !== 'default' ? nameTokens(symbol) : [];
}

export function typeFolders(view, moduleRoot) {
  const assignment = new Map();
  for (const node of view.nodes) {
    const relative = node.key.startsWith(`${moduleRoot}/`) ? node.key.slice(moduleRoot.length + 1) : node.key;
    const segments = relative.split('/');
    assignment.set(node.key, segments.length > 1 ? segments[0] : 'root');
  }
  return assignment;
}

export function nameTokenFullStem(view) {
  const assignment = new Map();
  for (const node of view.nodes) assignment.set(node.key, stemTokens(node.key).join('-') || '(empty)');
  return assignment;
}

function findSubsequence(tokens, anchor) {
  for (let start = 0; start + anchor.length <= tokens.length; start++) {
    if (anchor.every((token, offset) => tokens[start + offset] === token)) return start;
  }
  return -1;
}

// Anchors = stems of entity-like files, plus 1-2 token sequences shared by >= 3 stems (minus generic verbs).
// Every file joins the longest anchor found inside its tokens ("prefix merging", research 03b §6).
export function anchorsOf(view, tokensOf = (node) => stemTokens(node.key)) {
  const anchors = new Map();
  const frequency = new Map();
  for (const node of view.nodes) {
    const tokens = tokensOf(node);
    if (entityRoles.has(node.type) && tokens.length) anchors.set(tokens.join('-'), tokens);
    const seen = new Set();
    for (let start = 0; start < tokens.length; start++) {
      for (const length of [1, 2]) {
        const slice = tokens.slice(start, start + length);
        if (slice.length !== length || slice.some((token) => genericTokens.has(token) || token.length < 3)) continue;
        seen.add(slice.join('-'));
      }
    }
    for (const key of seen) frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }
  for (const [key, count] of frequency) if (count >= 3 && !anchors.has(key)) anchors.set(key, key.split('-'));
  return [...anchors.values()].sort((a, b) => b.length - a.length || (frequency.get(b.join('-')) ?? 0) - (frequency.get(a.join('-')) ?? 0) || a.join('-').localeCompare(b.join('-')));
}

export function nameTokenAnchored(view, tokensOf = (node) => stemTokens(node.key)) {
  const anchors = anchorsOf(view, tokensOf);
  const assignment = new Map();
  const matched = new Map();
  for (const node of view.nodes) {
    const tokens = tokensOf(node);
    let best = null;
    for (const anchor of anchors) {
      const position = findSubsequence(tokens, anchor);
      if (position >= 0 && (!best || anchor.length > best.anchor.length || (anchor.length === best.anchor.length && position < best.position))) best = { anchor, position };
    }
    assignment.set(node.key, best ? best.anchor.join('-') : tokens.join('-') || `(empty)/${node.key}`);
    matched.set(node.key, Boolean(best));
  }
  return { assignment, matched };
}

function undirectedGraph(view) {
  const graph = new Graph({ type: 'undirected' });
  for (const node of view.nodes) graph.addNode(node.key);
  for (const edge of view.edges) {
    if (edge.from === edge.to || !graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;
    if (graph.hasEdge(edge.from, edge.to)) graph.updateEdgeAttribute(edge.from, edge.to, 'weight', (weight) => weight + edge.weight);
    else graph.addEdge(edge.from, edge.to, { weight: edge.weight });
  }
  return graph;
}

export function louvainClusters(view, { seed = 1, resolution = 1 } = {}) {
  const graph = undirectedGraph(view);
  const communities = louvain(graph, { getEdgeWeight: 'weight', resolution, rng: mulberry32(seed) });
  return new Map(view.nodes.map((node) => [node.key, `louvain-${communities[node.key]}`]));
}

// Seeds (anchored name tokens on entity-like files) + weighted label propagation for the rest.
// Returns the draft plan the planner starts from, with per-file confidence and a contested list.
export function seedsWithPropagation(view, { iterations = 10, sharedSpread = 3, tokensOf } = {}) {
  const { assignment: anchored, matched } = nameTokenAnchored(view, tokensOf);
  const graph = undirectedGraph(view);
  const labels = new Map();
  const confidence = new Map();
  const anchorLabels = new Set(anchorsOf(view, tokensOf).map((anchor) => anchor.join('-')));
  for (const node of view.nodes) {
    if (matched.get(node.key) && anchorLabels.has(anchored.get(node.key))) {
      labels.set(node.key, anchored.get(node.key));
      confidence.set(node.key, 'seed');
    }
  }
  const unlabeled = view.nodes.map((node) => node.key).filter((key) => !labels.has(key)).sort();
  for (let round = 0; round < iterations; round++) {
    let changed = 0;
    for (const key of unlabeled) {
      const votes = new Map();
      graph.forEachEdge(key, (_edge, attributes, source, target) => {
        const neighbor = source === key ? target : source;
        const label = labels.get(neighbor);
        if (label && label !== 'shared') votes.set(label, (votes.get(label) ?? 0) + attributes.weight);
      });
      if (!votes.size) continue;
      const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
      const [topLabel, topWeight] = ranked[0];
      const next = ranked.length >= sharedSpread && topWeight / total <= 0.5 ? 'shared' : topLabel;
      if (labels.get(key) !== next) {
        labels.set(key, next);
        confidence.set(key, next === 'shared' ? 'contested' : topWeight / total >= 0.75 ? 'propagated-strong' : 'propagated-weak');
        changed++;
      }
    }
    if (!changed) break;
  }
  for (const key of unlabeled) {
    if (!labels.has(key)) {
      labels.set(key, anchored.get(key));
      confidence.set(key, 'isolated');
    }
  }
  const contested = [...confidence.entries()].filter(([, level]) => level === 'contested' || level === 'propagated-weak' || level === 'isolated').map(([key]) => key).sort();
  return { assignment: labels, confidence, contested };
}

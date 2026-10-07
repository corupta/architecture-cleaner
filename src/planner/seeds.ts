// The deterministic seeds draft (plan §3.5 step 2), ported from the G1 spike's `seedsWithPropagation`: entity-like
// files seed a label from the anchor their name contains (longest anchor wins: "prefix merging"), and weighted label
// propagation over the undirected edge graph labels the rest, with a per-file confidence and a contested list.
//
// The spike's algorithm and constants are kept. The only intended behaviour difference with every rule below off:
// ties are broken by code-unit order (a < b) where the spike used localeCompare. Isolated files with no name tokens
// get a kebab label of their path instead of the spike's `(empty)/<path>`.
//
// Three rules from corupta's review of the G1 immich plan, each on by default:
//   (a) audienceQualifiers: `admin`, `public`, `internal` are dropped from a name's tokens when other tokens remain
//       (auth-admin.service → auth, config-public.controller → config), so an audience variant joins its feature.
//   (b) genericAnchors: an anchor made only of generic names (app, api, main, …) is never an anchor; files whose only
//       anchor would be one fall through to propagation (app.module.ts, api.service.ts).
//   (c) registries: files with role `registry` (DI/route tables) get label `registry` with confidence `seed`; neither
//       `shared` nor `registry` votes in propagation, so composition roots don't pull their members into one group.
import path from 'node:path';
import type { Confidence, Draft, Facts } from './types.js';

export interface SeedOptions {
  /** Label-propagation rounds. */
  iterations?: number;
  /** A file whose votes spread over at least this many labels, none above half, is `shared`. */
  sharedSpread?: number;
  /** Rule (a). */
  audienceQualifiers?: boolean;
  /** Rule (b). */
  genericAnchors?: boolean;
  /** Rule (c). */
  registries?: boolean;
}

interface SeedNode {
  key: string;
  type: string;
  exports: string[];
  primaryExport: string | null;
}

// Anchor roles name a domain noun (album.service.ts); controllers/resolvers are excluded because Hono-style
// repos name them after verbs (create-task.ts), and Nest repos have a noun service next to each anyway.
const entityRoles = new Set(['module', 'service', 'repository', 'entity', 'model', 'route', 'schema', 'table']);
const genericTokens = new Set(['get', 'create', 'update', 'delete', 'remove', 'list', 'set', 'is', 'has', 'handle', 'by', 'from', 'to', 'all',
  'new', 'sync', 'import', 'export', 'validate', 'check', 'build', 'parse', 'use', 'with', 'for', 'and', 'of', 'the', 'a', 'on', 'in', 'add',
  'find', 'fetch', 'send', 'make', 'load', 'save', 'run', 'process', 'resolve', 'test', 'mock', 'base', 'default', 'main', 'app', 'api',
  'bulk', 'count', 'move', 'next', 'can', 'should', 'ensure', 'assert', 'normalize', 'format', 'map', 'v2', 'v1']);
const roleSuffix = /\.(controller|service|module|resolver|model|entity|dto|args|input|guard|strategy|decorator|interceptor|filter|pipe|middleware|repository|gateway|processor|mapper|schema|interface|enum|constants|config|handler|command|query|event|subscriber|validator|mock)$/;
const roleWordsInStem = new Set(['controller', 'service', 'module', 'resolver', 'model', 'entity', 'dto', 'guard', 'strategy', 'decorator', 'interceptor', 'repository', 'handler', 'index', 'schema', 'types', 'type', 'util', 'utils', 'helper', 'helpers']);
const audienceQualifiers = new Set(['admin', 'public', 'internal']);
const genericNames = new Set(['app', 'api', 'main', 'index', 'common', 'core', 'base', 'misc', 'general', 'helper', 'util', 'lib', 'manager', 'shared', 'platform', 'default']);

const singular = (token: string) => (token.length > 3 && token.endsWith('ies') ? `${token.slice(0, -3)}y`
  : token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `TeamCollectionService` / `team-collections.service` → team, collection (singular, role words dropped). */
export function nameTokens(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase()
    .split(/[-._]+/).filter(Boolean).map(singular).filter((token) => !roleWordsInStem.has(token));
}

/** Tokens of the file name without extension and role suffix: `src/services/shared-link.service.ts` → shared, link. */
export function stemTokens(key: string): string[] {
  return nameTokens(path.posix.basename(key).replace(/\.(ts|tsx|mts|cts)$/, '').replace(roleSuffix, ''));
}

/** Tokens of the primary exported symbol (TeamCollectionService → team, collection); survives opaque file names. */
export function exportTokens(node: { primaryExport: string | null; exports: string[] }): string[] {
  const symbol = node.primaryExport ?? node.exports[0];
  return symbol && symbol !== 'default' ? nameTokens(symbol) : [];
}

function findSubsequence(tokens: string[], anchor: string[]): number {
  for (let start = 0; start + anchor.length <= tokens.length; start++) {
    if (anchor.every((token, offset) => tokens[start + offset] === token)) return start;
  }
  return -1;
}

/**
 * Anchors = stems of entity-like files, plus 1-2 token sequences shared by >= 3 stems (minus generic verbs), longest
 * first, then most frequent, then by name. With rule (b), anchors made only of generic names are dropped.
 */
function anchorsOf(nodes: SeedNode[], tokensOf: (node: SeedNode) => string[], banGeneric: boolean): string[][] {
  const anchors = new Map<string, string[]>();
  const frequency = new Map<string, number>();
  const allowed = (tokens: string[]) => !banGeneric || !tokens.every((token) => genericNames.has(token));
  for (const node of nodes) {
    const tokens = tokensOf(node);
    if (entityRoles.has(node.type) && tokens.length && allowed(tokens)) anchors.set(tokens.join('-'), tokens);
    const seen = new Set<string>();
    for (let start = 0; start < tokens.length; start++) {
      for (const length of [1, 2]) {
        const slice = tokens.slice(start, start + length);
        if (slice.length !== length || slice.some((token) => genericTokens.has(token) || token.length < 3)) continue;
        seen.add(slice.join('-'));
      }
    }
    for (const key of seen) frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }
  for (const [key, count] of frequency) if (count >= 3 && !anchors.has(key) && allowed(key.split('-'))) anchors.set(key, key.split('-'));
  return [...anchors.values()].sort((a, b) => b.length - a.length
    || (frequency.get(b.join('-')) ?? 0) - (frequency.get(a.join('-')) ?? 0) || compare(a.join('-'), b.join('-')));
}

/** The longest anchor inside a file's tokens (earliest on a tie), or null. */
function bestAnchor(tokens: string[], anchors: string[][]): string[] | null {
  let best: { anchor: string[]; position: number } | null = null;
  for (const anchor of anchors) {
    const position = findSubsequence(tokens, anchor);
    if (position >= 0 && (!best || anchor.length > best.anchor.length || (anchor.length === best.anchor.length && position < best.position))) best = { anchor, position };
  }
  return best?.anchor ?? null;
}

export function seedDraft(facts: Facts, options: SeedOptions = {}): Draft {
  const { iterations = 10, sharedSpread = 3, audienceQualifiers: dropQualifiers = true, genericAnchors: banGeneric = true, registries = true } = options;
  const nodes: SeedNode[] = facts.files.map((file) => ({ key: file.path, type: file.role, exports: file.exports, primaryExport: file.primaryExport }));
  const tokensOf = (node: SeedNode) => {
    const tokens = stemTokens(node.key);
    const unqualified = dropQualifiers ? tokens.filter((token) => !audienceQualifiers.has(token)) : tokens;
    return unqualified.length ? unqualified : tokens;
  };
  const anchors = anchorsOf(nodes, tokensOf, banGeneric);

  // Undirected weighted graph: both directions of a pair add up (graphology's merge in the spike).
  const neighbors = new Map<string, Map<string, number>>(nodes.map((node) => [node.key, new Map()]));
  for (const edge of facts.edges) {
    const fromNeighbors = neighbors.get(edge.from);
    const toNeighbors = neighbors.get(edge.to);
    if (edge.from === edge.to || !fromNeighbors || !toNeighbors) continue;
    fromNeighbors.set(edge.to, (fromNeighbors.get(edge.to) ?? 0) + edge.weight);
    toNeighbors.set(edge.from, (toNeighbors.get(edge.from) ?? 0) + edge.weight);
  }

  const labels = new Map<string, string>();
  const confidence = new Map<string, Confidence>();
  const fallbackLabel = new Map<string, string>();
  for (const node of nodes) {
    const tokens = tokensOf(node);
    const anchor = bestAnchor(tokens, anchors);
    if (registries && node.type === 'registry') {
      labels.set(node.key, 'registry');
      confidence.set(node.key, 'seed');
    } else if (anchor) {
      labels.set(node.key, anchor.join('-'));
      confidence.set(node.key, 'seed');
    } else {
      const named = tokens.length ? tokens : exportTokens(node);
      fallbackLabel.set(node.key, named.length ? named.join('-') : node.key.replace(/\.(ts|tsx|mts|cts)$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    }
  }
  const silent = new Set(registries ? ['shared', 'registry'] : ['shared']);
  const unlabeled = nodes.map((node) => node.key).filter((key) => !labels.has(key)).sort(compare);
  for (let round = 0; round < iterations; round++) {
    let changed = 0;
    for (const key of unlabeled) {
      const votes = new Map<string, number>();
      for (const [neighbor, weight] of neighbors.get(key)!) {
        const label = labels.get(neighbor);
        if (label && !silent.has(label)) votes.set(label, (votes.get(label) ?? 0) + weight);
      }
      if (!votes.size) continue;
      const ranked = [...votes].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]));
      const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
      const [topLabel, topWeight] = ranked[0]!;
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
      labels.set(key, fallbackLabel.get(key)!);
      confidence.set(key, 'isolated');
    }
  }

  const assignment = new Map(nodes.map((node) => [node.key, labels.get(node.key)!]));
  const levels = new Map(nodes.map((node) => [node.key, confidence.get(node.key)!]));
  const contested = nodes.map((node) => node.key)
    .filter((key) => ['contested', 'propagated-weak', 'isolated'].includes(levels.get(key)!)).sort(compare);
  return { assignment, confidence: levels, contested };
}

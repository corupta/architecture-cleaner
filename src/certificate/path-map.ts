// Infers the pathMap of a diff from the two committed trees alone (plan §3.4 Independence): unchanged blobs
// keep their path; every other base file is matched to a head file by its content hash, first byte-exact, then
// with specifier spans blanked. Ties among identical candidates are broken by basename and path similarity. A
// wrong tie-break can only make later checks fail (a false rejection), never pass: every check is evaluated
// under the inferred map, and the certificate claims "a pure move under this map". Last, a source file still
// unpaired may pair with one whose import layout alone differs too (moved, then re-wrapped: S3 in one range), when
// that key is unique on both sides; K2 then holds the pair to its layout class (layout.ts).
import path from 'node:path';
import type { CommitTree } from './git-tree.js';
import { importLayoutKey } from './layout.js';
import type { SpanView } from './spans.js';

export interface PathMap {
  /** Every matched base path → its head path (identity included). */
  forward: ReadonlyMap<string, string>;
  /** Head path → base path. */
  inverse: ReadonlyMap<string, string>;
  /** Only the entries whose path changed. */
  moves: ReadonlyMap<string, string>;
  /** Base paths with no counterpart in head (deleted). */
  deleted: string[];
  /** Head paths with no counterpart in base (added); `copyOf` names a base file with the same content. */
  added: { path: string; copyOf?: string }[];
  /** Groups of identical candidates that needed a tie-break. */
  ambiguous: { key: string; sources: string[]; destinations: string[] }[];
  /** base path → head path, or the path itself for unmatched ones. */
  map(file: string): string;
}

type Views = (file: string) => SpanView | undefined;

/** Higher is a better pairing for two files with identical content. */
function similarity(from: string, to: string): number {
  const a = from.split('/');
  const b = to.split('/');
  let suffix = 0;
  while (suffix < a.length && suffix < b.length && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  let prefix = 0;
  while (prefix < a.length - 1 && prefix < b.length - 1 && a[prefix] === b[prefix]) prefix++;
  return (path.posix.basename(from) === path.posix.basename(to) ? 1_000_000 : 0) + suffix * 1000 + prefix;
}

/**
 * Pairs equal-key sources and destinations: first where the unambiguous files of the source's directory went (two
 * identical `index.ts` barrels follow their own feature's files), then by similarity, then lexical order (deterministic).
 */
function pairGroup(sources: string[], destinations: string[], destinationDirectory: (directory: string) => string | undefined): [string, string][] {
  if (sources.length === 1 && destinations.length === 1) return [[sources[0]!, destinations[0]!]];
  const candidates: { from: string; to: string; score: number }[] = [];
  for (const from of sources) {
    const followed = destinationDirectory(path.posix.dirname(from));
    for (const to of destinations) candidates.push({ from, to, score: (followed === path.posix.dirname(to) ? 1_000_000_000 : 0) + similarity(from, to) });
  }
  candidates.sort((x, y) => y.score - x.score || x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  const pairs: [string, string][] = [];
  for (const { from, to } of candidates) {
    if (usedFrom.has(from) || usedTo.has(to)) continue;
    usedFrom.add(from);
    usedTo.add(to);
    pairs.push([from, to]);
  }
  return pairs;
}

/** Directory → the directory most of its matched files went to (none on a tie). */
function directoryVotes(forward: ReadonlyMap<string, string>): (directory: string) => string | undefined {
  const votes = new Map<string, Map<string, number>>();
  for (const [from, to] of forward) {
    const counts = votes.get(path.posix.dirname(from)) ?? new Map<string, number>();
    counts.set(path.posix.dirname(to), (counts.get(path.posix.dirname(to)) ?? 0) + 1);
    votes.set(path.posix.dirname(from), counts);
  }
  return (directory) => {
    const ranked = [...(votes.get(directory) ?? [])].sort(([, a], [, b]) => b - a);
    return ranked.length && (ranked.length === 1 || ranked[0]![1] > ranked[1]![1]) ? ranked[0]![0] : undefined;
  };
}

export function inferPathMap(base: CommitTree, head: CommitTree, baseViews: Views, headViews: Views): PathMap {
  const forward = new Map<string, string>();
  const inverse = new Map<string, string>();
  const link = (from: string, to: string) => {
    forward.set(from, to);
    inverse.set(to, from);
  };
  for (const [file, entry] of base.entries) if (head.entries.get(file)?.oid === entry.oid) link(file, file);
  let sources = [...base.entries.keys()].filter((file) => !forward.has(file));
  let destinations = [...head.entries.keys()].filter((file) => !inverse.has(file));
  base.prefetch(sources);
  head.prefetch(destinations);

  // Edited in place, same modulo specifiers: an importer whose specifiers were rewritten.
  const headSet = new Set(destinations);
  for (const file of sources) {
    if (headSet.has(file) && baseViews(file)?.key === headViews(file)?.key) link(file, file);
  }
  sources = sources.filter((file) => !forward.has(file));
  destinations = destinations.filter((file) => !inverse.has(file));

  const ambiguous: PathMap['ambiguous'] = [];
  type KeyOf = (tree: 'base' | 'head', file: string) => string | undefined;
  const oidOf: KeyOf = (tree, file) => (tree === 'base' ? base : head).entries.get(file)?.oid;
  const spanKeyOf: KeyOf = (tree, file) => (tree === 'base' ? baseViews : headViews)(file)?.key;
  const groupsBy = (keyOf: KeyOf) => {
    const groups = new Map<string, { sources: string[]; destinations: string[] }>();
    const group = (key: string) => {
      let entry = groups.get(key);
      if (!entry) groups.set(key, (entry = { sources: [], destinations: [] }));
      return entry;
    };
    for (const file of sources) {
      const key = keyOf('base', file);
      if (key !== undefined) group(key).sources.push(file);
    }
    for (const file of destinations) {
      const key = keyOf('head', file);
      if (key !== undefined) group(key).destinations.push(file);
    }
    return [...groups].filter(([, entry]) => entry.sources.length && entry.destinations.length);
  };
  const unlinked = () => {
    sources = [...base.entries.keys()].filter((file) => !forward.has(file));
    destinations = [...head.entries.keys()].filter((file) => !inverse.has(file));
  };
  // Unique matches first, by blob then modulo specifiers; groups of identical candidates wait for that evidence.
  const deferred: { key: string; sources: string[]; destinations: string[] }[] = [];
  for (const keyOf of [oidOf, spanKeyOf]) {
    for (const [key, entry] of groupsBy(keyOf)) {
      if (entry.sources.length === 1 && entry.destinations.length === 1) link(entry.sources[0]!, entry.destinations[0]!);
      else deferred.push({ key, ...entry });
    }
    const waiting = { sources: new Set(deferred.flatMap((group) => group.sources)), destinations: new Set(deferred.flatMap((group) => group.destinations)) };
    sources = sources.filter((file) => !forward.has(file) && !waiting.sources.has(file));
    destinations = destinations.filter((file) => !inverse.has(file) && !waiting.destinations.has(file));
  }
  const destinationDirectory = directoryVotes(forward);
  const pairAmbiguous = (key: string, groupSources: string[], groupDestinations: string[]) => {
    const free = { sources: groupSources.filter((file) => !forward.has(file)), destinations: groupDestinations.filter((file) => !inverse.has(file)) };
    if (!free.sources.length || !free.destinations.length) return;
    ambiguous.push({ key, sources: [...free.sources].sort(), destinations: [...free.destinations].sort() });
    for (const [from, to] of pairGroup(free.sources, free.destinations, destinationDirectory)) link(from, to);
  };
  for (const group of deferred) pairAmbiguous(group.key, group.sources, group.destinations);
  // What uneven groups left over may still match modulo specifiers.
  unlinked();
  for (const [key, entry] of groupsBy(spanKeyOf)) {
    if (entry.sources.length === 1 && entry.destinations.length === 1) link(entry.sources[0]!, entry.destinations[0]!);
    else pairAmbiguous(key, entry.sources, entry.destinations);
  }
  unlinked();

  // Same path on both sides but different beyond specifiers: still that file (K2 reports the edit).
  const remaining = new Set(destinations);
  for (const file of sources) if (remaining.has(file)) link(file, file);
  sources = sources.filter((file) => !forward.has(file));
  destinations = destinations.filter((file) => !inverse.has(file));

  // Moved and re-wrapped: the same modulo specifiers and the layout of its import and `export … from` declarations.
  // Only unique keys pair; no tie-break.
  if (sources.length && destinations.length) {
    const layoutKeyOf: KeyOf = (tree, file) => {
      const view = (tree === 'base' ? baseViews : headViews)(file);
      return view?.source ? importLayoutKey(file, view) : undefined;
    };
    for (const [, entry] of groupsBy(layoutKeyOf)) if (entry.sources.length === 1 && entry.destinations.length === 1) link(entry.sources[0]!, entry.destinations[0]!);
    unlinked();
  }

  const baseByOid = new Map<string, string>();
  for (const [file, entry] of base.entries) if (!baseByOid.has(entry.oid)) baseByOid.set(entry.oid, file);
  // Copies modulo specifiers: only computed when something was added (it reads every base blob).
  const baseByKey = new Map<string, string>();
  if (destinations.length) {
    base.prefetch(base.entries.keys());
    for (const file of base.entries.keys()) {
      const key = baseViews(file)?.key;
      if (key && !baseByKey.has(key)) baseByKey.set(key, file);
    }
  }
  const added = destinations.sort().map((file) => {
    const copyOf = baseByOid.get(head.entries.get(file)!.oid) ?? (head.entries.get(file)!.mode !== '160000' ? baseByKey.get(headViews(file)?.key ?? '') : undefined);
    return copyOf ? { path: file, copyOf } : { path: file };
  });
  const moves = new Map([...forward].filter(([from, to]) => from !== to).sort(([a], [b]) => a.localeCompare(b)));
  return { forward, inverse, moves, deleted: sources.sort(), added, ambiguous, map: (file) => forward.get(file) ?? file };
}

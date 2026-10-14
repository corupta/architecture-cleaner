// A file's text split around its recognized specifier spans (the inside of each reference-site literal).
// Two versions of a file are the same modulo specifiers iff their chunk lists are equal (plan §3.4 K2); the
// pathMap is inferred by hashing exactly that view (plan §3.4 Independence).
import { createHash } from 'node:crypto';
import { isShebangScript, isSourceFile } from '../analyzer/analyze.js';
import { extractSites } from '../analyzer/reference-sites.js';
import type { ReferenceSite } from '../analyzer/types.js';
import { type CommitTree, isUtf8 } from './git-tree.js';

export interface SpanView {
  /** Text outside the spans, in order: chunks.length === sites.length + 1 for source files. */
  chunks: string[];
  sites: ReferenceSite[];
  /** Raw text of each span (inside the quotes, escapes as written). */
  raw: string[];
  /** Hash of chunks + site kinds: equal keys mean "same file modulo specifier text". */
  key: string;
  source: boolean;
  utf8: boolean;
}

/** JS/TS by extension, or an extensionless script whose shebang runs Node or a TypeScript runtime (`bin/www`, tsx, bun, deno). */
export function isScannedSource(file: string, text: string): boolean {
  return isSourceFile(file) || isShebangScript(file, text);
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function spanView(file: string, bytes: Buffer): SpanView {
  const utf8 = isUtf8(bytes);
  const text = bytes.toString('utf8');
  if (!utf8 || !isScannedSource(file, text)) {
    return { chunks: [text], sites: [], raw: [], key: `raw:${createHash('sha256').update(bytes).digest('hex')}`, source: false, utf8 };
  }
  const { sites } = extractSites(file, text);
  const chunks: string[] = [];
  const raw: string[] = [];
  let offset = 0;
  for (const site of sites) {
    chunks.push(text.slice(offset, site.start));
    raw.push(text.slice(site.start, site.end));
    offset = site.end;
  }
  chunks.push(text.slice(offset));
  const key = `src:${hash(JSON.stringify([chunks, sites.map((site) => site.kind)]))}`;
  return { chunks, sites, raw, key, source: true, utf8 };
}

/** Span views per path, computed once per tree. */
export function spanViews(tree: CommitTree): (file: string) => SpanView | undefined {
  const cache = new Map<string, SpanView>();
  return (file) => {
    const cached = cache.get(file);
    if (cached) return cached;
    const entry = tree.entries.get(file);
    if (!entry || entry.mode === '160000') return undefined;
    const bytes = tree.bytes(file);
    if (!bytes) return undefined;
    // Symlink blobs are link text, never parsed as code.
    const view = entry.mode === '120000' ? { chunks: [bytes.toString('utf8')], sites: [], raw: [], key: `link:${bytes.toString('utf8')}`, source: false, utf8: true } : spanView(file, bytes);
    cache.set(file, view);
    return view;
  };
}

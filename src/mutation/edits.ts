// Mutant trees as edits to the good head, plus the two building blocks most operators share: respelling a
// specifier in its own form class (relative stays relative, an alias keeps its prefix, the ending style stays) and
// a "correct" move of one file (its importers and its own relative specifiers rewritten, nothing else).
import path from 'node:path';
import type { ReferenceSite } from '../analyzer/types.js';
import type { Subject } from './subject.js';

export interface FileContent {
  bytes: Buffer;
  mode: string;
}

/** Path → new content, or null for a deletion; every other path keeps the good head's entry. */
export type TreeEdits = Map<string, FileContent | null>;

export interface SpanReplacement {
  start: number;
  end: number;
  text: string;
}

export function replaceSpans(text: string, replacements: readonly SpanReplacement[]): string {
  let result = '';
  let offset = 0;
  for (const replacement of [...replacements].sort((a, b) => a.start - b.start)) {
    result += text.slice(offset, replacement.start) + replacement.text;
    offset = replacement.end;
  }
  return result + text.slice(offset);
}

export const headText = (subject: Subject, file: string) => subject.headTree.text(file);
export const headMode = (subject: Subject, file: string) => subject.headTree.entries.get(file)?.mode ?? '100644';

/** One file of the head with its text replaced (mode kept). */
export function editFile(subject: Subject, file: string, text: string): TreeEdits {
  return new Map([[file, { bytes: Buffer.from(text, 'utf8'), mode: headMode(subject, file) }]]);
}

/** One file of the head with some spans replaced; null when nothing would change. */
export function editSpans(subject: Subject, file: string, replacements: readonly SpanReplacement[]): TreeEdits | null {
  const text = headText(subject, file);
  if (text === undefined) return null;
  const edited = replaceSpans(text, replacements);
  return edited === text ? null : editFile(subject, file, edited);
}

const declarationExtensions = ['.d.ts', '.d.mts', '.d.cts'];
const codeExtensions = ['.tsx', '.ts', '.mts', '.cts', '.jsx', '.js', '.mjs', '.cjs'];

/** [stem, extension] by the longest source extension ('.d.ts' before '.ts'); ['x.json', ''] for others. */
export function splitExtension(file: string): [string, string] {
  for (const extension of [...declarationExtensions, ...codeExtensions]) {
    if (file.endsWith(extension) && file.length > extension.length) return [file.slice(0, -extension.length), extension];
  }
  return [file, ''];
}

export const isRelativeSpecifier = (specifier: string) => /^\.\.?(\/|$)/.test(specifier);

/** How a specifier ends relative to the file it reaches: the ending style a respelling must keep. */
export type Ending = { kind: 'exact' } | { kind: 'bare' } | { kind: 'mapped'; extension: string } | { kind: 'directory' };

export function endingOf(specifier: string, target: string): Ending | null {
  if (specifier.endsWith('/')) return null;
  const last = specifier.split('/').pop() ?? '';
  const base = path.posix.basename(target);
  const [stem] = splitExtension(base);
  if (last === base) return { kind: 'exact' };
  if (last === stem) return { kind: 'bare' };
  for (const extension of ['.js', '.jsx', '.mjs', '.cjs']) if (last === stem + extension) return { kind: 'mapped', extension };
  if (stem === 'index' && last === path.posix.basename(path.posix.dirname(target))) return { kind: 'directory' };
  return null;
}

/** The path a specifier with this ending names for `target`: the file, its stem, or its directory. */
function keyOf(target: string, ending: Ending): string | null {
  if (ending.kind === 'exact') return target;
  if (ending.kind === 'directory') return splitExtension(path.posix.basename(target))[0] === 'index' ? path.posix.dirname(target) : null;
  return splitExtension(target)[0];
}

const withEnding = (key: string, ending: Ending) => (ending.kind === 'mapped' ? key + ending.extension : key);

/** Whether a site's specifier is file-relative (bare `/// <reference path="x.d.ts" />` is). */
export const isFileRelative = (site: ReferenceSite) => isRelativeSpecifier(site.specifier) || site.kind === 'triple-slash' || site.kind === 'url-reference';

/**
 * The specifier `site` would need, written from `importer`, to reach `newTarget` in the same form it reached
 * `oldTarget`; null when the form can't be kept (no recognisable ending, target outside the alias root).
 */
export function respell(site: ReferenceSite, importer: string, oldTarget: string, newTarget: string): string | null {
  const ending = endingOf(site.specifier, oldTarget);
  if (!ending) return null;
  const newKey = keyOf(newTarget, ending);
  if (newKey === null) return null;
  if (isFileRelative(site)) {
    let specifier = path.posix.relative(path.posix.dirname(importer), newKey);
    if (specifier === '') return null;
    if (!specifier.startsWith('../')) specifier = `./${specifier}`;
    if (!isRelativeSpecifier(site.specifier) && /^\.\/[^/]+$/.test(specifier)) specifier = specifier.slice(2);
    return withEnding(specifier, ending);
  }
  // Alias or baseUrl form: the specifier and the target share a tail; the specifier's head is the alias prefix,
  // the target's head the directory it stands for.
  const oldKey = keyOf(oldTarget, ending)!;
  const specifierKey = ending.kind === 'mapped' ? site.specifier.slice(0, -ending.extension.length) : site.specifier;
  const specifierSegments = specifierKey.split('/');
  const targetSegments = oldKey.split('/');
  let common = 0;
  while (common < specifierSegments.length && common < targetSegments.length
    && specifierSegments[specifierSegments.length - 1 - common] === targetSegments[targetSegments.length - 1 - common]) common++;
  if (common === 0) return null;
  const prefix = specifierSegments.slice(0, specifierSegments.length - common);
  const root = targetSegments.slice(0, targetSegments.length - common).join('/');
  if (root && !newKey.startsWith(`${root}/`)) return null;
  return withEnding([...prefix, root ? newKey.slice(root.length + 1) : newKey].join('/'), ending);
}

/** The raw text of a head site's span (escapes as written). */
export function rawOf(subject: Subject, file: string, index: number): string | undefined {
  return subject.views.head(file)?.raw[index];
}

/**
 * Moves one head file to `to` the way a correct executor would (plan §3.3): every importer's specifier and the
 * file's own relative specifiers are respelled, nothing else changes. Returns null when `to` exists, a specifier
 * can't be respelled in its form, or a file isn't UTF-8 text.
 */
export function moveWithImporters(subject: Subject, from: string, to: string): TreeEdits | null {
  const entry = subject.headTree.entries.get(from);
  if (!entry || subject.headTree.entries.has(to) || subject.headTree.directories.has(to)) return null;
  const replacements = new Map<string, SpanReplacement[]>();
  const add = (file: string, replacement: SpanReplacement) => replacements.set(file, [...(replacements.get(file) ?? []), replacement]);
  const own = subject.analyses.head.files.get(from);
  for (const [index, site] of (own?.sites ?? []).entries()) {
    if (site.resolution.type !== 'file' || !isFileRelative(site)) continue;
    const target = site.resolution.path === from ? to : site.resolution.path;
    const specifier = respell(site, to, site.resolution.path, target);
    if (specifier === null || rawOf(subject, from, index) !== site.specifier) return null;
    if (specifier !== site.specifier) add(from, { start: site.start, end: site.end, text: specifier });
  }
  for (const { file, index, site } of subject.importers.get(from) ?? []) {
    if (file === from) continue;
    const specifier = respell(site, file, from, to);
    if (specifier === null || rawOf(subject, file, index) !== site.specifier) return null;
    if (specifier !== site.specifier) add(file, { start: site.start, end: site.end, text: specifier });
  }
  const edits: TreeEdits = new Map();
  for (const [file, list] of replacements) {
    const text = headText(subject, file);
    if (text === undefined || subject.views.head(file)?.utf8 === false) return null;
    edits.set(file === from ? to : file, { bytes: Buffer.from(replaceSpans(text, list), 'utf8'), mode: headMode(subject, file) });
  }
  if (!edits.has(to)) edits.set(to, { bytes: subject.headTree.bytes(from)!, mode: entry.mode });
  edits.set(from, null);
  return edits;
}

/** Co-move bundle members of a file (manual mock, snapshot, declaration partner, source map) present in the head. */
export function bundleMembers(subject: Subject, file: string): string[] {
  const directory = path.posix.dirname(file);
  const base = path.posix.basename(file);
  const [stem, extension] = splitExtension(file);
  const candidates = [
    path.posix.join(directory, '__mocks__', base),
    path.posix.join(directory, '__snapshots__', `${base}.snap`),
    `${file}.map`,
    ...(extension.startsWith('.d.') ? [`${stem}.js`, `${stem}.mjs`, `${stem}.cjs`] : [`${stem}.d.ts`, `${stem}.d.mts`, `${stem}.d.cts`]),
  ];
  return candidates.filter((candidate) => candidate !== file && subject.headTree.entries.has(candidate));
}

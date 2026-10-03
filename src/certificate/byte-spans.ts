// K2 byte-span confinement (plan §3.4): for every file, the head bytes at map(f) equal the base bytes of f
// outside the recognized specifier spans; non-source files are byte-identical. A rewritten span may not contain
// characters that could change how the rest of the file parses (quotes, backslashes, line breaks, `${`).
import type { SpanView } from './spans.js';
import { type Check, type CertifyContext, result, type Violation } from './types.js';

const title = 'Byte-span confinement';
const unsafeSpan = /['"`\\\r\n\u2028\u2029]|\$\{/;

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index++) if (text.charCodeAt(index) === 10) line++;
  return line;
}

/** Where two chunk lists first differ, as a line number in the head file and a short excerpt of each side. */
function firstDifference(before: SpanView, after: SpanView): string {
  const beforeText = before.chunks.join('\u0000');
  const afterText = after.chunks.join('\u0000');
  let index = 0;
  while (index < beforeText.length && index < afterText.length && beforeText[index] === afterText[index]) index++;
  // Map the offset in the joined head chunks back to the head file (spans re-inserted).
  let headOffset = 0;
  let consumed = 0;
  for (let chunk = 0; chunk < after.chunks.length; chunk++) {
    const length = after.chunks[chunk]!.length;
    if (index <= consumed + length) {
      headOffset += index - consumed;
      break;
    }
    headOffset += length + (after.raw[chunk]?.length ?? 0);
    consumed += length + 1;
  }
  const headText = after.chunks.map((chunk, position) => chunk + (after.raw[position] ?? '')).join('');
  const excerpt = (text: string) => JSON.stringify(text.slice(Math.max(0, index - 30), index + 50));
  return `line ${lineOf(headText, headOffset)}: ${excerpt(beforeText)} -> ${excerpt(afterText)}`;
}

export function checkByteSpans(context: CertifyContext): { violations: Violation[]; metrics: Record<string, number> } {
  const { base, head, pathMap, views } = context;
  const violations: Violation[] = [];
  let compared = 0;
  let changedSpans = 0;
  let editedFiles = 0;
  for (const [from, to] of pathMap.forward) {
    const baseEntry = base.entries.get(from)!;
    const headEntry = head.entries.get(to)!;
    if (baseEntry.oid === headEntry.oid) continue;
    compared++;
    const before = views.base(from);
    const after = views.head(to);
    if (!before || !after) {
      violations.push({ file: to, detail: 'content changed and could not be read (submodule or missing blob)' });
      continue;
    }
    if (!before.utf8 || !after.utf8) {
      violations.push({ file: to, detail: 'content changed in a file that is not valid UTF-8' });
      continue;
    }
    if (!before.source || !after.source) {
      violations.push({ file: to, detail: 'content changed in a file without specifier spans (only module specifiers may change)' });
      continue;
    }
    if (before.sites.length !== after.sites.length) {
      violations.push({ file: to, detail: `${before.sites.length} reference sites in base, ${after.sites.length} in head; ${firstDifference(before, after)}` });
      continue;
    }
    const differentChunk = before.chunks.findIndex((chunk, index) => chunk !== after.chunks[index]);
    if (differentChunk !== -1) {
      violations.push({ file: to, detail: `bytes outside specifier spans changed, ${firstDifference(before, after)}` });
      continue;
    }
    let edited = false;
    before.sites.forEach((site, index) => {
      const later = after.sites[index]!;
      if (site.kind !== later.kind) violations.push({ file: to, detail: `site ${index} changed kind: ${site.kind} -> ${later.kind}` });
      if (before.raw[index] === after.raw[index]) return;
      edited = true;
      changedSpans++;
      if (unsafeSpan.test(after.raw[index]!)) violations.push({ file: to, detail: `rewritten specifier ${JSON.stringify(after.raw[index])} contains quote, escape, line-break or template characters` });
    });
    if (edited) editedFiles++;
  }
  return { violations, metrics: { comparedFiles: compared, editedFiles, changedSpans } };
}

export const byteSpanConfinement: Check = {
  id: 'K2',
  title,
  run(context) {
    const { violations, metrics } = checkByteSpans(context);
    const summary = violations.length
      ? `${violations.length} files differ outside specifier spans`
      : `${metrics.changedSpans} specifier spans changed in ${metrics.editedFiles} files; every other byte identical`;
    return result('K2', title, { summary, violations, metrics });
  },
};

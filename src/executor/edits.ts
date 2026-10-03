// Which specifiers must change, and to what (plan §3.3 steps 4-6). A site is rewritten only when its importer
// or target moved and the old text, read from the importer's new location in the post-move tree, no longer
// reaches the mapped target.
import path from 'node:path';
import { createSiteResolver } from '../analyzer/analyze.js';
import { overlayRepoFs, type RepoFs } from '../analyzer/repo-fs.js';
import type { RunnerConfig } from '../analyzer/runner-config.js';
import { loadScopes } from '../analyzer/tsconfig-scopes.js';
import type { Analysis, ResolvedSite } from '../analyzer/types.js';
import type { Decline } from './declines.js';
import { mapPath } from './move-set.js';
import { respecify, SpecifierDecline } from './respecify.js';

export interface SpecifierEdit {
  /** Repo-relative path of the file before the move (spans refer to its text). */
  file: string;
  start: number;
  end: number;
  before: string;
  after: string;
  kind: ResolvedSite['kind'];
}

export function planEdits(repo: RepoFs, analysis: Analysis, moves: ReadonlyMap<string, string>, runner: RunnerConfig): { edits: SpecifierEdit[]; declines: Decline[] } {
  const movedOnly = overlayRepoFs(repo, moves, new Map());
  const resolveAfter = createSiteResolver(movedOnly, runner);
  const scopeOf = loadScopes(repo);
  const edits: SpecifierEdit[] = [];
  const declines: Decline[] = [];
  for (const file of analysis.files.values()) {
    const newFile = mapPath(moves, file.path);
    const text = repo.read(file.path) ?? '';
    for (const site of file.sites) {
      if (site.resolution.type !== 'file') continue;
      const target = site.resolution.path;
      const newTarget = mapPath(moves, target);
      if (newFile === file.path && newTarget === target) continue;
      const stillReaches = resolveAfter(newFile, site);
      if (stillReaches.type === 'file' && stillReaches.path === newTarget) continue;
      if (text.slice(site.start, site.end) !== site.specifier) {
        declines.push({ code: 'unsupported-literal', file: file.path, detail: `escaped specifier ${JSON.stringify(text.slice(site.start, site.end))}` });
        continue;
      }
      const scope = scopeOf(file.path);
      try {
        const after = respecify({
          site,
          importer: { from: file.path, to: newFile, format: file.format },
          target: { from: target, to: newTarget },
          options: scope.options,
          configDirectory: scope.config ? path.posix.dirname(scope.config).replace(/^\.$/, '') : '',
          runner,
          root: repo.root,
        });
        if (after === site.specifier) continue;
        // The new spelling must reach the new target from the importer's new location; a spelling that is shadowed
        // or reinterpreted (another file, another program's options) is declined here rather than left to verify.
        const reached = resolveAfter(newFile, { ...site, specifier: after });
        if (reached.type !== 'file' || reached.path !== newTarget) {
          declines.push({ code: 'unsupported-specifier', file: file.path, detail: `'${site.specifier}' -> '${after}' reaches ${reached.type === 'unresolved' ? 'nothing' : reached.path} instead of ${newTarget}` });
          continue;
        }
        edits.push({ file: file.path, start: site.start, end: site.end, before: site.specifier, after, kind: site.kind });
      } catch (error) {
        if (!(error instanceof SpecifierDecline)) throw error;
        declines.push({ code: error.code, file: file.path, detail: error.message });
      }
    }
  }
  return { edits, declines };
}

/** Applies inside-quote edits to one file's text, back to front, with a guard on every original slice. */
export function applyEditsToText(text: string, edits: readonly SpecifierEdit[]): string {
  let result = text;
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  for (let index = 0; index < ordered.length; index++) {
    const edit = ordered[index]!;
    const previous = ordered[index - 1];
    if (previous && edit.end > previous.start) throw new Error(`overlapping edits in ${edit.file} at ${edit.start}`);
    if (result.slice(edit.start, edit.end) !== edit.before) throw new Error(`slice guard failed in ${edit.file} at ${edit.start}`);
    result = result.slice(0, edit.start) + edit.after + result.slice(edit.end);
  }
  return result;
}

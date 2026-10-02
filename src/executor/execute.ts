// One executor step: resolve → map → respecify → verify on a virtual post-move tree → write (plan §3.3).
// Either the whole step is applied, or it is declined with reasons and nothing on disk changes.
import { analyzeRepo } from '../analyzer/analyze.js';
import type { RepoFs } from '../analyzer/repo-fs.js';
import { loadRunnerConfig } from '../analyzer/runner-config.js';
import type { Analysis } from '../analyzer/types.js';
import { applyMove } from './apply.js';
import { type Decline, findDeclines } from './declines.js';
import { applyEditsToText, planEdits, type SpecifierEdit } from './edits.js';
import { mapPath, withCoMoves } from './move-set.js';
import { verifyMove, type Violation } from './verify.js';

export type MoveResult =
  | { outcome: 'applied' | 'verified'; moves: Map<string, string>; edits: SpecifierEdit[]; before: Analysis; after: Analysis }
  | { outcome: 'declined'; moves: Map<string, string>; declines: Decline[] }
  | { outcome: 'unverified'; moves: Map<string, string>; edits: SpecifierEdit[]; violations: Violation[] };

/** `dryRun` stops after verification (outcome `verified`). */
export function executeMove(repo: RepoFs, requested: ReadonlyMap<string, string>, { dryRun = false } = {}): MoveResult {
  const moves = withCoMoves(requested, new Set(repo.tracked()));
  const runner = loadRunnerConfig(repo);
  const before = analyzeRepo(repo, { runner });
  const declines = findDeclines(repo, before, moves, requested);
  if (declines.length) return { outcome: 'declined', moves, declines };

  const planned = planEdits(repo, before, moves, runner);
  if (planned.declines.length) return { outcome: 'declined', moves, declines: planned.declines };

  const byFile = new Map<string, SpecifierEdit[]>();
  for (const edit of planned.edits) byFile.set(edit.file, [...(byFile.get(edit.file) ?? []), edit]);
  const newContentsByOldPath = new Map<string, string>();
  const newContentsByNewPath = new Map<string, string>();
  for (const [file, edits] of byFile) {
    const text = applyEditsToText(repo.read(file) ?? '', edits);
    newContentsByOldPath.set(file, text);
    newContentsByNewPath.set(mapPath(moves, file), text);
  }

  const { after, violations } = verifyMove(repo, before, moves, newContentsByNewPath, runner);
  if (violations.length) return { outcome: 'unverified', moves, edits: planned.edits, violations };
  if (dryRun) return { outcome: 'verified', moves, edits: planned.edits, before, after };
  applyMove(repo, moves, newContentsByOldPath);
  return { outcome: 'applied', moves, edits: planned.edits, before, after };
}

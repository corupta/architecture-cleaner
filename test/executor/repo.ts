// Inline test repos for executor tests: a tree of files committed to a fresh git repo, and a move on it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { executeMove, type MoveResult } from '../../src/executor/execute.js';
import { materialize } from '../helpers.js';

export function repoFrom(tree: Record<string, string>): string {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-executor-src-'));
  for (const [file, content] of Object.entries(tree)) {
    fs.mkdirSync(path.dirname(path.join(staging, file)), { recursive: true });
    fs.writeFileSync(path.join(staging, file), content);
  }
  return materialize(staging, 'executor');
}

export const move = (root: string, moves: Record<string, string>, options: { dryRun?: boolean } = {}): MoveResult =>
  executeMove(gitRepoFs(root), new Map(Object.entries(moves)), options);

export const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8');

/** The outcome, or the sorted decline codes. */
export const codes = (result: MoveResult) => (result.outcome === 'declined' ? [...new Set(result.declines.map((decline) => decline.code))].sort() : [result.outcome]);

export const cjs = (extra: object = {}, include = ['src']) => JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', strict: true, types: [], ...extra }, include });

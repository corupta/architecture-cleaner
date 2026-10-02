// Writes the verified step to disk: new texts first (raw UTF-8, so BOM and CRLF survive), then `git mv` in two
// phases via temporary names so chains and swaps can't collide, then stages everything for the caller's commit.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { type RepoFs, toAbsolute } from '../analyzer/repo-fs.js';

const git = (repo: RepoFs, ...args: string[]) => execFileSync('git', ['-C', repo.root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

export function applyMove(repo: RepoFs, moves: ReadonlyMap<string, string>, newContentsByOldPath: ReadonlyMap<string, string>): void {
  for (const [file, text] of newContentsByOldPath) fs.writeFileSync(toAbsolute(repo, file), text, 'utf8');
  const staged: string[] = [...newContentsByOldPath.keys()].filter((file) => !moves.has(file));
  const temporary = new Map<string, string>();
  let counter = 0;
  for (const from of moves.keys()) {
    const temp = `${from}.ac-move-${counter++}`;
    git(repo, 'mv', '--', from, temp);
    temporary.set(from, temp);
  }
  for (const [from, to] of moves) {
    fs.mkdirSync(path.dirname(toAbsolute(repo, to)), { recursive: true });
    git(repo, 'mv', '--', temporary.get(from)!, to);
    staged.push(to);
  }
  if (staged.length) git(repo, 'add', '--', ...staged);
}

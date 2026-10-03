// Which paths a tree's ignore files match, with each file's own semantics:
// - gitignore family (.gitignore, .npmignore, .prettierignore, .eslintignore): asked of git itself, in a scratch
//   repo that holds only that kind of file at its committed locations;
// - .dockerignore: Docker's rules (moby/patternmatcher): patterns are anchored at the build context (the file's
//   directory), `**` spans directories, a pattern also excludes everything below a matched directory, last match wins.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CommitTree } from './git-tree.js';

export const ignoreKinds = ['.gitignore', '.npmignore', '.dockerignore', '.prettierignore', '.eslintignore'] as const;
export type IgnoreKind = (typeof ignoreKinds)[number];

function gitIgnored(tree: CommitTree, kind: IgnoreKind, files: string[], paths: string[], scratch: string): Set<string> {
  fs.mkdirSync(scratch, { recursive: true });
  spawnSync('git', ['init', '-q', scratch]);
  for (const file of files) {
    fs.mkdirSync(path.join(scratch, path.posix.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(scratch, path.posix.dirname(file), '.gitignore'), tree.bytes(file) ?? '');
  }
  const run = spawnSync('git', ['-C', scratch, '-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '--stdin', '-z'], { input: `${paths.join('\0')}\0`, maxBuffer: 1 << 28 });
  if (run.status !== 0 && run.status !== 1) throw new Error(`git check-ignore (${kind}) failed: ${run.stderr.toString()}`);
  return new Set(run.stdout.toString('utf8').split('\0').filter(Boolean));
}

interface DockerPattern {
  regex: RegExp;
  exclusion: boolean;
}

export function dockerPatterns(text: string): DockerPattern[] {
  const patterns: DockerPattern[] = [];
  for (const line of text.split(/\r?\n/)) {
    let pattern = line.trim();
    if (!pattern || pattern.startsWith('#')) continue;
    const exclusion = pattern.startsWith('!');
    if (exclusion) pattern = pattern.slice(1).trim();
    pattern = path.posix.normalize(pattern).replace(/^\/+/, '').replace(/\/+$/, '');
    if (pattern === '.' || pattern === '') continue;
    let source = '^';
    for (let index = 0; index < pattern.length; index++) {
      const char = pattern[index]!;
      if (char === '*' && pattern[index + 1] === '*') {
        index++;
        if (pattern[index + 1] === '/') index++;
        source += index + 1 >= pattern.length ? '.*' : '(.*/)?';
      } else if (char === '*') source += '[^/]*';
      else if (char === '?') source += '[^/]';
      else if (char === '\\' && index + 1 < pattern.length) source += `\\${pattern[++index]}`;
      else if (char === '[') {
        const close = pattern.indexOf(']', index + 1);
        if (close === -1) source += '\\[';
        else {
          source += pattern.slice(index, close + 1).replace(/^\[!/, '[^');
          index = close;
        }
      } else source += char.replace(/[.+^${}()|]/g, '\\$&');
    }
    patterns.push({ regex: new RegExp(`${source}$`), exclusion });
  }
  return patterns;
}

/** moby's MatchesOrParentMatches: a path is excluded when the last pattern matching it or one of its parents excludes. */
export function dockerIgnored(patterns: DockerPattern[], file: string): boolean {
  const parents = path.posix.dirname(file) === '.' ? [] : path.posix.dirname(file).split('/');
  let matched = false;
  for (const pattern of patterns) {
    if (pattern.exclusion !== matched) continue;
    let match = pattern.regex.test(file);
    for (let depth = 1; !match && depth <= parents.length; depth++) match = pattern.regex.test(parents.slice(0, depth).join('/'));
    if (match) matched = !pattern.exclusion;
  }
  return matched;
}

/** The subset of `paths` (repo-relative) that the tree's ignore files of `kind` match. */
export function ignoredPaths(tree: CommitTree, kind: IgnoreKind, paths: string[], scratch: string): Set<string> {
  const files = [...tree.entries.keys()].filter((file) => path.posix.basename(file) === kind);
  if (files.length === 0 || paths.length === 0) return new Set();
  if (kind !== '.dockerignore') return gitIgnored(tree, kind, files, paths, scratch);
  const ignored = new Set<string>();
  for (const file of files) {
    const context = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file);
    const patterns = dockerPatterns(tree.text(file) ?? '');
    for (const candidate of paths) {
      if (context && !candidate.startsWith(`${context}/`)) continue;
      if (dockerIgnored(patterns, context ? candidate.slice(context.length + 1) : candidate)) ignored.add(candidate);
    }
  }
  return ignored;
}

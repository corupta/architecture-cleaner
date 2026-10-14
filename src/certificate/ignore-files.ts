// Which paths a tree's path-keyed rule files match, with each file's own semantics:
// - gitignore family (.gitignore, .npmignore, deploy uploads' ignore files, tool ignores): asked of git itself, in a
//   scratch repo that holds only that kind of file at its committed locations;
// - .dockerignore: Docker's rules (moby/patternmatcher): patterns are anchored at the build context (the file's
//   directory), `**` spans directories, a pattern also excludes everything below a matched directory, last match wins.
//   A Dockerfile-specific `<name>.dockerignore` is anchored at a build context we can't see: every enclosing directory;
// - package.json `files`: what `npm pack` (and `pnpm deploy`) ships, entries anchored at the package like Docker's.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { stripBom } from '../analyzer/analyze.js';
import type { CommitTree } from './git-tree.js';

// Ignore files that decide what ships (git, npm pack, docker and deploy uploads) block; tool ignores are findings.
export const ignoreKinds = ['.gitignore', '.npmignore', '.dockerignore', '.gcloudignore', '.vercelignore', '.slugignore', '.cfignore', '.ebignore', '.funcignore',
  '.vscodeignore', '.prettierignore', '.eslintignore'] as const;
export type IgnoreKind = (typeof ignoreKinds)[number];
const toolIgnores = new Set<IgnoreKind>(['.prettierignore', '.eslintignore']);

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

const directoryOf = (file: string) => (path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file));
const under = (file: string, directory: string) => directory === '' || file.startsWith(`${directory}/`);
const relativeTo = (file: string, directory: string) => (directory === '' ? file : file.slice(directory.length + 1));
const isDockerIgnore = (file: string) => path.posix.basename(file).endsWith('.dockerignore');

/** The subset of `paths` (repo-relative) that the tree's ignore files of `kind` match (every context, for Docker). */
export function ignoredPaths(tree: CommitTree, kind: IgnoreKind, paths: string[], scratch: string): Set<string> {
  if (kind !== '.dockerignore') {
    const files = [...tree.entries.keys()].filter((file) => path.posix.basename(file) === kind);
    return files.length === 0 || paths.length === 0 ? new Set() : gitIgnored(tree, kind, files, paths, scratch);
  }
  const ignored = new Set<string>();
  for (const { file, context } of dockerContexts(tree)) {
    const patterns = dockerPatterns(tree.text(file) ?? '');
    for (const candidate of paths) if (under(candidate, context) && dockerIgnored(patterns, relativeTo(candidate, context))) ignored.add(candidate);
  }
  return ignored;
}

/**
 * One rule set that gives every path a status: git or a deploy upload ignores it, a Docker build context receives it,
 * `npm pack` ships it, git checks it out with these attributes. A pure move keeps every path's status in every scope.
 */
export interface PathScope {
  /** Names the rule file and what it governs; equal ids on both commits are the same scope. */
  id: string;
  /** Status changes block (what ships, what is checked out) or are findings (tool ignores). */
  blocking: boolean;
  /** The status of each path, in order. */
  status(paths: string[]): string[];
  /** The status of a path the scope doesn't govern (every path, on a commit without the scope). */
  neutral: string;
}

const flag = (paths: string[], matched: Set<string>, meaning: string) => paths.map((file) => (matched.has(file) ? meaning : `not ${meaning}`));

/** Docker build contexts: a `.dockerignore` at its directory; a Dockerfile-specific one at each enclosing directory. */
function dockerContexts(tree: CommitTree): { file: string; context: string }[] {
  const contexts: { file: string; context: string }[] = [];
  for (const file of [...tree.entries.keys()].filter(isDockerIgnore)) {
    for (let context = directoryOf(file); ; context = directoryOf(context)) {
      contexts.push({ file, context });
      if (path.posix.basename(file) === '.dockerignore' || context === '') break;
    }
  }
  return contexts;
}

function dockerScopes(tree: CommitTree): PathScope[] {
  return dockerContexts(tree).map(({ file, context }) => {
    const patterns = dockerPatterns(tree.text(file) ?? '');
    return {
      id: `${file} (build context ${context || '.'})`,
      blocking: true,
      neutral: 'not sent to the build context',
      status: (paths) => flag(paths, new Set(paths.filter((candidate) => under(candidate, context) && !dockerIgnored(patterns, relativeTo(candidate, context)))), 'sent to the build context'),
    };
  });
}

/** What `npm pack` of the package at `manifest` ships: everything under its directory, or what its `files` entries match. */
export function packageScope(tree: CommitTree, manifest: string): PathScope {
  const directory = directoryOf(manifest);
  let files: unknown;
  try {
    files = (JSON.parse(stripBom(tree.text(manifest) ?? '')) as { files?: unknown } | null)?.files;
  } catch {
    // An unparsable manifest packs nothing for npm; its own edits are K2's.
  }
  const entries = Array.isArray(files) ? files.filter((entry): entry is string => typeof entry === 'string') : null;
  // npm anchors `files` entries at the package and a directory entry takes its contents, like a Docker pattern.
  const patterns = entries && dockerPatterns(entries.join('\n'));
  return {
    id: `${manifest}${entries ? ' files' : ''}`,
    blocking: true,
    neutral: 'not packed by npm',
    status: (paths) => flag(paths, new Set(paths.filter((candidate) => under(candidate, directory) && (!patterns || dockerIgnored(patterns, relativeTo(candidate, directory))))), 'packed by npm'),
  };
}

export const packageManifests = (tree: CommitTree) => [...tree.entries.keys()].filter((file) => path.posix.basename(file) === 'package.json' && !file.split('/').includes('node_modules'));

// Attributes that change the bytes a checkout writes (or what `git archive` ships).
const checkoutAttributes = ['text', 'eol', 'crlf', 'filter', 'ident', 'working-tree-encoding', 'export-ignore', 'export-subst'];

/** The checkout attributes git gives each path under the tree's .gitattributes files (a renamed `win-*.sh` loses eol=crlf). */
function attributeScope(tree: CommitTree, scratch: string): PathScope | null {
  const files = [...tree.entries.keys()].filter((file) => path.posix.basename(file) === '.gitattributes');
  if (files.length === 0) return null;
  return {
    id: '.gitattributes',
    blocking: true,
    neutral: 'no checkout attributes',
    status(paths) {
      if (paths.length === 0) return [];
      fs.mkdirSync(scratch, { recursive: true });
      spawnSync('git', ['init', '-q', scratch]);
      for (const file of files) {
        fs.mkdirSync(path.join(scratch, path.posix.dirname(file)), { recursive: true });
        fs.writeFileSync(path.join(scratch, file), tree.bytes(file) ?? '');
      }
      const run = spawnSync('git', ['-C', scratch, '-c', 'core.attributesFile=/dev/null', 'check-attr', '--stdin', '-z', ...checkoutAttributes],
        { input: `${paths.join('\0')}\0`, maxBuffer: 1 << 30, env: { ...process.env, GIT_ATTR_NOSYSTEM: '1' } });
      if (run.status !== 0) throw new Error(`git check-attr failed: ${run.stderr.toString()}`);
      const attributes = new Map<string, string[]>();
      const fields = run.stdout.toString('utf8').split('\0');
      for (let index = 0; index + 2 < fields.length; index += 3) {
        if (fields[index + 2] === 'unspecified') continue;
        attributes.set(fields[index]!, [...(attributes.get(fields[index]!) ?? []), `${fields[index + 1]}=${fields[index + 2]}`]);
      }
      return paths.map((file) => attributes.get(file)?.join(' ') ?? 'no checkout attributes');
    },
  };
}

/** Every path scope of a tree: one per ignore kind (git combines its files), Docker context and package, and git attributes. */
export function pathScopes(tree: CommitTree, scratch: string): PathScope[] {
  const scopes: PathScope[] = [];
  for (const kind of ignoreKinds) {
    if (kind === '.dockerignore') continue;
    const files = [...tree.entries.keys()].filter((file) => path.posix.basename(file) === kind);
    if (files.length === 0) continue;
    scopes.push({ id: kind, blocking: !toolIgnores.has(kind), neutral: 'not ignored', status: (paths) => flag(paths, paths.length ? gitIgnored(tree, kind, files, paths, path.join(scratch, kind)) : new Set(), 'ignored') });
  }
  const attributes = attributeScope(tree, path.join(scratch, '.gitattributes'));
  return [...scopes, ...dockerScopes(tree), ...packageManifests(tree).map((manifest) => packageScope(tree, manifest)), ...(attributes ? [attributes] : [])];
}

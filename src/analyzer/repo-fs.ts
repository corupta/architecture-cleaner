// The analyzer reads the repo through this interface, so the executor can analyze a virtual post-move tree
// (an overlay of new contents and moved paths) with exactly the code that analyzes the real one.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

export interface RepoFs {
  /** Absolute repo root. */
  readonly root: string;
  /** Tracked files, repo-relative. */
  tracked(): string[];
  /** File text by repo-relative path; undefined when absent. */
  read(relativePath: string): string | undefined;
  fileExists(absolutePath: string): boolean;
  directoryExists(absolutePath: string): boolean;
  /** Direct children of an absolute directory, for tsconfig include/exclude matching. */
  entries(absolutePath: string): { files: string[]; directories: string[] };
}

export const toAbsolute = (repo: RepoFs, relativePath: string) => path.join(repo.root, relativePath);
export const toRelative = (repo: RepoFs, absolutePath: string) => path.relative(repo.root, absolutePath).split(path.sep).join('/');

export function gitRepoFs(root: string): RepoFs {
  const absoluteRoot = path.resolve(root);
  let trackedCache: string[] | undefined;
  return {
    root: absoluteRoot,
    tracked() {
      trackedCache ??= execFileSync('git', ['-C', absoluteRoot, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
        .split('\0')
        .filter(Boolean);
      return trackedCache;
    },
    read(relativePath) {
      try {
        return fs.readFileSync(path.join(absoluteRoot, relativePath), 'utf8');
      } catch {
        return undefined;
      }
    },
    fileExists: (absolutePath) => fs.statSync(absolutePath, { throwIfNoEntry: false })?.isFile() ?? false,
    directoryExists: (absolutePath) => fs.statSync(absolutePath, { throwIfNoEntry: false })?.isDirectory() ?? false,
    entries(absolutePath) {
      const files: string[] = [];
      const directories: string[] = [];
      for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
        if (entry.isFile()) files.push(entry.name);
        else if (entry.isDirectory()) directories.push(entry.name);
      }
      return { files, directories };
    },
  };
}

/**
 * A view of `base` after moving files and replacing contents. `moves` maps old → new repo-relative paths;
 * `contents` holds the new text of edited files, keyed by their new path.
 */
export function overlayRepoFs(base: RepoFs, moves: ReadonlyMap<string, string>, contents: ReadonlyMap<string, string>): RepoFs {
  const removed = new Set(moves.keys());
  const added = new Map<string, string>();
  for (const [from, to] of moves) added.set(to, from);
  for (const to of added.keys()) removed.delete(to);
  const isRemoved = (relativePath: string) => removed.has(relativePath) && !added.has(relativePath);
  const addedDirectories = new Set<string>();
  for (const to of added.keys()) {
    for (let directory = path.posix.dirname(to); directory !== '.'; directory = path.posix.dirname(directory)) addedDirectories.add(directory);
  }
  const tracked = [...base.tracked().filter((file) => !isRemoved(file) && !added.has(file)), ...added.keys()].sort();
  const trackedSet = new Set(tracked);
  return {
    root: base.root,
    tracked: () => tracked,
    read(relativePath) {
      if (contents.has(relativePath)) return contents.get(relativePath);
      if (added.has(relativePath)) return base.read(added.get(relativePath)!);
      if (isRemoved(relativePath)) return undefined;
      return base.read(relativePath);
    },
    fileExists(absolutePath) {
      const relativePath = toRelative(base, absolutePath);
      if (relativePath.startsWith('..')) return base.fileExists(absolutePath);
      if (added.has(relativePath) || contents.has(relativePath)) return true;
      if (isRemoved(relativePath)) return false;
      return base.fileExists(absolutePath);
    },
    directoryExists(absolutePath) {
      const relativePath = toRelative(base, absolutePath);
      if (addedDirectories.has(relativePath)) return true;
      return base.directoryExists(absolutePath);
    },
    entries(absolutePath) {
      const relativeDirectory = toRelative(base, absolutePath);
      const prefix = relativeDirectory === '' ? '' : `${relativeDirectory}/`;
      const files = new Set<string>();
      const directories = new Set<string>();
      if (base.directoryExists(absolutePath)) {
        const real = base.entries(absolutePath);
        for (const file of real.files) if (!isRemoved(prefix + file)) files.add(file);
        for (const directory of real.directories) directories.add(directory);
      }
      for (const file of trackedSet) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash === -1) files.add(rest);
        else directories.add(rest.slice(0, slash));
      }
      return { files: [...files], directories: [...directories] };
    },
  };
}

export function moduleResolutionHost(repo: RepoFs): ts.ModuleResolutionHost {
  return {
    fileExists: (fileName) => repo.fileExists(fileName),
    readFile: (fileName) => {
      const relativePath = toRelative(repo, fileName);
      return relativePath.startsWith('..') ? ts.sys.readFile(fileName) : (repo.read(relativePath) ?? ts.sys.readFile(fileName));
    },
    directoryExists: (directoryName) => repo.directoryExists(directoryName),
    realpath: (fileName) => fileName,
    getCurrentDirectory: () => repo.root,
    getDirectories: (directoryName) => (repo.directoryExists(directoryName) ? repo.entries(directoryName).directories : []),
  };
}

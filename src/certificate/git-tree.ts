// Committed trees, read only through git objects (`git ls-tree`, `git cat-file`): the certifier never looks at a
// working tree for tracked content (plan §3.4 Independence).
import { execFileSync, spawnSync } from 'node:child_process';

export interface TreeEntry {
  path: string;
  /** git mode: 100644, 100755, 120000 (symlink), 160000 (submodule). */
  mode: string;
  /** Blob id (or the commit id of a submodule). */
  oid: string;
}

export interface CommitTree {
  /** Full commit id. */
  commit: string;
  entries: ReadonlyMap<string, TreeEntry>;
  /** Every directory that holds an entry ('' is the root). */
  directories: ReadonlySet<string>;
  /** Raw bytes of a blob entry (symlinks: the link text); undefined for absent paths and submodules. */
  bytes(path: string): Buffer | undefined;
  /** UTF-8 text of a blob entry. */
  text(path: string): string | undefined;
  /** Loads many blobs with one `git cat-file --batch` call (an optimisation; `bytes` works without it). */
  prefetch(paths: Iterable<string>): void;
}

const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });

export function resolveCommit(repo: string, revision: string): string {
  return git(repo, 'rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`).trim();
}

/** Reads `git cat-file --batch` output for the given object ids. */
function catFileBatch(repo: string, oids: string[]): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  if (oids.length === 0) return result;
  const run = spawnSync('git', ['-C', repo, 'cat-file', '--batch'], { input: `${oids.join('\n')}\n`, maxBuffer: 2 ** 31 - 1 });
  if (run.status !== 0) throw new Error(`git cat-file --batch failed: ${run.stderr.toString()}`);
  const output = run.stdout;
  let offset = 0;
  for (const oid of oids) {
    const newline = output.indexOf(0x0a, offset);
    const header = output.subarray(offset, newline).toString('utf8');
    const [id, type, size] = header.split(' ');
    if (type === 'missing' || size === undefined) throw new Error(`git object ${oid} is missing`);
    const length = Number(size);
    result.set(id ?? oid, output.subarray(newline + 1, newline + 1 + length));
    offset = newline + 1 + length + 1;
  }
  return result;
}

export function readCommitTree(repo: string, revision: string): CommitTree {
  const commit = resolveCommit(repo, revision);
  const entries = new Map<string, TreeEntry>();
  const directories = new Set<string>(['']);
  for (const record of git(repo, 'ls-tree', '-r', '-z', '--full-tree', commit).split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const [mode, , oid] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    entries.set(path, { path, mode: mode!, oid: oid! });
    for (let slash = path.lastIndexOf('/'); slash > 0; slash = path.lastIndexOf('/', slash - 1)) directories.add(path.slice(0, slash));
  }
  const blobs = new Map<string, Buffer>();
  const isBlob = (entry: TreeEntry | undefined): entry is TreeEntry => entry !== undefined && entry.mode !== '160000';
  const prefetch = (paths: Iterable<string>) => {
    const wanted = new Set<string>();
    for (const path of paths) {
      const entry = entries.get(path);
      if (isBlob(entry) && !blobs.has(entry.oid)) wanted.add(entry.oid);
    }
    for (const [oid, buffer] of catFileBatch(repo, [...wanted])) blobs.set(oid, buffer);
  };
  const bytes = (path: string) => {
    const entry = entries.get(path);
    if (!isBlob(entry)) return undefined;
    if (!blobs.has(entry.oid)) prefetch([path]);
    return blobs.get(entry.oid);
  };
  return { commit, entries, directories, bytes, text: (path) => bytes(path)?.toString('utf8'), prefetch };
}

/** Whether bytes survive a UTF-8 decode/encode round trip (spans are computed on decoded text). */
export function isUtf8(buffer: Buffer): boolean {
  return Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer);
}

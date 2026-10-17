// Per-tree result cache (CertifyOptions.cacheDir): what a check computes from ONE committed tree is stored and reused
// wherever a later certification meets that tree again, on either side. Consecutive steps certify parent..commit, so
// step k's head tree is step k+1's base tree: without the cache every per-side result of a run is computed twice.
// A key holds everything the result depends on: the tree id (all tracked content), the package root, the environment
// checkout's identity (its node_modules realpaths, install markers and lockfiles), the tool (version and a hash of
// its code), the cache format, and what the check adds (runner spec, target Node, the child's environment). Keys are
// stored only as hashes: a child's environment may hold secrets. Machine paths in a stored value (the worktree and
// scratch directory it was computed in) become placeholders and are put back for the reading certification, so a hit
// equals a fresh run. Only complete results are stored; an unreadable, corrupt or mismatched entry is a miss. Results
// that are files (K8's oracle runs: logs, reports, artifacts) are stored as a directory with a manifest of hashes and
// copied out to where a fresh run would have written them.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diskRealpath, type Environment } from './commit-fs.js';
import { installMarkers } from './oracle-runs.js';
import { blockNetPreload, packageDirectory } from './toolchain.js';

/** Version of the entry layout and of the keys: a changed shape never reads old entries. */
export const cacheFormat = 1;

/** The CLI's switch: a directory turns the cache on ('off' or empty leaves it off). */
export const cacheVariable = 'AC_CERTIFY_CACHE';

export function cacheDirFromEnvironment(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = environment[cacheVariable];
  return value && value !== 'off' ? path.resolve(value) : undefined;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** sha256 over the regular files of `directories` (not recursive) and `files`, each with its name. */
export function codeHash(directories: string[], files: string[]): string {
  const hash = createHash('sha256');
  const add = (name: string, file: string) => hash.update(`${name}\0`).update(fs.readFileSync(file)).update('\0');
  for (const directory of directories) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      if (fs.statSync(file).isFile()) add(`${path.basename(directory)}/${name}`, file);
    }
  }
  for (const file of files) {
    if (fs.existsSync(file)) add(path.basename(file), file);
    else hash.update(`${path.basename(file)}\0missing\0`);
  }
  return hash.digest('hex');
}

export interface ToolIdentity {
  version: string;
  code: string;
}

let toolMemo: ToolIdentity | undefined;

/** This tool: its version and a hash of the code that computes cached results (certificate/, analyzer/, the offline preload). */
export function toolIdentity(): ToolIdentity {
  if (toolMemo) return toolMemo;
  const here = path.dirname(fileURLToPath(import.meta.url));
  let preload = 'block-net.cjs';
  try {
    preload = blockNetPreload();
  } catch {
    // probes fail without it, so nothing they compute is stored
  }
  const version = String(JSON.parse(fs.readFileSync(path.join(packageDirectory(), 'package.json'), 'utf8')).version ?? 'unknown');
  toolMemo = { version, code: codeHash([here, path.join(here, '..', 'analyzer')], [preload]) };
  return toolMemo;
}

const lockfiles = ['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb'];

/** What identifies an installed environment: its node_modules (real paths, install markers) and its lockfiles' content. */
export function environmentIdentity(environment: Pick<Environment, 'checkout' | 'linked'>) {
  const stat = (file: string) => fs.statSync(file, { throwIfNoEntry: false });
  const linked = environment.linked.map((directory) => {
    const nodeModules = path.join(environment.checkout, directory, 'node_modules');
    const markers = installMarkers.flatMap((marker) => {
      const found = stat(path.join(nodeModules, marker));
      return found ? [[marker, found.size, found.mtimeMs]] : [];
    });
    return { directory, nodeModules: fs.realpathSync(nodeModules), markers };
  });
  const locks = [...new Set(['', ...environment.linked])].sort().flatMap((directory) => lockfiles.flatMap((name) => {
    const file = path.join(environment.checkout, directory, name);
    return stat(file)?.isFile() ? [[path.posix.join(directory, name), sha256(fs.readFileSync(file))]] : [];
  }));
  return { checkout: fs.realpathSync(environment.checkout), linked, lockfiles: locks };
}

/**
 * Placeholder name → absolute path, as the certification at hand sees it. A path listed twice (a directory and its
 * real path when they are equal) keeps its first name: list the real paths first, runners report those.
 */
export type Places = readonly (readonly [name: string, absolutePath: string])[];

/** A directory under `name`, preceded by its real path under `<name>-real` (the directory need not exist yet). */
export function placesOf(name: string, directory: string): Places {
  return [[`${name}-real`, diskRealpath(directory) ?? directory], [name, directory]];
}

/** [text as it appears inside a JSON string, the placeholder's JSON text], longest path first. */
function relocations(places: Places): [string, string][] {
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  for (const [name, absolutePath] of places) {
    if (absolutePath.length < 2 || seen.has(absolutePath)) continue;
    seen.add(absolutePath);
    pairs.push([JSON.stringify(absolutePath).slice(1, -1), JSON.stringify(`\u0000ac-cache:${name}\u0000`).slice(1, -1)]);
  }
  return pairs.toSorted(([a], [b]) => b.length - a.length);
}

const relocate = (json: string, places: Places) => relocations(places).reduce((text, [found, placeholder]) => text.replaceAll(found, placeholder), json);
const restore = (json: string, places: Places) => relocations(places).reduce((text, [found, placeholder]) => text.replaceAll(placeholder, found), json);

export interface TreeCache {
  readonly directory: string;
  /** The value stored for `tree` under `key` (JSON data), with `places` put back; undefined on a miss. */
  read<T>(kind: string, tree: string, key: unknown, places: Places): T | undefined;
  /** Stores a complete result. Best effort: a failed write only means a later miss. */
  write(kind: string, tree: string, key: unknown, places: Places, value: unknown): void;
  /**
   * Copies the files stored for `tree` under `key` into `target` (emptied first), each checked against its stored
   * sha256; false on a miss or a damaged entry (target then holds nothing). Paths inside the files are left as stored.
   */
  readFiles(kind: string, tree: string, key: unknown, target: string): boolean;
  /** Stores a copy of the files under `source` but those `exclude` names (relative paths). Best effort, like write. */
  writeFiles(kind: string, tree: string, key: unknown, source: string, exclude?: (relative: string) => boolean): void;
}

/** A file entry's manifest: what readFiles checks before it copies anything out. */
interface FilesManifest {
  format: number;
  kind: string;
  tree: string;
  key: string;
  files: [relative: string, sha256: string][];
}

const manifestName = 'manifest.json';

/** Regular files under `directory`, relative and sorted; symbolic links and other entries are left out. */
function regularFiles(directory: string): string[] {
  return fs.readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((relative) => fs.lstatSync(path.join(directory, relative)).isFile())
    .map((relative) => relative.split(path.sep).join('/'))
    .sort();
}

export interface CacheScope {
  packageRoot: string;
  environment: Pick<Environment, 'checkout' | 'linked'>;
  /** Default: this tool (`toolIdentity`). */
  tool?: ToolIdentity;
}

/** The cache in `directory`, for certifications of one package in one environment by one tool. */
export function openTreeCache(directory: string, scope: CacheScope, log: (message: string) => void = () => {}): TreeCache {
  let shared: string | undefined;
  const keyOf = (kind: string, tree: string, key: unknown) => {
    shared ??= JSON.stringify({ format: cacheFormat, tool: scope.tool ?? toolIdentity(), packageRoot: scope.packageRoot, environment: environmentIdentity(scope.environment) });
    return sha256(JSON.stringify({ shared, kind, tree, key }));
  };
  const entryOf = (kind: string, tree: string, hash: string) => {
    if (!/^[\w.-]+$/.test(kind) || !/^[0-9a-f]+$/.test(tree)) throw new Error(`tree cache: bad entry name ${kind}/${tree}`);
    return path.join(directory, kind, `${tree.slice(0, 12)}-${hash.slice(0, 32)}`);
  };
  const fileOf = (kind: string, tree: string, hash: string) => `${entryOf(kind, tree, hash)}.json`;
  /** The manifest of a files entry, when it is one for `hash`. */
  const manifestOf = (entry: string, hash: string): FilesManifest | undefined => {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(entry, manifestName), 'utf8')) as FilesManifest;
      return manifest.format === cacheFormat && manifest.key === hash && Array.isArray(manifest.files) ? manifest : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    directory,
    read<T>(kind: string, tree: string, key: unknown, places: Places): T | undefined {
      const hash = keyOf(kind, tree, key);
      let text: string;
      try {
        text = fs.readFileSync(fileOf(kind, tree, hash), 'utf8');
      } catch {
        return undefined;
      }
      try {
        const newline = text.indexOf('\n');
        if (newline === -1) throw new Error('no header');
        const header = JSON.parse(text.slice(0, newline)) as { format?: unknown; key?: unknown; sha256?: unknown };
        const payload = text.slice(newline + 1);
        if (header.format !== cacheFormat || header.key !== hash || header.sha256 !== sha256(payload)) throw new Error('mismatch');
        return JSON.parse(restore(payload, places)) as T;
      } catch {
        log(`tree cache: ignoring the unreadable entry ${fileOf(kind, tree, hash)}`);
        return undefined;
      }
    },
    write(kind, tree, key, places, value) {
      const hash = keyOf(kind, tree, key);
      const file = fileOf(kind, tree, hash);
      const payload = relocate(JSON.stringify(value), places);
      const staging = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(staging, `${JSON.stringify({ format: cacheFormat, kind, tree, key: hash, sha256: sha256(payload) })}\n${payload}`);
        fs.renameSync(staging, file);
      } catch (error) {
        fs.rmSync(staging, { force: true });
        log(`tree cache: could not store ${file}: ${(error as Error).message}`);
      }
    },
    readFiles(kind, tree, key, target) {
      const hash = keyOf(kind, tree, key);
      const entry = entryOf(kind, tree, hash);
      fs.rmSync(target, { recursive: true, force: true });
      if (!fs.existsSync(entry)) return false;
      try {
        const manifest = manifestOf(entry, hash);
        if (!manifest) throw new Error('no manifest for this key');
        for (const [relative, digest] of manifest.files) {
          if (relative.split('/').includes('..') || path.isAbsolute(relative)) throw new Error(`bad path ${relative}`);
          const bytes = fs.readFileSync(path.join(entry, 'files', relative));
          if (sha256(bytes) !== digest) throw new Error(`${relative} changed`);
          fs.mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
          fs.writeFileSync(path.join(target, relative), bytes);
        }
        return true;
      } catch (error) {
        fs.rmSync(target, { recursive: true, force: true });
        // Removed, so the next complete result is stored in its place.
        fs.rmSync(entry, { recursive: true, force: true });
        log(`tree cache: removed the unreadable entry ${entry}: ${(error as Error).message}`);
        return false;
      }
    },
    writeFiles(kind, tree, key, source, exclude = () => false) {
      const hash = keyOf(kind, tree, key);
      const entry = entryOf(kind, tree, hash);
      if (manifestOf(entry, hash)) return;
      const staging = `${entry}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
      try {
        const files: FilesManifest['files'] = [];
        for (const relative of regularFiles(source).filter((file) => !exclude(file))) {
          const bytes = fs.readFileSync(path.join(source, relative));
          fs.mkdirSync(path.dirname(path.join(staging, 'files', relative)), { recursive: true });
          fs.writeFileSync(path.join(staging, 'files', relative), bytes);
          files.push([relative, sha256(bytes)]);
        }
        fs.mkdirSync(staging, { recursive: true });
        fs.writeFileSync(path.join(staging, manifestName), JSON.stringify({ format: cacheFormat, kind, tree, key: hash, files } satisfies FilesManifest));
        // A damaged entry under this name would never be read again: replace it.
        fs.rmSync(entry, { recursive: true, force: true });
        fs.renameSync(staging, entry);
      } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        log(`tree cache: could not store ${entry}: ${(error as Error).message}`);
      }
    },
  };
}

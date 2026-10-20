// A RepoFs over a committed tree, so the analyzer can run on base and head without a working tree.
// The only things read from disk are the installed environment: `node_modules` directories of a checkout (the
// target's dependencies), reached through a shadow root that holds nothing but symlinks to them. Tracked content
// always comes from git objects; an in-repo path that isn't in the commit doesn't exist, even if a working tree
// has it (the shadow root has no such file for `ts.sys` fallbacks to find). A node_modules link back into the
// repository (a workspace package) is followed into the commit too, never into the checkout's working tree.
import fs from 'node:fs';
import path from 'node:path';
import type { RepoFs } from '../analyzer/repo-fs.js';
import type { CommitTree } from './git-tree.js';

export interface Environment {
  /** The checkout whose installed node_modules both trees use. */
  checkout: string;
  /** Directory of symlinks `<dir>/node_modules -> <checkout>/<dir>/node_modules`. */
  shadowRoot: string;
  /** Repo-relative directories whose node_modules were linked ('' for the root). */
  linked: string[];
}

/** Links every `<dir>/node_modules` of `checkout` for directories that exist in any of the trees. */
export function createEnvironment(checkout: string, trees: readonly CommitTree[], shadowRoot: string): Environment {
  // Resolved once: a relative link target would resolve against the link's own directory, not the cwd.
  const root = path.resolve(checkout);
  const linked: string[] = [];
  fs.mkdirSync(shadowRoot, { recursive: true });
  const directories = new Set<string>();
  for (const tree of trees) for (const directory of tree.directories) directories.add(directory);
  for (const directory of [...directories].sort()) {
    if (directory.split('/').includes('node_modules')) continue;
    const installed = path.join(root, directory, 'node_modules');
    if (!fs.existsSync(installed)) continue;
    fs.mkdirSync(path.join(shadowRoot, directory), { recursive: true });
    fs.symlinkSync(installed, path.join(shadowRoot, directory, 'node_modules'));
    linked.push(directory);
  }
  return { checkout: root, shadowRoot: path.resolve(shadowRoot), linked };
}

const isEnvironmentPath = (relativePath: string) => relativePath.startsWith('..') || path.isAbsolute(relativePath) || relativePath.split('/').includes('node_modules');

/** Real path of a path whose leading part exists on disk (the rest is appended), or null when nothing does. */
export function diskRealpath(absolutePath: string): string | null {
  const rest: string[] = [];
  for (let current = absolutePath; ; current = path.dirname(current)) {
    try {
      return path.join(fs.realpathSync(current), ...rest.reverse());
    } catch {
      if (path.dirname(current) === current) return null;
      rest.push(path.basename(current));
    }
  }
}

export function commitRepoFs(tree: CommitTree, shadowRoot: string, checkout?: string): RepoFs {
  const root = path.resolve(shadowRoot);
  const checkoutRoot = checkout ? fs.realpathSync(checkout) : null;
  const tracked = [...tree.entries.keys()].sort();
  const relative = (absolutePath: string) => path.relative(root, absolutePath).split(path.sep).join('/');
  /** A path that leads through an environment link into the checkout outside node_modules: its repo-relative path. */
  const workspacePath = (absolutePath: string): string | null => {
    if (!checkoutRoot) return null;
    const real = diskRealpath(absolutePath);
    if (!real) return null;
    const inCheckout = path.relative(checkoutRoot, real).split(path.sep).join('/');
    return inCheckout.startsWith('..') || path.isAbsolute(inCheckout) || inCheckout.split('/').includes('node_modules') ? null : inCheckout;
  };
  let children: Map<string, { files: Set<string>; directories: Set<string> }> | undefined;
  const childIndex = () => {
    if (children) return children;
    children = new Map();
    const slot = (directory: string) => {
      let entry = children!.get(directory);
      if (!entry) children!.set(directory, (entry = { files: new Set(), directories: new Set() }));
      return entry;
    };
    for (const file of tracked) {
      const slash = file.lastIndexOf('/');
      slot(slash === -1 ? '' : file.slice(0, slash)).files.add(file.slice(slash + 1));
    }
    for (const directory of tree.directories) {
      if (directory === '') continue;
      const slash = directory.lastIndexOf('/');
      slot(slash === -1 ? '' : directory.slice(0, slash)).directories.add(directory.slice(slash + 1));
    }
    return children;
  };
  /** A tracked symlink inside the tree reads as its target's blob (one level; like readFileSync following the link). */
  const blobPath = (relativePath: string): string | undefined => {
    const entry = tree.entries.get(relativePath);
    if (!entry || entry.mode === '160000') return undefined;
    if (entry.mode !== '120000') return relativePath;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), tree.text(relativePath) ?? ''));
    const targetEntry = tree.entries.get(target);
    return targetEntry && targetEntry.mode !== '120000' && targetEntry.mode !== '160000' ? target : undefined;
  };
  const readTracked = (relativePath: string) => {
    const blob = blobPath(relativePath);
    return blob === undefined ? undefined : tree.text(blob);
  };
  return {
    root,
    tracked: () => tracked,
    read(relativePath) {
      if (isEnvironmentPath(relativePath)) {
        const inRepo = workspacePath(path.join(root, relativePath));
        return inRepo === null ? undefined : readTracked(inRepo);
      }
      return readTracked(relativePath);
    },
    fileExists(absolutePath) {
      const relativePath = relative(absolutePath);
      if (isEnvironmentPath(relativePath)) {
        const inRepo = workspacePath(absolutePath);
        if (inRepo !== null) return blobPath(inRepo) !== undefined;
        return fs.statSync(absolutePath, { throwIfNoEntry: false })?.isFile() ?? false;
      }
      return blobPath(relativePath) !== undefined;
    },
    directoryExists(absolutePath) {
      const relativePath = relative(absolutePath);
      if (isEnvironmentPath(relativePath)) {
        const inRepo = workspacePath(absolutePath);
        if (inRepo !== null) return tree.directories.has(inRepo);
        return fs.statSync(absolutePath, { throwIfNoEntry: false })?.isDirectory() ?? false;
      }
      return tree.directories.has(relativePath);
    },
    realpath(absolutePath) {
      const relativePath = relative(absolutePath);
      if (!isEnvironmentPath(relativePath)) return absolutePath;
      const inRepo = workspacePath(absolutePath);
      if (inRepo !== null) return path.join(root, inRepo);
      return diskRealpath(absolutePath) ?? absolutePath;
    },
    entries(absolutePath) {
      const relativePath = relative(absolutePath);
      const inRepo = isEnvironmentPath(relativePath) ? workspacePath(absolutePath) : null;
      if (isEnvironmentPath(relativePath) && inRepo === null) {
        const files: string[] = [];
        const directories: string[] = [];
        for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
          if (entry.isFile()) files.push(entry.name);
          else if (entry.isDirectory()) directories.push(entry.name);
        }
        return { files, directories };
      }
      const entry = childIndex().get(inRepo ?? relativePath);
      return { files: [...(entry?.files ?? [])], directories: [...(entry?.directories ?? [])] };
    },
  };
}

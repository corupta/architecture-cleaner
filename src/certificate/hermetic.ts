// Where a certificate can be made. The certifier materializes trees in its work dir (the shadow root the analyzer reads
// through, the runtime-probe skeletons, the runner and oracle worktrees, K6's collection) and runs TypeScript and the
// target's own tools on them. TypeScript's automatic @types lookup and Node's (and the runners') module resolution walk
// up from every one of those files to the root, and the nearest package.json above a file sets its module format. A
// node_modules or a package.json above the work dir is therefore read as if it were part of the environment: the same
// trees certified in another directory would give another certificate. A hermetic directory has neither on its real
// path (symlinks resolved, so a link can't bring an ancestor in) nor on any ancestor. The certifier certifies only in
// one; callers that pick a directory pick a hermetic one, and long runs check theirs before they start.
import fs from 'node:fs';
import path from 'node:path';
import { diskRealpath } from './commit-fs.js';

/** The names TypeScript and Node look up in every directory on the way up from a file. */
const lookedUp = ['node_modules', 'package.json'] as const;

export class NotHermeticError extends Error {}

/** The real path of `directory`; a part that doesn't exist yet is appended to the real path of the part that does. */
export function realDirectory(directory: string): string {
  const absolute = path.resolve(directory);
  return diskRealpath(absolute) ?? absolute;
}

/** Every node_modules and package.json in `directory` (its real path) and in each of its ancestors, nearest first. */
export function lookupEntriesOnPath(directory: string): string[] {
  const found: string[] = [];
  for (let current = realDirectory(directory); ; current = path.dirname(current)) {
    for (const name of lookedUp) if (fs.existsSync(path.join(current, name))) found.push(path.join(current, name));
    if (path.dirname(current) === current) return found;
  }
}

/**
 * node_modules above an environment checkout (its real path; its own excluded). The certifier links the checkout's
 * node_modules in, and Node and TypeScript resolve an installed package's own imports from the package's real path in
 * the checkout: an import the checkout's install doesn't satisfy is looked up in these. Base and head read them alike,
 * but what the target's tools load (K3b, K3c, K6, K8) can depend on them.
 */
export function nodeModulesAbove(checkout: string): string[] {
  return lookupEntriesOnPath(path.dirname(realDirectory(checkout))).filter((entry) => path.basename(entry) === 'node_modules');
}

const listed = (entries: string[]) => (entries.length === 1 ? entries[0]! : `${entries.slice(0, -1).join(', ')} and ${entries.at(-1)!}`);

/**
 * Why `directory` can't hold a certification (one sentence naming what was found, then `remedy`), or null when it is
 * hermetic. `role` names the directory: 'the work dir', 'the run directory'.
 */
export function hermeticProblem(directory: string, role: string, remedy: string): string | null {
  const found = lookupEntriesOnPath(directory);
  if (!found.length) return null;
  return `${role} ${realDirectory(directory)} is not hermetic: ${listed(found)} ${found.length === 1 ? 'is' : 'are'} on its path, and TypeScript and Node `
    + `look node_modules and package.json up from every tree certified there, so the certificate would depend on ${found.length === 1 ? 'it' : 'them'}. ${remedy}`;
}

/** The real path of `directory` when it is hermetic; a NotHermeticError otherwise, before anything is written there. */
export function requireHermetic(directory: string, role: string, remedy: string): string {
  const problem = hermeticProblem(directory, role, remedy);
  if (problem) throw new NotHermeticError(problem);
  return realDirectory(directory);
}

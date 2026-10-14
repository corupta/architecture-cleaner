// R3 filename normalization (plan §2.3; contract C5): after R1/R2 placed files under <moduleRoot>/modules/<m>/,
// platform/<c>/ and shared/, rename each file whose name has a role word to `<kebab stem>.<role>` (names.ts), its
// co-located specs with it, unless the filename-observability guard (guard.ts) finds anything that could see the old
// name. One step per folder, in path order. The renames are dry-run through the executor first, and a rename it would
// decline is dropped with its reason, so the steps returned apply on the tree they were computed for.
import path from 'node:path';
import { analyzeRepo } from '../analyzer/analyze.js';
import type { RepoFs } from '../analyzer/repo-fs.js';
import { loadRunnerConfig } from '../analyzer/runner-config.js';
import { loadScopes } from '../analyzer/tsconfig-scopes.js';
import type { Analysis } from '../analyzer/types.js';
import type { Profile } from '../certificate/profile.js';
import { executeMove } from '../executor/execute.js';
import { guardRenames } from './guard.js';
import { normalizedName, splitBasename } from './names.js';

export interface RenameStep {
  index: number;
  rung: 'R3';
  group: string;
  /** Repo-relative old path → new path. Co-moved `__mocks__` files are the executor's to add. */
  moves: Map<string, string>;
}

/**
 * A rename R3 leaves undone. Reasons: unparseable, case-only, destination-exists, destination-clash, filename-observed,
 * name-from-file-loader, snapshot-pair, name-in-text, suffix-tooling, with-pair (another file of its subject+spec pair
 * was declined), and executor-<code> (the step's dry run declined it, e.g. executor-config-reference).
 */
export interface RenameDecline {
  file: string;
  to: string;
  reason: string;
  detail: string;
}

export interface NormalizationOptions {
  /** Repo-relative package root ('' for the repo root). */
  packageRoot: string;
  /** Package-relative directory that holds modules/, platform/ and shared/ (the plan's moduleRoot, e.g. `src`). */
  moduleRoot: string;
  profile?: Profile | null;
}

/** A subject and its co-located specs (`x.ts`, `x.spec.ts`): renamed together or not at all. */
interface RenameGroup {
  folder: string;
  renames: Map<string, string>;
}

const join = (...parts: string[]) => parts.filter(Boolean).join('/');

/** The step group of a file R1/R2 placed: `module/<m>`, `platform/<c>` or `shared/shared`; null elsewhere. */
function folderOf(file: string, base: string): string | null {
  const inside = base ? (file.startsWith(`${base}/`) ? file.slice(base.length + 1) : null) : file;
  if (inside === null) return null;
  const [kind, name, ...rest] = inside.split('/');
  if (kind === 'shared' && name) return 'shared/shared';
  if ((kind === 'modules' || kind === 'platform') && name && rest.length) return `${kind === 'modules' ? 'module' : 'platform'}/${name}`;
  return null;
}

export function normalizationSteps(repo: RepoFs, options: NormalizationOptions): { steps: RenameStep[]; declined: RenameDecline[] } {
  const base = join(options.packageRoot, options.moduleRoot);
  const tracked = repo.tracked();
  const lowerTracked = new Map(tracked.map((file) => [file.toLowerCase(), file]));
  const declined: RenameDecline[] = [];
  const decline = (file: string, to: string, reason: string, detail: string) => declined.push({ file, to, reason, detail });

  // Proposed renames, grouped by subject: x.ts and x.spec.ts share the name part `x` in one directory.
  const groups = new Map<string, RenameGroup>();
  for (const file of tracked) {
    const folder = folderOf(file, base);
    if (!folder || file.split('/').some((segment) => segment === '__mocks__' || segment === '__snapshots__' || segment === 'node_modules')) continue;
    const basename = path.posix.basename(file);
    const result = normalizedName(basename);
    if (result.kind === 'normal' || result.kind === 'no-role') continue;
    if (result.kind === 'unparseable') {
      decline(file, file, 'unparseable', result.detail);
      continue;
    }
    const key = `${path.posix.dirname(file)}\0${splitBasename(basename)!.name}`;
    const group = groups.get(key) ?? { folder, renames: new Map() };
    group.renames.set(file, path.posix.join(path.posix.dirname(file), result.basename));
    groups.set(key, group);
  }

  // Destinations: never case-only (K1), never onto a file that stays, never two files onto one name (any case, or one
  // stem with .ts and .tsx).
  const all = new Map([...groups.values()].flatMap((group) => [...group.renames]));
  const clashKey = (file: string) => file.replace(/\.[cm]?[jt]sx?$/, '').toLowerCase();
  const destinations = new Map<string, string[]>();
  for (const [from, to] of all) destinations.set(clashKey(to), [...(destinations.get(clashKey(to)) ?? []), from]);
  const problems = new Map<string, { reason: string; detail: string }>();
  for (const [from, to] of all) {
    const occupant = lowerTracked.get(to.toLowerCase());
    const sameStem = tracked.find((file) => file !== from && !all.has(file) && clashKey(file) === clashKey(to));
    if (from.toLowerCase() === to.toLowerCase()) problems.set(from, { reason: 'case-only', detail: `${from} -> ${to} differs only in case` });
    else if (occupant && !all.has(occupant)) problems.set(from, { reason: 'destination-exists', detail: `${occupant} is already there` });
    else if (sameStem) problems.set(from, { reason: 'destination-clash', detail: `${sameStem} has the same name` });
    else if (destinations.get(clashKey(to))!.length > 1) problems.set(from, { reason: 'destination-clash', detail: `${destinations.get(clashKey(to))!.join(' and ')} would share the name` });
  }

  const runner = loadRunnerConfig(repo);
  const analysis: Analysis = analyzeRepo(repo, { runner });
  const guardDeclines = guardRenames({ repo, packageRoot: options.packageRoot, analysis, runner, scopes: loadScopes(repo), profile: options.profile ?? null }, all);
  for (const guard of guardDeclines) if (!problems.has(guard.file)) problems.set(guard.file, { reason: guard.reason, detail: guard.detail });

  // A pair renames together: one declined member keeps the others' names too.
  const dropBlocked = (candidates: RenameGroup[], blockers: ReadonlyMap<string, { reason: string; detail: string }>): RenameGroup[] => candidates.filter((group) => {
    const blocked = [...group.renames.keys()].find((from) => blockers.has(from));
    if (!blocked) return true;
    for (const [from, to] of group.renames) {
      const problem = blockers.get(from);
      if (problem) decline(from, to, problem.reason, problem.detail);
      else decline(from, to, 'with-pair', `${blocked} keeps its name (${blockers.get(blocked)!.reason})`);
    }
    return false;
  });
  let kept = dropBlocked([...groups.values()], problems);

  // One dry run of every rename (renames in place are independent of each other): the executor's own declines (config
  // references, specifiers it can't re-spell, location-sensitive code) drop the groups they name, until it verifies.
  while (kept.length) {
    const moves = new Map(kept.flatMap((group) => [...group.renames]));
    const result = executeMove(repo, moves, { dryRun: true });
    if (result.outcome === 'verified' || result.outcome === 'applied') break;
    const blockers = new Map<string, { reason: string; detail: string }>();
    if (result.outcome === 'unverified') {
      for (const violation of result.violations) {
        for (const owner of ownersOf(violation.file, moves, analysis)) if (!blockers.has(owner)) blockers.set(owner, { reason: 'executor-unverified', detail: `${violation.file}: ${violation.detail}` });
      }
      // A violation that names no rename can't be pinned on one: nothing is left to verify.
      if (blockers.size === 0) for (const from of moves.keys()) blockers.set(from, { reason: 'executor-unverified', detail: result.violations.map((violation) => `${violation.file}: ${violation.detail}`).join('; ') });
    } else if (result.outcome === 'declined') {
      for (const executorDecline of result.declines) {
        const owners = ownersOf(executorDecline.file, moves, analysis);
        for (const owner of owners.length ? owners : [...moves.keys()]) {
          if (!blockers.has(owner)) blockers.set(owner, { reason: `executor-${executorDecline.code}`, detail: `${executorDecline.file}: ${executorDecline.detail}` });
        }
      }
    }
    kept = dropBlocked(kept, blockers);
  }

  const folders = [...new Set(kept.map((group) => group.folder))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const steps: RenameStep[] = folders.map((folder, index) => ({
    index: index + 1,
    rung: 'R3',
    group: folder,
    moves: new Map(kept.filter((group) => group.folder === folder).flatMap((group) => [...group.renames]).sort(([a], [b]) => (a < b ? -1 : 1))),
  }));
  declined.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { steps, declined };
}

/** The renames an executor decline is about: the file itself, the subject of a co-moved mock, or what a file imports. */
function ownersOf(file: string, moves: ReadonlyMap<string, string>, analysis: Analysis): string[] {
  if (moves.has(file)) return [file];
  const source = [...moves].find(([, to]) => to === file)?.[0];
  if (source) return [source];
  const mocked = file.replace(/(^|\/)__mocks__\//, '$1');
  if (moves.has(mocked)) return [mocked];
  return (analysis.files.get(file)?.sites ?? []).filter((site) => site.resolution.type === 'file' && moves.has(site.resolution.path))
    .map((site) => (site.resolution as { path: string }).path);
}

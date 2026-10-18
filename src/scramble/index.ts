// `ac scramble` (plan §7): flatten a feature-modular package into type folders as one real move. The layout is planned
// from the base commit, applied with our executor (a file it declines stays where it is, never forced), committed
// reproducibly (fixed identity, the base commit's date) and checked by our certifier as a pure move: its verdict is
// recorded as it comes back, FAIL included (the bench scores the scramble either way). The original feature folder of
// every scored file is the benchmark's ground truth.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeRepo } from '../analyzer/analyze.js';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import type { Analysis } from '../analyzer/types.js';
import { certify } from '../certificate/certify.js';
import { readCommitTree } from '../certificate/git-tree.js';
import { inferPathMap } from '../certificate/path-map.js';
import { summarize, trailers } from '../certificate/report.js';
import { spanViews } from '../certificate/spans.js';
import { cacheDirFromEnvironment } from '../certificate/tree-cache.js';
import type { CheckId } from '../certificate/types.js';
import { executeMove, type MoveResult } from '../executor/execute.js';
import { branchExists, git, headCommit, isClean, resolveRevision, treeOf } from '../orchestrator/git.js';
import { featureOf } from './classify.js';
import { readInventory } from './inventory.js';
import { layoutScramble, type ScrambleLayout } from './layout.js';
import type { ScrambleOptions, ScrambleResult, ScrambleVariant } from './types.js';

export { readScrambleManifest } from './manifest.js';

export const defaultScrambleBranch = (name: string, variant: ScrambleVariant) => `ac-scramble/${name}${variant === 'H1' ? '-H1' : ''}`;

/** The scramble commit's author and committer: fixed, so the same scramble of the same base is the same commit. */
const scrambleIdentity = (date: string): NodeJS.ProcessEnv => ({
  GIT_AUTHOR_NAME: 'ac scramble', GIT_AUTHOR_EMAIL: 'ac-scramble@architecture-cleaner.invalid', GIT_AUTHOR_DATE: date,
  GIT_COMMITTER_NAME: 'ac scramble', GIT_COMMITTER_EMAIL: 'ac-scramble@architecture-cleaner.invalid', GIT_COMMITTER_DATE: date,
});

interface Entry {
  /** Package-relative scored file. */
  subject: string;
  /** Package-relative moves: the subject and its co-located tests. */
  moves: Map<string, string>;
}

interface Dropped {
  /** Package-relative path left in place. */
  path: string;
  code: string;
  detail: string;
  test: boolean;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text: string, file: string) => new RegExp(`(^|[^\\w./-])${escapeRegex(file)}($|[^\\w./-])`).test(text);

/**
 * Applies the layout with the executor. A declined or unverified attempt changes nothing on disk; the entries its
 * reasons name are dropped (a test alone when only the test is named) and the rest is attempted again.
 */
function applyLayout(repo: string, packagePrefix: string, layout: ScrambleLayout, log: (message: string) => void): { result: Extract<MoveResult, { before: Analysis }>; dropped: Dropped[] } {
  const entries: Entry[] = layout.entities.filter((entity) => entity.scrambled !== entity.original).map((entity) => ({
    subject: entity.original,
    moves: new Map([[entity.original, entity.scrambled], ...(layout.tests.get(entity.original) ?? [])]),
  }));
  const dropped: Dropped[] = [];
  let baseAnalysis: Analysis | undefined;
  for (let attempt = 1; ; attempt++) {
    const requested = new Map(entries.flatMap((entry) => [...entry.moves].map(([from, to]) => [packagePrefix + from, packagePrefix + to] as const)));
    if (!requested.size) throw new Error('the executor declined every move of the scramble');
    log(`executor attempt ${attempt}: ${entries.length} files and ${requested.size - entries.length} co-located tests`);
    const result = executeMove(gitRepoFs(repo), requested);
    if ('before' in result) {
      if (result.outcome === 'verified') throw new Error('the executor stopped after verification outside a dry run');
      return { result, dropped };
    }
    // Declines name a file by its path before the move, except multi-program-file; violations by its path after.
    const inverse = new Map([...result.moves].map(([from, to]) => [to, from]));
    const reasons = result.outcome === 'declined'
      ? result.declines.map((decline) => ({ file: decline.code === 'multi-program-file' ? (inverse.get(decline.file) ?? decline.file) : decline.file, code: decline.code, detail: `${decline.file}: ${decline.detail}` }))
      : result.violations.map((violation) => ({ file: inverse.get(violation.file) ?? violation.file, code: 'unverified', detail: `${violation.file}: ${violation.detail}` }));
    const drops = new Map<Entry, { code: string; detail: string; tests: string[] | null }>();
    const unattributed: string[] = [];
    const drop = (entry: Entry, reason: { code: string; detail: string }, test: string | null) => {
      const existing = drops.get(entry);
      if (existing && existing.tests === null) return;
      if (test === null) drops.set(entry, { ...reason, tests: null });
      else drops.set(entry, { ...(existing ?? reason), tests: [...(existing?.tests ?? []), test] });
    };
    for (const reason of reasons) {
      const file = reason.file.slice(packagePrefix.length);
      const owner = reason.file.startsWith(packagePrefix) ? entries.find((entry) => entry.moves.has(file)) : undefined;
      if (owner) {
        drop(owner, reason, file === owner.subject ? null : file);
        continue;
      }
      const named = entries.filter((entry) => [...entry.moves].some(([from, to]) => mentions(reason.detail, packagePrefix + from) || mentions(reason.detail, packagePrefix + to)));
      // An importer whose specifier can't be rewritten: the moved files it references stay instead.
      let referenced: Entry[] = [];
      if (!named.length) {
        baseAnalysis ??= analyzeRepo(gitRepoFs(repo));
        const targets = (baseAnalysis.files.get(reason.file)?.sites ?? []).flatMap((site) => (site.resolution.type === 'file' && site.resolution.path.startsWith(packagePrefix) ? [site.resolution.path.slice(packagePrefix.length)] : []));
        referenced = entries.filter((entry) => targets.some((target) => entry.moves.has(target)));
      }
      for (const entry of named.length ? named : referenced) drop(entry, reason, null);
      if (!named.length && !referenced.length) unattributed.push(`${reason.code} ${reason.detail}`);
    }
    if (!drops.size) throw new Error(`the executor ${result.outcome} the scramble for reasons no scrambled file owns: ${unattributed.slice(0, 5).join('; ')}`);
    for (const [entry, reason] of drops) {
      if (reason.tests === null) {
        entries.splice(entries.indexOf(entry), 1);
        dropped.push({ path: entry.subject, code: reason.code, detail: reason.detail, test: false });
        for (const test of [...entry.moves.keys()].filter((file) => file !== entry.subject)) dropped.push({ path: test, code: reason.code, detail: `its subject ${entry.subject} stays`, test: true });
      } else {
        for (const test of new Set(reason.tests)) {
          entry.moves.delete(test);
          dropped.push({ path: test, code: reason.code, detail: reason.detail, test: true });
        }
      }
    }
    log(`executor ${result.outcome}: ${drops.size} files stay (${[...drops].slice(0, 3).map(([entry, reason]) => `${entry.subject} ${reason.code}`).join(', ')}${drops.size > 3 ? ', …' : ''})`);
  }
}

const byPath = <T extends { path: string }>(a: T, b: T) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Files identical modulo specifiers are paired by the certifier's pathMap inference on path evidence alone (path-map.ts);
 * when its tie-break pairs them unlike the executor did, every check reads the move wrong: a false rejection. The files
 * are interchangeable, so the scramble can take the certifier's pairing instead. Returns the repo-relative moves the
 * inference reads differently (from → the destination it pairs with), or null when it reads the staged move as applied.
 */
function inferenceDisagreement(repo: string, base: string, moves: ReadonlyMap<string, string>, identity: NodeJS.ProcessEnv): Map<string, string> | null {
  const probe = git(repo, ['commit-tree', git(repo, ['write-tree']).trim(), '-p', base, '-m', 'ac scramble: pathMap probe'], undefined, identity).trim();
  const before = readCommitTree(repo, base);
  const after = readCommitTree(repo, probe);
  const inferred = inferPathMap(before, after, spanViews(before), spanViews(after));
  const destinations = new Set(moves.values());
  const differing = [...moves].filter(([from, to]) => inferred.map(from) !== to && destinations.has(inferred.map(from)));
  return differing.length ? new Map(differing.map(([from]) => [from, inferred.map(from)])) : null;
}

/**
 * The layout with some destinations replaced (repo-relative), for scored files and their tests. The leaky flag belongs
 * to a planned name (a feature prefix, a counter), so a file paired with another file's destination takes that
 * destination's flag; a test's destination carries its subject's.
 */
export function reassign(layout: ScrambleLayout, packagePrefix: string, destinations: ReadonlyMap<string, string>): ScrambleLayout {
  const destinationOf = (file: string, planned: string) => destinations.get(packagePrefix + file)?.slice(packagePrefix.length) ?? planned;
  const leakyAt = new Map(layout.entities.map((entity) => [entity.scrambled, entity.leaky]));
  for (const entity of layout.entities) for (const planned of layout.tests.get(entity.original)?.values() ?? []) leakyAt.set(planned, entity.leaky);
  return {
    ...layout,
    entities: layout.entities.map((entity) => {
      const scrambled = destinationOf(entity.original, entity.scrambled);
      return { ...entity, scrambled, leaky: leakyAt.get(scrambled) ?? entity.leaky };
    }),
    tests: new Map([...layout.tests].map(([subject, tests]) => [subject, new Map([...tests].map(([test, planned]) => [test, destinationOf(test, planned)]))])),
  };
}

export async function scrambleRepo(options: ScrambleOptions): Promise<ScrambleResult> {
  const log = options.log ?? (() => {});
  const { manifest, variant } = options;
  const repo = path.resolve(options.repo);
  const out = path.resolve(options.out);
  const branch = options.branch ?? defaultScrambleBranch(manifest.name, variant);
  const certifying = options.certify ?? true;
  if (options.oracles && !options.profile?.oracles?.length) throw new Error('oracles need a profile with oracle commands');
  if (options.oracles && !certifying) throw new Error('oracles run inside the certificate: certification is off');
  const base = resolveRevision(repo, manifest.sha);
  const head = headCommit(repo);
  if (head !== base) throw new Error(`${repo} is at ${head.slice(0, 12)}, not at the manifest's ${manifest.sha}: scramble a worktree checked out there`);
  if (!isClean(repo)) throw new Error(`${repo} has uncommitted changes to tracked files`);
  if (branchExists(repo, branch)) throw new Error(`branch ${branch} already exists in ${repo}: delete it or pass another branch name`);
  const packagePrefix = manifest.packageRoot ? `${manifest.packageRoot}/` : '';

  log(`reading ${manifest.packageRoot || '.'}/${manifest.moduleRoot} at ${base.slice(0, 12)}`);
  const inventory = readInventory(gitRepoFs(repo), manifest.packageRoot, manifest.moduleRoot);
  const date = git(repo, ['log', '-1', '--format=%cI', base]).trim();
  let layout = layoutScramble(manifest, variant, inventory);
  let { result, dropped } = applyLayout(repo, packagePrefix, layout, log);
  for (let round = 1; round <= 2; round++) {
    const reassigned = inferenceDisagreement(repo, base, result.moves, scrambleIdentity(date));
    if (!reassigned) break;
    log(`the certifier's pathMap inference pairs ${reassigned.size} interchangeable files differently: taking its pairing`);
    git(repo, ['reset', '-q', '--hard', base]);
    layout = reassign(layout, packagePrefix, reassigned);
    ({ result, dropped } = applyLayout(repo, packagePrefix, layout, log));
  }

  const declinedFiles = new Map(dropped.filter((file) => !file.test).map((file) => [file.path, file]));
  const entities = layout.entities.map((entity) => (declinedFiles.has(entity.original) ? { ...entity, scrambled: entity.original, leaky: false } : entity));
  const testsMoved = [...layout.tests.values()].reduce((sum, tests) => sum + tests.size, 0) - dropped.filter((file) => file.test).length;
  const filesMoved = entities.filter((entity) => entity.scrambled !== entity.original).length;
  const subject = `chore(scramble): flatten ${packagePrefix}${manifest.moduleRoot} into type folders (${manifest.name}${variant === 'H1' ? ', H1 opaque names' : ''})`;
  const body = [
    `ac scramble moved ${filesMoved} scored files and ${testsMoved} co-located tests (${result.moves.size} paths with co-moves),`,
    `with ${result.edits.length} specifier edits in ${new Set(result.edits.map((edit) => edit.file)).size} files.`,
    `${declinedFiles.size === 1 ? '1 file the executor declined stays where it was' : `${declinedFiles.size} files the executor declined stay where they were`}. The ground truth is in scramble.json, outside the tree.`,
  ].join('\n');
  git(repo, ['commit', '-q', '--no-verify', '-F', '-'], `${subject}\n\n${body}\n`, scrambleIdentity(date));
  let commit = headCommit(repo);
  log(`committed ${commit.slice(0, 12)}: ${filesMoved} files moved, ${declinedFiles.size} declined`);

  fs.mkdirSync(out, { recursive: true });
  let certificate: ScrambleResult['certificate'] = null;
  if (certifying) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-scramble-certify-'));
    const cacheDir = cacheDirFromEnvironment();
    log(`certifying ${base.slice(0, 12)}..${commit.slice(0, 12)}${options.oracles ? ' with oracles' : ''}`);
    const issued = await certify({
      repo, base, head: commit, packageRoot: manifest.packageRoot, environment: path.resolve(options.environment ?? repo), profile: options.profile ?? null,
      oracles: Boolean(options.oracles), workDir, keep: false, ...(cacheDir ? { cacheDir } : {}),
    });
    const file = path.join(out, 'certificate.json');
    fs.writeFileSync(file, `${JSON.stringify(issued, null, 1)}\n`);
    fs.writeFileSync(path.join(out, 'certificate.txt'), `${summarize(issued)}\n`);
    certificate = {
      file, verdict: issued.verdict, scope: issued.scope, digest: issued.digest,
      failing: issued.checks.filter((check) => check.status === 'fail' || check.status === 'error').map((check) => check.id as CheckId),
    };
    // The trailers name trees, so the certificate stays true for the amended commit (same tree, new message).
    git(repo, ['commit', '-q', '--amend', '--no-verify', '--only', '-F', '-'], `${subject}\n\n${body}\n\n${trailers(issued).join('\n')}\n`, scrambleIdentity(date));
    commit = headCommit(repo);
    log(`certificate: ${issued.verdict.toUpperCase()} (${issued.scope})`);
  }
  git(repo, ['checkout', '-q', '-b', branch]);

  // Leakage: every file still in a ground-truth feature folder that the scramble didn't put there.
  const features = new Set(entities.filter((entity) => entity.truthKind === 'feature').map((entity) => entity.truth));
  const destinations = new Set([...result.moves.values()].map((file) => file.slice(packagePrefix.length)));
  const why = new Map<string, string>([
    ...layout.excluded.map((file) => [file.path, file.reason] as const),
    ...dropped.map((file) => [file.path, file.test ? `test left in place (${file.code}: ${file.detail})` : `declined by the executor (${file.code})`] as const),
  ]);
  const modulePrefix = `${manifest.moduleRoot}/`;
  const leakage = git(repo, ['ls-tree', '-r', '-z', '--name-only', commit, '--', packagePrefix || '.']).split('\0').filter(Boolean)
    .map((file) => file.slice(packagePrefix.length))
    .filter((file) => file.startsWith(modulePrefix) && !destinations.has(file) && features.has(featureOf(manifest, file.slice(modulePrefix.length)).truth))
    .map((file) => ({ path: file, reason: why.get(file) ?? 'not a TypeScript source file' }))
    .sort(byPath);

  const scramble: ScrambleResult = {
    format: 'ac-scramble/1',
    manifest,
    variant,
    repo,
    base,
    baseTree: treeOf(repo, base),
    commit,
    tree: treeOf(repo, commit),
    branch,
    worktree: repo,
    entities,
    excluded: layout.excluded,
    declined: dropped.filter((file) => !file.test).map(({ path: file, code, detail }) => ({ path: file, code, detail })).sort(byPath),
    leakage,
    certificate,
  };
  fs.writeFileSync(path.join(out, 'scramble.json'), `${JSON.stringify(scramble, null, 1)}\n`);
  fs.writeFileSync(path.join(out, 'pathmap.json'), `${JSON.stringify({ moves: Object.fromEntries([...result.moves].sort(([a], [b]) => (a < b ? -1 : 1))) }, null, 1)}\n`);
  return scramble;
}

// `ac certify <repo> <base>..<head>`: reads the two committed trees, infers the pathMap, runs K0–K8 and issues
// a certificate (plan §3.4). Never imports src/executor: it certifies any diff, ours or anyone else's.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { analyzeRepo } from '../analyzer/analyze.js';
import { loadRunnerConfig } from '../analyzer/runner-config.js';
import type { Analysis, AnalyzedFile } from '../analyzer/types.js';
import { byteSpanConfinement } from './byte-spans.js';
import { commitRepoFs, createEnvironment, type Environment } from './commit-fs.js';
import { emitLayout } from './emit-layout.js';
import { envelope } from './envelope.js';
import { type CommitTree, readCommitTree } from './git-tree.js';
import { requireHermetic } from './hermetic.js';
import { locationScan } from './location-scan.js';
import { moveSetIntegrity } from './move-set-integrity.js';
import { oracles } from './oracles.js';
import { inferPathMap } from './path-map.js';
import { runnerResolution } from './resolution-runner.js';
import { runtimeResolution } from './resolution-runtime.js';
import { typescriptResolution } from './resolution-typescript.js';
import { spanViews } from './spans.js';
import { testInventory } from './test-inventory.js';
import { packageDirectory } from './toolchain.js';
import { openTreeCache, placesOf } from './tree-cache.js';
import type { Certificate, CertifyContext, CertifyOptions, Check, CheckResult, Side } from './types.js';

export const checks: readonly Check[] = [envelope, moveSetIntegrity, byteSpanConfinement, typescriptResolution, runnerResolution, runtimeResolution, locationScan, testInventory, emitLayout, oracles];

const toolVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(packageDirectory(), 'package.json'), 'utf8')).version as string;
  } catch {
    return 'unknown';
  }
})();

export const residualRisk = [
  'consumers outside the repository (deep imports, handler strings in infrastructure, other services)',
  'runtime file-system contents (assets, templates, SQL read at runtime)',
  'environment-dependent resolution (NODE_PATH, untracked or generated files)',
  'stack-trace and source-map text',
  'CI triggers and review routing keyed by path (workflow `paths`, CODEOWNERS)',
];

const analyzerInputs = /(^|\/)(package|tsconfig[^/]*|jest[^/]*)\.json$|\.[cm]?[jt]sx?$/;

/** Loads every blob the analyzer reads with one `git cat-file --batch` per tree (one process per file otherwise). */
export function prefetchAnalyzerInputs(tree: CommitTree): void {
  tree.prefetch([...tree.entries.keys()].filter((file) => !file.split('/').includes('node_modules')
    && (analyzerInputs.test(file) || !path.posix.basename(file).includes('.'))));
}

/**
 * A fresh git worktree of `commit` at `directory` (hooks disabled), with the environment's node_modules linked in:
 * where the target's own tools run.
 */
export function addWorktree(repo: string, commit: string, directory: string, environment: Pick<Environment, 'checkout' | 'linked'>): string {
  fs.rmSync(directory, { recursive: true, force: true });
  execFileSync('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', '--force', directory, commit], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const linked of environment.linked) {
    const target = path.join(directory, linked, 'node_modules');
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(path.join(environment.checkout, linked, 'node_modules'), target);
  }
  return directory;
}

export function removeWorktrees(repo: string, directories: string[]): void {
  for (const directory of directories) {
    try {
      execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', directory], { stdio: 'ignore' });
    } catch {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
  if (directories.length) execFileSync('git', ['-C', repo, 'worktree', 'prune'], { stdio: 'ignore' });
}

/**
 * Makes the work dir `given` (real path `directory`) when it is missing, and returns what removes the certifier's leftovers
 * there. What the work dir held when opened is the user's: only the entries added since are deleted, then the directory
 * itself when that leaves it empty, unless it was given as a symlink (the link and its target are the user's too).
 */
export function openWorkDir(given: string, directory: string): () => void {
  const linked = fs.lstatSync(path.resolve(given), { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
  const held = new Set(fs.existsSync(directory) ? fs.readdirSync(directory) : []);
  fs.mkdirSync(directory, { recursive: true });
  return () => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory)) if (!held.has(entry)) fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
    if (!linked && !fs.readdirSync(directory).length) fs.rmdirSync(directory);
  };
}

export function createContext(given: CertifyOptions): { context: CertifyContext; cleanup(): void } {
  // Probes run from inside a worktree: a relative work dir would name another directory there. Its real path, refused
  // before anything is written when a node_modules or package.json above it would reach the trees certified in it.
  const workDir = requireHermetic(given.workDir, 'the work dir', 'Certify in a directory with neither on its path.');
  const removeWhatWasMade = openWorkDir(given.workDir, workDir);
  const options = { ...given, workDir, ...(given.cacheDir ? { cacheDir: path.resolve(given.cacheDir) } : {}) };
  const base = readCommitTree(options.repo, options.base);
  const head = readCommitTree(options.repo, options.head);
  const views = { base: spanViews(base), head: spanViews(head) };
  const pathMap = inferPathMap(base, head, views.base, views.head);
  const environment = createEnvironment(options.environment, [base, head], path.join(options.workDir, 'shadow'));
  const fsBySide = { base: commitRepoFs(base, environment.shadowRoot, environment.checkout), head: commitRepoFs(head, environment.shadowRoot, environment.checkout) };
  let analyses: Record<Side, Analysis> | undefined;
  const worktrees = new Map<Side, string>();
  const log = (message: string) => process.stderr.write(`[certify] ${message}\n`);
  const cache = options.cacheDir ? openTreeCache(options.cacheDir, { packageRoot: options.packageRoot, environment }, log) : null;
  /** The analyzer's pass over one tree; the tree cache keys it by the tool's TypeScript and Node too (builtins). */
  const analysisOf = (side: Side): Analysis => {
    const tree = side === 'base' ? base : head;
    const key = { typescript: ts.version, node: process.version };
    const places = placesOf('shadow', environment.shadowRoot);
    // Later checks read these blobs too: one batch either way.
    prefetchAnalyzerInputs(tree);
    const stored = cache?.read<[string, AnalyzedFile][]>('analysis', tree.tree, key, places);
    if (stored) {
      log(`analysis of ${side} from the tree cache`);
      return { files: new Map(stored) };
    }
    const analysis = analyzeRepo(fsBySide[side], { runner: loadRunnerConfig(fsBySide[side]) });
    cache?.write('analysis', tree.tree, key, places, [...analysis.files]);
    return analysis;
  };
  const context: CertifyContext = {
    options,
    base,
    head,
    views,
    pathMap,
    environment,
    fs: fsBySide,
    cache,
    analyses() {
      analyses ??= { base: analysisOf('base'), head: analysisOf('head') };
      return analyses;
    },
    materialize(side) {
      const existing = worktrees.get(side);
      if (existing) return existing;
      const directory = addWorktree(options.repo, side === 'base' ? base.commit : head.commit, path.join(options.workDir, `worktree-${side}`), environment);
      worktrees.set(side, directory);
      return directory;
    },
    log,
  };
  const cleanup = () => {
    removeWorktrees(options.repo, [...worktrees.values()]);
    if (!options.keep) removeWhatWasMade();
  };
  return { context, cleanup };
}

async function runCheck(check: Check, context: CertifyContext): Promise<CheckResult> {
  const started = performance.now();
  context.log(`${check.id} ${check.title}`);
  let outcome: CheckResult;
  try {
    outcome = await check.run(context);
  } catch (error) {
    outcome = { id: check.id, title: check.title, status: 'error', summary: `crashed: ${(error as Error).message}`, metrics: {}, violations: [{ detail: (error as Error).stack ?? String(error) }], findings: [], durationMs: 0 };
  }
  return { ...outcome, durationMs: Math.round(performance.now() - started) };
}

/**
 * What the digest covers: the format, the tool, the two trees, the package root and profile, the pathMap, the checks,
 * the verdict and scope. Commit ids, machine paths and facts about the execution (durations, `run`) are left out, and
 * wherever a check's text names the repository, the environment or the work dir, a placeholder stands for it: the
 * same trees certified again (after an amend or a rebase, in another work dir) give the same digest.
 */
export function canonicalForm(certificate: Omit<Certificate, 'digest'>): string {
  const roots = ([[certificate.workDir, '{workDir}'], [certificate.environment.checkout, '{environment}'], [certificate.repo, '{repo}']] as const)
    .filter(([root]) => root.length > 1).toSorted(([a], [b]) => b.length - a.length);
  const anonymize = (text: string) => roots.reduce((current, [root, placeholder]) => current.replaceAll(root, placeholder), text);
  const { format, tool, baseTree, headTree, packageRoot, profile, pathMap, verdict, scope, residualRisk } = certificate;
  const checks = certificate.checks.map(({ durationMs: _durationMs, run: _run, ...check }) => check);
  const canonical = { format, tool, baseTree, headTree, packageRoot, profile, pathMap, checks, verdict, scope, residualRisk };
  return JSON.stringify(canonical, (_key, value: unknown) => (typeof value === 'string' ? anonymize(value) : value));
}

export function digestOf(certificate: Omit<Certificate, 'digest'>): string {
  return `sha256:${createHash('sha256').update(canonicalForm(certificate)).digest('hex')}`;
}

export async function certify(options: CertifyOptions): Promise<Certificate> {
  const { context, cleanup } = createContext(options);
  try {
    const results: CheckResult[] = [];
    for (const check of checks) {
      if (options.only && !options.only.includes(check.id)) continue;
      results.push(await runCheck(check, context));
    }
    const { pathMap, base, head } = context;
    const editedInPlace = [...pathMap.forward].filter(([from, to]) => from === to && base.entries.get(from)!.oid !== head.entries.get(to)!.oid).length;
    const k8 = results.find((check) => check.id === 'K8');
    const certificate: Omit<Certificate, 'digest'> = {
      format: 'ac-certificate/2',
      tool: { name: 'architecture-cleaner', version: toolVersion },
      repo: path.resolve(options.repo),
      base: base.commit,
      head: head.commit,
      baseTree: base.tree,
      headTree: head.tree,
      packageRoot: options.packageRoot,
      profile: options.profile?.name ?? null,
      environment: { checkout: context.environment.checkout, node: process.version, linkedNodeModules: context.environment.linked },
      workDir: context.options.workDir,
      pathMap: {
        moves: pathMap.moves.size,
        unchanged: pathMap.forward.size - pathMap.moves.size - editedInPlace,
        editedInPlace,
        deleted: pathMap.deleted,
        added: pathMap.added,
        ambiguousGroups: pathMap.ambiguous.length,
        entries: Object.fromEntries(pathMap.moves),
      },
      checks: results,
      verdict: results.some((check) => check.status === 'fail' || check.status === 'error') ? 'fail' : 'pass',
      scope: k8?.status === 'pass' || k8?.status === 'fail' ? 'full' : 'static',
      residualRisk,
    };
    return { ...certificate, digest: digestOf(certificate) };
  } finally {
    cleanup();
  }
}

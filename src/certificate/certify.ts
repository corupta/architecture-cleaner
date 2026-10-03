// `ac certify <repo> <base>..<head>`: reads the two committed trees, infers the pathMap, runs K0–K8 and issues
// a certificate (plan §3.4). Never imports src/executor: it certifies any diff, ours or anyone else's.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeRepo } from '../analyzer/analyze.js';
import { loadRunnerConfig } from '../analyzer/runner-config.js';
import type { Analysis } from '../analyzer/types.js';
import { byteSpanConfinement } from './byte-spans.js';
import { commitRepoFs, createEnvironment } from './commit-fs.js';
import { envelope } from './envelope.js';
import { readCommitTree } from './git-tree.js';
import { locationScan } from './location-scan.js';
import { moveSetIntegrity } from './move-set-integrity.js';
import { oracles } from './oracles.js';
import { inferPathMap } from './path-map.js';
import { runnerResolution } from './resolution-runner.js';
import { runtimeResolution } from './resolution-runtime.js';
import { typescriptResolution } from './resolution-typescript.js';
import { spanViews } from './spans.js';
import { testInventory } from './test-inventory.js';
import type { Certificate, CertifyContext, CertifyOptions, Check, CheckResult, Side } from './types.js';

export const checks: readonly Check[] = [envelope, moveSetIntegrity, byteSpanConfinement, typescriptResolution, runnerResolution, runtimeResolution, locationScan, testInventory, oracles];

const toolVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version as string;
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

export function createContext(options: CertifyOptions): { context: CertifyContext; cleanup(): void } {
  fs.mkdirSync(options.workDir, { recursive: true });
  const base = readCommitTree(options.repo, options.base);
  const head = readCommitTree(options.repo, options.head);
  const views = { base: spanViews(base), head: spanViews(head) };
  const pathMap = inferPathMap(base, head, views.base, views.head);
  const environment = createEnvironment(options.environment, [base, head], path.join(options.workDir, 'shadow'));
  const fsBySide = { base: commitRepoFs(base, environment.shadowRoot), head: commitRepoFs(head, environment.shadowRoot) };
  let analyses: Record<Side, Analysis> | undefined;
  const worktrees = new Map<Side, string>();
  const context: CertifyContext = {
    options,
    base,
    head,
    views,
    pathMap,
    environment,
    fs: fsBySide,
    analyses() {
      analyses ??= {
        base: analyzeRepo(fsBySide.base, { runner: loadRunnerConfig(fsBySide.base) }),
        head: analyzeRepo(fsBySide.head, { runner: loadRunnerConfig(fsBySide.head) }),
      };
      return analyses;
    },
    materialize(side) {
      const existing = worktrees.get(side);
      if (existing) return existing;
      const directory = path.join(options.workDir, `worktree-${side}`);
      const commit = side === 'base' ? base.commit : head.commit;
      fs.rmSync(directory, { recursive: true, force: true });
      execFileSync('git', ['-C', options.repo, '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', '--force', directory, commit], { stdio: ['ignore', 'pipe', 'pipe'] });
      for (const linked of environment.linked) {
        const target = path.join(directory, linked, 'node_modules');
        if (fs.existsSync(target)) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.symlinkSync(path.join(environment.checkout, linked, 'node_modules'), target);
      }
      worktrees.set(side, directory);
      return directory;
    },
    log: (message) => process.stderr.write(`[certify] ${message}\n`),
  };
  const cleanup = () => {
    for (const directory of worktrees.values()) {
      try {
        execFileSync('git', ['-C', options.repo, 'worktree', 'remove', '--force', directory], { stdio: 'ignore' });
      } catch {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
    if (worktrees.size) execFileSync('git', ['-C', options.repo, 'worktree', 'prune'], { stdio: 'ignore' });
    if (!options.keep) fs.rmSync(options.workDir, { recursive: true, force: true });
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

export function digestOf(certificate: Omit<Certificate, 'digest'>): string {
  const canonical = JSON.stringify({ ...certificate, checks: certificate.checks.map(({ durationMs: _durationMs, ...check }) => check) });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
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
      format: 'ac-certificate/1',
      tool: { name: 'architecture-cleaner', version: toolVersion },
      repo: path.resolve(options.repo),
      base: base.commit,
      head: head.commit,
      packageRoot: options.packageRoot,
      environment: { checkout: context.environment.checkout, node: process.version, linkedNodeModules: context.environment.linked },
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
      scope: k8?.status === 'pass' ? 'full' : 'static',
      residualRisk,
    };
    return { ...certificate, digest: digestOf(certificate) };
  } finally {
    cleanup();
  }
}

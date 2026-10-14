// R4 boundary rules (plan §2.3, contract C6): in a scratch worktree of the repo's HEAD (after R1–R3), the folder
// graph and its module DAG order give dependency-cruiser rules (rules.ts); dependency-cruiser freezes today's
// violations into the known-violations baseline, a check with that baseline must report nothing new on the
// unmodified tree, and one synthetic violation per rule must fire (anti-vacuity.ts). Returns the two files to commit
// at the package root, the report (contract C8) and the summary; the repo itself is never written.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { analyzeRepo, isSourceFile } from '../analyzer/analyze.js';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import { addWorktree, removeWorktrees } from '../certificate/certify.js';
import type { BoundaryRungInput, BoundaryRungResult } from '../orchestrator/types.js';
import { antiVacuityProbes, judgeProbes, probeFiles } from './anti-vacuity.js';
import { baselineCounts, checkWithBaseline, dependencyCruiserVersion, writeBaseline, type Violation } from './dependency-cruiser.js';
import { folderGraph, normalizeDirectory, type Layout } from './folder-graph.js';
import { backEdgesOf, dagOrder, stronglyConnectedComponents } from './order.js';
import { persistenceOf } from './persistence.js';
import { boundaryReport, boundarySummary, checkCommand, type BoundaryReport } from './report.js';
import { boundaryRules, configFileName, configText, knownViolationsFileName } from './rules.js';

export type { BoundaryReport } from './report.js';

export interface BoundaryRules extends BoundaryRungResult {
  report: BoundaryReport;
  /** The check command, run from the package root. */
  command: string;
  /** New violations of the anti-vacuity cruise that no probe asked for (a cycle reported along another path, say). */
  unexpected: Violation[];
  timings: { worktreeMs: number; analysisMs: number; baselineMs: number; checkMs: number; antiVacuityMs: number; totalMs: number };
}

export interface BoundaryOptions {
  /** Keep the scratch worktree and dependency-cruiser's JSON results under workDir (default: removed). */
  keep?: boolean;
}

const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const join = (...parts: string[]) => parts.filter(Boolean).join('/');
const elapsed = (since: number) => Math.round(performance.now() - since);

/** The directories from the repository root down to the package root ('' first). */
const ancestry = (packageRoot: string) => ['', ...packageRoot.split('/').filter(Boolean).map((_, at, parts) => parts.slice(0, at + 1).join('/'))];

/** The target's own TypeScript version (what its developers run the check with), else ours. */
function typescriptVersion(environment: string, packageRoot: string): string {
  for (const directory of ancestry(packageRoot).reverse()) {
    const manifest = path.join(environment, directory, 'node_modules', 'typescript', 'package.json');
    if (fs.existsSync(manifest)) return (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version: string }).version;
  }
  return ts.version;
}

/** The plan isn't read: the rules come from the tree at HEAD, where pins and skips already left their mark. */
export type BoundaryInput = Omit<BoundaryRungInput, 'planFile'>;

export async function buildBoundaryRules(input: BoundaryInput, options: BoundaryOptions = {}): Promise<BoundaryRules> {
  const started = performance.now();
  const layout: Layout = { packageRoot: normalizeDirectory(input.packageRoot), moduleRoot: normalizeDirectory(input.moduleRoot) };
  const repo = git(input.repo, 'rev-parse', '--show-toplevel');
  const head = git(repo, 'rev-parse', 'HEAD');
  const environment = path.resolve(input.environment);
  fs.mkdirSync(input.workDir, { recursive: true });
  const worktree = path.join(path.resolve(input.workDir), 'worktree');
  let phase = performance.now();
  addWorktree(repo, head, worktree, { checkout: environment, linked: ancestry(layout.packageRoot).filter((directory) => fs.existsSync(path.join(environment, directory, 'node_modules'))) });
  const worktreeMs = elapsed(phase);
  try {
    const packageDirectory = path.join(worktree, layout.packageRoot);
    const packagePrefix = layout.packageRoot ? `${layout.packageRoot}/` : '';
    phase = performance.now();
    const repoFs = gitRepoFs(worktree);
    const tracked = repoFs.tracked().filter((file) => file.startsWith(packagePrefix));
    // The rules check importers under the module root; nothing else needs analyzing.
    const scopePrefix = join(layout.packageRoot, layout.moduleRoot);
    const analysis = analyzeRepo(repoFs, { files: tracked.filter((file) => isSourceFile(file) && (!scopePrefix || file.startsWith(`${scopePrefix}/`))) });
    const graph = folderGraph(analysis, layout);
    const persistence = persistenceOf(analysis, layout);
    const moduleEdges = graph.edges.filter((edge) => edge.from.startsWith('module/') && edge.to.startsWith('module/'));
    const order = dagOrder(graph.modules, moduleEdges.map((edge) => ({ from: edge.from, to: edge.to, weight: edge.files })));
    // The composition root imports every module and most import it back (immich's BaseService), so with it every such
    // folder would be one component; the cycles worth reading are the ones without it.
    const outsideRoot = (key: string) => key !== graph.compositionRoot;
    const sccs = stronglyConnectedComponents(graph.folders.map((folder) => folder.key).filter(outsideRoot),
      graph.edges.filter((edge) => outsideRoot(edge.from) && outsideRoot(edge.to)).map((edge) => ({ from: edge.from, to: edge.to, weight: edge.files })))
      .filter((component) => component.length > 1);
    const backEdges = backEdgesOf(order, moduleEdges);
    const rules = boundaryRules({ graph, order, persistence });
    const config = configText(rules, { tsConfig: tracked.includes(join(layout.packageRoot, 'tsconfig.json')) ? 'tsconfig.json' : null });
    const analysisMs = elapsed(phase);
    input.log(`R4: ${graph.folders.length} folders, ${graph.modules.length} modules, ${graph.edges.length} folder edges (${graph.pairs.length} file pairs), ${rules.length} rules (${analysisMs} ms)`);

    const targets = [layout.moduleRoot || '.'];
    fs.writeFileSync(path.join(packageDirectory, configFileName), config);
    const baseline = await writeBaseline(packageDirectory, targets);
    const counts = baselineCounts(baseline.text);
    input.log(`R4: baseline of ${[...counts.values()].reduce((sum, count) => sum + count, 0)} known violations (${Math.round(baseline.durationMs)} ms)`);
    const check = await checkWithBaseline(packageDirectory, targets, path.join(input.workDir, 'check.json'));
    if (check.errors.length) {
      throw new Error(`the baseline doesn't hold on the tree it froze: ${check.errors.length} new violations, e.g. ${check.errors.slice(0, 3).map((violation) => `${violation.rule.name}: ${violation.from} -> ${violation.to}`).join('; ')}`);
    }
    input.log(`R4: check with the baseline: 0 new, ${check.known} known violations over ${check.modules} modules (${Math.round(check.durationMs)} ms)`);

    phase = performance.now();
    const probes = antiVacuityProbes({ graph, rules, order, persistence, existing: new Set(tracked.map((file) => file.slice(packagePrefix.length))) });
    for (const [file, content] of probeFiles(probes)) {
      const absolute = path.join(packageDirectory, file);
      if (fs.existsSync(absolute)) throw new Error(`anti-vacuity probe ${file} already exists`);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content);
    }
    const probeRun = await checkWithBaseline(packageDirectory, targets, path.join(input.workDir, 'anti-vacuity.json'));
    const { entries, unexpected } = judgeProbes(probes, probeRun.errors);
    const antiVacuityMs = elapsed(phase);
    input.log(`R4: anti-vacuity: ${entries.filter((entry) => entry.fired).length}/${entries.length} rules fired, ${unexpected.length} unexpected violations (${antiVacuityMs} ms)`);

    const command = checkCommand(targets, { dependencyCruiser: dependencyCruiserVersion(), typescript: typescriptVersion(environment, layout.packageRoot) });
    const report = boundaryReport({ graph, sccs, order, backEdges, rules, baselineCounts: counts, antiVacuity: entries });
    return {
      files: new Map([[join(layout.packageRoot, configFileName), config], [join(layout.packageRoot, knownViolationsFileName), baseline.text]]),
      report,
      antiVacuity: entries,
      summary: boundarySummary(report, command),
      command,
      unexpected,
      timings: { worktreeMs, analysisMs, baselineMs: Math.round(baseline.durationMs), checkMs: Math.round(check.durationMs), antiVacuityMs, totalMs: elapsed(started) },
    };
  } finally {
    if (!options.keep) {
      removeWorktrees(repo, [worktree]);
      for (const output of ['check.json', 'anti-vacuity.json']) fs.rmSync(path.join(input.workDir, output), { force: true });
    }
  }
}

/** Contract C6: the hook the orchestrator's R4 calls. */
export const boundaryRung = (input: BoundaryRungInput): Promise<BoundaryRungResult> => buildBoundaryRules(input);

// The target as the run found it: the base commit read from git objects (never a working tree, which the run moved
// on), the planner's facts and seeds draft there, the run's plan.yaml as placements over those facts, and the
// analyzer's resolved references of the module root's code. The repo-based collectors all read this.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeRepo } from '../analyzer/analyze.js';
import type { RepoFs } from '../analyzer/repo-fs.js';
import type { Analysis } from '../analyzer/types.js';
import { prefetchAnalyzerInputs } from '../certificate/certify.js';
import { commitRepoFs, createEnvironment } from '../certificate/commit-fs.js';
import { readCommitTree } from '../certificate/git-tree.js';
import { buildFacts } from '../planner/facts.js';
import { declarationExtension, sourceExtension, testPattern, testSupportPattern } from '../planner/facts-roles.js';
import { readPlanYaml, type PlanFile } from '../planner/plan-file.js';
import { seedDraft } from '../planner/seeds.js';
import { latestPlannerRules, type Draft, type Facts, type GroupKind, type Placement, type Plan } from '../planner/types.js';

export interface Target {
  repo: RepoFs;
  facts: Facts;
  draft: Draft;
  planFile: PlanFile;
  /** plan.yaml's placements of the facts' movable files (entries the facts don't know are left out). */
  plan: Plan;
  /** Package-relative path → plan group key (`module/album`), for every placed file and its listed tests. */
  groupOf: Map<string, string>;
  /** Module-root code (package-relative), tests and test support excluded: what production imports. */
  productionFiles: string[];
  /** The analyzer over productionFiles (repo-relative keys). */
  analysis: Analysis;
  /** `server/` + a package-relative path. */
  repoPath(packagePath: string): string;
}

export interface TargetInput {
  /** Any clone that has the base commit. */
  repo: string;
  /** A checkout with node_modules installed (the facts' type checker resolves packages there). */
  environment: string;
  base: string;
  packageRoot: string;
  moduleRoot: string;
  /** Extra package-relative pin globs from the profile. */
  pins: string[];
  planText: string;
}

/** plan.yaml's groups as placements of `facts`' movable files. */
export function placementsOf(planFile: PlanFile, facts: Facts, draft: Draft): Plan {
  const movable = new Set(facts.files.map((file) => file.path));
  const placements: Placement[] = [];
  for (const [key, entries] of planFile.groups) {
    const [kind, name] = key.split('/') as [GroupKind, string];
    for (const entry of entries) {
      if (!movable.has(entry.path)) continue;
      placements.push({
        path: entry.path, kind, name, confidence: entry.confidence ?? draft.confidence.get(entry.path) ?? 'seed', contested: entry.contested ?? false,
        source: entry.source ?? 'draft', ...(entry.rationale ? { rationale: entry.rationale } : {}),
      });
    }
  }
  return { placements: placements.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}

export function loadTarget(input: TargetInput): Target {
  const tree = readCommitTree(input.repo, input.base);
  prefetchAnalyzerInputs(tree);
  const shadowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-findings-'));
  try {
    const environment = createEnvironment(input.environment, [tree], shadowRoot);
    const repo = commitRepoFs(tree, environment.shadowRoot, environment.checkout);
    // buildFacts asks git for the root's HEAD; the shadow root has none, so the facts name the commit read here. The
    // findings read the code, not a model's answer, so they take the latest planner rules' scan whatever rules the
    // run's plan was made with (a Kysely CTE alias is no table under rules 2; immich's pinned plan has rules 1).
    const facts = { ...buildFacts(repo, { packageRoot: input.packageRoot, moduleRoot: input.moduleRoot, pins: input.pins, rules: latestPlannerRules }), sha: tree.commit };
    const draft = seedDraft(facts);
    const planFile = readPlanYaml(input.planText);
    const prefix = facts.packageRoot ? `${facts.packageRoot}/` : '';
    const moduleRootPrefix = facts.moduleRoot ? `${facts.moduleRoot}/` : '';
    const groupOf = new Map<string, string>();
    for (const [key, entries] of planFile.groups) for (const entry of entries) for (const file of [entry.path, ...entry.tests]) groupOf.set(file, key);
    const productionFiles = repo.tracked()
      .filter((file) => file.startsWith(prefix + moduleRootPrefix) && sourceExtension.test(file) && !declarationExtension.test(file))
      .map((file) => file.slice(prefix.length))
      .filter((file) => !testPattern.test(file) && !testSupportPattern.test(file));
    const analysis = analyzeRepo(repo, { files: productionFiles.map((file) => prefix + file) });
    return { repo, facts, draft, planFile, plan: placementsOf(planFile, facts, draft), groupOf, productionFiles, analysis, repoPath: (file) => prefix + file };
  } finally {
    // Everything is read by now: the type checker's programs and the analyzer hold their own copies.
    fs.rmSync(shadowRoot, { recursive: true, force: true });
  }
}

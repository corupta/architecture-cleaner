// A known-good result (a base commit and a head commit the certifier must pass) with what the mutation operators
// look at: both committed trees, the inferred pathMap, the analyzer's resolved sites, tsconfig scopes and runner
// configs of the head. Built through the certifier's own context, so operators see exactly what the checks see.
import path from 'node:path';
import type { RepoFs } from '../analyzer/repo-fs.js';
import { loadRunnerConfig, type RunnerConfig } from '../analyzer/runner-config.js';
import { loadScopes, type ScopeLookup } from '../analyzer/tsconfig-scopes.js';
import type { Analysis, ResolvedSite } from '../analyzer/types.js';
import { createContext } from '../certificate/certify.js';
import type { CommitTree } from '../certificate/git-tree.js';
import type { PathMap } from '../certificate/path-map.js';
import type { Profile } from '../certificate/profile.js';
import type { SpanView } from '../certificate/spans.js';
import type { Side } from '../certificate/types.js';

export interface SubjectCommits {
  /** Git repository holding base, the good head and (later) every mutant commit: a scratch repo or clone. */
  repo: string;
  /** Checkout whose installed node_modules serve as the certifier's environment. */
  environment: string;
  base: string;
  head: string;
}

export interface SubjectSpec {
  /** Unique name, e.g. 'fixture:jest-mocks', 'immich-r1'. */
  name: string;
  /** Column of the kill matrix: 'fixtures', 'openhab-cloud', 'immich-album', 'immich-r1', 'hunt'. */
  target: string;
  packageRoot: string;
  profile: Profile | null;
  /** Creates (or finds) the commits under `workDir`. */
  prepare(workDir: string): SubjectCommits;
}

/** A site of a file in one tree: `index` is its position in the file's site list (== its span index). */
export interface SiteReference {
  file: string;
  index: number;
  site: ResolvedSite;
}

/** A head site whose text differs from its base counterpart: a specifier the result rewrote. */
export interface RewrittenSite extends SiteReference {
  baseFile: string;
  baseRaw: string;
  headRaw: string;
}

export interface Subject extends SubjectCommits {
  name: string;
  target: string;
  packageRoot: string;
  profile: Profile | null;
  baseTree: CommitTree;
  headTree: CommitTree;
  pathMap: PathMap;
  views: Record<Side, (file: string) => SpanView | undefined>;
  analyses: Record<Side, Analysis>;
  /** The head as the analyzer reads it (tracked content from git objects). */
  headFs: RepoFs;
  headScopes: ScopeLookup;
  headRunner: RunnerConfig;
  rewritten: RewrittenSite[];
  /** Head path → head sites that resolve to it (any resolver). */
  importers: ReadonlyMap<string, SiteReference[]>;
  /** Head files the result touched: moved destinations and files edited in place. */
  touched: string[];
  /** A directory operators may write throwaway files to. */
  scratch: string;
}

export function openSubject(spec: SubjectSpec, workDir: string): Subject {
  const commits = spec.prepare(workDir);
  const { context, cleanup } = createContext({
    repo: commits.repo,
    base: commits.base,
    head: commits.head,
    packageRoot: spec.packageRoot,
    environment: commits.environment,
    profile: spec.profile,
    oracles: false,
    workDir: path.join(workDir, 'context', spec.name.replace(/[^\w.-]+/g, '_')),
    keep: false,
  });
  try {
    const analyses = context.analyses();
    const headScopes = loadScopes(context.fs.head);
    const headRunner = loadRunnerConfig(context.fs.head);
    const { pathMap, views } = context;
    const rewritten: RewrittenSite[] = [];
    const touched: string[] = [];
    for (const [baseFile, headFile] of [...pathMap.forward].sort(([a], [b]) => a.localeCompare(b))) {
      if (context.base.entries.get(baseFile)!.oid === context.head.entries.get(headFile)!.oid && baseFile === headFile) continue;
      touched.push(headFile);
      const before = views.base(baseFile);
      const after = views.head(headFile);
      const analyzed = analyses.head.files.get(headFile);
      if (!before?.source || !after?.source || !analyzed || before.sites.length !== after.sites.length) continue;
      after.sites.forEach((viewSite, index) => {
        const site = analyzed.sites[index];
        if (!site || site.start !== viewSite.start || before.raw[index] === after.raw[index]) return;
        rewritten.push({ file: headFile, index, site, baseFile, baseRaw: before.raw[index]!, headRaw: after.raw[index]! });
      });
    }
    const importers = new Map<string, SiteReference[]>();
    for (const [file, analyzed] of analyses.head.files) {
      analyzed.sites.forEach((site, index) => {
        if (site.resolution.type !== 'file') return;
        const list = importers.get(site.resolution.path) ?? [];
        list.push({ file, index, site });
        importers.set(site.resolution.path, list);
      });
    }
    return {
      ...commits,
      name: spec.name,
      target: spec.target,
      packageRoot: spec.packageRoot,
      profile: spec.profile,
      baseTree: context.base,
      headTree: context.head,
      pathMap,
      views,
      analyses,
      headFs: context.fs.head,
      headScopes,
      headRunner,
      rewritten,
      importers,
      touched,
      scratch: path.join(workDir, 'scratch', spec.name.replace(/[^\w.-]+/g, '_')),
    };
  } finally {
    cleanup();
  }
}

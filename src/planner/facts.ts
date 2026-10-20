// Planner facts (plan §3.5 step 1): the movable files under the module root with role, exports, tables, routes and
// co-located tests; the pinned files with a reason (plan §2.4); and symbol-level edges between movable files.
// Inventory, resolution and hazards come from the product analyzer; exports and edges from a type checker over the
// package's tsconfig scope, read through the RepoFs so a virtual tree works like the real one.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { analyzeRepo } from '../analyzer/analyze.js';
import type { RepoFs } from '../analyzer/repo-fs.js';
import { loadScopes } from '../analyzer/tsconfig-scopes.js';
import { checkFiles, createEdgeCollector, createProgram, sourcePathMapper, type CheckedFile } from './facts-checker.js';
import { choosePin, directoryPins, directoryPrefix, entrypointPins, scriptPins, type PinCandidate } from './facts-pins.js';
import { declarationExtension, roleOf, sourceExtension, testedStem, testPattern, testSupportPattern } from './facts-roles.js';
import { isBarrel, isGenerated, scanRoutes, scanTables } from './facts-scan.js';
import type { Confidence, Draft, Facts, FileFact, Pin, PlannerRules } from './types.js';

export interface BuildFactsOptions {
  /** Repo-relative package directory ('' or '.' for the repo root). */
  packageRoot: string;
  /** Package-relative directory whose files are planned; default `src`. */
  moduleRoot?: string;
  /** Extra pins from a target profile: package-relative globs. */
  pins?: string[];
  /** The planner rules the facts are read under: they decide what the table scan counts (facts-scan.ts scanTables). */
  rules: PlannerRules;
}

/** A file importing value symbols from at least this many movable files of one role is a registry (DI/route table). */
export const registryThreshold = 8;

const normalizeDirectory = (directory: string) => {
  const normalized = path.posix.normalize(directory || '.').replace(/\/$/, '');
  return normalized === '.' ? '' : normalized;
};

export function buildFacts(repo: RepoFs, options: BuildFactsOptions): Facts {
  const packageRoot = normalizeDirectory(options.packageRoot);
  const moduleRoot = normalizeDirectory(options.moduleRoot ?? 'src');
  const packagePrefix = directoryPrefix(packageRoot);
  const modulePrefix = directoryPrefix(moduleRoot);
  const repoPath = (file: string) => packagePrefix + file;
  const absolutePath = (file: string) => path.join(repo.root, repoPath(file));

  // Package TS sources (the spike's file set: no .d.ts, no node_modules), and the candidates under the module root.
  const packageFiles = repo.tracked()
    .filter((file) => file.startsWith(packagePrefix) && !file.split('/').includes('node_modules') && sourceExtension.test(file))
    .map((file) => file.slice(packagePrefix.length));
  const sources = new Set(packageFiles.filter((file) => !declarationExtension.test(file)));
  const candidates = packageFiles.filter((file) => file.startsWith(modulePrefix)).sort();
  const tests = candidates.filter((file) => testPattern.test(file) && !declarationExtension.test(file));
  const code = candidates.filter((file) => !testPattern.test(file) && !declarationExtension.test(file));
  const codeSet = new Set(code);
  const analysis = analyzeRepo(repo, { files: [...code, ...tests].map(repoPath) });

  // One program per tsconfig scope over the module root's code plus that config's ambient declarations.
  const scopeOf = loadScopes(repo);
  const groups = new Map<string, { options: ts.CompilerOptions; config: string | null; files: string[] }>();
  for (const file of code) {
    const scope = scopeOf(repoPath(file));
    const key = scope.config ?? '';
    const group = groups.get(key) ?? { options: scope.options, config: scope.config, files: [] };
    group.files.push(file);
    groups.set(key, group);
  }
  const programs = [...groups.values()].map((group) => {
    const declarations = group.config ? [...(scopeOf.programs.get(group.config)?.files ?? [])].filter((file) => declarationExtension.test(file) && !file.split('/').includes('node_modules')) : [];
    const rootNames = [...group.files.map(absolutePath), ...declarations.map((file) => path.join(repo.root, file))];
    return { program: createProgram(repo, rootNames, group.options), files: group.files };
  });
  const programOf = new Map(programs.flatMap((entry) => entry.files.map((file) => [file, entry.program] as const)));
  const sourceFileOf = (file: string) => programOf.get(file)?.getSourceFile(absolutePath(file));

  // Pins (plan §2.4).
  const pinCandidates = new Map<string, PinCandidate[]>();
  const addPins = (file: string, found: PinCandidate[]) => {
    if (found.length) pinCandidates.set(file, [...(pinCandidates.get(file) ?? []), ...found]);
  };
  for (const file of candidates.filter((candidate) => declarationExtension.test(candidate))) addPins(file, [{ reason: 'ambient-declaration', detail: 'declaration file' }]);
  for (const [file, found] of entrypointPins(repo, packageRoot, moduleRoot, codeSet)) addPins(file, found);
  for (const [file, found] of scriptPins(repo, packageRoot, moduleRoot, codeSet)) addPins(file, found);
  const hazardPins = (file: string) => (['location-sensitive', 'dynamic-reference'] as const).flatMap((kind) => {
    const details = [...new Set(analysis.files.get(repoPath(file))?.hazards.filter((hazard) => hazard.kind === kind).map((hazard) => hazard.detail))];
    return details.length ? [{ reason: kind, detail: details.join(', ') }] : [];
  });
  for (const file of code) {
    addPins(file, directoryPins(file, moduleRoot));
    if (testSupportPattern.test(file)) addPins(file, [{ reason: 'test', detail: 'test support (mock, fixture or test util)' }]);
    if (isGenerated(repo.read(repoPath(file)) ?? '')) addPins(file, [{ reason: 'generated', detail: 'generated-code banner in the leading comment' }]);
    addPins(file, hazardPins(file));
    const sourceFile = sourceFileOf(file);
    if (sourceFile && isBarrel(sourceFile)) addPins(file, [{ reason: 'barrel', detail: 're-exports only' }]);
    for (const pattern of options.pins ?? []) if (path.posix.matchesGlob(file, pattern)) addPins(file, [{ reason: 'profile', detail: `profile pin ${pattern}` }]);
  }
  const movable = code.filter((file) => !pinCandidates.has(file));
  const movableSet = new Set(movable);

  // Tests never move on their own: a test next to its movable subject moves with it, every other one is pinned. A
  // location-sensitive test stays too (immich's library.service.spec.ts reads process.cwd()); its subject still moves.
  const testsOf = new Map<string, string[]>();
  for (const test of tests) {
    const stem = testedStem(path.posix.basename(test));
    const directory = path.posix.dirname(test);
    const subject = stem === null || testPattern.test(`${directory}/`) ? undefined
      : ['.ts', '.tsx', '.mts', '.cts'].map((extension) => path.posix.join(directory, stem + extension)).find((option) => codeSet.has(option));
    const hazards = hazardPins(test);
    if (subject && movableSet.has(subject) && !hazards.length) testsOf.set(subject, [...(testsOf.get(subject) ?? []), test]);
    else addPins(test, hazards.length ? hazards : [{ reason: 'test', detail: subject ? `subject ${subject} is pinned` : 'no co-located subject' }]);
  }

  const collector = createEdgeCollector(movableSet);
  const checked = new Map<string, CheckedFile>();
  for (const { program, files } of programs) {
    const results = checkFiles({
      program,
      files: files.filter((file) => movableSet.has(file)),
      absolutePath,
      sourcePathOf: sourcePathMapper(repo, packageRoot, sources),
      sitesOf: (file) => analysis.files.get(repoPath(file))?.sites ?? [],
      collector,
    });
    for (const [file, result] of results) checked.set(file, result);
  }

  const files: FileFact[] = movable.map((file, index) => {
    const text = repo.read(repoPath(file)) ?? '';
    const sourceFile = sourceFileOf(file);
    const result = checked.get(file);
    return {
      path: file,
      id: index + 1,
      role: isRegistry(result?.valueImports, movableSet) ? 'registry' : roleOf(file),
      loc: text.split('\n').length,
      exports: result?.exports ?? [],
      primaryExport: result?.primaryExport ?? null,
      tables: scanTables(text, options.rules, file),
      routes: sourceFile ? scanRoutes(sourceFile) : [],
      tests: (testsOf.get(file) ?? []).sort(),
    };
  });
  const pins: Pin[] = [...pinCandidates].map(([file, found]) => choosePin(file, found)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { packageRoot, moduleRoot, sha: headSha(repo.root), files, edges: collector.edges(), pins };
}

/** Imports value symbols from >= registryThreshold movable files that share one role (immich `services/index.ts`). */
function isRegistry(valueImports: ReadonlySet<string> | undefined, movable: ReadonlySet<string>): boolean {
  const perRole = new Map<string, number>();
  for (const target of valueImports ?? []) {
    if (!movable.has(target)) continue;
    const role = roleOf(target);
    perRole.set(role, (perRole.get(role) ?? 0) + 1);
  }
  return [...perRole.values()].some((count) => count >= registryThreshold);
}

function headSha(root: string): string {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

/** Paths as the model sees them: relative to the module root (`controllers/album.controller.ts`). */
export const displayPath = (facts: Facts, path: string) => (facts.moduleRoot && path.startsWith(`${facts.moduleRoot}/`) ? path.slice(facts.moduleRoot.length + 1) : path);

/** A low-confidence file as the edit prompt's DRAFT LOW-CONFIDENCE FILES lists it: `56(contested)`. */
export const lowConfidenceName = (id: number, confidence: Confidence) => `${id}(${confidence})`;

/** The edit prompt's other names for a file: its entry in DRAFT LOW-CONFIDENCE FILES, if the draft lists it there. */
export function lowConfidenceNames(draft: Draft): (file: FileFact) => string[] {
  const contested = new Set(draft.contested);
  return (file) => (contested.has(file.path) ? [lowConfidenceName(file.id, draft.confidence.get(file.path)!)] : []);
}

/**
 * The movable files a model's name denotes, under the planner rules: one, and the name resolves; none, and it is
 * unknown; more, and it is ambiguous. Rules 1 read a package or displayed path (the first file that has it). Rules 2
 * read exactly the names the prompt showed: those paths, the bare id (FILES lines, the draft's group lists and the
 * edges show it; the `~` before an edge's id marks the edge, it isn't part of a name) and `shownNames(file)` (the
 * edit's low-confidence list). Trimmed, never fuzzy; a name two files share (one's displayed path is the other's
 * package path) names neither.
 */
export function fileResolver(facts: Facts, rules: PlannerRules, shownNames: (file: FileFact) => string[] = () => []): (named: string) => FileFact[] {
  if (rules === 1) {
    return (named) => {
      const text = named.trim();
      const file = facts.files.find((candidate) => candidate.path === text || displayPath(facts, candidate.path) === text);
      return file ? [file] : [];
    };
  }
  const filesByName = new Map<string, FileFact[]>();
  for (const file of facts.files) {
    for (const name of new Set([file.path, displayPath(facts, file.path), String(file.id), ...shownNames(file)])) filesByName.set(name, [...(filesByName.get(name) ?? []), file]);
  }
  return (named) => filesByName.get(named.trim()) ?? [];
}

// Reasons to refuse a whole step before touching anything (test/fixtures/README.md, "Declines").
import fs from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { moduleFormat } from '../analyzer/analyze.js';
import { overlayRepoFs, type RepoFs, toAbsolute } from '../analyzer/repo-fs.js';
import type { RunnerConfig, TestScope } from '../analyzer/runner-config.js';
import { loadScopes } from '../analyzer/tsconfig-scopes.js';
import { configReferences } from './config-references.js';
import { globToRegExp } from './glob.js';
import { extensionOf } from './respecify.js';
import type { Analysis } from '../analyzer/types.js';

export type DeclineCode =
  | 'unknown-source' | 'case-only-rename' | 'destination-exists' | 'ignored-destination' | 'location-sensitive'
  | 'dynamic-reference' | 'config-reference' | 'module-format-change' | 'compile-context-change' | 'alias-escape' | 'unsupported-literal'
  | 'unsupported-specifier' | 'extension-change' | 'ambient-declaration' | 'split-pair' | 'symlink' | 'package-resolution-change'
  | 'test-runner-scope' | 'dirty-worktree' | 'unsupported-encoding' | 'unreadable-runner-config' | 'multi-program-file'
  | 'alias-rewrite-hazard';

export interface Decline {
  code: DeclineCode;
  file: string;
  detail: string;
}

/** Something an applied step leaves as it was, worth a line in the findings log (the certificate's Finding shape). */
export interface MoveFinding {
  kind: string;
  file?: string;
  detail: string;
}

function ignoredPaths(repo: RepoFs, paths: string[]): Set<string> {
  if (paths.length === 0) return new Set();
  try {
    const output = execFileSync('git', ['-C', repo.root, 'check-ignore', '--no-index', '--stdin'], { input: paths.join('\n'), encoding: 'utf8' });
    return new Set(output.split('\n').filter(Boolean));
  } catch (error) {
    // exit status 1 means "none ignored"
    if ((error as { status?: number }).status === 1) return new Set();
    throw error;
  }
}

const jestDefaultMatch = ['**/__tests__/**/*.?([mc])[jt]s?(x)', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)'];
const vitestDefaultInclude = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];
const vitestDefaultExclude = ['**/node_modules/**', '**/.git/**'];

/** The Jest/Vitest configs whose test set `from` leaves or `to` enters, as decline details. */
export function testScopeChanges(runner: RunnerConfig, from: string, to: string): string[] {
  const changes: string[] = [];
  for (const jest of runner.jest) {
    const defaults = { include: jestDefaultMatch, exclude: [] };
    if (inScope(from, jest.scope, defaults) !== inScope(to, jest.scope, defaults)) changes.push(`${jest.config}: test membership changes at ${to}`);
  }
  for (const vitest of runner.vitest) {
    const defaults = { include: vitestDefaultInclude, exclude: vitestDefaultExclude };
    if (inScope(from, vitest.scope, defaults) !== inScope(to, vitest.scope, defaults)) changes.push(`${vitest.config}: test membership changes at ${to}`);
  }
  return changes;
}

function inScope(file: string, scope: TestScope, defaults: { include: string[]; exclude: string[] }): boolean {
  if (!scope.roots.some((root) => root === '' || file.startsWith(`${root}/`))) return false;
  const include = scope.include.length ? scope.include : defaults.include;
  const exclude = [...scope.exclude, ...(scope.exclude.length ? [] : defaults.exclude)];
  // Jest's testRegex replaces testMatch (and its default) as the include rule.
  const included = scope.includePatterns.length ? scope.includePatterns.some((pattern) => pattern.test(`/${file}`)) : include.some((glob) => globToRegExp(glob).test(file));
  return included && !exclude.some((glob) => globToRegExp(glob).test(file)) && !scope.excludePatterns.some((pattern) => pattern.test(`/${file}`));
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** The node_modules directory Node would load `name` from, walking up from a repo-relative directory. */
function nearestPackage(repo: RepoFs, directory: string, name: string): string | null {
  for (let current = directory; ; current = path.posix.dirname(current)) {
    const candidate = current === '.' ? `node_modules/${name}` : `${current}/node_modules/${name}`;
    if (repo.directoryExists(toAbsolute(repo, candidate))) return candidate;
    // Node also loads a package that is a single file: node_modules/dep.js / .json / .node.
    for (const extension of ['.js', '.json', '.node']) if (repo.fileExists(toAbsolute(repo, candidate + extension))) return candidate + extension;
    if (current === '.' || current === '') return null;
  }
}

const pairedImplementation: [RegExp, string][] = [[/\.d\.ts$/, '.js'], [/\.d\.mts$/, '.mjs'], [/\.d\.cts$/, '.cjs'], [/\.js$/, '.d.ts'], [/\.mjs$/, '.d.mts'], [/\.cjs$/, '.d.cts']];
const sameStemPairs: [RegExp, string][] = [[/\.ts$/, '.js'], [/\.tsx$/, '.jsx'], [/\.mts$/, '.mjs'], [/\.cts$/, '.cjs'], [/\.js$/, '.ts'], [/\.jsx$/, '.tsx'], [/\.mjs$/, '.mts'], [/\.cjs$/, '.cts']];

export function findDeclines(repo: RepoFs, analysis: Analysis, moves: ReadonlyMap<string, string>, requested: ReadonlyMap<string, string>, runner: RunnerConfig): { declines: Decline[]; findings: MoveFinding[] } {
  const declines: Decline[] = [];
  const tracked = new Set(repo.tracked());
  const destinations = new Map<string, string>();
  for (const [from, to] of moves) {
    if (requested.has(from) && !tracked.has(from)) declines.push({ code: 'unknown-source', file: from, detail: 'not a tracked file' });
    const caseOnly = from !== to && from.toLowerCase() === to.toLowerCase();
    if (caseOnly) declines.push({ code: 'case-only-rename', file: from, detail: `${from} -> ${to}` });
    // On a case-insensitive filesystem the destination of a case-only rename "exists": it is the source itself.
    const occupied = !caseOnly && (tracked.has(to) || repo.fileExists(toAbsolute(repo, to))) && !moves.has(to);
    if (occupied || destinations.has(to)) declines.push({ code: 'destination-exists', file: from, detail: to });
    destinations.set(to, from);
  }
  for (const ignored of ignoredPaths(repo, [...moves.values()])) declines.push({ code: 'ignored-destination', file: destinations.get(ignored) ?? ignored, detail: ignored });

  const scopesBefore = loadScopes(repo);
  // An unreadable runner config only matters for files it governs (its directory, or a Vitest config's root, and below):
  // moved files, and files whose mocks point at moved files.
  const mockImporters = [...analysis.files.values()].filter((file) => file.sites.some((site) => site.kind === 'mock'
    && site.resolution.type === 'file' && moves.has(site.resolution.path))).map((file) => file.path);
  const governed = [...moves.keys(), ...moves.values(), ...mockImporters];
  for (const entry of runner.unreadable) {
    const directory = runner.vitest.find((vitest) => vitest.config === entry.config)?.directory ?? path.posix.dirname(entry.config).replace(/^\.$/, '');
    const affected = governed.find((file) => directory === '' || file.startsWith(`${directory}/`));
    if (affected) declines.push({ code: 'unreadable-runner-config', file: entry.config, detail: `${entry.reason} (governs ${affected})` });
  }
  for (const [from, to] of moves) {
    if (!tracked.has(from)) continue;
    // Declaration pairs move as one: an explicit pathmap must not send the halves to different places.
    for (const [pattern, suffix] of pairedImplementation) {
      if (!pattern.test(from)) continue;
      const partner = from.replace(pattern, suffix);
      if (tracked.has(partner) && moves.has(partner) && moves.get(partner) !== to.replace(pattern, suffix)) {
        declines.push({ code: 'split-pair', file: from, detail: `${partner} goes to ${moves.get(partner)}, not next to ${to}` });
      }
    }
    // Plan §2.5: a .ts and a .js with the same stem are ambiguous (TS picks the .ts, Node the committed .js).
    for (const [pattern, suffix] of sameStemPairs) {
      const partner = pattern.test(from) && !/\.d\.[cm]?ts$/.test(from) ? from.replace(pattern, suffix) : null;
      if (partner && tracked.has(partner)) declines.push({ code: 'split-pair', file: from, detail: `same-stem pair with ${partner}` });
    }
    if (extensionOf(from) !== extensionOf(to)) declines.push({ code: 'extension-change', file: from, detail: `${extensionOf(from)} -> ${extensionOf(to)}` });
    if (fs.lstatSync(toAbsolute(repo, from), { throwIfNoEntry: false })?.isSymbolicLink()) declines.push({ code: 'symlink', file: from, detail: 'tracked symlink' });
    const arbitraryDeclaration = /^(.*)\.d\.([^./]+)\.ts$/.exec(from);
    if (arbitraryDeclaration && tracked.has(`${arbitraryDeclaration[1]}.${arbitraryDeclaration[2]}`) && !moves.has(`${arbitraryDeclaration[1]}.${arbitraryDeclaration[2]}`)) {
      declines.push({ code: 'split-pair', file: from, detail: `declares the asset ${arbitraryDeclaration[1]}.${arbitraryDeclaration[2]}, which never moves` });
    }
    if (/\.d\.[cm]?ts$/.test(from)) {
      const declared = from.replace(/\.d\.[cm]?ts$/, '');
      if (tracked.has(declared) && !moves.has(declared) && !/\.[cm]?[jt]sx?$/.test(declared)) declines.push({ code: 'split-pair', file: from, detail: `declares the asset ${declared}, which never moves` });
      const sourceFile = ts.createSourceFile(from, repo.read(from) ?? '', ts.ScriptTarget.Latest, false);
      if (!ts.isExternalModule(sourceFile)) declines.push({ code: 'ambient-declaration', file: from, detail: 'global declaration file (plan §2.4 pin)' });
    }
    for (const typeRoot of scopesBefore(from).options.typeRoots ?? []) {
      const root = path.relative(repo.root, typeRoot).split(path.sep).join('/');
      if (from.startsWith(`${root}/`)) declines.push({ code: 'ambient-declaration', file: from, detail: `inside typeRoots ${root}` });
    }
    const file = analysis.files.get(from);
    for (const site of file?.sites ?? []) {
      if (site.resolution.type !== 'external' || /^\.\.?(\/|$)/.test(site.specifier) || isBuiltin(site.specifier)) continue;
      const name = packageName(site.specifier);
      const before = nearestPackage(repo, path.posix.dirname(from), name);
      const after = nearestPackage(repo, path.posix.dirname(to), name);
      if (before !== after) declines.push({ code: 'package-resolution-change', file: from, detail: `'${name}' from ${before ?? 'nowhere'} -> ${after ?? 'nowhere'}` });
    }
    // Every runner config counts: in a monorepo a test can leave one package's set and enter another's.
    for (const detail of testScopeChanges(runner, from, to)) declines.push({ code: 'test-runner-scope', file: from, detail });
  }

  for (const from of moves.keys()) {
    for (const hazard of analysis.files.get(from)?.hazards ?? []) {
      declines.push({ code: hazard.kind === 'location-sensitive' ? 'location-sensitive' : 'dynamic-reference', file: from, detail: hazard.detail });
    }
  }

  // MVP: never edit configs; refuse the step when one names a moved file (an ungated coverage glob is only a finding).
  const configs = configReferences(repo, analysis, moves, scopesBefore, runner);
  declines.push(...configs.declines);

  const after = overlayRepoFs(repo, moves, new Map());
  const scopesAfter = loadScopes(after);
  for (const [from, to] of moves) {
    if (!/\.[cm]?[jt]sx?$/.test(from)) continue;
    const before = moduleFormat(repo, from);
    const later = moduleFormat(after, to);
    if (before !== later) declines.push({ code: 'module-format-change', file: from, detail: `${before} -> ${later} at ${to}` });
    const programsBefore = scopesBefore(from).programs.join(',');
    const programsAfter = scopesAfter(to).programs.join(',');
    if (programsBefore !== programsAfter) declines.push({ code: 'compile-context-change', file: from, detail: `programs [${programsBefore}] -> [${programsAfter}]` });
  }
  return { declines, findings: configs.findings };
}

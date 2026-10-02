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
import { extensionOf } from './respecify.js';
import type { Analysis } from '../analyzer/types.js';

export type DeclineCode =
  | 'unknown-source' | 'case-only-rename' | 'destination-exists' | 'ignored-destination' | 'location-sensitive'
  | 'dynamic-reference' | 'config-reference' | 'module-format-change' | 'compile-context-change' | 'alias-escape' | 'unsupported-literal'
  | 'unsupported-specifier' | 'extension-change' | 'ambient-declaration' | 'split-pair' | 'symlink' | 'package-resolution-change'
  | 'test-runner-scope' | 'dirty-worktree' | 'unsupported-encoding';

export interface Decline {
  code: DeclineCode;
  file: string;
  detail: string;
}

const configPattern = /(^|\/)(package\.json|tsconfig[^/]*\.json|jest\.config\.[cm]?[jt]s|jest\.config\.json|(vitest|vite)\.config\.[cm]?[jt]s|nest-cli\.json)$/;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

/** Minimal glob → RegExp: `**`, `*`, `?`, `[..]`, `{a,b}` and the extglobs `?(…) *(…) +(…) @(…)`. */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  const groups: string[] = [];
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    const next = glob[index + 1];
    if ('?*+@'.includes(char) && next === '(') {
      groups.push(char === '@' ? ')' : `)${char}`);
      source += '(?:';
      index++;
    } else if (char === ')' && groups.length) source += groups.pop();
    else if (char === '|' && groups.length) source += '|';
    else if (char === '*' && next === '*') {
      source += glob[index + 2] === '/' ? '(?:.*/)?' : '.*';
      index += glob[index + 2] === '/' ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '{') {
      groups.push(')');
      source += '(?:';
    } else if (char === '}' && groups.length) source += groups.pop();
    else if (char === ',' && groups.length) source += '|';
    else if (char === '[') {
      const close = glob.indexOf(']', index);
      source += glob.slice(index, close + 1);
      index = close;
    } else source += char.replace(/[.^$()|\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

function inScope(file: string, scope: TestScope, defaults: { include: string[]; exclude: string[] }): boolean {
  if (!scope.roots.some((root) => root === '' || file.startsWith(`${root}/`))) return false;
  const include = scope.include.length ? scope.include : defaults.include;
  const exclude = scope.exclude.length ? scope.exclude : defaults.exclude;
  return include.some((glob) => globToRegExp(glob).test(file)) && !exclude.some((glob) => globToRegExp(glob).test(file));
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
    if (current === '.' || current === '') return null;
  }
}

const emittedExtension: Record<string, string> = { '.ts': '.js', '.tsx': '.js', '.mts': '.mjs', '.cts': '.cjs' };

export function findDeclines(repo: RepoFs, analysis: Analysis, moves: ReadonlyMap<string, string>, requested: ReadonlyMap<string, string>, runner: RunnerConfig): Decline[] {
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
  for (const [from, to] of moves) {
    if (!tracked.has(from)) continue;
    if (extensionOf(from) !== extensionOf(to)) declines.push({ code: 'extension-change', file: from, detail: `${extensionOf(from)} -> ${extensionOf(to)}` });
    if (fs.lstatSync(toAbsolute(repo, from), { throwIfNoEntry: false })?.isSymbolicLink()) declines.push({ code: 'symlink', file: from, detail: 'tracked symlink' });
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
    if (runner.jest && inScope(from, runner.jest.scope, { include: jestDefaultMatch, exclude: [] }) !== inScope(to, runner.jest.scope, { include: jestDefaultMatch, exclude: [] })) {
      declines.push({ code: 'test-runner-scope', file: from, detail: `Jest test membership changes at ${to}` });
    }
    if (runner.vitest && inScope(from, runner.vitest.scope, { include: vitestDefaultInclude, exclude: vitestDefaultExclude }) !== inScope(to, runner.vitest.scope, { include: vitestDefaultInclude, exclude: vitestDefaultExclude })) {
      declines.push({ code: 'test-runner-scope', file: from, detail: `Vitest test membership changes at ${to}` });
    }
  }

  for (const from of moves.keys()) {
    for (const hazard of analysis.files.get(from)?.hazards ?? []) {
      declines.push({ code: hazard.kind === 'location-sensitive' ? 'location-sensitive' : 'dynamic-reference', file: from, detail: hazard.detail });
    }
  }

  // MVP: never edit configs; refuse the step when one names a moved file (repo- or config-relative, with or without extension).
  for (const config of repo.tracked().filter((file) => configPattern.test(file) && !file.includes('node_modules/'))) {
    const text = repo.read(config) ?? '';
    const configDirectory = path.posix.dirname(config);
    for (const from of moves.keys()) {
      const variants = new Set([from, path.posix.relative(configDirectory, from)]);
      // The emitted path too (rootDir → outDir, .ts → .js): package.json main/bin and scripts name build output.
      const options = scopesBefore(from).options;
      if (options.outDir && /\.[cm]?tsx?$/.test(from) && !/\.d\.[cm]?ts$/.test(from)) {
        const outDirectory = path.relative(repo.root, options.outDir).split(path.sep).join('/');
        const rootDirectory = options.rootDir ? path.relative(repo.root, options.rootDir).split(path.sep).join('/') : path.posix.dirname(from);
        const relative = rootDirectory === '' ? from : path.posix.relative(rootDirectory, from);
        if (!relative.startsWith('..')) {
          const emitted = path.posix.join(outDirectory, relative.replace(/\.[cm]?tsx?$/, (extension) => emittedExtension[extension] ?? '.js'));
          variants.add(emitted);
          variants.add(path.posix.relative(configDirectory, emitted));
        }
      }
      for (const variant of [...variants]) variants.add(variant.replace(/\.[cm]?[jt]sx?$/, ''));
      const hit = [...variants].find((variant) => new RegExp(`(?<![\\w.-])(\\./)?${escapeRegex(variant)}(\\.[cm]?[jt]sx?)?(?![\\w/.-])`).test(text));
      if (hit) declines.push({ code: 'config-reference', file: from, detail: `${config} mentions ${hit}` });
    }
  }

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
  return declines;
}

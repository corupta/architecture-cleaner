// Computes the new text of a specifier whose target or importer moved, keeping its form class
// (plan §3.3 step 5): relative stays relative, the alias key stays, the ending and `/index` style stay.
import path from 'node:path';
import type ts from 'typescript';
import type { RunnerConfig } from '../analyzer/runner-config.js';
import type { ReferenceSite } from '../analyzer/types.js';

export class AliasEscape extends Error {
  constructor(readonly specifier: string, readonly detail: string) {
    super(`alias-escape: ${specifier} (${detail})`);
  }
}

export interface RespecifyInput {
  site: ReferenceSite;
  /** Old and new repo-relative paths of the importing file and of the target. */
  importer: { from: string; to: string };
  target: { from: string; to: string };
  /** The importer's compiler options (paths, baseUrl, pathsBasePath). */
  options: ts.CompilerOptions;
  /** Repo-relative directory of the tsconfig that owns the importer ('' for the root). */
  configDirectory: string;
  runner: RunnerConfig;
  /** Absolute repo root, to relativize option paths. */
  root: string;
}

const isRelative = (specifier: string) => /^\.\.?(\/|$)/.test(specifier);
const jsEndingFor: Record<string, string> = { '.ts': '.js', '.tsx': '.js', '.mts': '.mjs', '.cts': '.cjs', '.d.ts': '.js' };

function extensionOf(file: string): string {
  const declaration = /\.d\.(ts|mts|cts)$/.exec(file);
  return declaration ? declaration[0] : path.posix.extname(file);
}

function stemOf(file: string): string {
  return path.posix.basename(file).slice(0, path.posix.basename(file).length - extensionOf(file).length);
}

/** How the old specifier spells its target: directory form, explicit file name, mapped JS ending, or no ending. */
type Ending = { kind: 'directory' } | { kind: 'literal'; text: string };

function endingOf(specifier: string, target: string): Ending {
  const lastSegment = specifier.replace(/\/+$/, '').split('/').pop() ?? '';
  const basename = path.posix.basename(target);
  const stem = stemOf(target);
  if (stem === 'index' && lastSegment !== 'index' && !lastSegment.startsWith('index.')) return { kind: 'directory' };
  if (lastSegment === basename) return { kind: 'literal', text: extensionOf(target) };
  const mapped = jsEndingFor[extensionOf(target)];
  if (mapped && lastSegment === stem + mapped) return { kind: 'literal', text: mapped };
  if (lastSegment === stem) return { kind: 'literal', text: '' };
  const extension = path.posix.extname(lastSegment);
  return { kind: 'literal', text: extension };
}

/** The path the new specifier must denote, before choosing its form: a file path with the old ending, or a directory. */
function denotedPath(ending: Ending, newTarget: string): string {
  if (ending.kind === 'directory') return path.posix.dirname(newTarget);
  return path.posix.join(path.posix.dirname(newTarget), stemOf(newTarget) + ending.text);
}

function relativeSpecifier(fromDirectory: string, to: string, bare: boolean): string {
  const relative = path.posix.relative(fromDirectory, to);
  if (relative === '') return '.';
  if (relative.startsWith('../') || relative === '..') return relative;
  if (bare && !relative.includes('/')) return relative;
  return `./${relative}`;
}

/** tsconfig `paths` key matching like TS: exact keys first, then the wildcard pattern with the longest prefix. */
function matchPathsKey(specifier: string, paths: ts.MapLike<string[]>): { key: string; star: string } | null {
  if (Object.hasOwn(paths, specifier) && !specifier.includes('*')) return { key: specifier, star: '' };
  let best: { key: string; star: string; prefixLength: number } | null = null;
  for (const key of Object.keys(paths)) {
    const star = key.indexOf('*');
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix)
      && (!best || prefix.length > best.prefixLength)) {
      best = { key, star: specifier.slice(prefix.length, specifier.length - suffix.length), prefixLength: prefix.length };
    }
  }
  return best && { key: best.key, star: best.star };
}

function pathsBase(input: RespecifyInput): string {
  const absolute = input.options.baseUrl ?? (input.options.pathsBasePath as string | undefined) ?? path.join(input.root, input.configDirectory);
  return path.relative(input.root, absolute).split(path.sep).join('/');
}

function underDirectory(directory: string, target: string): string | null {
  const relative = directory === '' ? target : path.posix.relative(directory, target);
  return relative.startsWith('..') ? null : relative;
}

/** Whether a module path (as written after alias expansion) reaches `target`: exact, + extension, JS ending, or directory index. */
function denotes(modulePath: string, target: string): boolean {
  const candidates = [modulePath, modulePath.replace(/\.(m|c)?js$/, '')];
  return candidates.some((candidate) => target === candidate || target.startsWith(`${candidate}.`) || target.startsWith(`${candidate}/index.`));
}

function unescapeRegex(source: string): string {
  return source.replace(/\\(.)/g, '$1');
}

export function respecify(input: RespecifyInput): string {
  const { site, importer, target, options, runner } = input;
  const specifier = site.specifier;
  const ending = endingOf(specifier, target.from);
  const denoted = denotedPath(ending, target.to);
  const importerDirectory = path.posix.dirname(importer.to);

  if (site.kind === 'triple-slash' || isRelative(specifier)) {
    return relativeSpecifier(importerDirectory, denoted, site.kind === 'triple-slash' && !isRelative(specifier));
  }
  // A directory-form alias whose directory became the alias root itself has no spelling with the same key.
  const aliasTail = (directory: string) => {
    const tail = underDirectory(directory, denoted);
    if (tail === '' && ending.kind === 'directory') throw new AliasEscape(specifier, 'directory form at the alias root');
    return tail;
  };

  if (site.kind === 'mock' && site.callee?.startsWith('jest.') && runner.jest) {
    for (const mapper of runner.jest.mappers) {
      if (!mapper.pattern.test(specifier)) continue;
      const shape = /^\^(.*)\(\.\*\)\$$/.exec(mapper.source);
      const replacement = /^(.*)\$1$/.exec(mapper.replacement);
      if (!shape || !replacement) throw new AliasEscape(specifier, `moduleNameMapper ${mapper.source} is not a prefix mapping`);
      const tail = aliasTail(replacement[1]!.replace(/\/$/, ''));
      if (tail === null) throw new AliasEscape(specifier, `target leaves ${replacement[1]}`);
      return unescapeRegex(shape[1]!) + tail;
    }
  }
  if (site.kind === 'mock' && site.callee?.startsWith('vi.') && runner.vitest) {
    for (const alias of runner.vitest.aliases) {
      if (specifier !== alias.find && !specifier.startsWith(`${alias.find}/`)) continue;
      const tail = aliasTail(alias.replacement);
      if (tail === null || tail === '') throw new AliasEscape(specifier, `target leaves alias ${alias.find}`);
      return `${alias.find}/${tail}`;
    }
  }

  if (options.paths) {
    const match = matchPathsKey(specifier, options.paths);
    if (match) {
      const base = pathsBase(input);
      const substitutions = options.paths[match.key] ?? [];
      // The substitution the old specifier actually went through: the one whose expansion contains the old target.
      const used = substitutions.find((substitution) => denotes(path.posix.join(base, substitution.replace('*', match.star)), target.from)) ?? substitutions[0];
      if (!used || !match.key.includes('*') || !used.endsWith('*')) throw new AliasEscape(specifier, `paths key ${match.key} cannot express a moved target`);
      const tail = aliasTail(path.posix.join(base, used.slice(0, -1)).replace(/\/$/, ''));
      if (tail === null) throw new AliasEscape(specifier, `target leaves ${used}`);
      const star = match.key.indexOf('*');
      return match.key.slice(0, star) + tail + match.key.slice(star + 1);
    }
  }

  if (options.baseUrl) {
    const tail = aliasTail(pathsBase(input));
    if (tail === null) throw new AliasEscape(specifier, 'target leaves baseUrl');
    return tail;
  }
  throw new AliasEscape(specifier, 'non-relative specifier with no alias mechanism');
}

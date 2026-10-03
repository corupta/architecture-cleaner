// Computes the new text of a specifier whose target or importer moved, keeping its form class
// (plan §3.3 step 5): relative stays relative, the alias key stays, the ending and `/index` style stay.
// For a pure move (basename unchanged) the original last segment is kept verbatim, so endings, moduleSuffixes
// spellings and explicit extensions survive; only the directory part changes.
import path from 'node:path';
import type ts from 'typescript';
import { nearestConfig, type RunnerConfig } from '../analyzer/runner-config.js';
import type { ModuleFormat, ReferenceSite } from '../analyzer/types.js';

/** A specifier the executor can't rewrite while keeping its form: the step is declined with `code`. */
export class SpecifierDecline extends Error {
  constructor(readonly code: 'alias-escape' | 'unsupported-specifier', readonly specifier: string, readonly detail: string) {
    super(`${code}: ${specifier} (${detail})`);
  }
}

export interface RespecifyInput {
  site: ReferenceSite;
  /** Old and new repo-relative paths of the importing file and of the target. */
  importer: { from: string; to: string; format: ModuleFormat };
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
const jsEndingFor: Record<string, string> = { '.ts': '.js', '.tsx': '.js', '.mts': '.mjs', '.cts': '.cjs', '.d.ts': '.js', '.d.mts': '.mjs', '.d.cts': '.cjs' };

export function extensionOf(file: string): string {
  const declaration = /\.d\.(ts|mts|cts)$/.exec(file);
  return declaration ? declaration[0] : path.posix.extname(file);
}

function stemOf(file: string): string {
  return path.posix.basename(file).slice(0, path.posix.basename(file).length - extensionOf(file).length);
}

const lastSegmentOf = (specifier: string) => specifier.replace(/\/+$/, '').split('/').pop() ?? '';

/** Whether a module path (as written after alias expansion) reaches `target`: exact, + extension, JS ending, or directory index. */
function denotes(modulePath: string, target: string): boolean {
  const trimmed = path.posix.normalize(modulePath).replace(/\/+$/, '');
  const candidates = [trimmed, trimmed.replace(/\.(m|c)?js$/, '')];
  const arbitraryExtension = /^(.*)(\.[^./]+)$/.exec(trimmed);
  if (arbitraryExtension) candidates.push(`${arbitraryExtension[1]}.d${arbitraryExtension[2]}`);
  return candidates.some((candidate) => (candidate === '.' ? /^index\./.test(target)
    : target === candidate || target.startsWith(`${candidate}.`) || target.startsWith(`${candidate}/index.`)));
}

/** `index`, or `index.<moduleSuffix>` (platform/index.ios.ts): the file a directory specifier reaches. */
const isIndexStem = (stem: string) => stem === 'index' || stem.startsWith('index.');

/** The repo path the new specifier must spell (before choosing relative/alias form), plus a trailing slash to keep. */
function spelledPath(specifier: string, target: { from: string; to: string }): { spelled: string; trailingSlash: boolean; directoryForm: boolean } {
  const trailingSlash = /[^/]\/+$/.test(specifier) || specifier === './' || specifier === '../';
  const lastSegment = lastSegmentOf(specifier);
  const addressesDirectory = isIndexStem(stemOf(target.from)) && lastSegment !== 'index' && !lastSegment.startsWith('index.');
  if (addressesDirectory) {
    // The index file was renamed away from `index`: its directory no longer denotes it, so spell the file instead.
    if (!isIndexStem(stemOf(target.to))) return { spelled: path.posix.join(path.posix.dirname(target.to), stemOf(target.to)), trailingSlash: false, directoryForm: false };
    return { spelled: path.posix.dirname(target.to), trailingSlash, directoryForm: true };
  }
  if (path.posix.basename(target.from) === path.posix.basename(target.to)) {
    return { spelled: path.posix.join(path.posix.dirname(target.to), lastSegment), trailingSlash: false, directoryForm: false };
  }
  // Renamed target: keep the ending style if the old segment was stem + ending; anything else can't be re-spelled.
  const stem = stemOf(target.from);
  const fromExtension = extensionOf(target.from);
  const mapped = jsEndingFor[fromExtension];
  let newEnding: string;
  if (lastSegment === stem) newEnding = '';
  else if (lastSegment === path.posix.basename(target.from)) newEnding = extensionOf(target.to);
  else if (mapped && lastSegment === stem + mapped) newEnding = jsEndingFor[extensionOf(target.to)] ?? mapped;
  else throw new SpecifierDecline('unsupported-specifier', specifier, `renamed target spelled as '${lastSegment}'`);
  return { spelled: path.posix.join(path.posix.dirname(target.to), stemOf(target.to) + newEnding), trailingSlash: false, directoryForm: false };
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

function unescapeRegex(source: string): string {
  return source.replace(/\\(.)/g, '$1');
}

function formSpecifier(input: RespecifyInput, spelled: string, trailingSlash: boolean, directoryForm: boolean): string {
  const { site, importer, target, options, runner } = input;
  const specifier = site.specifier;
  const slash = trailingSlash ? '/' : '';

  if (site.kind === 'triple-slash' || isRelative(specifier)) {
    // A relative specifier that doesn't physically point at its target went through rootDirs (or similar):
    // its virtual-relative meaning can't be kept by recomputing a physical path.
    if (site.kind !== 'triple-slash' && !denotes(path.posix.join(path.posix.dirname(importer.from), specifier), target.from)) {
      throw new SpecifierDecline('unsupported-specifier', specifier, 'resolved through rootDirs or another virtual mapping');
    }
    return relativeSpecifier(path.posix.dirname(importer.to), spelled, site.kind === 'triple-slash' && !isRelative(specifier)) + slash;
  }
  const aliasTail = (directory: string) => {
    const tail = underDirectory(directory, spelled);
    if (tail === '' && directoryForm) throw new SpecifierDecline('alias-escape', specifier, 'directory form at the alias root');
    return tail;
  };
  const jest = nearestConfig(runner.jest, importer.from);
  const vitest = nearestConfig(runner.vitest, importer.from);
  if (site.kind === 'mock' && site.callee?.startsWith('jest.') && jest) {
    for (const mapper of jest.mappers) {
      if (!mapper.pattern.test(specifier)) continue;
      const shape = /^\^(.*)\(\.\*\)\$$/.exec(mapper.source);
      const replacement = /^(.*)\$1$/.exec(mapper.replacement);
      if (!shape || !replacement) throw new SpecifierDecline('alias-escape', specifier, `moduleNameMapper ${mapper.source} is not a prefix mapping`);
      const tail = aliasTail(replacement[1]!.replace(/\/$/, ''));
      if (tail === null) throw new SpecifierDecline('alias-escape', specifier, `target leaves ${replacement[1]}`);
      return unescapeRegex(shape[1]!) + tail + slash;
    }
  }
  if (site.kind === 'mock' && site.callee?.startsWith('vi.') && vitest) {
    for (const alias of vitest.aliases) {
      if (specifier !== alias.find && !specifier.startsWith(`${alias.find}/`)) continue;
      const tail = aliasTail(alias.replacement);
      if (tail === null || tail === '') throw new SpecifierDecline('alias-escape', specifier, `target leaves alias ${alias.find}`);
      return `${alias.find}/${tail}${slash}`;
    }
  }
  if (options.paths) {
    const match = matchPathsKey(specifier, options.paths);
    if (match) {
      const base = pathsBase(input);
      const substitutions = options.paths[match.key] ?? [];
      // The substitution the old specifier actually went through: the one whose expansion reaches the old target.
      // `${configDir}` substitutions arrive already absolute from TS; the rest are relative to the paths base.
      const expand = (substitution: string) => (path.isAbsolute(substitution) ? path.relative(input.root, substitution).split(path.sep).join('/') : path.posix.join(base, substitution));
      const used = substitutions.find((substitution) => denotes(expand(substitution.replace('*', match.star)), target.from)) ?? substitutions[0];
      if (!used || !match.key.includes('*') || !used.includes('*')) throw new SpecifierDecline('alias-escape', specifier, `paths key ${match.key} cannot express a moved target`);
      const [substitutionPrefix, substitutionSuffix] = [used.slice(0, used.indexOf('*')), used.slice(used.indexOf('*') + 1)];
      const star = match.key.indexOf('*');
      const keySuffix = match.key.slice(star + 1);
      if (substitutionSuffix) {
        // TS appends the substitution suffix ('src/modules/*/index'), so the `*` capture is the part of the new
        // target's module path between the substitution's prefix and suffix.
        const prefixPath = expand(substitutionPrefix);
        const modulePath = path.posix.join(path.posix.dirname(target.to), stemOf(target.to));
        if (!modulePath.startsWith(prefixPath) || !modulePath.endsWith(substitutionSuffix) || modulePath.length < prefixPath.length + substitutionSuffix.length) {
          throw new SpecifierDecline('alias-escape', specifier, `new target isn't expressible through ${used}`);
        }
        const capture = modulePath.slice(prefixPath.length, modulePath.length - substitutionSuffix.length);
        if (capture === '') throw new SpecifierDecline('alias-escape', specifier, `empty capture for ${used}`);
        return match.key.slice(0, star) + capture + keySuffix;
      }
      const tail = aliasTail(expand(substitutionPrefix).replace(/\/$/, ''));
      if (tail === null) throw new SpecifierDecline('alias-escape', specifier, `target leaves ${used}`);
      // A key suffix ('@x/*.js') is part of the spelling: the tail must end with it, and it is written once.
      if (keySuffix && !tail.endsWith(keySuffix)) throw new SpecifierDecline('alias-escape', specifier, `new tail doesn't end with the key suffix ${keySuffix}`);
      return match.key.slice(0, star) + tail.slice(0, tail.length - keySuffix.length) + keySuffix + slash;
    }
  }
  if (options.baseUrl) {
    const tail = aliasTail(pathsBase(input));
    if (tail === null) throw new SpecifierDecline('alias-escape', specifier, 'target leaves baseUrl');
    return tail + slash;
  }
  throw new SpecifierDecline('alias-escape', specifier, 'non-relative specifier with no alias mechanism');
}

export function respecify(input: RespecifyInput): string {
  const { spelled, trailingSlash, directoryForm } = spelledPath(input.site.specifier, input.target);
  const result = formSpecifier(input, spelled, trailingSlash, directoryForm);
  // ESM specifiers are URLs: '#', '?' and '%' in a path change their meaning at runtime even though TS accepts them.
  // import() is URL-resolved by Node even in a CJS file, unless a compiler downlevels it.
  const urlResolved = input.importer.format === 'esm' || input.site.kind === 'dynamic-import' || input.site.kind === 'url-reference';
  if (urlResolved && /[#?%]/.test(result) && result !== input.site.specifier) {
    throw new SpecifierDecline('unsupported-specifier', input.site.specifier, `new specifier '${result}' contains a URL-significant character`);
  }
  return result;
}

// The form class of a module specifier (test/fixtures/README.md item 4, research 04b C2 `form(s)`): how it reaches
// its target, apart from where the target is. A pure move may change a specifier's path, never its form: relative
// stays relative, an alias keeps its key, bare packages keep their text, and the ending, directory-index and
// trailing-slash styles stay. Form is observable even at an identical target (04b A1/A3: an alias that only tsc
// knows crashes at runtime; Jest leaves aliased modules unmocked; an ESM `?`/`#` loads a second instance).
import path from 'node:path';
import type ts from 'typescript';
import { stripBom } from '../analyzer/analyze.js';
import { nearestConfig, type RunnerConfig } from '../analyzer/runner-config.js';
import type { ReferenceSite, Resolution } from '../analyzer/types.js';

export interface SpecifierForm {
  /**
   * relative | relative-indirect | absolute | url | jest-mapper:<regex> | vite-alias:<find> | subpath-import:<key> |
   * paths:<key> | base-url | package | unresolved. relative-indirect: relative text that doesn't spell the target's
   * path (rootDirs' virtual directory, moduleSuffixes, a directory's package.json `main`).
   */
  mechanism: string;
  /** directory: names the directory of an index file (`./users`); file: names the file itself (`./users/index`). */
  shape: 'directory' | 'file';
  /** What the last segment adds to the target's stem ('', '.js', '.json', ...), or `segment:<text>` when it doesn't spell the stem. */
  ending: string;
  trailingSlash: boolean;
}

export interface FormContext {
  /** The importing file (repo-relative). */
  file: string;
  /** Compiler options the site resolves under (paths, baseUrl). */
  options: ts.CompilerOptions;
  runner: RunnerConfig;
  /** Absolute repo root (compiler options hold absolute paths). */
  root: string;
  /** Repo file text, for the nearest package.json `imports`. */
  read(file: string): string | undefined;
}

const isRelative = (specifier: string) => /^\.\.?(\/|$)/.test(specifier);
const declarationExtension = /\.d\.(ts|mts|cts)$/;

const extensionOf = (file: string) => declarationExtension.exec(file)?.[0] ?? path.posix.extname(file);
const stemOf = (file: string) => path.posix.basename(file).slice(0, path.posix.basename(file).length - extensionOf(file).length);
/** `index`, or `index.<moduleSuffix>` (index.ios.ts): the file a directory specifier reaches. */
const isIndexStem = (stem: string) => stem === 'index' || stem.startsWith('index.');
const lastSegmentOf = (specifier: string) => specifier.replace(/\/+$/, '').split('/').pop() ?? '';
const spelledExtensions = ['', '.ts', '.tsx', '.d.ts', '.mts', '.d.mts', '.cts', '.d.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.node'];

/** Whether a joined module path names `target` itself: as written, with an extension, through the .js -> .ts mapping, or as its directory's index. */
function spells(modulePath: string, target: string): boolean {
  const written = path.posix.normalize(modulePath).replace(/\/+$/, '');
  const stems = [written, written.replace(/\.(m|c)?jsx?$/, '')];
  const arbitrary = /^(.*)(\.[^./]+)$/.exec(written);
  if (arbitrary) stems.push(`${arbitrary[1]}.d${arbitrary[2]}`);
  return stems.some((stem) => spelledExtensions.some((extension) => target === stem + extension || target === `${stem === '.' ? '' : `${stem}/`}index${extension}`));
}

/** Pattern-key matching shared by tsconfig `paths` and package.json `imports`: an exact key, else the wildcard key with the longest prefix. */
export function matchPatternKey(specifier: string, keys: readonly string[]): string | null {
  if (keys.includes(specifier) && !specifier.includes('*')) return specifier;
  let best: { key: string; prefixLength: number } | null = null;
  for (const key of keys) {
    const star = key.indexOf('*');
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix) && (!best || prefix.length > best.prefixLength)) {
      best = { key, prefixLength: prefix.length };
    }
  }
  return best?.key ?? null;
}

function importsKeys(context: FormContext): string[] {
  for (let directory = path.posix.dirname(context.file); ; directory = path.posix.dirname(directory)) {
    const manifest = context.read(directory === '.' ? 'package.json' : `${directory}/package.json`);
    if (manifest !== undefined) {
      try {
        const imports = JSON.parse(stripBom(manifest)).imports;
        return imports && typeof imports === 'object' ? Object.keys(imports) : [];
      } catch {
        return [];
      }
    }
    if (directory === '.') return [];
  }
}

/** The mechanism that turns the specifier into a path, in the order the analyzer's resolvers try them. */
function mechanismOf(site: ReferenceSite, resolution: Resolution, context: FormContext): string {
  const specifier = site.specifier;
  // A relative text that reaches its target without spelling its path went through rootDirs or similar: recomputing a
  // physical path would change what the merged output (or a moduleSuffixes platform build) loads.
  const relativeOf = () => (resolution.type === 'unresolved' || spells(path.posix.join(path.posix.dirname(context.file), specifier), resolution.path) ? 'relative' : 'relative-indirect');
  if (site.kind === 'triple-slash' || site.kind === 'url-reference') return relativeOf();
  if (site.kind === 'mock' && site.callee?.startsWith('jest.')) {
    const mapper = nearestConfig(context.runner.jest, context.file)?.mappers.find((candidate) => candidate.pattern.test(specifier));
    if (mapper) return `jest-mapper:${mapper.source}`;
  }
  if (site.kind === 'mock' && site.callee?.startsWith('vi.')) {
    const alias = nearestConfig(context.runner.vitest, context.file)?.aliases.find((candidate) => specifier === candidate.find || specifier.startsWith(`${candidate.find}/`));
    if (alias) return `vite-alias:${alias.find}`;
  }
  if (isRelative(specifier)) return relativeOf();
  if (specifier.startsWith('/')) return 'absolute';
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier) && !specifier.startsWith('node:')) return 'url';
  // Nothing outside the repository moves, so a bare specifier that reaches it never needs new text, whatever maps it.
  if (resolution.type === 'external') return 'package';
  if (specifier.startsWith('#')) return `subpath-import:${matchPatternKey(specifier, importsKeys(context)) ?? '?'}`;
  const pathsKey = context.options.paths ? matchPatternKey(specifier, Object.keys(context.options.paths)) : null;
  if (pathsKey !== null) return `paths:${pathsKey}`;
  if (resolution.type === 'file' && context.options.baseUrl !== undefined) {
    // baseUrl-relative only when the text spells the target under baseUrl; a workspace package link is a package.
    const spelled = path.posix.join(path.relative(context.root, context.options.baseUrl).split(path.sep).join('/'), specifier);
    if (resolution.path === spelled || resolution.path.startsWith(`${spelled}.`) || resolution.path.startsWith(`${spelled}/`)) return 'base-url';
  }
  return resolution.type === 'unresolved' ? 'unresolved' : 'package';
}

export function specifierForm(site: ReferenceSite, resolution: Resolution, context: FormContext): SpecifierForm {
  const mechanism = mechanismOf(site, resolution, context);
  const trailingSlash = site.specifier.endsWith('/');
  if (resolution.type === 'unresolved') return { mechanism, shape: 'file', ending: `segment:${lastSegmentOf(site.specifier)}`, trailingSlash };
  const target = resolution.path;
  const segment = lastSegmentOf(site.specifier);
  const stem = stemOf(target);
  if (isIndexStem(stem) && segment !== 'index' && !segment.startsWith('index.')) return { mechanism, shape: 'directory', ending: '', trailingSlash };
  return { mechanism, shape: 'file', ending: segment.startsWith(stem) ? segment.slice(stem.length) : `segment:${segment}`, trailingSlash };
}

/** Mechanisms whose text names something no move can relocate: a changed text is a changed reference. */
const fixedText = (mechanism: string) => mechanism === 'package' || mechanism === 'url' || mechanism === 'unresolved';

/**
 * Why the rewrite `before` → `after` of one site changes its form ([] when it keeps it). `targets` are the resolved
 * paths on each side (equal modulo the pathMap when resolution identity holds). `urlSyntax`: the site is resolved as
 * a URL (ESM, `import()`, URL references, anything Vite transforms), where '?', '#' and '%' are syntax.
 */
export function formChanges(
  site: { before: string; after: string; urlSyntax: boolean },
  forms: { before: SpecifierForm; after: SpecifierForm },
  targets: { before: string | null; after: string | null },
): string[] {
  if (site.before === site.after) return [];
  const problems: string[] = [];
  const { before, after } = forms;
  if (before.mechanism !== after.mechanism) problems.push(`form ${before.mechanism} -> ${after.mechanism}`);
  else if (fixedText(before.mechanism)) problems.push(`${before.mechanism} specifier rewritten`);
  if (before.trailingSlash !== after.trailingSlash) problems.push(`trailing slash ${before.trailingSlash ? 'dropped' : 'added'}`);
  const renamed = targets.before !== null && targets.after !== null && path.posix.basename(targets.before) !== path.posix.basename(targets.after);
  // A directory specifier can't name an index file that was renamed away from `index`: then (only then) the file is named.
  const indexRenamedAway = renamed && before.shape === 'directory' && targets.after !== null && !isIndexStem(stemOf(targets.after));
  if (before.shape !== after.shape && !(indexRenamedAway && after.shape === 'file' && after.ending === '')) problems.push(`index style ${before.shape} -> ${after.shape}`);
  else if (before.shape === 'file' && after.shape === 'file' && before.ending !== after.ending) problems.push(`ending ${JSON.stringify(before.ending)} -> ${JSON.stringify(after.ending)}`);
  // URL-resolved specifiers: '?', '#' and '%' change what loads (a second instance, a fragment, a decoded name).
  // A leading '#' is a subpath import.
  const urlText = after.mechanism.startsWith('subpath-import:') ? site.after.slice(1) : site.after;
  if (site.urlSyntax && /[#?%]/.test(urlText)) problems.push(`rewritten specifier contains '#', '?' or '%', which an ESM or Vite resolver reads as URL syntax`);
  // An empty segment keeps a distinct ESM URL for the same file (a second module instance); '.' and '..' inside the
  // path are no form any rewrite needs (the contract writes the shortest path).
  if (!fixedText(after.mechanism) && !isNormalForm(site.after)) problems.push(`rewritten specifier is not in normal form (empty, '.' or '..' segments inside the path)`);
  return problems;
}

/** `./` or a run of `../` (or a leading `/`), then no empty, '.' or '..' segments; a trailing slash is a style of its own. */
function isNormalForm(specifier: string): boolean {
  const segments = specifier.split('/');
  let index = 0;
  if (segments[0] === '.' || segments[0] === '') index = 1;
  else while (segments[index] === '..') index++;
  const rest = segments.slice(index);
  if (rest.length > 0 && rest[rest.length - 1] === '') rest.pop();
  return rest.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

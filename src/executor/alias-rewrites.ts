// Build-time alias rewriters (Nest CLI's tsconfig-paths hook, tsc-alias) turn a tsconfig `paths`/`baseUrl` specifier
// into a relative one at emit: relative(importer's directory, target without its extension), and './' when that is
// empty. When the target's extensionless path is the importer's own directory or an ancestor of it (`src/utils.ts`
// imported as 'src/utils' from inside `src/utils/`), the emitted '.'/'..' chain names a directory, which Node loads
// as a directory: TypeScript and the test runners resolve the file, the built app crashes (hoppscotch scramble, K3c).
// A move that creates that shape declines; one the base already had is left as it was.
import path from 'node:path';
import type ts from 'typescript';
import type { RepoFs } from '../analyzer/repo-fs.js';
import { loadScopes } from '../analyzer/tsconfig-scopes.js';
import type { Analysis, ResolvedSite } from '../analyzer/types.js';
import type { Decline } from './declines.js';
import { mapPath } from './move-set.js';

// Sites a build emits (type-only ones are elided, but whether they are is the compiler's call: kept).
const emittedKinds = new Set<ResolvedSite['kind']>(['import', 'export', 'import-equals', 'dynamic-import', 'require', 'require-resolve', 'typeof-import']);

/** Resolved through tsconfig `paths` or `baseUrl`, the specifiers a rewriter turns relative. */
function throughAlias(specifier: string, options: ts.CompilerOptions): boolean {
  if (/^\.\.?(\/|$)/.test(specifier) || specifier.startsWith('#') || specifier.startsWith('/') || /^[a-z]+:/i.test(specifier)) return false;
  if (options.baseUrl !== undefined) return true;
  return Object.keys(options.paths ?? {}).some((key) => {
    const star = key.indexOf('*');
    if (star === -1) return specifier === key;
    const [prefix, suffix] = [key.slice(0, star), key.slice(star + 1)];
    return specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix);
  });
}

/** The target's extensionless path is the importer's directory or one of its ancestors. */
function namesEnclosingDirectory(importer: string, target: string): boolean {
  const stripped = target.replace(/\.[^./]+$/, '');
  const directory = path.posix.dirname(importer);
  return directory === stripped || directory.startsWith(`${stripped}/`);
}

export function aliasRewriteHazards(repo: RepoFs, afterFs: RepoFs, before: Analysis, after: Analysis, moves: ReadonlyMap<string, string>): Decline[] {
  const scopesBefore = loadScopes(repo);
  const scopesAfter = loadScopes(afterFs);
  const declines: Decline[] = [];
  for (const old of before.files.values()) {
    const newPath = mapPath(moves, old.path);
    const later = after.files.get(newPath);
    const touched = moves.has(old.path) || old.sites.some((site) => site.resolution.type === 'file' && moves.has(site.resolution.path));
    if (!later || !touched) continue;
    later.sites.forEach((site, index) => {
      if (!emittedKinds.has(site.kind) || site.resolution.type !== 'file' || !namesEnclosingDirectory(newPath, site.resolution.path)) return;
      if (!throughAlias(site.specifier, scopesAfter(newPath).options)) return;
      const was = old.sites[index];
      if (was?.resolution.type === 'file' && namesEnclosingDirectory(old.path, was.resolution.path) && throughAlias(was.specifier, scopesBefore(old.path).options)) return;
      const target = was?.resolution.type === 'file' ? was.resolution.path : site.resolution.path;
      declines.push({
        code: 'alias-rewrite-hazard',
        file: old.path,
        detail: `'${site.specifier}' at ${newPath} reaches ${site.resolution.path} (base ${target}), whose extensionless path encloses the importer: `
          + `build-time alias rewriters (Nest CLI, tsc-alias) emit it as '${path.posix.relative(path.posix.dirname(newPath), site.resolution.path.replace(/\.[^./]+$/, '')) || './'}', which loads a directory`,
      });
    });
  }
  return declines;
}

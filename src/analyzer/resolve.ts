// Resolves reference sites (plan §3.3 step 3): TS sites through ts.resolveModuleName with the file's own
// options and resolution mode; mock sites with the test runner's semantics (Jest moduleNameMapper, Vite aliases);
// assets and triple-slash paths through the filesystem.
import { isBuiltin } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { type RepoFs, toAbsolute, toRelative } from './repo-fs.js';
import { nearestConfig, type RunnerConfig } from './runner-config.js';
import type { ModuleFormat, ReferenceSite, Resolution } from './types.js';

const jestExtensions = ['', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json'];
const viteExtensions = ['', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'];
// Node's CommonJS lookup for require-like sites TS doesn't resolve (e.g. extensionless JSON: require('./data')).
const nodeCjsExtensions = ['', '.js', '.json', '.node'];
const isRelative = (specifier: string) => /^\.\.?(\/|$)/.test(specifier);

export interface ResolveContext {
  repo: RepoFs;
  host: ts.ModuleResolutionHost;
  runner: RunnerConfig;
  cacheFor(options: ts.CompilerOptions): ts.ModuleResolutionCache;
}

const trackedSets = new WeakMap<readonly string[], Set<string>>();
function isTracked(repo: RepoFs, file: string): boolean {
  const tracked = repo.tracked();
  let set = trackedSets.get(tracked);
  if (!set) trackedSets.set(tracked, (set = new Set(tracked)));
  return set.has(file);
}

function classify(repo: RepoFs, resolvedFileName: string, external: boolean | undefined, via: 'typescript' | 'jest' | 'vitest' | 'filesystem'): Resolution {
  const relativePath = toRelative(repo, resolvedFileName);
  if (relativePath.startsWith('..') || relativePath.split('/').includes('node_modules')) return { type: 'external', path: resolvedFileName, via };
  // TS flags anything found through node_modules as external, but a workspace link (node_modules/a -> packages/a)
  // realpaths onto a tracked repo file: that file is what moves, so it must be treated as a repo file.
  if (external && !isTracked(repo, relativePath)) return { type: 'external', path: resolvedFileName, via };
  return { type: 'file', path: relativePath, via };
}

/** Exact file, then extensions, then `<path>/index.<ext>` (repo-relative base). */
function probe(repo: RepoFs, base: string, extensions: readonly string[]): string | null {
  for (const extension of extensions) {
    const candidate = path.posix.normalize(base + extension);
    if (repo.fileExists(toAbsolute(repo, candidate))) return candidate;
  }
  for (const extension of extensions.filter(Boolean)) {
    const candidate = path.posix.join(base, `index${extension}`);
    if (repo.fileExists(toAbsolute(repo, candidate))) return candidate;
  }
  return null;
}

function resolveWithTypeScript(context: ResolveContext, file: string, specifier: string, options: ts.CompilerOptions, mode: ts.ResolutionMode): Resolution {
  const resolved = ts.resolveModuleName(specifier, toAbsolute(context.repo, file), options, context.host, context.cacheFor(options), undefined, mode).resolvedModule;
  if (resolved) return classify(context.repo, resolved.resolvedFileName, resolved.isExternalLibraryImport, 'typescript');
  if (isBuiltin(specifier)) return { type: 'external', path: specifier, via: 'typescript' };
  if (isRelative(specifier)) {
    // Assets (`./button.css`) and JSON without resolveJsonModule: TS doesn't resolve them, the bundler/runtime does.
    const base = path.posix.join(path.posix.dirname(file), specifier);
    const found = mode === ts.ModuleKind.CommonJS ? probe(context.repo, base, nodeCjsExtensions) : context.repo.fileExists(toAbsolute(context.repo, base)) ? base : null;
    if (found) return { type: 'file', path: found, via: 'filesystem' };
  }
  return { type: 'unresolved' };
}

function resolveMock(context: ResolveContext, file: string, site: ReferenceSite, options: ts.CompilerOptions): Resolution {
  const { runner, repo } = context;
  const specifier = site.specifier;
  const vitest = nearestConfig(runner.vitest, file);
  const jest = nearestConfig(runner.jest, file);
  if (site.callee?.startsWith('vi.') && vitest) {
    for (const alias of vitest.aliases) {
      if (specifier === alias.find || specifier.startsWith(`${alias.find}/`)) {
        const found = probe(repo, alias.replacement + specifier.slice(alias.find.length), viteExtensions);
        return found ? { type: 'file', path: found, via: 'vitest' } : { type: 'unresolved' };
      }
    }
    if (isRelative(specifier)) {
      const found = probe(repo, path.posix.join(path.posix.dirname(file), specifier), viteExtensions);
      return found ? { type: 'file', path: found, via: 'vitest' } : { type: 'unresolved' };
    }
  }
  if (site.callee?.startsWith('jest.') && jest) {
    for (const mapper of jest.mappers) {
      if (mapper.pattern.test(specifier)) {
        const mapped = specifier.replace(mapper.pattern, mapper.replacement);
        const base = isRelative(mapped) ? path.posix.join(path.posix.dirname(file), mapped) : mapped;
        const found = probe(repo, base, jestExtensions);
        return found ? { type: 'file', path: found, via: 'jest' } : { type: 'unresolved' };
      }
    }
    if (isRelative(specifier)) {
      const found = probe(repo, path.posix.join(path.posix.dirname(file), specifier), jestExtensions);
      return found ? { type: 'file', path: found, via: 'jest' } : { type: 'unresolved' };
    }
  }
  return resolveWithTypeScript(context, file, specifier, options, ts.ModuleKind.CommonJS);
}

export function resolveSite(context: ResolveContext, file: string, format: ModuleFormat, site: ReferenceSite, options: ts.CompilerOptions): Resolution {
  switch (site.kind) {
    case 'triple-slash': {
      const base = path.posix.join(path.posix.dirname(file), site.specifier);
      const found = probe(context.repo, base, ['', '.d.ts', '.ts']);
      return found ? { type: 'file', path: found, via: 'filesystem' } : { type: 'unresolved' };
    }
    case 'mock':
      return resolveMock(context, file, site, options);
    case 'url-reference': {
      const candidate = path.posix.join(path.posix.dirname(file), site.specifier);
      return context.repo.fileExists(toAbsolute(context.repo, candidate)) ? { type: 'file', path: candidate, via: 'filesystem' } : { type: 'unresolved' };
    }
    case 'require':
    case 'require-resolve':
    case 'import-equals':
      return resolveWithTypeScript(context, file, site.specifier, options, ts.ModuleKind.CommonJS);
    case 'dynamic-import':
      return resolveWithTypeScript(context, file, site.specifier, options, ts.ModuleKind.ESNext);
    default:
      return resolveWithTypeScript(context, file, site.specifier, options, format === 'esm' ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS);
  }
}

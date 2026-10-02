// Resolves reference sites (plan §3.3 step 3): TS sites through ts.resolveModuleName with the file's own
// options and resolution mode; mock sites with the test runner's semantics (Jest moduleNameMapper, Vite aliases);
// assets and triple-slash paths through the filesystem.
import { isBuiltin } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { type RepoFs, toAbsolute, toRelative } from './repo-fs.js';
import type { RunnerConfig } from './runner-config.js';
import type { ModuleFormat, ReferenceSite, Resolution } from './types.js';

const jestExtensions = ['', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json'];
const viteExtensions = ['', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'];
const isRelative = (specifier: string) => /^\.\.?(\/|$)/.test(specifier);

export interface ResolveContext {
  repo: RepoFs;
  host: ts.ModuleResolutionHost;
  runner: RunnerConfig;
  cacheFor(options: ts.CompilerOptions): ts.ModuleResolutionCache;
}

function classify(repo: RepoFs, resolvedFileName: string, external: boolean | undefined, via: 'typescript' | 'jest' | 'vitest' | 'filesystem'): Resolution {
  const relativePath = toRelative(repo, resolvedFileName);
  if (external || relativePath.startsWith('..') || relativePath.split('/').includes('node_modules')) return { type: 'external', path: resolvedFileName, via };
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
    const candidate = path.posix.join(path.posix.dirname(file), specifier);
    if (context.repo.fileExists(toAbsolute(context.repo, candidate))) return { type: 'file', path: candidate, via: 'filesystem' };
  }
  return { type: 'unresolved' };
}

function resolveMock(context: ResolveContext, file: string, site: ReferenceSite, options: ts.CompilerOptions): Resolution {
  const { runner, repo } = context;
  const specifier = site.specifier;
  if (site.callee?.startsWith('vi.') && runner.vitest) {
    for (const alias of runner.vitest.aliases) {
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
  if (site.callee?.startsWith('jest.') && runner.jest) {
    for (const mapper of runner.jest.mappers) {
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

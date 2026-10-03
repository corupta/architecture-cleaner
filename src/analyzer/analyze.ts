// Analyzer entry point: every tracked JS/TS file with its resolved reference sites and hazards.
import path from 'node:path';
import ts from 'typescript';
import { extractSites } from './reference-sites.js';
import { type RepoFs, moduleResolutionHost } from './repo-fs.js';
import { resolveSite, type ResolveContext } from './resolve.js';
import { loadRunnerConfig, type RunnerConfig } from './runner-config.js';
import { loadScopes } from './tsconfig-scopes.js';
import type { Analysis, AnalyzedFile, ModuleFormat, ReferenceSite, Resolution } from './types.js';

export const sourcePattern = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

export function isSourceFile(file: string): boolean {
  return sourcePattern.test(file) && !file.split('/').includes('node_modules');
}

/** Extensionless executables run by Node (`bin/www` with a `#!/usr/bin/env node` line) are JavaScript too. */
export function isNodeScript(repo: RepoFs, file: string): boolean {
  if (path.posix.basename(file).includes('.') || file.split('/').includes('node_modules')) return false;
  const text = repo.read(file);
  return text !== undefined && /^#![^\n]*\bnode\b/.test(text);
}

/** JSON text without a leading BOM (JSON.parse rejects it; Node strips it for package.json). */
export const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** Node's module format for a file at this path: extension first, then the nearest package.json `type`. */
export function moduleFormat(repo: RepoFs, file: string): ModuleFormat {
  if (/\.(mts|mjs)$/.test(file)) return 'esm';
  if (/\.(cts|cjs)$/.test(file)) return 'cjs';
  for (let directory = path.posix.dirname(file); ; directory = path.posix.dirname(directory)) {
    const manifest = repo.read(directory === '.' ? 'package.json' : `${directory}/package.json`);
    if (manifest !== undefined) {
      try {
        return JSON.parse(stripBom(manifest)).type === 'module' ? 'esm' : 'cjs';
      } catch {
        return 'cjs';
      }
    }
    if (directory === '.') return 'cjs';
  }
}

/** Resolves a site in `file`; `options` overrides the file's own scope (to ask "and under that other program?"). */
export type SiteResolver = (file: string, site: ReferenceSite, options?: ts.CompilerOptions) => Resolution;

interface AnalyzerContext {
  scopeOf: ReturnType<typeof loadScopes>;
  resolve: SiteResolver;
}

function createContext(repo: RepoFs, runner?: RunnerConfig): AnalyzerContext {
  const scopeOf = loadScopes(repo);
  const caches = new Map<ts.CompilerOptions, ts.ModuleResolutionCache>();
  const context: ResolveContext = {
    repo,
    host: moduleResolutionHost(repo),
    runner: runner ?? loadRunnerConfig(repo),
    cacheFor(options) {
      let cache = caches.get(options);
      if (!cache) caches.set(options, (cache = ts.createModuleResolutionCache(repo.root, (fileName) => fileName, options)));
      return cache;
    },
  };
  return { scopeOf, resolve: (file, site, options) => resolveSite(context, file, moduleFormat(repo, file), site, options ?? scopeOf(file).options) };
}

/** Resolves single sites as if they sat in `file` of `repo` (used to ask "does this specifier still work after the move?"). */
export function createSiteResolver(repo: RepoFs, runner?: RunnerConfig): SiteResolver {
  return createContext(repo, runner).resolve;
}

export function analyzeRepo(repo: RepoFs, { files, runner }: { files?: string[]; runner?: RunnerConfig } = {}): Analysis {
  const { scopeOf, resolve } = createContext(repo, runner);
  const analysis: Analysis = { files: new Map() };
  for (const file of files ?? repo.tracked().filter((file) => isSourceFile(file) || isNodeScript(repo, file))) {
    const text = repo.read(file);
    if (text === undefined) continue;
    const { sites, hazards } = extractSites(file, text);
    const analyzed: AnalyzedFile = {
      path: file,
      format: moduleFormat(repo, file),
      config: scopeOf(file).config,
      sites: sites.map((site) => ({ ...site, resolution: resolve(file, site) })),
      hazards,
    };
    analysis.files.set(file, analyzed);
  }
  return analysis;
}

// Assigns every file the compiler options that resolve its specifiers (plan §3.3 step 1).
// Each tracked tsconfig*.json is parsed with `extends`; include/exclude are matched against the RepoFs, so a
// virtual post-move tree gets the same treatment as the real one. Files outside every program take the options
// of the nearest ancestor tsconfig.json (tests excluded by `include` still resolve the way their runner does).
import path from 'node:path';
import ts from 'typescript';
import { type RepoFs, toAbsolute, toRelative } from './repo-fs.js';

export interface Scope {
  config: string | null;
  options: ts.CompilerOptions;
  /** Every tsconfig whose program includes the file (its compile-context fingerprint, plan §3.4 K5). */
  programs: string[];
}

const tsconfigPattern = /(^|\/)tsconfig[^/]*\.json$/;

// TS 6 legacy-resolution shim: repos written for TS < 6 relied on node10 when moduleResolution was unset.
export function withLegacyShim(options: ts.CompilerOptions): ts.CompilerOptions {
  const shimmed: ts.CompilerOptions = { ...options, ignoreDeprecations: '6.0', noEmit: true };
  if (shimmed.moduleResolution === undefined) {
    const module = shimmed.module;
    shimmed.moduleResolution =
      module === ts.ModuleKind.Node16 || module === ts.ModuleKind.NodeNext ? ts.ModuleResolutionKind.NodeNext
        : module === undefined || module === ts.ModuleKind.CommonJS ? ts.ModuleResolutionKind.Node10
          : ts.ModuleResolutionKind.Bundler;
  }
  return shimmed;
}

type MatchFiles = (
  directory: string, extensions: readonly string[] | undefined, excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined, useCaseSensitiveFileNames: boolean, currentDirectory: string,
  depth: number | undefined, getFileSystemEntries: (directory: string) => { files: readonly string[]; directories: readonly string[] },
  realpath: (path: string) => string,
) => string[];

function parseConfigHost(repo: RepoFs): ts.ParseConfigFileHost {
  // ts.matchFiles is internal but stable in the frozen 6.0 JS codebase; it is what ts.sys.readDirectory uses.
  const matchFiles = (ts as unknown as { matchFiles: MatchFiles }).matchFiles;
  return {
    useCaseSensitiveFileNames: true,
    getCurrentDirectory: () => repo.root,
    fileExists: (fileName) => repo.fileExists(fileName) || ts.sys.fileExists(fileName),
    readFile: (fileName) => {
      const relativePath = toRelative(repo, fileName);
      return relativePath.startsWith('..') ? ts.sys.readFile(fileName) : (repo.read(relativePath) ?? ts.sys.readFile(fileName));
    },
    readDirectory: (rootDirectory, extensions, excludes, includes, depth) =>
      matchFiles(rootDirectory, extensions, excludes, includes, true, repo.root, depth,
        (directory) => (repo.directoryExists(directory) ? repo.entries(directory) : { files: [], directories: [] }),
        (fileName) => fileName),
    onUnRecoverableConfigFileDiagnostic: () => {},
  };
}

export type ScopeLookup = ((file: string) => Scope) & {
  /** Parsed options and program files of a tsconfig (repo-relative), for every tsconfig in the repo. */
  programs: ReadonlyMap<string, { options: ts.CompilerOptions; files: ReadonlySet<string> }>;
};

export function loadScopes(repo: RepoFs): ScopeLookup {
  const host = parseConfigHost(repo);
  const configs = repo.tracked().filter((file) => tsconfigPattern.test(file) && !file.includes('node_modules/'));
  // A config that other configs extend is a base, not a program of its own (tsconfig.base.json), unless it is the
  // directory's tsconfig.json (Nest: tsconfig.build.json extends the tsconfig.json that tsc and the IDE use).
  const extendedBases = new Set<string>();
  for (const config of configs) {
    const raw = ts.parseConfigFileTextToJson(config, repo.read(config) ?? '').config as { extends?: string | string[] } | undefined;
    for (const base of [raw?.extends ?? []].flat()) {
      if (base.startsWith('.')) extendedBases.add(path.posix.normalize(path.posix.join(path.posix.dirname(config), base.endsWith('.json') ? base : `${base}.json`)));
    }
  }
  const parsed = new Map<string, { options: ts.CompilerOptions; files: Set<string> }>();
  for (const config of configs.filter((candidate) => !extendedBases.has(candidate) || path.posix.basename(candidate) === 'tsconfig.json')) {
    const commandLine = ts.getParsedCommandLineOfConfigFile(toAbsolute(repo, config), {}, host);
    if (!commandLine) continue;
    parsed.set(config, { options: withLegacyShim(commandLine.options), files: new Set(commandLine.fileNames.map((fileName) => toRelative(repo, fileName))) });
  }
  const depth = (config: string) => config.split('/').length;
  const isPrimary = (config: string) => path.posix.basename(config) === 'tsconfig.json';
  const byPreference = [...parsed.keys()].sort((a, b) => depth(b) - depth(a) || Number(isPrimary(b)) - Number(isPrimary(a)) || a.localeCompare(b));
  const cache = new Map<string, Scope>();
  const lookup = (file: string): Scope => {
    const cached = cache.get(file);
    if (cached) return cached;
    const programs = byPreference.filter((candidate) => parsed.get(candidate)!.files.has(file)).sort();
    let config = byPreference.find((candidate) => parsed.get(candidate)!.files.has(file) && isAncestor(candidate, file));
    config ??= byPreference.find((candidate) => parsed.get(candidate)!.files.has(file));
    config ??= byPreference.find((candidate) => isPrimary(candidate) && isAncestor(candidate, file));
    const scope: Scope = config
      ? { config, options: parsed.get(config)!.options, programs }
      : { config: null, options: withLegacyShim({ module: ts.ModuleKind.CommonJS, allowJs: true, resolveJsonModule: true }), programs };
    cache.set(file, scope);
    return scope;
  };
  return Object.assign(lookup, { programs: parsed });
}

function isAncestor(config: string, file: string): boolean {
  const directory = path.posix.dirname(config);
  return directory === '.' || file.startsWith(`${directory}/`);
}

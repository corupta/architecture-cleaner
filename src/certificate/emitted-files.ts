// The files a tsconfig program emits and the directory TypeScript before 6.0 roots their output at (its default
// rootDir): shared by K3c's emit mirrors, K4's emitted layouts and K7, so all three read the same default.
import path from 'node:path';
import ts from 'typescript';
import { moduleResolutionHost, type RepoFs, toAbsolute, toRelative } from '../analyzer/repo-fs.js';
import type { ScopeLookup } from '../analyzer/tsconfig-scopes.js';

const declarationPattern = /\.d(\.[^./]+)?\.[cm]?ts$/;

/** Longest common directory of a program's non-declaration files: TypeScript's default rootDir before 6.0. */
export function commonSourceDirectory(files: ReadonlySet<string>): string {
  const directories = [...files].filter((file) => !declarationPattern.test(file)).map((file) => path.posix.dirname(file).split('/'));
  const first = directories[0] ?? [];
  let length = first.length;
  for (const parts of directories) {
    let shared = 0;
    while (shared < length && parts[shared] === first[shared]) shared++;
    length = shared;
  }
  return first.slice(0, length).join('/').replace(/^\.$/, '');
}

/**
 * The repo files a program emits, as TypeScript builds it: its root files and everything they pull in, less declaration
 * files, files of external libraries (node_modules) and sources of referenced projects (their outputs stand in).
 */
export function emittedFiles(repo: RepoFs, scopes: ScopeLookup, config: string): Set<string> {
  const program = scopes.programs.get(config)!;
  // TypeScript 5 includes every typeRoots package when `types` is unset (6 only for '*'); lib files emit nothing.
  const options: ts.CompilerOptions = { ...program.options, types: program.options.types ?? ['*'], noLib: true };
  const resolution = moduleResolutionHost(repo);
  const inRepo = (fileName: string) => !toRelative(repo, fileName).startsWith('..');
  const references = (ts.parseConfigFileTextToJson(config, repo.read(config) ?? '').config as { references?: { path?: unknown }[] } | undefined)?.references ?? [];
  const built = ts.createProgram({
    rootNames: [...program.files].map((file) => toAbsolute(repo, file)),
    options,
    projectReferences: references.flatMap((reference) => (typeof reference.path === 'string' ? [{ path: path.resolve(path.dirname(toAbsolute(repo, config)), reference.path) }] : [])),
    host: {
      ...ts.createCompilerHost(options),
      getCurrentDirectory: () => repo.root,
      fileExists: (fileName) => (inRepo(fileName) ? repo.fileExists(fileName) : ts.sys.fileExists(fileName)),
      directoryExists: (directoryName) => (inRepo(directoryName) ? repo.directoryExists(directoryName) : ts.sys.directoryExists(directoryName)),
      getDirectories: (directoryName) => (inRepo(directoryName) ? resolution.getDirectories!(directoryName) : ts.sys.getDirectories(directoryName)),
      realpath: resolution.realpath!,
      readFile: (fileName) => resolution.readFile(fileName),
      getSourceFile: (fileName, languageVersionOrOptions) => {
        // A file in node_modules is an external library's, and so is everything only it imports: none is emitted.
        if (!inRepo(fileName) || toRelative(repo, fileName).split('/').includes('node_modules')) return undefined;
        const text = resolution.readFile(fileName);
        return text === undefined ? undefined : ts.createSourceFile(fileName, text, languageVersionOrOptions);
      },
      getParsedCommandLine: (fileName) => {
        const referenced = scopes.programs.get(toRelative(repo, fileName));
        // The program wants the reference's parsed config file, which the scope's copied options don't carry.
        const configFile = ts.readJsonConfigFile(fileName, (name) => resolution.readFile(name));
        return referenced && { options: { ...referenced.options, configFile }, fileNames: [...referenced.files].map((file) => toAbsolute(repo, file)), errors: [] };
      },
    },
  });
  const emitted = built.getSourceFiles().filter((file) => !file.isDeclarationFile && !built.isSourceFileFromExternalLibrary(file));
  return new Set(emitted.map((file) => toRelative(repo, file.fileName)));
}

// K7 emit layout (plan §3.4): every tsconfig program of base that emits keeps where it writes: the same outDir and the
// same rootDir, so each file that didn't move (the pinned entries package.json, scripts and Docker run from the build,
// `dist/main.js`) is emitted where it was. An explicit rootDir can't change under a move (K2 keeps the tsconfig's bytes);
// a default one can: TypeScript before 6.0 roots the output at the common directory of every file the program emits
// (its include roots, what they import, JSON included), so moving the one file outside `src/` into it turns
// `dist/src/main.js` into `dist/main.js`; a composite program, and from 6.0 on every program, roots it at the tsconfig's
// directory. The rule is that of the TypeScript the environment installs for the tsconfig's directory; when its version
// is unknown, both must hold.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { moduleResolutionHost, type RepoFs, toAbsolute, toRelative } from '../analyzer/repo-fs.js';
import { loadScopes, type ScopeLookup } from '../analyzer/tsconfig-scopes.js';
import { commonSourceDirectory, configuredOption } from './resolution-runtime.js';
import { installedPackage } from './runtime-probe.js';
import { type Check, type Finding, result, type Side, type Violation } from './types.js';

const title = 'Emit layout';
const declarationPattern = /\.d\.[cm]?ts$/;
const emittedExtensions: Record<string, string> = { '.ts': '.js', '.tsx': '.js', '.mts': '.mjs', '.cts': '.cjs' };

/** Where TypeScript writes a source file: its path below rootDir, under outDir, with the emitted extension. */
const emittedPath = (file: string, rootDir: string, outDir: string) =>
  path.posix.join(outDir, rootDir ? path.posix.relative(rootDir, file) : file).replace(/\.(ts|tsx|mts|cts)$/, (extension) => emittedExtensions[extension]!);

/** The major version of the TypeScript installed for a directory (the one `tsc` there runs), or null. */
function typescriptMajor(checkout: string, directory: string): number | null {
  const installed = installedPackage(path.join(checkout, directory), 'typescript');
  if (!installed) return null;
  const major = Number(String(JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version).split('.')[0]);
  return Number.isFinite(major) ? major : null;
}

/**
 * The repo files a program emits, as TypeScript builds it: its root files and everything they pull in, less declaration
 * files, files of external libraries (node_modules) and sources of referenced projects (their outputs stand in).
 */
function emittedFiles(repo: RepoFs, scopes: ScopeLookup, config: string): Set<string> {
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

export const emitLayout: Check = {
  id: 'K7',
  title,
  run(context) {
    const { pathMap } = context;
    const scopes = { base: loadScopes(context.fs.base), head: loadScopes(context.fs.head) };
    const trees = { base: context.base, head: context.head };
    const violations: Violation[] = [];
    const findings: Finding[] = [];
    let emitting = 0;
    let inferred = 0;
    const relative = (side: Side, absolute: string) => path.relative(context.fs[side].root, absolute).split(path.sep).join('/');
    for (const [config, program] of scopes.base.programs) {
      if (configuredOption(trees.base, config, 'noEmit') === true || program.options.outDir === undefined) continue;
      emitting++;
      const headConfig = pathMap.map(config);
      const later = scopes.head.programs.get(headConfig);
      if (!later) {
        violations.push({ file: config, detail: `emits into ${relative('base', program.options.outDir)}, but head has no program ${headConfig}` });
        continue;
      }
      const outDirs = { base: relative('base', program.options.outDir), head: later.options.outDir === undefined ? '(none)' : relative('head', later.options.outDir) };
      if (outDirs.base !== outDirs.head) violations.push({ file: headConfig, detail: `outDir ${outDirs.base} -> ${outDirs.head}` });
      if (program.options.rootDir !== undefined) {
        const rootDirs = { base: relative('base', program.options.rootDir), head: later.options.rootDir === undefined ? '(default)' : relative('head', later.options.rootDir) };
        if (rootDirs.base !== rootDirs.head) violations.push({ file: headConfig, detail: `rootDir ${rootDirs.base} -> ${rootDirs.head}` });
        continue;
      }
      inferred++;
      // TypeScript 6's default can't move with the sources; check the common directory unless TypeScript 6+ is installed.
      const configDirectory = { base: path.posix.dirname(config).replace(/^\.$/, ''), head: path.posix.dirname(headConfig).replace(/^\.$/, '') };
      const major = typescriptMajor(context.environment.checkout, configDirectory.base);
      const rules = major === null ? ['6.0+', 'before 6.0'] : major >= 6 ? ['6.0+'] : ['before 6.0'];
      const options = { base: program.options, head: later.options };
      const emitted = rules.includes('before 6.0')
        ? { base: emittedFiles(context.fs.base, scopes.base, config), head: emittedFiles(context.fs.head, scopes.head, headConfig) }
        : { base: program.files, head: later.files };
      const rootOf = (side: Side, rule: string) => (rule === '6.0+' || options[side].composite ? configDirectory[side] : commonSourceDirectory(emitted[side]));
      const unmoved = [...emitted.base].filter((file) => !declarationPattern.test(file) && pathMap.map(file) === file).sort()[0];
      let shifted = false;
      for (const rule of rules) {
        const [before, after] = [rootOf('base', rule), rootOf('head', rule)];
        if (before === after) continue;
        shifted = true;
        const example = unmoved ? `: ${unmoved} was emitted as ${emittedPath(unmoved, before, outDirs.base)}, now ${emittedPath(unmoved, after, outDirs.head)}` : '';
        violations.push({ file: headConfig, detail: `no rootDir, and TypeScript ${rule}'s default moves from ${before || '.'} to ${after || '.'}, so every file emitted into ${outDirs.base} moves${example}` });
      }
      if (!shifted) findings.push({ kind: 'default-root-dir', file: headConfig, detail: `emits into ${outDirs.base} without a rootDir; TypeScript ${rules.join(' and ')}'s default stays ${rules.map((rule) => rootOf('base', rule) || '.').join(' and ')}` });
    }
    const summary = violations.length
      ? `${violations.length} emitting programs change where they write`
      : `${emitting} emitting programs keep their outDir and rootDir (${inferred} by TypeScript's default)`;
    return result('K7', title, { summary, violations, findings, metrics: { emittingPrograms: emitting, defaultRootDirs: inferred } });
  },
};

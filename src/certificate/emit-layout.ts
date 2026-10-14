// K7 emit layout (plan §3.4): every tsconfig program of base that emits keeps where it writes: the same outDir and the
// same rootDir, so each file that didn't move (the pinned entries package.json, scripts and Docker run from the build,
// `dist/main.js`) is emitted where it was. An explicit rootDir can't change under a move (K2 keeps the tsconfig's bytes);
// a default one can: TypeScript before 6.0 roots the output at the sources' common directory, so moving the one file
// outside `src/` into it turns `dist/src/main.js` into `dist/main.js`. From 6.0 on the default is the tsconfig's
// directory. The rule is that of the TypeScript the environment installs for the tsconfig's directory; when its version
// is unknown, both must hold.
import fs from 'node:fs';
import path from 'node:path';
import { loadScopes } from '../analyzer/tsconfig-scopes.js';
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
      const common = { base: commonSourceDirectory(program.files), head: commonSourceDirectory(later.files) };
      const major = typescriptMajor(context.environment.checkout, configDirectory.base);
      const rules = major === null ? ['6.0+', 'before 6.0'] : major >= 6 ? ['6.0+'] : ['before 6.0'];
      const unmoved = [...program.files].filter((file) => !declarationPattern.test(file) && pathMap.map(file) === file).sort()[0];
      let shifted = false;
      for (const rule of rules) {
        const [before, after] = rule === '6.0+' ? [configDirectory.base, configDirectory.head] : [common.base, common.head];
        if (before === after) continue;
        shifted = true;
        const example = unmoved ? `: ${unmoved} was emitted as ${emittedPath(unmoved, before, outDirs.base)}, now ${emittedPath(unmoved, after, outDirs.head)}` : '';
        violations.push({ file: headConfig, detail: `no rootDir, and TypeScript ${rule}'s default moves from ${before || '.'} to ${after || '.'}, so every file emitted into ${outDirs.base} moves${example}` });
      }
      if (!shifted) findings.push({ kind: 'default-root-dir', file: headConfig, detail: `emits into ${outDirs.base} without a rootDir; TypeScript ${rules.join(' and ')}'s default stays ${rules.map((rule) => (rule === '6.0+' ? configDirectory.base : common.base) || '.').join(' and ')}` });
    }
    const summary = violations.length
      ? `${violations.length} emitting programs change where they write`
      : `${emitting} emitting programs keep their outDir and rootDir (${inferred} by TypeScript's default)`;
    return result('K7', title, { summary, violations, findings, metrics: { emittingPrograms: emitting, defaultRootDirs: inferred } });
  },
};

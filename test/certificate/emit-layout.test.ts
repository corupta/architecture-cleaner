// K7 emit layout: every emitting program keeps its outDir and rootDir, so the files that didn't move are emitted where
// they were; a default rootDir follows the environment's TypeScript (the sources' common directory before 6.0).
import { describe, expect, it } from 'vitest';
import { emitLayout } from '../../src/certificate/emit-layout.js';
import type { CheckResult } from '../../src/certificate/types.js';
import { type Tree, withContext } from './two-commit-repo.js';

const typescript = (version: string) => ({ 'node_modules/typescript/package.json': JSON.stringify({ name: 'typescript', version }) });
const tsconfig = (compilerOptions: Record<string, unknown>) => JSON.stringify({ compilerOptions: { module: 'commonjs', ...compilerOptions }, include: ['src', 'scripts'] });
const main = "import { seed } from '../scripts/seed';\nexport const main = seed;\n";
const base = (options: Record<string, unknown>): Tree => ({ 'tsconfig.json': tsconfig(options), 'src/main.ts': main, 'scripts/seed.ts': 'export const seed = 1;\n' });
// The one file outside src/ moves into it: the sources' common directory becomes src/.
const head = (options: Record<string, unknown>): Tree => ({ 'tsconfig.json': tsconfig(options), 'src/main.ts': main.replace('../scripts/seed', './scripts/seed'), 'src/scripts/seed.ts': 'export const seed = 1;\n' });

const k7 = (before: Tree, after: Tree, version?: string) =>
  withContext(before, after, (context) => emitLayout.run(context) as CheckResult, version ? { installed: typescript(version) } : {});

describe('K7 emit layout', () => {
  it("fails a move that shifts TypeScript 5's default rootDir: every emitted path changes", () => {
    const check = k7(base({ outDir: 'dist' }), head({ outDir: 'dist' }), '5.9.3');
    expect(check.status).toBe('fail');
    expect(check.violations).toEqual([{ file: 'tsconfig.json', detail: "no rootDir, and TypeScript before 6.0's default moves from . to src, so every file emitted into dist moves: src/main.ts was emitted as dist/src/main.js, now dist/main.js" }]);
  });

  it("passes the same move under TypeScript 6, whose default is the tsconfig's directory, and records the default", () => {
    const check = k7(base({ outDir: 'dist' }), head({ outDir: 'dist' }), '6.0.3');
    expect(check.status).toBe('pass');
    expect(check.findings).toEqual([{ kind: 'default-root-dir', file: 'tsconfig.json', detail: "emits into dist without a rootDir; TypeScript 6.0+'s default stays ." }]);
    expect(check.metrics).toEqual({ emittingPrograms: 1, defaultRootDirs: 1 });
  });

  it('applies the rule of the TypeScript installed for the tsconfig, not the repo root', () => {
    const nested = (tree: Tree) => Object.fromEntries(Object.entries(tree).map(([file, text]) => [`packages/app/${file}`, text]));
    const installed = { ...typescript('6.0.3'), 'packages/app/node_modules/typescript/package.json': JSON.stringify({ name: 'typescript', version: '5.9.3' }) };
    const check = withContext(nested(base({ outDir: 'dist' })), nested(head({ outDir: 'dist' })), (context) => emitLayout.run(context) as CheckResult, { installed });
    expect(check.violations.map((violation) => violation.detail)).toEqual([expect.stringContaining("TypeScript before 6.0's default moves from packages/app to packages/app/src")]);
  });

  it('holds both rules when the TypeScript version is unknown', () => {
    expect(k7(base({ outDir: 'dist' }), head({ outDir: 'dist' })).violations.map((violation) => violation.detail)).toEqual([expect.stringContaining('TypeScript before 6.0')]);
  });

  it('passes with an explicit rootDir, and ignores programs that emit nothing', () => {
    const explicit = k7(base({ outDir: 'dist', rootDir: '.' }), head({ outDir: 'dist', rootDir: '.' }), '5.9.3');
    expect(explicit).toMatchObject({ status: 'pass', violations: [], findings: [] });
    expect(k7(base({ outDir: 'dist', noEmit: true }), head({ outDir: 'dist', noEmit: true }), '5.9.3').metrics.emittingPrograms).toBe(0);
    expect(k7(base({}), head({}), '5.9.3').metrics.emittingPrograms).toBe(0);
  });
});

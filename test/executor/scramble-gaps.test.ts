// Executor gaps the S7 scrambles hit, and the S6 carry-over "testRegex modelled": build-time alias rewriters that emit
// './' for a module file shadowed by a directory (hoppscotch), and Jest's testRegex as a test scope instead of an
// unreadable config.
import { describe, expect, it } from 'vitest';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { loadRunnerConfig } from '../../src/analyzer/runner-config.js';
import { testScopeChanges } from '../../src/executor/declines.js';
import { cjs, codes, move, read, repoFrom } from './repo.js';

const baseUrl = (extra: object = {}) => cjs({ baseUrl: './', ignoreDeprecations: '6.0', ...extra });

describe('alias-rewrite-hazard: a paths/baseUrl target whose extensionless path encloses the importer', () => {
  const utils = {
    'tsconfig.json': baseUrl(),
    'src/utils.ts': 'export const isDefined = (value: unknown) => value !== undefined;\n',
    'src/auth/helper.ts': "import { isDefined } from 'src/utils';\nexport const has = (value: unknown) => isDefined(value);\n",
    'src/auth/deep/check.ts': "import { isDefined } from 'src/utils';\nexport const check = isDefined;\n",
  };

  it('declines moving an importer into the directory named like its target (emitted as ./)', () => {
    const result = move(repoFrom(utils), { 'src/auth/helper.ts': 'src/utils/helper.ts' });
    expect(codes(result)).toEqual(['alias-rewrite-hazard']);
    if (result.outcome !== 'declined') return;
    expect(result.declines[0]!.file).toBe('src/auth/helper.ts');
    expect(result.declines[0]!.detail).toContain("emit it as './'");
  });

  it('declines moving it deeper under that directory (emitted as ..)', () => {
    const result = move(repoFrom(utils), { 'src/auth/deep/check.ts': 'src/utils/deep/check.ts' });
    expect(codes(result)).toEqual(['alias-rewrite-hazard']);
    if (result.outcome === 'declined') expect(result.declines[0]!.detail).toContain("emit it as '..'");
  });

  it('declines moving the target so that its path encloses an importer that stays', () => {
    const result = move(repoFrom({ ...utils, 'src/auth.ts': 'export const auth = 1;\n', 'src/auth/uses.ts': "import { auth } from 'src/auth';\nexport const uses = auth;\n" }),
      { 'src/utils.ts': 'src/auth/deep.ts' });
    expect(codes(result)).toEqual(['alias-rewrite-hazard']);
  });

  it('applies the same move with a relative specifier, which no rewriter touches', () => {
    const root = repoFrom({ ...utils, 'src/auth/helper.ts': "import { isDefined } from '../utils';\nexport const has = (value: unknown) => isDefined(value);\n" });
    expect(codes(move(root, { 'src/auth/helper.ts': 'src/utils/helper.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/utils/helper.ts')).toContain("from '../utils'");
  });

  it('applies a move next to the directory (emitted as ../utils, which Node resolves to the file)', () => {
    const root = repoFrom(utils);
    expect(codes(move(root, { 'src/auth/helper.ts': 'src/util/helper.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/util/helper.ts')).toContain("from 'src/utils'");
  });

  it('leaves a shape the base already had alone', () => {
    const root = repoFrom({ ...utils, 'src/utils/inside.ts': "import { isDefined } from 'src/utils';\nexport const inside = isDefined;\n" });
    expect(codes(move(root, { 'src/utils/inside.ts': 'src/utils/nested/inside.ts' }))).toEqual(['applied']);
  });
});

describe('tool config scripts name files too (kaneo drizzle.config.ts)', () => {
  const kaneo = {
    'apps/api/package.json': '{ "name": "api", "type": "module" }\n',
    'apps/api/tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true, types: [] }, include: ['src'] }),
    'apps/api/drizzle.config.ts': "import { defineConfig } from 'drizzle-kit';\nexport default defineConfig({ schema: './src/database/schema.ts', out: './drizzle' });\n",
    'apps/api/src/database/schema.ts': 'export const userTable = {};\n',
    'apps/api/src/database/index.ts': "export * from './schema';\n",
  };

  it('declines moving the schema a drizzle config names', () => {
    const result = move(repoFrom(kaneo), { 'apps/api/src/database/schema.ts': 'apps/api/src/utils/user-table.ts' });
    expect(codes(result)).toEqual(['config-reference']);
    if (result.outcome === 'declined') expect(result.declines[0]!.detail).toContain("apps/api/drizzle.config.ts line 2 [schema]: './src/database/schema.ts' is the old path");
  });

  it('records a mention in a comment of such a config as a finding', () => {
    const tree = { ...kaneo, 'apps/api/drizzle.config.ts': "// schema: ./src/database/schema.ts\nexport default { out: './drizzle' };\n" };
    const result = move(repoFrom(tree), { 'apps/api/src/database/schema.ts': 'apps/api/src/utils/user-table.ts' });
    expect(codes(result)).toEqual(['applied']);
    expect(result.outcome === 'applied' ? result.findings.map((finding) => finding.kind) : []).toEqual(['old-path-in-comment']);
  });
});

describe('Jest testRegex is a test scope, not an unreadable config', () => {
  const e2e = (config: object) => ({
    'tsconfig.json': cjs({}, ['src', 'test']),
    'package.json': '{ "name": "backend" }\n',
    'test/jest-e2e.json': JSON.stringify({ rootDir: '.', ...config }),
    'test/app.e2e-spec.ts': 'export const e2e = 1;\n',
    'test/helpers.ts': 'export const helper = 1;\n',
    'src/a.ts': 'export const a = 1;\n',
  });

  it('reads testRegex from a jest*.json config (hoppscotch test/jest-e2e.json)', () => {
    const runner = loadRunnerConfig(gitRepoFs(repoFrom(e2e({ testRegex: '.e2e-spec.ts$' }))));
    expect(runner.unreadable).toEqual([]);
    const jest = runner.jest.find((config) => config.config === 'test/jest-e2e.json')!;
    expect(jest.scope.roots).toEqual(['test']);
    expect(jest.scope.includePatterns.map((pattern) => pattern.source)).toEqual(['.e2e-spec.ts$']);
  });

  it('moves files the config governs when their membership is unchanged', () => {
    expect(codes(move(repoFrom(e2e({ testRegex: '.e2e-spec.ts$' })), { 'src/a.ts': 'src/lib/a.ts' }))).toEqual(['applied']);
    expect(codes(move(repoFrom(e2e({ testRegex: '.e2e-spec.ts$' })), { 'test/helpers.ts': 'test/support/helpers.ts' }))).toEqual(['applied']);
  });

  it('declines a test that would leave the regex test set', () => {
    expect(codes(move(repoFrom(e2e({ testRegex: '.e2e-spec.ts$' })), { 'test/app.e2e-spec.ts': 'test/app.e2e.ts' }))).toEqual(['test-runner-scope']);
  });

  it('applies the regex instead of the default testMatch (a .spec.ts outside the regex is not a test)', () => {
    const runner = loadRunnerConfig(gitRepoFs(repoFrom(e2e({ testRegex: ['\\.e2e-spec\\.ts$'] }))));
    expect(testScopeChanges(runner, 'test/x.ts', 'test/x.spec.ts')).toEqual([]);
    expect(testScopeChanges(runner, 'test/x.ts', 'test/x.e2e-spec.ts')).toEqual(['test/jest-e2e.json: test membership changes at test/x.e2e-spec.ts']);
  });

  it('reads string, array and regex-literal forms from a script config', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'jest.config.js': 'module.exports = { testRegex: [/\\.it\\.ts$/i, "\\\\.spec\\\\.ts$"], testPathIgnorePatterns: ["/fixtures/"] };\n',
      'src/a.ts': 'export const a = 1;\n',
    });
    const runner = loadRunnerConfig(gitRepoFs(root));
    expect(runner.unreadable).toEqual([]);
    expect(runner.jest[0]!.scope.includePatterns.map(String)).toEqual(['/\\.it\\.ts$/i', '/\\.spec\\.ts$/']);
    expect(testScopeChanges(runner, 'src/a.ts', 'src/a.IT.ts')).toHaveLength(1);
    expect(testScopeChanges(runner, 'src/a.spec.ts', 'src/fixtures/a.spec.ts')).toHaveLength(1);
  });

  it.each([
    [{ testRegex: '^/home/ci/repo/test/' }, 'testRegex "^/home/ci/repo/test/" is anchored to an absolute path'],
    [{ testRegex: '(unclosed' }, 'invalid regex in testRegex ("(unclosed")'],
    [{ testRegex: '.e2e-spec.ts$', testMatch: ['**/*.e2e-spec.ts'] }, 'testMatch and testRegex together'],
  ])('keeps %j unreadable: %s', (config, reason) => {
    const root = repoFrom(e2e(config));
    expect(loadRunnerConfig(gitRepoFs(root)).unreadable).toEqual([{ config: 'test/jest-e2e.json', reason }]);
    expect(codes(move(root, { 'test/helpers.ts': 'test/support/helpers.ts' }))).toEqual(['unreadable-runner-config']);
  });

  it('keeps a computed testRegex unreadable', () => {
    const root = repoFrom({ 'tsconfig.json': cjs(), 'jest.config.js': 'const suffix = "spec";\nmodule.exports = { testRegex: `\\\\.${suffix}\\\\.ts$` };\n', 'src/a.ts': 'export const a = 1;\n' });
    expect(loadRunnerConfig(gitRepoFs(root)).unreadable).toEqual([{ config: 'jest.config.js', reason: 'non-literal testRegex' }]);
  });
});

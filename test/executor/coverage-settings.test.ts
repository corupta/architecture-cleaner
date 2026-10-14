// S6 review fixes on the executor side: which config values are coverage settings (the key that holds the value,
// never a script or job name), coverage gates that fail closed (a threshold from a const, a CLI threshold flag, a
// threshold in another file), Jest regex path settings, and runner roots read relative to their config.
import { describe, expect, it } from 'vitest';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { loadRunnerConfig } from '../../src/analyzer/runner-config.js';
import { coverageGated } from '../../src/analyzer/coverage-settings.js';
import type { MoveResult } from '../../src/executor/execute.js';
import { cjs, codes, move, repoFrom } from './repo.js';

const findingsOf = (result: MoveResult) => (result.outcome === 'applied' || result.outcome === 'verified' ? result.findings : []);
const detailsOf = (result: MoveResult) => (result.outcome === 'declined' ? result.declines.map((decline) => decline.detail) : []);

const services = {
  'tsconfig.json': cjs(),
  'src/services/user.service.ts': 'export const user = 1;\n',
  'src/services/user.service.spec.ts': "import { user } from './user.service';\nexport const spec = user;\n",
  'src/services/other.service.ts': 'export const other = 1;\n',
};
const toModule = { 'src/services/user.service.ts': 'src/modules/user/user.service.ts', 'src/services/user.service.spec.ts': 'src/modules/user/user.service.spec.ts' };
const vitestCoverage = (coverage: string, prelude = '') => `import { defineConfig } from 'vitest/config';\n${prelude}export default defineConfig({ test: { coverage: { include: ['src/services/**']${coverage} } } });\n`;

describe('a coverage setting is decided by the key that holds the value', () => {
  it('declines a test path in an npm script named test:coverage, as it does under any other name', () => {
    for (const script of ['test:coverage', 'test:unit']) {
      const root = repoFrom({ ...services, 'package.json': JSON.stringify({ name: 'x', scripts: { test: 'vitest run', [script]: 'vitest run --coverage src/services' } }, null, 2) + '\n' });
      const result = move(root, toModule);
      expect(codes(result)).toEqual(['config-reference']);
      expect(detailsOf(result)[0]).toContain(`[scripts.${script}]`);
    }
  });

  it('declines a path in a config section named coverage that is no coverage setting', () => {
    const root = repoFrom({ ...services, 'package.json': JSON.stringify({ name: 'x', coverage: { entry: 'src/services/user.service.ts' } }, null, 2) + '\n' });
    expect(codes(move(root, toModule))).toEqual(['config-reference']);
  });

  it('keeps an ungated Vitest test.coverage glob a finding', () => {
    const root = repoFrom({ ...services, 'package.json': '{ "name": "x" }\n', 'vitest.config.ts': vitestCoverage('') });
    const result = move(root, toModule);
    expect(codes(result)).toEqual(['applied']);
    expect(findingsOf(result).map((finding) => finding.kind)).toEqual(['ungated-coverage-glob']);
  });
});

describe('a coverage gate fails closed', () => {
  it('reads a threshold set from a const, a spread or a call as a gate', () => {
    expect(coverageGated('coverage: { thresholds: { lines: MIN } }')).toBe(true);
    expect(coverageGated('coverageThreshold: { global: { ...base.global } }')).toBe(true);
    expect(coverageGated('coverageThreshold: thresholds()')).toBe(true);
    expect(coverageGated("coverage: { thresholds: { 'src/**': { lines: 0 }, perFile: true, autoUpdate: false } }")).toBe(false);
    expect(coverageGated('{ "100": true }')).toBe(true);
  });

  it('declines a Vitest coverage glob whose threshold is a const', () => {
    const root = repoFrom({ ...services, 'package.json': '{ "name": "x" }\n', 'vitest.config.ts': vitestCoverage(', thresholds: { lines: MIN }', 'const MIN = 90;\n') });
    const result = move(root, { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' });
    expect(codes(result)).toEqual(['config-reference']);
    expect(detailsOf(result)[0]).toContain('a coverage setting gated by');
  });

  it.each([
    ['a Vitest threshold flag', 'vitest run --coverage --coverage.thresholds.lines=90'],
    ['a Jest coverageThreshold flag', `jest --coverage --coverageThreshold='{"global":{"lines":90}}'`],
    ['c8 --check-coverage', 'c8 --check-coverage --lines 90 vitest run'],
  ])('declines a coverage glob the package gates with %s in a script', (_name, script) => {
    const root = repoFrom({ ...services, 'package.json': JSON.stringify({ name: 'x', scripts: { 'test:ci': script } }, null, 2) + '\n', 'vitest.config.ts': vitestCoverage('') });
    const result = move(root, { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' });
    expect(codes(result)).toEqual(['config-reference']);
    expect(detailsOf(result)[0]).toContain('package.json');
  });

  it('declines a coverage glob gated from CI', () => {
    const root = repoFrom({
      ...services,
      'package.json': '{ "name": "x" }\n',
      'vitest.config.ts': vitestCoverage(''),
      '.github/workflows/ci.yml': 'jobs:\n  unit:\n    steps:\n      - run: npx vitest run --coverage --coverage.thresholds.lines=90\n',
    });
    expect(codes(move(root, { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' }))).toEqual(['config-reference']);
  });

  it("leaves another package's gate alone", () => {
    const root = repoFrom({
      'package.json': '{ "name": "root", "private": true }\n',
      'web/package.json': JSON.stringify({ name: 'web', scripts: { 'test:ci': 'vitest run --coverage.thresholds.lines=90' } }) + '\n',
      'server/package.json': '{ "name": "server" }\n',
      'server/tsconfig.json': cjs(),
      'server/vitest.config.ts': vitestCoverage(''),
      'server/src/services/user.service.ts': 'export const user = 1;\n',
      'server/src/services/other.service.ts': 'export const other = 1;\n',
    });
    const result = move(root, { 'server/src/services/user.service.ts': 'server/src/modules/user/user.service.ts' });
    expect(codes(result)).toEqual(['applied']);
    expect(findingsOf(result).map((finding) => finding.kind)).toEqual(['ungated-coverage-glob']);
  });

  it('declines a Jest coverage glob whose threshold comes from a required base config or a preset', () => {
    const jest = (config: string, extra: Record<string, string>) => repoFrom({ ...services, 'package.json': '{ "name": "x" }\n', 'jest.config.js': config, ...extra });
    const based = jest("const base = require('./jest.base.js');\nmodule.exports = { ...base, collectCoverageFrom: ['src/services/**/*.ts'] };\n", {
      'jest.base.js': 'module.exports = { coverageThreshold: { global: { lines: 90 } } };\n',
    });
    expect(codes(move(based, { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' }))).toEqual(['config-reference']);
    const preset = jest("module.exports = { preset: './jest-preset.js', collectCoverageFrom: ['src/services/**/*.ts'] };\n", {
      'jest-preset.js': 'module.exports = { coverageThreshold: { global: { lines: 90 } } };\n',
    });
    expect(codes(move(preset, { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' }))).toEqual(['config-reference']);
    const uninstalled = jest("module.exports = { preset: 'company-jest-preset', collectCoverageFrom: ['src/services/**/*.ts'] };\n", {});
    expect(codes(move(uninstalled, { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' }))).toEqual(['config-reference']);
    const ungated = jest("const base = require('./jest.base.js');\nmodule.exports = { ...base, collectCoverageFrom: ['src/services/**/*.ts'] };\n", {
      'jest.base.js': "module.exports = { testEnvironment: 'node' };\n",
    });
    expect(codes(move(ungated, { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' }))).toEqual(['applied']);
  });

  it('reads an installed preset through its exports map: gated when its file sets a threshold, a finding when not', () => {
    const installed = (preset: string) => repoFrom({
      ...services,
      '.gitignore': 'node_modules/\n',
      'package.json': '{ "name": "x" }\n',
      'jest.config.js': "module.exports = { preset: '@company/jest', collectCoverageFrom: ['src/services/**/*.ts'] };\n",
      'node_modules/@company/jest/package.json': JSON.stringify({ name: '@company/jest', exports: { './jest-preset': { require: './dist/preset.js' } } }),
      'node_modules/@company/jest/dist/preset.js': preset,
    });
    const moved = { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' };
    const gated = move(installed('module.exports = { coverageThreshold: { global: { lines: 90 } } };\n'), moved);
    expect(codes(gated)).toEqual(['config-reference']);
    expect(detailsOf(gated)[0]).toContain('a threshold in node_modules/@company/jest/dist/preset.js');
    const ungated = move(installed("module.exports = { testEnvironment: 'node' };\n"), moved);
    expect(codes(ungated)).toEqual(['applied']);
    expect(findingsOf(ungated).map((finding) => finding.kind)).toEqual(['ungated-coverage-glob']);
  });

  it('declines a coverage glob gated by a threshold in a multi-project root config above it', () => {
    const root = repoFrom({
      'package.json': '{ "name": "root", "private": true }\n',
      'jest.config.js': "module.exports = { projects: ['<rootDir>/packages/*'], coverageThreshold: { global: { lines: 90 } } };\n",
      'packages/api/package.json': '{ "name": "api" }\n',
      'packages/api/tsconfig.json': cjs(),
      'packages/api/jest.config.js': "module.exports = { collectCoverageFrom: ['src/services/**/*.ts'] };\n",
      'packages/api/src/services/user.service.ts': 'export const user = 1;\n',
      'packages/api/src/services/other.service.ts': 'export const other = 1;\n',
    });
    const result = move(root, { 'packages/api/src/services/user.service.ts': 'packages/api/src/modules/user/user.service.ts' });
    expect(codes(result)).toEqual(['config-reference']);
    expect(detailsOf(result)[0]).toContain('a threshold in jest.config.js, a runner config over it');
  });
});

describe('Jest regex path settings', () => {
  it('declines a move that changes a gated coveragePathIgnorePatterns match, and records an ungated one', () => {
    const config = (threshold: string) => `module.exports = {\n  collectCoverageFrom: ['src/**/*.ts'],\n  coveragePathIgnorePatterns: ['/node_modules/', '/src/(services|repositories)/'],${threshold}\n};\n`;
    const gated = repoFrom({ ...services, 'package.json': '{ "name": "x" }\n', 'jest.config.js': config('\n  coverageThreshold: { global: { lines: 90 } },') });
    const result = move(gated, { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' });
    expect(codes(result)).toEqual(['config-reference']);
    expect(detailsOf(result)[0]).toContain('[coveragePathIgnorePatterns]');
    const ungated = repoFrom({ ...services, 'package.json': '{ "name": "x" }\n', 'jest.config.js': config('') });
    const recorded = move(ungated, { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' });
    expect(codes(recorded)).toEqual(['applied']);
    expect(findingsOf(recorded).map((finding) => finding.kind)).toEqual(['ungated-coverage-glob']);
  });

  it('declines a move that changes a modulePathIgnorePatterns match', () => {
    const root = repoFrom({ ...services, 'package.json': JSON.stringify({ name: 'x', jest: { modulePathIgnorePatterns: ['<rootDir>/src/services/'] } }) + '\n' });
    expect(codes(move(root, { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' }))).toEqual(['config-reference']);
  });
});

describe('runner roots are read relative to their config', () => {
  const api = (rootDir: string) => ({
    'package.json': '{ "name": "root", "private": true }\n',
    'packages/api/package.json': '{ "name": "api" }\n',
    'packages/api/tsconfig.json': cjs(),
    'packages/api/jest.config.js': `module.exports = { rootDir: '${rootDir}', testMatch: ['<rootDir>/services/**/*.spec.ts'], collectCoverageFrom: ['<rootDir>/services/**/*.ts'], coverageThreshold: { global: { lines: 90 } } };\n`,
    'packages/api/src/services/user.service.ts': 'export const user = 1;\n',
    'packages/api/src/services/user.service.spec.ts': "import { user } from './user.service';\nexport const spec = user;\n",
  });

  it('reads a bare Jest rootDir from the config directory, as Jest does', () => {
    for (const rootDir of ['src', './src']) {
      const root = repoFrom(api(rootDir));
      expect(loadRunnerConfig(gitRepoFs(root)).jest.map((jest) => [jest.rootDir, jest.scope.include])).toEqual([['packages/api/src', ['packages/api/src/services/**/*.spec.ts']]]);
      expect(codes(move(root, {
        'packages/api/src/services/user.service.ts': 'packages/api/src/modules/user/user.service.ts',
        'packages/api/src/services/user.service.spec.ts': 'packages/api/src/modules/user/user.service.spec.ts',
      }))).toEqual(['config-reference', 'test-runner-scope']);
    }
  });

  it('reads a relative Vitest root from the package directory (the cwd), and not at all when that is ambiguous', () => {
    const own = repoFrom({ 'packages/web/package.json': '{ "name": "web" }\n', 'packages/web/vitest.config.ts': "export default { test: { root: 'src', include: ['services/**/*.spec.ts'] } };\n" });
    const ownRunner = loadRunnerConfig(gitRepoFs(own));
    expect(ownRunner.vitest.map((vitest) => [vitest.directory, vitest.scope.include])).toEqual([['packages/web/src', ['packages/web/src/services/**/*.spec.ts']]]);
    expect(ownRunner.unreadable).toEqual([]);
    const nested = repoFrom({ 'packages/web/package.json': '{ "name": "web" }\n', 'packages/web/test/vitest.config.ts': "export default { test: { root: '..', include: ['src/**/*.spec.ts'] } };\n" });
    const nestedRunner = loadRunnerConfig(gitRepoFs(nested));
    expect(nestedRunner.vitest.map((vitest) => vitest.directory)).toEqual(['packages']);
    expect(nestedRunner.unreadable.map((entry) => entry.config)).toEqual(['packages/web/test/vitest.config.ts']);
  });
});

// S4 carry-overs (docs/sessions/s4.md item 10): package-root-relative config globs with the certifier's coverage rule,
// parenthesized and cast loader calls, tsx/bun/deno shebang scripts and jest*.json configs, and Vite's .js → .ts
// lookup for mock specifiers.
import { describe, expect, it } from 'vitest';
import { extractSites } from '../../src/analyzer/reference-sites.js';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { loadRunnerConfig } from '../../src/analyzer/runner-config.js';
import { coverageGated } from '../../src/analyzer/coverage-settings.js';
import type { MoveResult } from '../../src/executor/execute.js';
import { cjs, codes, move, read, repoFrom } from './repo.js';

// immich's server/test/vitest.config.mjs: root is the server directory, so its globs are package-root-relative.
const immichVitest = (coverageExtra = '') => `import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  test: {
    root: serverRoot,
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/cores/**', 'src/services/**'],
      exclude: ['src/services/*.spec.ts', 'src/services/api.service.ts'],${coverageExtra}
    },
  },
});
`;

const immichLike = (coverageExtra = '') => ({
  'server/package.json': '{ "name": "server" }\n',
  'server/tsconfig.json': cjs({}, ['src', 'test']),
  'server/test/vitest.config.mjs': immichVitest(coverageExtra),
  'server/src/services/album.service.ts': 'export const album = 1;\n',
  'server/src/services/album.service.spec.ts': "import { album } from './album.service';\nexport const spec = album;\n",
  'server/src/services/api.service.ts': 'export const api = 1;\n',
});

const findingsOf = (result: MoveResult) => (result.outcome === 'applied' || result.outcome === 'verified' ? result.findings : []);

describe('config references: package-root-relative globs and the coverage rule', () => {
  it('records an ungated coverage glob that matches a moved file as a finding, not a decline', () => {
    const root = repoFrom(immichLike());
    const result = move(root, {
      'server/src/services/album.service.ts': 'server/src/modules/album/album.service.ts',
      'server/src/services/album.service.spec.ts': 'server/src/modules/album/album.service.spec.ts',
    });
    expect(codes(result)).toEqual(['applied']);
    const findings = findingsOf(result);
    expect(findings.map((finding) => finding.kind)).toEqual(['ungated-coverage-glob', 'ungated-coverage-glob']);
    expect(findings[0]!.file).toBe('server/test/vitest.config.mjs');
    expect(findings[0]!.detail).toContain("'src/services/**'");
    expect(findings[0]!.detail).toContain('server/src/services/album.service.ts');
    expect(findings[1]!.detail).toContain("'src/services/*.spec.ts'");
    expect(findings[1]!.detail).toContain('server/src/services/album.service.spec.ts');
  });

  it('records a plain coverage path to a moved file as a finding', () => {
    const root = repoFrom(immichLike());
    const result = move(root, { 'server/src/services/api.service.ts': 'server/src/platform/registry/api.service.ts' });
    expect(codes(result)).toEqual(['applied']);
    expect(findingsOf(result).map((finding) => [finding.kind, finding.detail.includes("'src/services/api.service.ts'")])).toEqual([
      ['ungated-coverage-glob', false],
      ['ungated-coverage-glob', true],
    ]);
  });

  it('declines when a coverage threshold gates the glob', () => {
    const root = repoFrom(immichLike('\n      thresholds: { lines: 80 },'));
    const result = move(root, { 'server/src/services/album.service.ts': 'server/src/modules/album/album.service.ts' });
    expect(codes(result)).toEqual(['config-reference']);
    expect(result.outcome === 'declined' && result.declines[0]!.detail).toContain('gated by a threshold');
  });

  it('declines a Jest collectCoverageFrom glob under a coverageThreshold', () => {
    const root = repoFrom({
      'server/package.json': '{ "name": "server" }\n',
      'server/tsconfig.json': cjs(),
      'server/jest.config.js': "module.exports = {\n  collectCoverageFrom: ['src/services/**/*.ts'],\n  coverageThreshold: { global: { lines: 90 } },\n};\n",
      'server/src/services/user.service.ts': 'export const user = 1;\n',
    });
    expect(codes(move(root, { 'server/src/services/user.service.ts': 'server/src/modules/user/user.service.ts' }))).toEqual(['config-reference']);
  });

  it('declines a non-coverage per-file glob that stops matching a moved file (eslint files)', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'eslint.config.mjs': "export default [{ files: ['src/services/**/*.ts'], rules: { 'no-console': 'error' } }];\n",
      'src/services/user.service.ts': 'export const user = 1;\n',
    });
    expect(codes(move(root, { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' }))).toEqual(['config-reference']);
  });

  it('keeps a glob whose match set the move leaves alone', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'package.json': '{ "scripts": { "lint": "eslint \\"src/**/*.ts\\"" } }\n',
      'src/services/user.service.ts': 'export const user = 1;\n',
    });
    const result = move(root, { 'src/services/user.service.ts': 'src/modules/user/user.service.ts' });
    expect(codes(result)).toEqual(['applied']);
    expect(findingsOf(result)).toEqual([]);
  });

  it('records a moved path in a config comment as a finding', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'jest.config.js': "// setup lives in src/setup/clock.ts\nmodule.exports = { testEnvironment: 'node' };\n",
      'src/setup/clock.ts': 'export const clock = 1;\n',
    });
    const result = move(root, { 'src/setup/clock.ts': 'src/testing/clock.ts' });
    expect(codes(result)).toEqual(['applied']);
    expect(findingsOf(result).map((finding) => finding.kind)).toEqual(['old-path-in-comment']);
  });

  it('declines a config that names a directory a move leaves', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'package.json': '{ "scripts": { "email": "email dev --dir src/emails" } }\n',
      'src/emails/welcome.ts': 'export const welcome = 1;\n',
    });
    expect(codes(move(root, { 'src/emails/welcome.ts': 'src/modules/email/welcome.ts' }))).toEqual(['config-reference']);
  });

  it('reads the Vitest root, so a spec leaving its package-root-relative include is declined', () => {
    const root = repoFrom(immichLike());
    const vitest = loadRunnerConfig(gitRepoFs(root)).vitest[0]!;
    expect(vitest.directory).toBe('server');
    expect(vitest.scope.include).toEqual(['server/src/**/*.spec.ts']);
    expect(codes(move(root, { 'server/src/services/album.service.spec.ts': 'server/test/album.service.spec.ts' }))).toEqual(['config-reference', 'test-runner-scope']);
  });

  it('governs by the Vitest root: an unreadable config under test/ still covers the package', () => {
    const tree = (vitest: string) => ({
      'pkg/package.json': '{ "name": "pkg" }\n',
      'pkg/tsconfig.json': cjs(),
      'pkg/test/vitest.config.mjs': vitest,
      'pkg/src/a.ts': 'export const a = 1;\n',
    });
    const unreadableAlias = "export default { test: { root: '..' }, resolve: { alias: { '@': process.env.SRC } } };\n";
    expect(codes(move(repoFrom(tree(unreadableAlias)), { 'pkg/src/a.ts': 'pkg/src/lib/a.ts' }))).toEqual(['unreadable-runner-config']);
    const unreadableRoot = 'export default { test: { root: process.cwd() } };\n';
    expect(codes(move(repoFrom(tree(unreadableRoot)), { 'pkg/src/a.ts': 'pkg/src/lib/a.ts' }))).toEqual(['unreadable-runner-config']);
  });

  it('gates like the certifier', () => {
    expect(coverageGated("coverage: { thresholds: { lines: 80 } }")).toBe(true);
    expect(coverageGated("coverage: { thresholds: { lines: 0 } }")).toBe(false);
    expect(coverageGated('"check-coverage": true')).toBe(true);
    expect(coverageGated("coverage: { include: ['src/**'] }")).toBe(false);
  });
});

describe('parenthesized and cast loader calls', () => {
  const forms = [
    "(require)('./a')",
    "(require as any)('./a')",
    "(<any>require)('./a')",
    "(0, require)('./a')",
    "require(('./a'))",
    "require('./a' as string)",
    "(require as any).resolve('./a')",
    "(jest.requireActual as any)('./a')",
    "(jest as any).mock('./a')",
    "(vi.importActual)('./a')",
    "(vi as unknown as { mock(path: string): void }).mock('./a')",
  ];

  it.each(forms)('extracts %s', (form) => {
    const text = `const x = ${form};\n`;
    const { sites, hazards } = extractSites('src/main.ts', text);
    expect(hazards).toEqual([]);
    expect(sites.map((site) => [site.specifier, text.slice(site.start, site.end)])).toEqual([['./a', './a']]);
  });

  it('rewrites them when the target moves', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'src/globals.d.ts': 'declare function require(id: string): any;\ndeclare const jest: any;\n',
      'src/a.ts': 'export const a = 1;\n',
      'src/main.ts': "const one = (require as any)('./a');\nconst two = (<any>require)('./a');\nconst three = (jest.requireActual as any)('./a');\nexport { one, two, three };\n",
    });
    expect(codes(move(root, { 'src/a.ts': 'src/lib/a.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/main.ts')).toBe("const one = (require as any)('./lib/a');\nconst two = (<any>require)('./lib/a');\nconst three = (jest.requireActual as any)('./lib/a');\nexport { one, two, three };\n");
  });
});

describe('shebang scripts and jest*.json configs', () => {
  it.each(['#!/usr/bin/env -S npx tsx', '#!/usr/bin/env bun', '#!/usr/bin/env -S deno run --allow-read'])('reads an extensionless %s script', (shebang) => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'src/a.ts': 'export const a = 1;\n',
      'bin/cli': `${shebang}\nimport { a } from '../src/a';\nconsole.log(a);\n`,
    });
    expect(codes(move(root, { 'src/a.ts': 'src/lib/a.ts' }))).toEqual(['applied']);
    expect(read(root, 'bin/cli')).toBe(`${shebang}\nimport { a } from '../src/lib/a';\nconsole.log(a);\n`);
  });

  it('leaves an extensionless file with another shebang alone', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'src/a.ts': 'export const a = 1;\n',
      'bin/run': "#!/bin/sh\nimport '../src/a'\n",
    });
    expect(codes(move(root, { 'src/a.ts': 'src/lib/a.ts' }))).toEqual(['applied']);
    expect(read(root, 'bin/run')).toBe("#!/bin/sh\nimport '../src/a'\n");
  });

  it('reads moduleNameMapper from test/jest-e2e.json', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({}, ['src', 'test']),
      'test/jest-e2e.json': JSON.stringify({ rootDir: '.', testMatch: ['<rootDir>/**/*.e2e-spec.ts'], moduleNameMapper: { '^@app/(.*)$': '<rootDir>/../src/$1' } }),
      'test/globals.d.ts': 'declare const jest: { mock(path: string): void };\n',
      'test/app.e2e-spec.ts': "jest.mock('@app/a');\nexport const spec = 1;\n",
      'src/a.ts': 'export const a = 1;\n',
    });
    expect(codes(move(root, { 'src/a.ts': 'src/lib/a.ts' }))).toEqual(['applied']);
    expect(read(root, 'test/app.e2e-spec.ts')).toBe("jest.mock('@app/lib/a');\nexport const spec = 1;\n");
  });

  it('declines a spec leaving a jest-e2e.json testMatch', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({}, ['src', 'test', 'e2e']),
      'test/jest-e2e.json': JSON.stringify({ rootDir: '.', testMatch: ['<rootDir>/**/*.e2e-spec.ts'] }),
      'test/app.e2e-spec.ts': 'export const spec = 1;\n',
    });
    expect(codes(move(root, { 'test/app.e2e-spec.ts': 'e2e/app.e2e-spec.ts' }))).toContain('test-runner-scope');
  });
});

describe('.js → .ts in mock specifiers', () => {
  const spec = (callee: string) => `${callee}('./a.js');\nexport const spec = 1;\n`;

  it('follows Vite: vi.mock("./a.js") reaches a.ts and is rewritten', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'vitest.config.ts': "export default { test: { include: ['src/**/*.spec.ts'] } };\n",
      'src/a.ts': 'export const a = 1;\n',
      'src/a.spec.ts': spec('vi.mock'),
    });
    expect(codes(move(root, { 'src/a.ts': 'src/lib/a.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/a.spec.ts')).toBe(spec("vi.mock").replace('./a.js', './lib/a.js'));
  });

  it('keeps the .js ending when the mocked file is renamed', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'vitest.config.ts': "export default { test: { include: ['src/**/*.spec.ts'] } };\n",
      'src/userService.ts': 'export const a = 1;\n',
      'src/a.spec.ts': "vi.mock('./userService.js');\nexport const spec = 1;\n",
    });
    expect(codes(move(root, { 'src/userService.ts': 'src/user.service.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/a.spec.ts')).toBe("vi.mock('./user.service.js');\nexport const spec = 1;\n");
  });

  it('follows Jest only through a moduleNameMapper that strips .js', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'jest.config.js': "module.exports = { moduleNameMapper: { '^(\\\\.{1,2}/.*)\\\\.js$': '$1' } };\n",
      'src/a.ts': 'export const a = 1;\n',
      'src/a.spec.ts': spec('jest.mock'),
    });
    expect(codes(move(root, { 'src/a.ts': 'src/lib/a.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/a.spec.ts')).toBe(spec('jest.mock').replace('./a.js', './lib/a.js'));
  });

  it('leaves a Jest .js mock without that mapper unresolved and untouched', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'jest.config.js': "module.exports = { testEnvironment: 'node' };\n",
      'src/a.ts': 'export const a = 1;\n',
      'src/a.spec.ts': spec('jest.mock'),
    });
    expect(codes(move(root, { 'src/a.ts': 'src/lib/a.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/a.spec.ts')).toBe(spec('jest.mock'));
  });
});

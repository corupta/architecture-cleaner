// Resolution red-team regressions (K3a, K3b, K3c): false passes found by building base/head pairs whose behavior
// differs (a crash at runtime, a test that asserts something else) while every static check passed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createContext } from '../../src/certificate/certify.js';
import { checkTypeScriptResolution } from '../../src/certificate/resolution-typescript.js';
import { runtimeResolution } from '../../src/certificate/resolution-runtime.js';
import type { CheckResult } from '../../src/certificate/types.js';
import { certifyFiles, checkOf, installed, jestNodeModules } from './runner-repos.js';
import { type Tree, twoCommits, withContext } from './two-commit-repo.js';

const details = (outcome: { violations: { file?: string; detail: string }[] }) => outcome.violations.map((violation) => `${violation.file ?? ''}: ${violation.detail}`);

/** K3c on base -> head; `typescript` links an installed TypeScript into the environment's node_modules. */
async function k3c(base: Tree, head: Tree, typescript?: string): Promise<CheckResult> {
  const repo = twoCommits(base, head, {}, typescript ? (root) => {
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.symlinkSync(typescript, path.join(root, 'node_modules', 'typescript'));
  } : undefined);
  const { context, cleanup } = createContext({
    repo: repo.root, base: repo.base, head: repo.head, packageRoot: '', environment: repo.root, profile: null, oracles: false,
    workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ac-resolution-red-team-')), keep: false,
  });
  try {
    return await runtimeResolution.run(context);
  } finally {
    cleanup();
    fs.rmSync(repo.root, { recursive: true, force: true });
  }
}

const manifest = (fields: object) => JSON.stringify({ name: 'target', version: '1.0.0', ...fields });
const commonjs = (extra: object = {}) => JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', strict: true, outDir: 'dist', rootDir: 'src', ignoreDeprecations: '6.0', ...extra }, include: ['src'] });
const requireDeclaration = 'declare function require(id: string): any;\n';

describe('K3c: the environment a launch command sets', () => {
  // `NODE_PATH=dist node dist/main.js`: require('services/user') loads dist/services/user.js. TypeScript and plain
  // Node leave it unresolved on both sides, so the moved user.ts looked free to move; the app crashed at boot.
  const files = (user: string) => ({
    'package.json': manifest({ scripts: { build: 'tsc', start: 'NODE_PATH=dist node dist/main.js' } }),
    'tsconfig.json': commonjs(),
    'src/globals.d.ts': requireDeclaration,
    'src/main.ts': "const user = require('services/user');\nexport const main = user.name;\n",
    [user]: "export const name = 'alice';\n",
  });

  it('fails a move that strands a bare specifier NODE_PATH resolves (through the outDir)', async () => {
    const outcome = await k3c(files('src/services/user.ts'), files('src/modules/user/user.ts'));
    expect(outcome.metrics).toMatchObject({ runtimes: 'node/emit{NODE_PATH=dist}' });
    expect(details(outcome)).toEqual(["src/main.ts: node/emit{NODE_PATH=dist}: require 'services/user' resolves to unresolved (MODULE_NOT_FOUND), expected src/modules/user/user.ts; base src/main.ts 'services/user'"]);
  });

  it('passes the rewrite that keeps the baseUrl form NODE_PATH mirrors', async () => {
    const tree = (user: string, specifier: string) => ({
      'package.json': manifest({ scripts: { build: 'tsc', start: 'cross-env NODE_PATH=dist node dist/main.js' } }),
      'tsconfig.json': commonjs({ baseUrl: 'src' }),
      'src/main.ts': `import { name } from '${specifier}';\nexport const main = name;\n`,
      [user]: "export const name = 'alice';\n",
    });
    const outcome = await k3c(tree('src/services/user.ts', 'services/user'), tree('src/modules/user/user.ts', 'modules/user/user'));
    expect(details(outcome)).toEqual([]);
    expect(outcome.metrics).toMatchObject({ comparedSites: 1, aliasSitesBase: 1, aliasSitesHead: 1 });
  });

  it('fails an unmodeled NODE_PATH (absolute, from a Dockerfile ENV) when some bare specifier is unresolved', async () => {
    const tree = (user: string) => ({ ...files(user), 'package.json': manifest({ scripts: { build: 'tsc' } }), Dockerfile: 'FROM node:22\nWORKDIR /app\nENV NODE_PATH=/app/dist\nCMD ["node", "dist/main.js"]\n' });
    const outcome = await k3c(tree('src/services/user.ts'), tree('src/modules/user/user.ts'));
    expect(details(outcome)).toEqual([': runtime alias mechanism not modeled: NODE_PATH with an absolute or computed directory (Dockerfile: CMD ["node", "dist/main.js"]), and 1 bare specifiers that require leaves unresolved in base may resolve through it']);
  });

  it('applies the export conditions NODE_OPTIONS passes (a subpath import only the development condition reaches)', async () => {
    // `npm run dev` loads src/dev/settings.js through #cfg/*; TypeScript and condition-less Node see only src/settings.ts.
    const tree = (devSettings: string) => ({
      'package.json': manifest({ imports: { '#cfg/*': { development: './src/dev/*.js', default: './src/*.js' } }, scripts: { start: 'node src/main.js', dev: 'NODE_OPTIONS=--conditions=development node src/main.js' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', strict: true, types: [] }, include: ['src'] }),
      'src/main.ts': "import { level } from '#cfg/settings';\nexport const main = level;\n",
      'src/settings.ts': "export const level = 'production';\n",
      [devSettings]: "export const level = 'development';\n",
    });
    const outcome = await k3c(tree('src/dev/settings.ts'), tree('src/dev/legacy/settings.ts'));
    expect(outcome.metrics).toMatchObject({ runtimes: 'node/emit, node/emit[development]' });
    expect(details(outcome)).toEqual(["src/main.ts: node/emit[development]: import '#cfg/settings' resolves to unresolved (MODULE_NOT_FOUND), expected src/dev/legacy/settings.ts; base src/main.ts '#cfg/settings'"]);
  });

  it('fails the same stranded specifier when a tracked env file that node --env-file loads sets NODE_PATH', async () => {
    const tree = (user: string) => ({ ...files(user), '.env.production': 'NODE_PATH=dist\n', 'package.json': manifest({ scripts: { build: 'tsc', start: 'node --env-file=.env.production dist/main.js' } }) });
    const outcome = await k3c(tree('src/services/user.ts'), tree('src/modules/user/user.ts'));
    expect(details(outcome)).toEqual(["src/main.ts: node/emit{NODE_PATH=dist}: require 'services/user' resolves to unresolved (MODULE_NOT_FOUND), expected src/modules/user/user.ts; base src/main.ts 'services/user'"]);
  });

  it("fails the same stranded specifier when a pm2 ecosystem file's env sets NODE_PATH", async () => {
    const tree = (user: string) => ({
      ...files(user),
      'package.json': manifest({ scripts: { build: 'tsc', start: 'pm2-runtime start ecosystem.config.js' } }),
      'ecosystem.config.js': "module.exports = {\n  apps: [{ name: 'app', script: 'dist/main.js', env: { NODE_PATH: 'dist' } }],\n};\n",
    });
    const outcome = await k3c(tree('src/services/user.ts'), tree('src/modules/user/user.ts'));
    expect(details(outcome)).toEqual(["src/main.ts: node/emit{NODE_PATH=dist}: require 'services/user' resolves to unresolved (MODULE_NOT_FOUND), expected src/modules/user/user.ts; base src/main.ts 'services/user'"]);
  });

  it('fails module-alias registered from code when some bare specifier is unresolved (its aliases are invisible to TypeScript)', async () => {
    const tree = (user: string) => ({
      ...files(user),
      'package.json': manifest({ dependencies: { 'module-alias': '^2' }, scripts: { build: 'tsc', start: 'node dist/main.js' } }),
      'src/aliases.ts': "const moduleAlias = require('module-alias');\nmoduleAlias.addAliases(require('../aliases.json'));\n",
    });
    const outcome = await k3c(tree('src/services/user.ts'), tree('src/modules/user/user.ts'));
    expect(details(outcome)).toEqual([": runtime alias mechanism not modeled: programmatic module-alias registration (src/aliases.ts: require 'module-alias'), and 2 bare specifiers that require leaves unresolved in base may resolve through it"]);
  });
});

describe('K3c: paths into the outDir reach the in-place emit model', () => {
  it('passes a subpath-import rewrite whose pattern names the outDir (no false "unresolved with changed text")', async () => {
    const tree = (lib: string, specifier: string) => ({
      'package.json': manifest({ type: 'module', imports: { '#lib/*': './dist/lib/*.js' }, scripts: { build: 'tsc', start: 'node dist/main.js' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', strict: true, outDir: 'dist', rootDir: 'src', types: [] }, include: ['src'] }),
      'src/main.ts': `import { x } from '${specifier}';\nexport const main = x;\n`,
      [lib]: 'export const x = 1;\n',
    });
    const outcome = await k3c(tree('src/lib/x.ts', '#lib/x'), tree('src/lib/util/x.ts', '#lib/util/x'));
    expect(details(outcome)).toEqual([]);
    expect(outcome.metrics).toMatchObject({ comparedSites: 1, unresolvedInBase: 0 });
  });
});

// openhab-cloud's install: TypeScript 5.9, whose default rootDir is the sources' common directory.
const typescript5 = path.join(os.homedir(), 'ac-targets', 'openhab-cloud', 'node_modules', 'typescript');

describe.skipIf(!fs.existsSync(path.join(typescript5, 'package.json')))('K3c: the outDir under TypeScript 5', () => {
  it('mirrors the inferred rootDir: without one, src/ is emitted straight into dist/', async () => {
    const files = (user: string) => ({
      'package.json': manifest({ scripts: { build: 'tsc', start: 'NODE_PATH=dist node dist/main.js' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true, outDir: 'dist', types: [] }, include: ['src'] }),
      'src/globals.d.ts': requireDeclaration,
      'src/main.ts': "const user = require('services/user');\nexport const main = user.name;\n",
      [user]: "export const name = 'alice';\n",
    });
    const outcome = await k3c(files('src/services/user.ts'), files('src/modules/user/user.ts'), typescript5);
    expect(details(outcome)).toEqual(["src/main.ts: node/emit{NODE_PATH=dist}: require 'services/user' resolves to unresolved (MODULE_NOT_FOUND), expected src/modules/user/user.ts; base src/main.ts 'services/user'"]);
  });
});

describe('K3a: resolutions from directories a call names', () => {
  // require.resolve('./builtin/greeter', { paths: ['dist/plugins'] }) loads dist/plugins/builtin/greeter.js; K3a
  // resolved the text from src/main.ts (unresolved on both sides) and K4 left the span to K3.
  const tree = (greeter: string) => ({
    'tsconfig.json': commonjs(),
    'src/globals.d.ts': 'declare const require: { (id: string): any; resolve(id: string, options?: { paths?: string[] }): string };\n',
    'src/main.ts': "const entry = require.resolve('./builtin/greeter', { paths: ['dist/plugins'] });\nexport const main = require(entry).greet();\n",
    'src/plugins.mts': "export const greeter = import.meta.resolve('./builtin/greeter.js', new URL('../dist/plugins/', import.meta.url).href);\n",
    [greeter]: "export const greet = () => 'hello';\n",
  });

  it('fails require.resolve with a paths option and import.meta.resolve with a parent when files move', () => {
    const outcome = withContext(tree('src/plugins/builtin/greeter.ts'), tree('src/plugins/core/greeter.ts'), (context) => checkTypeScriptResolution(context));
    expect(details(outcome)).toEqual([
      "src/main.ts: line 1: require.resolve('./builtin/greeter', …) resolves from the directories its second argument names, which no K3 resolver models, so a move may change its target",
      "src/plugins.mts: line 1: import.meta.resolve('./builtin/greeter.js', …) resolves from the directories its second argument names, which no K3 resolver models, so a move may change its target",
    ]);
  });

  it('passes it when nothing moves', () => {
    const outcome = withContext(tree('src/plugins/builtin/greeter.ts'), tree('src/plugins/builtin/greeter.ts'), (context) => checkTypeScriptResolution(context));
    expect(details(outcome)).toEqual([]);
  });
});

describe.skipIf(!installed(jestNodeModules, 'jest'))('K3b: modules tests load from outside the Jest roots', () => {
  // roots: ['<rootDir>/test'] and a mapper that stubs '../clock': the moved invoice.ts now imports '../../clock', the
  // mapper no longer matches and the test gets the real clock ('real' instead of 'fixed'). K3b skipped src/ entirely.
  const files = (invoice: string, clock: string, testImport: string) => ({
    'package.json': manifest({ private: true, scripts: { test: 'jest' } }),
    'jest.config.cjs': "module.exports = {\n  roots: ['<rootDir>/test'],\n  testEnvironment: 'node',\n  transform: { '^.+\\\\.ts$': ['ts-jest', { diagnostics: false }] },\n  moduleNameMapper: { '^\\\\.\\\\./clock$': '<rootDir>/test/fixed-clock.ts' },\n};\n",
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true, types: [] }, include: ['src', 'test'] }),
    'src/clock.ts': "export const now = () => 'real';\n",
    [invoice]: `import { now } from '${clock}';\n\nexport const stamp = () => now();\n`,
    'test/fixed-clock.ts': "export const now = () => 'fixed';\n",
    'test/invoice.test.ts': `import { stamp } from '${testImport}';\n\ntest('stamps with the clock', () => expect(stamp()).toBe('fixed'));\n`,
  });

  it("fails a rewrite that leaves a moduleNameMapper stub behind, in a module outside the roots", async () => {
    const check = checkOf(await certifyFiles(
      files('src/billing/invoice.ts', '../clock', '../src/billing/invoice'),
      files('src/modules/billing/invoice.ts', '../../clock', '../src/modules/billing/invoice'),
      { only: ['K3b'], nodeModules: jestNodeModules },
    ), 'K3b');
    expect(check.status).toBe('fail');
    expect(check.violations.map((violation) => violation.file)).toEqual(['src/modules/billing/invoice.ts']);
    expect(check.violations[0]!.detail).toContain('moduleNameMapper stub base test/fixed-clock.ts, head unresolved');
  });
});

describe.skipIf(!installed(jestNodeModules, 'jest'))('K3b: the environment the test script sets', () => {
  // `"test": "NODE_PATH=src jest"`: jest-resolve looks bare specifiers up under src/. The probe ran without it, so
  // 'services/user' was unresolved on both sides (and K6 saw the test fail to load "in both").
  const files = (user: string) => ({
    'package.json': manifest({ private: true, scripts: { test: 'NODE_PATH=src jest' } }),
    'jest.config.cjs': "module.exports = { testEnvironment: 'node', transform: { '^.+\\\\.ts$': ['ts-jest', { diagnostics: false }] } };\n",
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true, types: [] }, include: ['src', 'test'] }),
    'test/globals.d.ts': requireDeclaration,
    [user]: "export const name = 'alice';\n",
    'test/user.test.ts': "const user = require('services/user');\n\ntest('finds the user', () => expect(user.name).toBe('alice'));\n",
  });

  it('fails a move that strands a bare specifier the test script\'s NODE_PATH resolves', async () => {
    const check = checkOf(await certifyFiles(files('src/services/user.ts'), files('src/modules/user/user.ts'), { only: ['K3b'], nodeModules: jestNodeModules }), 'K3b');
    expect(check.metrics).toMatchObject({ dangling: 1 });
    expect(check.violations.map((violation) => violation.file)).toEqual(['test/user.test.ts']);
    expect(check.violations[0]!.detail).toContain("site 0 'services/user' (require): base src/modules/user/user.ts, head unresolved");
  });
});

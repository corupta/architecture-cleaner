// K3c: resolution identity under the runtime, with Node itself and the target's own alias mechanism.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createContext } from '../../src/certificate/certify.js';
import { runtimeResolution } from '../../src/certificate/resolution-runtime.js';
import type { CheckResult } from '../../src/certificate/types.js';
import { listFixtures } from '../helpers.js';
import { type Tree, treeOf, twoCommits } from './two-commit-repo.js';

/**
 * Runs K3c on base -> head; `environment` is a checkout with node_modules (default: the repo, which has none unless
 * `install` puts some there after both commits).
 */
async function k3c(base: Tree, head: Tree, environment?: string, install?: (root: string) => void): Promise<CheckResult> {
  const repo = twoCommits(base, head, {}, install);
  const { context, cleanup } = createContext({
    repo: repo.root, base: repo.base, head: repo.head, packageRoot: '', environment: environment ?? repo.root, profile: null, oracles: false,
    workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ac-k3c-work-')), keep: false,
  });
  try {
    return await runtimeResolution.run(context);
  } finally {
    cleanup();
    fs.rmSync(repo.root, { recursive: true, force: true });
  }
}
const details = (outcome: CheckResult) => outcome.violations.map((violation) => `${violation.file ?? ''}: ${violation.detail}`);

const environments: string[] = [];
afterAll(() => {
  for (const root of environments) fs.rmSync(root, { recursive: true, force: true });
});
/** An environment checkout whose node_modules links real installed packages (skipped where they aren't installed). */
function environmentWith(packages: Record<string, string | undefined>): string | undefined {
  if (Object.values(packages).some((directory) => directory === undefined || !fs.existsSync(directory))) return undefined;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-k3c-env-'));
  environments.push(root);
  fs.mkdirSync(path.join(root, 'node_modules'));
  for (const [name, directory] of Object.entries(packages)) fs.symlinkSync(directory!, path.join(root, 'node_modules', name));
  return root;
}
const targets = path.join(os.homedir(), 'ac-targets');
const pnpmStore = path.join(targets, 'immich', 'node_modules', '.pnpm');
const tsconfigPaths = fs.existsSync(pnpmStore) ? fs.readdirSync(pnpmStore).find((entry) => entry.startsWith('tsconfig-paths@')) : undefined;
const tsconfigPathsEnvironment = environmentWith({ 'tsconfig-paths': tsconfigPaths && path.join(pnpmStore, tsconfigPaths, 'node_modules', 'tsconfig-paths') });
// tsx's own dependencies resolve from its real location (openhab-cloud's flat node_modules).
const tsxEnvironment = environmentWith({ tsx: path.join(targets, 'openhab-cloud', 'node_modules', 'tsx') });

const ghostfolio = path.join(targets, 'ghostfolio', 'node_modules');
const tsNodeEnvironment = environmentWith({ 'ts-node': path.join(ghostfolio, 'ts-node'), typescript: path.join(ghostfolio, 'typescript'), 'tsconfig-paths': tsconfigPaths && path.join(pnpmStore, tsconfigPaths, 'node_modules', 'tsconfig-paths') });
const immichServer = path.join(targets, 'immich', 'server', 'node_modules');
const nestEnvironment = environmentWith({ '@nestjs': path.join(immichServer, '@nestjs'), typescript: path.join(immichServer, 'typescript') });

const commonjsPackage = (scripts: Record<string, string>) => JSON.stringify({ name: 'target', version: '1.0.0', scripts });
const esmPackage = (scripts: Record<string, string>) => JSON.stringify({ name: 'target', version: '1.0.0', type: 'module', scripts });
const commonjs = (extra: object = {}) => JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', strict: true, outDir: 'dist', rootDir: 'src', ...extra }, include: ['src'] });
const nodenext = JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', strict: true, outDir: 'dist', rootDir: 'src' }, include: ['src'] });
const plainStart = { build: 'tsc', start: 'node dist/main.js' };

describe('K3c resolution identity under the runtime', () => {
  it('passes a correct relative move (ESM, nodenext)', async () => {
    const outcome = await k3c(
      { 'package.json': esmPackage(plainStart), 'tsconfig.json': nodenext, 'src/main.ts': "import { x } from './lib/x.js';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      { 'package.json': esmPackage(plainStart), 'tsconfig.json': nodenext, 'src/main.ts': "import { x } from './util/x.js';\nexport const main = x;\n", 'src/util/x.ts': 'export const x = 1;\n' },
    );
    expect(details(outcome)).toEqual([]);
    expect(outcome.status).toBe('pass');
    expect(outcome.metrics).toMatchObject({ runtimes: 'node/emit', files: 2, comparedSites: 1 });
  });

  it('passes a correct move of an importer whose runtime sites include require, import() and a builtin (CommonJS)', async () => {
    const main = (lib: string) => `import fs = require('fs');\nimport { x } from '${lib}/x';\nconst y = require('${lib}/y');\nexport const load = () => import('${lib}/x');\nexport const main = [fs, x, y];\n`;
    const outcome = await k3c(
      { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': commonjs(), 'src/main.ts': main('./lib'), 'src/lib/x.ts': 'export const x = 1;\n', 'src/lib/y.ts': 'export const y = 2;\n' },
      { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': commonjs(), 'src/app/main.ts': main('../lib'), 'src/lib/x.ts': 'export const x = 1;\n', 'src/lib/y.ts': 'export const y = 2;\n' },
    );
    expect(details(outcome)).toEqual([]);
    expect(outcome.metrics).toMatchObject({ comparedSites: 4 });
  });

  it('fails a relative -> tsconfig-paths alias rewrite when the runtime has no alias mechanism', async () => {
    const tsconfig = commonjs({ paths: { '@/*': ['./src/*'] } });
    const outcome = await k3c(
      { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from './lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from '@/lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
    );
    expect(outcome.status).toBe('fail');
    expect(details(outcome)).toEqual([
      "src/main.ts: node/emit: import '@/lib/x' resolves to unresolved (MODULE_NOT_FOUND), expected src/lib/x.ts; base src/main.ts './lib/x'",
      "src/main.ts: unknown runtime alias mechanism (head): '@/lib/x' reaches src/lib/x.ts through tsconfig paths/baseUrl, but node/emit has no alias layer and resolves it to unresolved (MODULE_NOT_FOUND)",
    ]);
  });

  it.skipIf(!tsconfigPathsEnvironment)('passes the same rewrite when the start script registers tsconfig-paths and the alias reaches the same file', async () => {
    const tsconfig = commonjs({ baseUrl: '.', paths: { '@/*': ['src/*'] } });
    const scripts = { build: 'tsc', start: 'node -r tsconfig-paths/register dist/main.js' };
    const outcome = await k3c(
      { 'package.json': commonjsPackage(scripts), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from './lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      { 'package.json': commonjsPackage(scripts), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from '@/lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      tsconfigPathsEnvironment,
    );
    expect(details(outcome)).toEqual([]);
    expect(outcome.metrics).toMatchObject({ runtimes: 'node/emit+tsconfig-paths', aliasSitesHead: 1 });
  });

  it.skipIf(!tsconfigPathsEnvironment)('fails it when the tsconfig tsconfig-paths reads maps the alias somewhere else', async () => {
    // TypeScript compiles src with tsconfig.app.json (@/ -> src/); tsconfig-paths/register reads tsconfig.json (@/ -> legacy/).
    const scripts = { build: 'tsc -p tsconfig.app.json', start: 'node -r tsconfig-paths/register dist/main.js' };
    const files = {
      'package.json': commonjsPackage(scripts),
      'tsconfig.json': JSON.stringify({ files: [], compilerOptions: { baseUrl: '.', paths: { '@/*': ['legacy/*'] } } }),
      'tsconfig.app.json': commonjs({ baseUrl: '.', paths: { '@/*': ['src/*'] } }),
      'src/lib/x.ts': 'export const x = 1;\n',
      'legacy/lib/x.js': 'exports.x = 0;\n',
    };
    const outcome = await k3c(
      { ...files, 'src/main.ts': "import { x } from './lib/x';\nexport const main = x;\n" },
      { ...files, 'src/main.ts': "import { x } from '@/lib/x';\nexport const main = x;\n" },
      tsconfigPathsEnvironment,
    );
    expect(details(outcome)).toEqual(["src/main.ts: node/emit+tsconfig-paths: import '@/lib/x' resolves to legacy/lib/x.js, expected src/lib/x.ts; base src/main.ts './lib/x'"]);
  });

  it.skipIf(!tsconfigPathsEnvironment)('reports an alias the runtime already maps elsewhere than TypeScript as a finding (pre-existing, not the step)', async () => {
    const tree = {
      'package.json': commonjsPackage({ build: 'tsc -p tsconfig.app.json', start: 'node -r tsconfig-paths/register dist/main.js' }),
      'tsconfig.json': JSON.stringify({ files: [], compilerOptions: { baseUrl: '.', paths: { '@/*': ['legacy/*'] } } }),
      'tsconfig.app.json': commonjs({ baseUrl: '.', paths: { '@/*': ['src/*'] } }),
      'src/main.ts': "import { x } from '@/lib/x';\nexport const main = x;\n",
      'src/lib/x.ts': 'export const x = 1;\n',
      'legacy/lib/x.js': 'exports.x = 0;\n',
    };
    const outcome = await k3c(tree, tree, tsconfigPathsEnvironment);
    expect(outcome.status).toBe('pass');
    expect(outcome.findings).toEqual([{ kind: 'runtime-typescript-disagreement', file: 'src/main.ts', detail: "node/emit+tsconfig-paths: import '@/lib/x' resolves to legacy/lib/x.js at runtime, src/lib/x.ts for TypeScript" }]);
  });

  it.skipIf(!tsNodeEnvironment)('resolves with ts-node and tsconfig-paths registered for a ts-node start script', async () => {
    const tsconfig = commonjs({ baseUrl: '.', paths: { '@/*': ['src/*'] } });
    const scripts = { start: 'ts-node -r tsconfig-paths/register src/main.ts' };
    const outcome = await k3c(
      { 'package.json': commonjsPackage(scripts), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from './lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      { 'package.json': commonjsPackage(scripts), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from '@/util/x';\nexport const main = x;\n", 'src/util/x.ts': 'export const x = 1;\n' },
      tsNodeEnvironment,
    );
    expect(details(outcome)).toEqual([]);
    expect(outcome.metrics).toMatchObject({ runtimes: 'ts-node/source+tsconfig-paths', aliasSitesHead: 1 });
  });

  it('fails a .d.ts moved without its .js: TypeScript still resolves the declaration, Node finds no implementation', async () => {
    const outcome = await k3c(
      { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': commonjs(), 'src/main.ts': "import { x } from './legacy/x';\nexport const main = x;\n", 'src/legacy/x.js': 'exports.x = 1;\n', 'src/legacy/x.d.ts': 'export declare const x: number;\n' },
      { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': commonjs(), 'src/main.ts': "import { x } from './types/x';\nexport const main = x;\n", 'src/legacy/x.js': 'exports.x = 1;\n', 'src/types/x.d.ts': 'export declare const x: number;\n' },
    );
    expect(details(outcome)).toEqual(["src/main.ts: node/emit: import './types/x' resolves to unresolved (MODULE_NOT_FOUND), expected src/legacy/x.js; base src/main.ts './legacy/x'"]);
  });

  it("fails an ESM specifier with '#': Node reads it as a URL fragment", async () => {
    const outcome = await k3c(
      { 'package.json': esmPackage(plainStart), 'tsconfig.json': nodenext, 'src/main.ts': "import { x } from './lib/x.js';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      { 'package.json': esmPackage(plainStart), 'tsconfig.json': nodenext, 'src/main.ts': "import { x } from './lib#2/x.js';\nexport const main = x;\n", 'src/lib#2/x.ts': 'export const x = 1;\n' },
    );
    expect(details(outcome)).toEqual(["src/main.ts: node/emit: import './lib#2/x.js' resolves to unresolved (ERR_MODULE_NOT_FOUND), expected src/lib#2/x.ts; base src/main.ts './lib/x.js'"]);
  });

  it("passes the same '#' path under CommonJS, where require takes it literally", async () => {
    const outcome = await k3c(
      { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': commonjs(), 'src/main.ts': "import { x } from './lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': commonjs(), 'src/main.ts': "import { x } from './lib#2/x';\nexport const main = x;\n", 'src/lib#2/x.ts': 'export const x = 1;\n' },
    );
    expect(details(outcome)).toEqual([]);
  });

  it('fails an extension-style change that TypeScript accepts but ESM Node cannot load', async () => {
    const bundler = JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true, outDir: 'dist', rootDir: 'src' }, include: ['src'] });
    const outcome = await k3c(
      { 'package.json': esmPackage(plainStart), 'tsconfig.json': bundler, 'src/main.ts': "import { x } from './lib/x.js';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      { 'package.json': esmPackage(plainStart), 'tsconfig.json': bundler, 'src/main.ts': "import { x } from './util/x';\nexport const main = x;\n", 'src/util/x.ts': 'export const x = 1;\n' },
    );
    expect(details(outcome)).toEqual(["src/main.ts: node/emit: import './util/x' resolves to unresolved (ERR_MODULE_NOT_FOUND), expected src/util/x.ts; base src/main.ts './lib/x.js'"]);
  });

  it('fails a move that flips the module format of the importer', async () => {
    const tsconfig = JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', strict: true }, include: ['src'] });
    const outcome = await k3c(
      { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from './x.js';\nexport const main = x;\n", 'src/x.ts': 'export const x = 1;\n', 'src/esm/package.json': '{ "type": "module" }\n' },
      { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': tsconfig, 'src/esm/main.ts': "import { x } from '../x.js';\nexport const main = x;\n", 'src/x.ts': 'export const x = 1;\n', 'src/esm/package.json': '{ "type": "module" }\n' },
    );
    expect(details(outcome)).toEqual(['src/esm/main.ts: node/emit: loaded as ESM, as CJS in base src/main.ts (its module format changed)']);
  });

  it('fails a moved file whose relative specifier was unresolved: it now points somewhere else', async () => {
    const outcome = await k3c(
      { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': commonjs(), 'src/main.ts': "export const load = () => require('./generated/schema');\n" },
      { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': commonjs(), 'src/app/main.ts': "export const load = () => require('./generated/schema');\n" },
    );
    expect(details(outcome)).toEqual(["src/app/main.ts: node/emit: require './generated/schema' is unresolved and relative, and its file moved from src/main.ts; base src/main.ts './generated/schema'"]);
  });

  it('fails a new file that shadows a directory index for an untouched importer', async () => {
    const base = { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': commonjs(), 'src/main.ts': "import { x } from './lib';\nexport const main = x;\n", 'src/lib/index.ts': 'export const x = 1;\n', 'src/other/lib.ts': 'export const x = 2;\n' };
    const { 'src/other/lib.ts': moved, ...unmoved } = base;
    const outcome = await k3c(base, { ...unmoved, 'src/lib.ts': moved });
    expect(details(outcome)).toEqual(["src/main.ts: node/emit: import './lib' resolves to src/lib.ts, expected src/lib/index.ts; base src/main.ts './lib'"]);
  });

  it.skipIf(!tsxEnvironment)('resolves tsconfig paths with the target tsx for a tsx start script', async () => {
    const tsconfig = commonjs({ paths: { '@/*': ['./src/*'] } });
    const scripts = { start: 'tsx src/main.ts' };
    const outcome = await k3c(
      { 'package.json': commonjsPackage(scripts), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from './lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      { 'package.json': commonjsPackage(scripts), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from '@/lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      tsxEnvironment,
    );
    expect(details(outcome)).toEqual([]);
    expect(outcome.metrics).toMatchObject({ runtimes: 'tsx/source' });
  });

  it.skipIf(!tsxEnvironment)('still fails that rewrite when the production start runs node on the emitted JavaScript', async () => {
    const tsconfig = commonjs({ paths: { '@/*': ['./src/*'] } });
    const scripts = { build: 'tsc', dev: 'tsx watch src/main.ts', start: 'node dist/main.js' };
    const outcome = await k3c(
      { 'package.json': commonjsPackage(scripts), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from './lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      { 'package.json': commonjsPackage(scripts), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from '@/lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      tsxEnvironment,
    );
    expect(outcome.metrics).toMatchObject({ runtimes: 'node/emit, tsx/source' });
    expect(details(outcome)).toEqual([
      "src/main.ts: node/emit: import '@/lib/x' resolves to unresolved (MODULE_NOT_FOUND), expected src/lib/x.ts; base src/main.ts './lib/x'",
      "src/main.ts: unknown runtime alias mechanism (head): '@/lib/x' reaches src/lib/x.ts through tsconfig paths/baseUrl, but node/emit has no alias layer and resolves it to unresolved (MODULE_NOT_FOUND)",
    ]);
  });

  describe.skipIf(!nestEnvironment)("Nest CLI build (the target's own @nestjs/cli tsconfig-paths hook)", () => {
    const files = {
      'package.json': esmPackage({ build: 'nest build', start: 'nest start' }),
      'nest-cli.json': JSON.stringify({ sourceRoot: 'src' }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', strict: true, outDir: 'dist', rootDir: '.', paths: { 'src/*': ['./src/*'] } }, include: ['src'] }),
      'src/app.module.ts': 'export const app = 1;\n',
    };
    const main = (service: string, module = './app.module.js') => `import { x } from '${service}';\nexport const load = () => import('${module}');\nexport const main = x;\n`;

    it('passes an alias-keeping move: the build rewrites both aliases to the same emitted file', async () => {
      const outcome = await k3c(
        { ...files, 'src/main.ts': main('src/services/x.service.js'), 'src/services/x.service.ts': 'export const x = 1;\n' },
        { ...files, 'src/main.ts': main('src/modules/x/x.service.js'), 'src/modules/x/x.service.ts': 'export const x = 1;\n' },
        nestEnvironment,
      );
      expect(details(outcome)).toEqual([]);
      expect(outcome.metrics).toMatchObject({ runtimes: 'nest-cli/emit', comparedSites: 2, rewrittenByBuild: 1 });
    });

    it('fails an alias in import(), which the hook leaves for Node to choke on', async () => {
      const outcome = await k3c(
        { ...files, 'src/main.ts': main('src/services/x.service.js'), 'src/services/x.service.ts': 'export const x = 1;\n' },
        { ...files, 'src/main.ts': main('src/services/x.service.js', 'src/app.module.js'), 'src/services/x.service.ts': 'export const x = 1;\n' },
        nestEnvironment,
      );
      expect(details(outcome)).toEqual(["src/main.ts: nest-cli/emit: dynamic-import 'src/app.module.js' resolves to unresolved (ERR_MODULE_NOT_FOUND), expected src/app.module.ts; base src/main.ts './app.module.js'"]);
    });
  });

  it('reports a base site the runtime cannot resolve but TypeScript can as a finding, not a violation', async () => {
    const base = { 'package.json': commonjsPackage(plainStart), 'tsconfig.json': commonjs(), 'src/main.ts': "import { T } from './types';\nexport const main = (t: T) => t;\n", 'src/types.d.ts': 'export interface T { a: number }\n' };
    const outcome = await k3c(base, base);
    expect(outcome.status).toBe('pass');
    expect(outcome.findings).toEqual([{ kind: 'runtime-unresolved', file: 'src/main.ts', detail: "node/emit: import './types' doesn't resolve at runtime (MODULE_NOT_FOUND); TypeScript resolves it to src/types.d.ts" }]);
  });
});

describe('K3c when nothing in the tree launches the package (plain Node stands in)', () => {
  it('still fails a break only Node sees', async () => {
    const outcome = await k3c(
      { 'tsconfig.json': commonjs(), 'src/main.ts': "import { x } from './legacy/x';\nexport const main = x;\n", 'src/legacy/x.js': 'exports.x = 1;\n', 'src/legacy/x.d.ts': 'export declare const x: number;\n' },
      { 'tsconfig.json': commonjs(), 'src/main.ts': "import { x } from './types/x';\nexport const main = x;\n", 'src/legacy/x.js': 'exports.x = 1;\n', 'src/types/x.d.ts': 'export declare const x: number;\n' },
    );
    expect(outcome.metrics).toMatchObject({ runtimes: 'node/emit (assumed)' });
    expect(details(outcome)).toEqual(["src/main.ts: node/emit (assumed): import './types/x' resolves to unresolved (MODULE_NOT_FOUND), expected src/legacy/x.js; base src/main.ts './legacy/x'"]);
  });

  it('fails a relative -> alias rewrite: no alias mechanism is identified', async () => {
    const tsconfig = commonjs({ paths: { '@/*': ['./src/*'] } });
    const outcome = await k3c(
      { 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from './lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      { 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from '@/lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
    );
    expect(details(outcome)).toEqual([
      "src/main.ts: node/emit (assumed): import '@/lib/x' resolves to unresolved (MODULE_NOT_FOUND), expected src/lib/x.ts; base src/main.ts './lib/x'",
      "src/main.ts: unknown runtime alias mechanism (head): '@/lib/x' reaches src/lib/x.ts through tsconfig paths/baseUrl, but node/emit (assumed) has no alias layer and resolves it to unresolved (MODULE_NOT_FOUND)",
    ]);
  });

  it("leaves base's own aliases and bundler-only specifiers to K3a: they may stay unresolved or reach map(TypeScript's target)", async () => {
    const tsconfig = JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true, paths: { '@/*': ['./src/*'] } }, include: ['src'] });
    const outcome = await k3c(
      { 'package.json': esmPackage({}), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from '@/lib/x';\nimport { y } from './lib/y';\nexport const main = [x, y];\n", 'src/lib/x.ts': 'export const x = 1;\n', 'src/lib/y.ts': 'export const y = 2;\n' },
      { 'package.json': esmPackage({}), 'tsconfig.json': tsconfig, 'src/main.ts': "import { x } from '@/util/x';\nimport { y } from './util/y';\nexport const main = [x, y];\n", 'src/util/x.ts': 'export const x = 1;\n', 'src/util/y.ts': 'export const y = 2;\n' },
    );
    expect(details(outcome)).toEqual([]);
    expect(outcome.metrics).toMatchObject({ runtimes: 'node/emit (assumed)', comparedSites: 2, deferredSites: 2, aliasSitesBase: 1, aliasSitesHead: 1 });
    expect(outcome.findings.map((finding) => finding.kind)).toEqual(['runtime-alias-mechanism-unknown']);
  });

  it("also stands in with Node's type stripping on the sources when the program emits nothing", async () => {
    const tsconfig = JSON.stringify({ compilerOptions: { module: 'nodenext', strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ['src'] });
    const outcome = await k3c(
      { 'package.json': esmPackage({}), 'tsconfig.json': tsconfig, 'src/main.ts': "import { v } from './a.ts';\nexport const main = v;\n", 'src/a.ts': 'export const v = 1;\n' },
      { 'package.json': esmPackage({}), 'tsconfig.json': tsconfig, 'src/main.ts': "import { v } from './c#/a.ts';\nexport const main = v;\n", 'src/c#/a.ts': 'export const v = 1;\n' },
    );
    expect(outcome.metrics).toMatchObject({ runtimes: 'node/emit (assumed), node/source (assumed)' });
    expect(details(outcome)).toEqual(["src/main.ts: node/source (assumed): import './c#/a.ts' resolves to unresolved (ERR_MODULE_NOT_FOUND), expected src/c#/a.ts; base src/main.ts './a.ts'"]);
  });

  it('follows a workspace link in the environment into the commit, not into the checkout', async () => {
    const files = { 'tsconfig.json': commonjs(), 'src/main.ts': "import { u } from 'a/util';\nexport const main = u;\n", 'a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }) };
    const outcome = await k3c(
      { ...files, 'a/util.ts': 'export const u = 1;\n' },
      { ...files, 'a/lib/util.ts': 'export const u = 1;\n' },
      undefined,
      (root) => {
        fs.mkdirSync(path.join(root, 'node_modules'));
        fs.symlinkSync('../a', path.join(root, 'node_modules', 'a'));
      },
    );
    expect(details(outcome)).toEqual(["src/main.ts: node/emit (assumed): import 'a/util' resolves to unresolved (MODULE_NOT_FOUND), expected a/lib/util.ts; base src/main.ts 'a/util'"]);
  });

  it('skips when the runtime that launches the package is not installed in the environment', async () => {
    const tree = { 'package.json': commonjsPackage({ start: 'tsx src/main.ts' }), 'tsconfig.json': commonjs(), 'src/main.ts': 'export const main = 1;\n' };
    const outcome = await k3c(tree, tree);
    expect(outcome.status).toBe('skip');
    expect(outcome.skipReason).toBe('no runtime could be modeled: tsx/source: tsx is not installed in the environment');
  });
});

describe('K3c compile context of the runtime', () => {
  it('fails a leaf module that moves into a scope of another module format', async () => {
    const outcome = await k3c(
      { 'package.json': esmPackage({ start: 'node src/main.js' }), 'src/main.js': "import { util } from './util.js';\nexport const main = util;\n", 'src/util.js': 'export const util = 1;\n', 'src/legacy/package.json': '{ "type": "commonjs" }\n' },
      { 'package.json': esmPackage({ start: 'node src/main.js' }), 'src/main.js': "import { util } from './legacy/util.js';\nexport const main = util;\n", 'src/legacy/util.js': 'export const util = 1;\n', 'src/legacy/package.json': '{ "type": "commonjs" }\n' },
    );
    expect(details(outcome)).toEqual(['src/legacy/util.js: node/emit: loaded as CJS, as ESM in base src/util.js (its module format changed)']);
  });

  it("reads a .js file's format the way Node detects it when no package.json sets a type", async () => {
    const outcome = await k3c(
      { 'package.json': JSON.stringify({ name: 'target', scripts: { start: 'node src/main.js' } }), 'src/main.js': "import { x } from './lib/x.js';\nexport const main = x;\n", 'src/lib/x.js': 'export const x = 1;\n' },
      { 'package.json': JSON.stringify({ name: 'target', scripts: { start: 'node src/main.js' } }), 'src/main.js': "import { x } from './lib#2/x.js';\nexport const main = x;\n", 'src/lib#2/x.js': 'export const x = 1;\n' },
    );
    expect(details(outcome)).toEqual(["src/main.js: node/emit: import './lib#2/x.js' resolves to unresolved (ERR_MODULE_NOT_FOUND), expected src/lib#2/x.js; base src/main.js './lib/x.js'"]);
  });

  it('fails a file that leaves the program the build compiles: the build no longer emits it', async () => {
    const scripts = { build: 'tsc -p tsconfig.build.json', start: 'node dist/main.js' };
    const files = { 'package.json': commonjsPackage(scripts), 'tsconfig.json': commonjs({ rootDir: '.' }), 'tsconfig.build.json': JSON.stringify({ extends: './tsconfig.json', include: ['src'] }) };
    const outcome = await k3c(
      { ...files, 'src/main.ts': "import { x } from './lib/x';\nexport const main = x;\n", 'src/lib/x.ts': 'export const x = 1;\n' },
      { ...files, 'src/main.ts': "import { x } from '../lib/x';\nexport const main = x;\n", 'lib/x.ts': 'export const x = 1;\n' },
    );
    expect(details(outcome)).toEqual(["lib/x.ts: node/emit: no longer in tsconfig.build.json's program, so the build doesn't emit it; base src/lib/x.ts was"]);
  });

  it('counts `import { type T }` as a runtime site under verbatimModuleSyntax (emitted as `import {} from`)', async () => {
    const tsconfig = (verbatimModuleSyntax: boolean) => JSON.stringify({ compilerOptions: { module: 'nodenext', strict: true, verbatimModuleSyntax }, include: ['src'] });
    const tree = (verbatim: boolean) => ({ 'package.json': esmPackage(plainStart), 'tsconfig.json': tsconfig(verbatim), 'src/main.ts': "import { type T } from './t.js';\nimport type { U } from './t.js';\nexport const main = (t: T, u: U) => [t, u];\n", 'src/t.ts': 'export type T = 1;\nexport type U = 2;\n' });
    expect((await k3c(tree(true), tree(true))).metrics).toMatchObject({ comparedSites: 1 });
    expect((await k3c(tree(false), tree(false))).metrics).toMatchObject({ comparedSites: 0 });
  });
});

describe('K3c on the executor fixtures', () => {
  const applied = listFixtures().filter((candidate) => candidate.expected.outcome === 'applied');
  for (const fixture of applied) {
    it(`does not fail ${fixture.name} (before -> after)`, async () => {
      const outcome = await k3c(treeOf(path.join(fixture.directory, 'before')), treeOf(path.join(fixture.directory, 'after')));
      expect(details(outcome)).toEqual([]);
      expect(outcome.status).not.toBe('fail');
    });
  }
  // With a start script that runs the emitted JavaScript, the fixtures Node can run (no aliases, no bundler resolution) pass.
  const runnable = applied.filter((fixture) => !/"(paths|baseUrl)"|"bundler"/.test(fs.readFileSync(path.join(fixture.directory, 'before', 'tsconfig.json'), 'utf8')));
  const withStart = (tree: Tree): Tree => {
    const manifest = typeof tree['package.json'] === 'string' ? JSON.parse(tree['package.json']) : { name: 'fixture' };
    return { ...tree, 'package.json': JSON.stringify({ ...manifest, scripts: { ...manifest.scripts, start: 'node dist/main.js' } }) };
  };
  it('has Node-runnable fixtures to certify', () => expect(runnable.map((fixture) => fixture.name)).toEqual(['ambient-references', 'assets-json', 'cjs-relative', 'nodenext-esm']));
  for (const fixture of runnable) {
    it(`passes ${fixture.name} under node on the emitted JavaScript`, async () => {
      const outcome = await k3c(withStart(treeOf(path.join(fixture.directory, 'before'))), withStart(treeOf(path.join(fixture.directory, 'after'))));
      expect(details(outcome)).toEqual([]);
      expect(outcome.status).toBe('pass');
      expect(outcome.metrics.comparedSites).toBeGreaterThan(0);
    });
  }
});

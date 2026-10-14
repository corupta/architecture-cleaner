// K3a and K0 hardening: red-team regressions (false passes and false fails found in review).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkEnvelope } from '../../src/certificate/envelope.js';
import { checkTypeScriptResolution } from '../../src/certificate/resolution-typescript.js';
import { type Tree, withContext } from './two-commit-repo.js';

const commonjs = JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true }, include: ['src'] });
const nodenext = JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', strict: true }, include: ['src'] });
const details = (outcome: { violations: { file?: string; detail: string }[] }) => outcome.violations.map((violation) => `${violation.file ?? ''}: ${violation.detail}`);
type Options = { installed?: Record<string, string>; install?: (root: string) => void; packageRoot?: string };
const k3a = (base: Tree, head: Tree, options: Options = {}) => withContext(base, head, (context) => checkTypeScriptResolution(context), options);
const k0 = (base: Tree, head: Tree, options: Options = {}) => withContext(base, head, (context) => checkEnvelope(context), options);

describe('K3a hardening: false passes', () => {
  it('fails an unresolved relative import of a generated module in a moved file', () => {
    const user = "import { client } from './generated/client';\nexport const user = client;\n";
    const outcome = k3a(
      { '.gitignore': 'generated\n', 'tsconfig.json': commonjs, 'src/services/user.ts': user },
      { '.gitignore': 'generated\n', 'tsconfig.json': commonjs, 'src/modules/user/user.ts': user },
    );
    expect(details(outcome)).toEqual(["src/modules/user/user.ts: line 1: unresolved import './generated/client' named src/services/generated/client, now src/modules/user/generated/client: an untracked or generated module at the old path is no longer reached"]);
  });

  it('keeps a virtual jest mock and the imports of its path moving together', () => {
    const jest = 'module.exports = {};\n';
    const test = "jest.mock('./virtual', () => ({ v: 1 }), { virtual: true });\nimport { v } from './virtual';\ntest('x', () => v);\n";
    const outcome = k3a({ 'tsconfig.json': commonjs, 'jest.config.js': jest, 'src/services/a.test.ts': test }, { 'tsconfig.json': commonjs, 'jest.config.js': jest, 'src/modules/a.test.ts': test });
    expect(details(outcome)).toEqual([]);
    expect(outcome.findings.map((finding) => finding.kind)).toEqual(['unresolved-relative-moved', 'unresolved-relative-moved']);
  });

  it('fails two files that swap paths under untouched importers', () => {
    const main = "import { a } from './a';\nexport const m = a;\n";
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n', 'src/main.ts': main },
      { 'tsconfig.json': commonjs, 'src/b.ts': 'export const a = 1;\n', 'src/a.ts': 'export const b = 2;\n', 'src/main.ts': main },
    );
    expect(details(outcome)).toEqual(["src/main.ts: line 1: import './a': expected file src/b.ts (typescript), got file src/a.ts (typescript)"]);
  });

  it('fails a stale jest.unstable_mockModule specifier', () => {
    const jest = 'export default { testEnvironment: "node" };\n';
    const test = (specifier: string, mock: string) => `import { jest } from '@jest/globals';\njest.unstable_mockModule('${mock}', () => ({ x: 2 }));\nconst { x } = await import('${specifier}');\nexport const t = x;\n`;
    const outcome = k3a(
      { 'package.json': '{ "type": "module" }', 'tsconfig.json': nodenext, 'jest.config.js': jest, 'src/x.ts': 'export const x = 1;\n', 'src/x.test.ts': test('./x.js', './x.js') },
      { 'package.json': '{ "type": "module" }', 'tsconfig.json': nodenext, 'jest.config.js': jest, 'src/lib/x.ts': 'export const x = 1;\n', 'src/x.test.ts': test('./lib/x.js', './x.js') },
    );
    expect(details(outcome)).toEqual(["src/x.test.ts: line 2: jest.unstable_mockModule './x.js': as a module path (TypeScript) expected file src/lib/x.ts, got unresolved"]);
  });

  it('fails a stale jest.setMock specifier', () => {
    const test = (specifier: string, mock: string) => `jest.setMock('${mock}', { x: 2 });\nimport { x } from '${specifier}';\nexport const t = x;\n`;
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'jest.config.js': 'module.exports = {};\n', 'src/x.ts': 'export const x = 1;\n', 'src/x.test.ts': test('./x', './x') },
      { 'tsconfig.json': commonjs, 'jest.config.js': 'module.exports = {};\n', 'src/lib/x.ts': 'export const x = 1;\n', 'src/x.test.ts': test('./lib/x', './x') },
    );
    expect(details(outcome)).toEqual(["src/x.test.ts: line 1: jest.setMock './x': expected file src/lib/x.ts (jest), got unresolved"]);
  });

  it('fails a vi.mock that starts to reach a file moved in under its old dangling path', () => {
    const vitest = 'export default { test: {} };\n';
    const test = "vi.mock('./x.js');\nexport const t = 1;\n";
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'vitest.config.ts': vitest, 'src/a.test.ts': test, 'src/lib/x.ts': 'export const x = 1;\n', 'src/b.ts': "export { x } from './lib/x';\n" },
      { 'tsconfig.json': commonjs, 'vitest.config.ts': vitest, 'src/a.test.ts': test, 'src/x.ts': 'export const x = 1;\n', 'src/b.ts': "export { x } from './x';\n" },
    );
    expect(details(outcome)).toEqual(["src/a.test.ts: line 1: vi.mock './x.js': expected unresolved, got file src/x.ts (vitest)"]);
  });

  it("fails a rewritten specifier with '?' in a CommonJS file that Vitest runs", () => {
    const base = { 'tsconfig.json': commonjs, 'src/x.ts': 'export const x = 1;\n', 'src/a.ts': "import { x } from './x';\nexport const a = x;\n" };
    const head = { 'tsconfig.json': commonjs, 'src/what?/x.ts': 'export const x = 1;\n', 'src/a.ts': "import { x } from './what?/x';\nexport const a = x;\n" };
    expect(details(k3a(base, head))).toEqual([]);
    const vitest = { 'vitest.config.ts': 'export default { test: {} };\n' };
    expect(details(k3a({ ...base, ...vitest }, { ...head, ...vitest })))
      .toEqual(["src/a.ts: form class changes: line 1: import './x' -> './what?/x': rewritten specifier contains '#', '?' or '%', which an ESM or Vite resolver reads as URL syntax"]);
  });

  it('fails a rewritten ESM specifier with an empty segment (a second module instance)', () => {
    const outcome = k3a(
      { 'package.json': '{ "type": "module" }', 'tsconfig.json': nodenext, 'src/x.ts': 'export const x = 1;\n', 'src/a.ts': "import { x } from './x.js';\nexport const a = x;\n" },
      { 'package.json': '{ "type": "module" }', 'tsconfig.json': nodenext, 'src/lib/x.ts': 'export const x = 1;\n', 'src/a.ts': "import { x } from './lib//x.js';\nexport const a = x;\n" },
    );
    expect(details(outcome)).toEqual(["src/a.ts: form class changes: line 1: import './x.js' -> './lib//x.js': rewritten specifier is not in normal form (empty, '.' or '..' segments inside the path)"]);
  });

  it('fails a test that moves under a different Jest config', () => {
    const configs = { 'jest.config.js': 'module.exports = { testEnvironment: "node" };\n', 'src/web/jest.config.js': 'module.exports = { testEnvironment: "jsdom" };\n' };
    const outcome = k3a(
      { 'tsconfig.json': commonjs, ...configs, 'src/web/a.test.ts': 'export const a = 1;\n' },
      { 'tsconfig.json': commonjs, ...configs, 'src/server/a.test.ts': 'export const a = 1;\n' },
    );
    expect(details(outcome)).toEqual(['src/server/a.test.ts: Jest config src/web/jest.config.js -> jest.config.js (moved from src/web/a.test.ts)']);
  });

  it('fails a moved file whose implicit tslib import reaches another node_modules', () => {
    const helpers = JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true, importHelpers: true }, include: ['src', 'legacy'] });
    const tslib = (version: string) => ({ [`${version}/node_modules/tslib/package.json`]: JSON.stringify({ name: 'tslib', version, main: 'tslib.js', types: 'tslib.d.ts' }), [`${version}/node_modules/tslib/tslib.js`]: '', [`${version}/node_modules/tslib/tslib.d.ts`]: 'export {};\n' });
    const installed = { ...tslib('src'), ...tslib('legacy') };
    const outcome = k3a(
      { '.gitignore': 'node_modules\n', 'tsconfig.json': helpers, 'src/a.ts': 'export class A {}\n', 'legacy/keep.ts': 'export {};\n' },
      { '.gitignore': 'node_modules\n', 'tsconfig.json': helpers, 'legacy/a.ts': 'export class A {}\n', 'legacy/keep.ts': 'export {};\n' },
      { installed },
    );
    expect(details(outcome)[0]).toBe('legacy/a.ts: node_modules lookup [src/node_modules] -> [legacy/node_modules] (moved from src/a.ts)');
    expect(details(outcome)[1]).toMatch(/^legacy\/a\.ts: implicit import 'tslib' \(importHelpers\): expected external .*\/src\/node_modules\/tslib\/tslib\.d\.ts \(typescript\), got external .*\/legacy\/node_modules\/tslib\/tslib\.d\.ts/);
  });
});

describe('K3a hardening: virtual modules and context', () => {
  const jest = 'module.exports = {};\n';

  it('does not let a virtual mock in a test excuse the production import of a generated module', () => {
    const service = "import { client } from './gen';\nexport const service = client;\n";
    const test = "jest.mock('./gen', () => ({ client: 1 }), { virtual: true });\nimport { service } from './service';\ntest('x', () => service);\n";
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'jest.config.js': jest, 'src/services/service.ts': service, 'src/services/service.test.ts': test },
      { 'tsconfig.json': commonjs, 'jest.config.js': jest, 'src/modules/service.ts': service, 'src/modules/service.test.ts': test },
    );
    expect(details(outcome)).toEqual(["src/modules/service.ts: line 1: unresolved import './gen' named src/services/gen, now src/modules/gen: an untracked or generated module at the old path is no longer reached"]);
  });

  it('fails a moved virtual mock whose module other files reach through a bare or aliased specifier', () => {
    const aliased = JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true, paths: { '@/*': ['./src/*'] } }, include: ['src'] });
    const test = "jest.mock('./gen', () => ({ client: 1 }), { virtual: true });\ntest('x', () => 1);\n";
    const user = "import { client } from '@/services/gen';\nexport const user = client;\n";
    const outcome = k3a(
      { 'tsconfig.json': aliased, 'jest.config.js': jest, 'src/services/a.test.ts': test, 'src/user.ts': user },
      { 'tsconfig.json': aliased, 'jest.config.js': jest, 'src/modules/a.test.ts': test, 'src/user.ts': user },
    );
    expect(details(outcome)).toEqual(["src/modules/a.test.ts: line 1: unresolved jest.mock './gen' named src/services/gen, now src/modules/gen: a virtual mock of a module that other sites reach without a relative path ('@/services/gen')"]);
  });

  it('fails a stale module.require', () => {
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'src/x.ts': 'export const x = 1;\n', 'src/a.ts': "export const a = module.require('./x');\n" },
      { 'tsconfig.json': commonjs, 'src/lib/x.ts': 'export const x = 1;\n', 'src/a.ts': "export const a = module.require('./x');\n" },
    );
    expect(details(outcome)).toEqual(["src/a.ts: line 1: require './x': expected file src/lib/x.ts (typescript), got unresolved"]);
  });

  it('fails a move under another nearest tsconfig.json (esbuild and Vite read the nearest one per file)', () => {
    const root = JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true }, include: ['src'] });
    const legacy = JSON.stringify({ compilerOptions: { experimentalDecorators: true }, files: [] });
    const outcome = k3a(
      { 'tsconfig.json': root, 'src/legacy/tsconfig.json': legacy, 'src/a.ts': 'export const a = 1;\n' },
      { 'tsconfig.json': root, 'src/legacy/tsconfig.json': legacy, 'src/legacy/a.ts': 'export const a = 1;\n' },
    );
    expect(details(outcome)).toEqual(['src/legacy/a.ts: nearest tsconfig.json tsconfig.json -> src/legacy/tsconfig.json (moved from src/a.ts)']);
  });

  it('fails a move into another node_modules lookup chain, even for packages the environment lacks', () => {
    const tsconfig = JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true }, include: ['packages'] });
    const optional = "let native: unknown;\ntry { native = require('pg-native'); } catch { native = null; }\nexport const db = native;\n";
    const outcome = k3a(
      { '.gitignore': 'node_modules\n', 'tsconfig.json': tsconfig, 'packages/a/db.ts': optional, 'packages/b/keep.ts': 'export {};\n' },
      { '.gitignore': 'node_modules\n', 'tsconfig.json': tsconfig, 'packages/b/db.ts': optional, 'packages/b/keep.ts': 'export {};\n' },
      { installed: { 'packages/a/node_modules/.keep': '', 'packages/b/node_modules/.keep': '' } },
    );
    expect(details(outcome)).toEqual(['packages/b/db.ts: node_modules lookup [packages/a/node_modules] -> [packages/b/node_modules] (moved from packages/a/db.ts)']);
  });
});

describe('K3a hardening: workspace links', () => {
  it('fails moves under a workspace link that dangles in the environment checkout', () => {
    const main = "import { util } from 'a/util';\nexport const main = util;\n";
    const outcome = k3a(
      { '.gitignore': 'node_modules\n', 'tsconfig.json': commonjs, 'a/util.ts': 'export const util = 1;\n', 'src/main.ts': main },
      { '.gitignore': 'node_modules\n', 'tsconfig.json': commonjs, 'packages/a/util.ts': 'export const util = 1;\n', 'src/main.ts': main },
      { install: (root) => {
        fs.mkdirSync(path.join(root, 'node_modules'));
        fs.symlinkSync('../a', path.join(root, 'node_modules/a'));
      } },
    );
    expect(details(outcome)).toEqual(['node_modules/a: links the workspace package a/, where 1 files moved (a/util.ts), but the link dangles in the environment checkout: resolution through it is not comparable']);
  });
});

describe('K3a hardening: false fails', () => {
  it('certifies a move inside a workspace package that the environment links into node_modules', () => {
    const base = { '.gitignore': 'node_modules\n', 'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true }, include: ['src', 'a'] }),
      'a/package.json': '{ "name": "a", "main": "index.ts" }', 'a/index.ts': "export { util } from './util';\n", 'a/util.ts': 'export const util = 1;\n', 'src/main.ts': "import { util } from 'a';\nexport const main = util;\n" };
    const head = { ...base, 'a/index.ts': "export { util } from './lib/util';\n", 'a/lib/util.ts': 'export const util = 1;\n' } as Tree;
    delete head['a/util.ts'];
    const install = (root: string) => {
      fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
      fs.symlinkSync('../a', path.join(root, 'node_modules/a'));
    };
    expect(details(k3a(base, head, { install }))).toEqual([]);
    const dropped = { ...head, 'a/index.ts': "export { util } from './util';\n" };
    expect(details(k3a(base, dropped, { install }))).toEqual(["a/index.ts: line 1: export './util': expected file a/lib/util.ts (typescript), got unresolved"]);
  });
});

describe('K0 hardening: false passes', () => {
  it('declines a change to tracked files under node_modules', () => {
    const base = { 'tsconfig.json': commonjs, 'src/node_modules/app/x.ts': 'export const x = 1;\n', 'src/a.ts': "import { x } from 'app/x';\nexport const a = x;\n" };
    const head = { 'tsconfig.json': commonjs, 'src/node_modules/app/y.ts': 'export const x = 1;\n', 'src/a.ts': "import { x } from 'app/x';\nexport const a = x;\n" };
    expect(details(k0(base, head))).toEqual([
      'src/node_modules/app/x.ts: tracked file under node_modules changes (moved to src/node_modules/app/y.ts): the certifier reads node_modules from the environment, not the commits',
    ]);
    expect(details(k0(base, base))).toEqual([]);
    const into = { 'tsconfig.json': commonjs, 'src/node_modules/app/x.ts': 'export const x = 1;\n', 'src/node_modules/app/y.ts': 'export const y = 1;\n', 'src/a.ts': "import { x } from 'app/x';\nexport const a = x;\n" };
    expect(details(k0({ ...base, 'src/y.ts': 'export const y = 1;\n' }, into))).toEqual([
      'src/node_modules/app/y.ts: tracked file under node_modules changes (moved from src/y.ts): the certifier reads node_modules from the environment, not the commits',
    ]);
  });

  it('declines a tracked symlink that points into a directory a moved file leaves or enters', () => {
    const app = "let user: unknown;\ntry { user = require('../lib/user'); } catch { user = null; }\nexport const app = user;\n";
    const base = { 'tsconfig.json': commonjs, 'lib': { link: 'src/modules' }, 'src/modules/keep.ts': 'export const keep = 1;\n', 'src/services/user.ts': 'export const user = 1;\n', 'src/app.ts': app };
    const head = { 'tsconfig.json': commonjs, 'lib': { link: 'src/modules' }, 'src/modules/keep.ts': 'export const keep = 1;\n', 'src/modules/user.ts': 'export const user = 1;\n', 'src/app.ts': app };
    expect(details(k0(base, head))).toEqual(['lib: tracked symlink to src/modules, which holds moved file src/modules/user.ts (head)']);
  });

  it('declines a tracked symlink to a moved file', () => {
    const base = { 'tsconfig.json': commonjs, 'bin/user.ts': { link: '../src/services/user.ts' }, 'src/services/user.ts': 'export const user = 1;\n' };
    const head = { 'tsconfig.json': commonjs, 'bin/user.ts': { link: '../src/modules/user.ts' }, 'src/modules/user.ts': 'export const user = 1;\n' };
    expect(details(k0(base, head))).toEqual([
      'bin/user.ts: tracked symlink to src/services/user.ts, which holds moved file src/services/user.ts (base)',
      'bin/user.ts: tracked symlink to src/modules/user.ts, which holds moved file src/modules/user.ts (head)',
    ]);
  });
});

// K3a: resolution identity under TypeScript, every program, plus the specifier form class.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTypeScriptResolution } from '../../src/certificate/resolution-typescript.js';
import { formChanges, matchPatternKey, specifierForm } from '../../src/certificate/specifier-form.js';
import type { ReferenceSite } from '../../src/analyzer/types.js';
import { listFixtures } from '../helpers.js';
import { type Tree, treeOf, withContext } from './two-commit-repo.js';

const commonjs = JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true }, include: ['src'] });
const nodenext = JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', strict: true }, include: ['src'] });
const aliased = JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true, paths: { '@/*': ['./src/*'] } }, include: ['src'] });

function k3a(base: Tree, head: Tree, installed?: Record<string, string>, install?: (root: string) => void) {
  return withContext(base, head, (context) => checkTypeScriptResolution(context), { ...(installed ? { installed } : {}), ...(install ? { install } : {}) });
}
const details = (outcome: { violations: { file?: string; detail: string }[] }) => outcome.violations.map((violation) => `${violation.file}: ${violation.detail}`);

describe('K3a resolution identity', () => {
  it('passes a clean move with its importers rewritten, and counts what it compared', () => {
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'src/a.ts': "import { b } from './b';\nexport const a = b;\n", 'src/b.ts': 'export const b = 1;\n' },
      { 'tsconfig.json': commonjs, 'src/a.ts': "import { b } from './lib/b';\nexport const a = b;\n", 'src/lib/b.ts': 'export const b = 1;\n' },
    );
    expect(details(outcome)).toEqual([]);
    expect(outcome.metrics).toMatchObject({ files: 2, sites: 1, rewrittenSpecifiers: 1 });
  });

  it('fails a retarget to a same-basename file', () => {
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'src/app.ts': "import { user } from './services/user';\nexport const app = user;\n", 'src/services/user.ts': 'export const user = 1;\n', 'src/billing/user.ts': 'export const user = 2;\n' },
      { 'tsconfig.json': commonjs, 'src/app.ts': "import { user } from './billing/user';\nexport const app = user;\n", 'src/modules/user/user.ts': 'export const user = 1;\n', 'src/billing/user.ts': 'export const user = 2;\n' },
    );
    expect(details(outcome)).toEqual(["src/app.ts: line 1: import './services/user' -> './billing/user': expected file src/modules/user/user.ts (typescript), got file src/billing/user.ts (typescript)"]);
  });

  it("fails when one importer's rewrite is dropped", () => {
    const base = { 'tsconfig.json': commonjs, 'src/a.ts': "import { b } from './b';\nexport const a = b;\n", 'src/c.ts': "export { b } from './b';\n", 'src/b.ts': 'export const b = 1;\n' };
    const outcome = k3a(base, { 'tsconfig.json': commonjs, 'src/a.ts': "import { b } from './lib/b';\nexport const a = b;\n", 'src/c.ts': "export { b } from './b';\n", 'src/lib/b.ts': 'export const b = 1;\n' });
    expect(details(outcome)).toEqual(["src/c.ts: line 1: export './b': expected file src/lib/b.ts (typescript), got unresolved"]);
  });

  it('fails a stale jest.mock specifier (resolved with the Jest model)', () => {
    const jest = 'module.exports = { testEnvironment: "node" };\n';
    const test = (specifier: string) => `import { user } from '${specifier}';\njest.mock('${specifier}');\ntest('x', () => user);\n`;
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'jest.config.js': jest, 'src/services/user.ts': 'export const user = 1;\n', 'src/user.test.ts': test('./services/user') },
      { 'tsconfig.json': commonjs, 'jest.config.js': jest, 'src/modules/user.ts': 'export const user = 1;\n', 'src/user.test.ts': "import { user } from './modules/user';\njest.mock('./services/user');\ntest('x', () => user);\n" },
    );
    expect(details(outcome)).toEqual(["src/user.test.ts: line 2: jest.mock './services/user': expected file src/modules/user.ts (jest), got unresolved"]);
  });

  it('fails a stale vi.mock that the Vite model leaves unresolved but TypeScript resolves', () => {
    const vitest = 'export default { test: {} };\n';
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'vitest.config.ts': vitest, 'src/x.ts': 'export const x = 1;\n', 'src/x.test.ts': "import { x } from './x.js';\nvi.mock('./x.js');\nexport const t = x;\n" },
      { 'tsconfig.json': commonjs, 'vitest.config.ts': vitest, 'src/lib/x.ts': 'export const x = 1;\n', 'src/x.test.ts': "import { x } from './lib/x.js';\nvi.mock('./x.js');\nexport const t = x;\n" },
    );
    expect(details(outcome)).toEqual(["src/x.test.ts: line 2: vi.mock './x.js': as a module path (TypeScript) expected file src/lib/x.ts, got unresolved"]);
  });

  it('fails relative -> alias at the same file (form class)', () => {
    const outcome = k3a(
      { 'tsconfig.json': aliased, 'src/user/service.ts': 'export const service = 1;\n', 'src/app/main.ts': "import { service } from '../user/service';\nexport const main = service;\n" },
      { 'tsconfig.json': aliased, 'src/user/service.ts': 'export const service = 1;\n', 'src/app/main.ts': "import { service } from '@/user/service';\nexport const main = service;\n" },
    );
    expect(details(outcome)).toEqual(["src/app/main.ts: form class changes: line 1: import '../user/service' -> '@/user/service': form relative -> paths:@/*"]);
  });

  it('passes an alias rewrite that keeps its key, and fails one that drops to relative', () => {
    const base = { 'tsconfig.json': aliased, 'src/services/user.ts': 'export const user = 1;\n', 'src/app/main.ts': "import { user } from '@/services/user';\nexport const main = user;\n" };
    const moved = { 'tsconfig.json': aliased, 'src/modules/user/user.ts': 'export const user = 1;\n' };
    expect(details(k3a(base, { ...moved, 'src/app/main.ts': "import { user } from '@/modules/user/user';\nexport const main = user;\n" }))).toEqual([]);
    expect(details(k3a(base, { ...moved, 'src/app/main.ts': "import { user } from '../modules/user/user';\nexport const main = user;\n" })))
      .toEqual(["src/app/main.ts: form class changes: line 1: import '@/services/user' -> '../modules/user/user': form paths:@/* -> relative"]);
  });

  it('fails a changed extension style at the same file', () => {
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'src/x.ts': 'export const x = 1;\n', 'src/a.ts': "import { x } from './x';\nexport const a = x;\n" },
      { 'tsconfig.json': commonjs, 'src/lib/x.ts': 'export const x = 1;\n', 'src/a.ts': "import { x } from './lib/x.js';\nexport const a = x;\n" },
    );
    expect(details(outcome)).toEqual([`src/a.ts: form class changes: line 1: import './x' -> './lib/x.js': ending "" -> ".js"`]);
  });

  it('fails a moved file that shadows an untouched importer\'s directory index', () => {
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'src/foo/index.ts': 'export const foo = 1;\n', 'src/other/foo.ts': 'export const other = 2;\n', 'src/app.ts': "import { foo } from './foo';\nexport const app = foo;\n" },
      { 'tsconfig.json': commonjs, 'src/foo/index.ts': 'export const foo = 1;\n', 'src/foo.ts': 'export const other = 2;\n', 'src/app.ts': "import { foo } from './foo';\nexport const app = foo;\n" },
    );
    expect(details(outcome)).toEqual(["src/app.ts: line 1: import './foo': expected file src/foo/index.ts (typescript), got file src/foo.ts (typescript)"]);
  });

  it("fails a case-mismatched specifier ('./User' for user.ts)", () => {
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'src/models/user.ts': 'export const user = 1;\n', 'src/app.ts': "import { user } from './models/user';\nexport const app = user;\n" },
      { 'tsconfig.json': commonjs, 'src/modules/user.ts': 'export const user = 1;\n', 'src/app.ts': "import { user } from './modules/User';\nexport const app = user;\n" },
    );
    expect(details(outcome)).toEqual(["src/app.ts: line 1: import './models/user' -> './modules/User': expected file src/modules/user.ts (typescript), got unresolved"]);
  });

  it('fails a program-set change', () => {
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'src/greet.ts': 'export const greet = 1;\n', 'tests/greet.test.ts': "import { greet } from '../src/greet';\nexport const t = greet;\n" },
      { 'tsconfig.json': commonjs, 'src/greet.ts': 'export const greet = 1;\n', 'src/greet.test.ts': "import { greet } from './greet';\nexport const t = greet;\n" },
    );
    expect(details(outcome)).toEqual(['src/greet.test.ts: tsconfig programs [] -> [tsconfig.json]']);
  });

  it('checks a file under every program that includes it', () => {
    // tsconfig.json maps @/* to src/, tsconfig.alt.json to alt/: under alt, the rewritten alias reaches a different file.
    const alt = JSON.stringify({ extends: './tsconfig.json', compilerOptions: { paths: { '@/*': ['./alt/*'] } }, include: ['src', 'alt'] });
    const shared = { 'tsconfig.json': aliased, 'tsconfig.alt.json': alt, 'alt/modules/user.ts': 'export const user = 3;\n', 'alt/services/user.ts': 'export const user = 4;\n' };
    const outcome = k3a(
      { ...shared, 'src/services/user.ts': 'export const user = 1;\n', 'src/main.ts': "import { user } from '@/services/user';\nexport const main = user;\n" },
      { ...shared, 'src/modules/user.ts': 'export const user = 1;\n', 'src/main.ts': "import { user } from '@/modules/user';\nexport const main = user;\n" },
    );
    expect(details(outcome)).toEqual(["src/main.ts: line 1: import '@/services/user' -> '@/modules/user': expected file alt/services/user.ts (typescript), got file alt/modules/user.ts (typescript) under tsconfig.alt.json"]);
    expect(outcome.metrics.multiProgramFiles).toBeGreaterThan(0);
  });

  it('fails a module format change', () => {
    const outcome = k3a(
      { 'package.json': '{}', 'tsconfig.json': nodenext, 'src/scripts/package.json': '{ "type": "module" }', 'src/date.ts': 'export const date = 1;\n' },
      { 'package.json': '{}', 'tsconfig.json': nodenext, 'src/scripts/package.json': '{ "type": "module" }', 'src/scripts/date.ts': 'export const date = 1;\n' },
    );
    expect(details(outcome)).toEqual(['src/scripts/date.ts: module format cjs -> esm (moved from src/date.ts)']);
  });

  it('keeps the ending style of a renamed target and fails a changed one', () => {
    const base = { 'package.json': '{ "type": "module" }', 'tsconfig.json': nodenext, 'src/user.service.ts': 'export const user = 1;\n', 'src/app.ts': "import { user } from './user.service.js';\nexport const app = user;\n" };
    const renamed = { 'package.json': '{ "type": "module" }', 'tsconfig.json': nodenext, 'src/user/service.ts': 'export const user = 1;\n' };
    expect(details(k3a(base, { ...renamed, 'src/app.ts': "import { user } from './user/service.js';\nexport const app = user;\n" }))).toEqual([]);
    expect(details(k3a(base, { ...renamed, 'src/app.ts': "import { user } from './user/service.ts';\nexport const app = user;\n" })).join('\n')).toMatch(/ending ".js" -> ".ts"/);
  });

  it('fails a changed directory-index style and a dropped trailing slash', () => {
    const base = { 'tsconfig.json': commonjs, 'src/users/index.ts': 'export const users = 1;\n', 'src/a.ts': "import { users } from './users';\nexport const a = users;\n", 'src/b.ts': "import { users } from './users/';\nexport const b = users;\n" };
    const outcome = k3a(base, {
      'tsconfig.json': commonjs, 'src/modules/users/index.ts': 'export const users = 1;\n',
      'src/a.ts': "import { users } from './modules/users/index';\nexport const a = users;\n", 'src/b.ts': "import { users } from './modules/users';\nexport const b = users;\n",
    });
    expect(details(outcome)).toEqual([
      "src/a.ts: form class changes: line 1: import './users' -> './modules/users/index': index style directory -> file",
      "src/b.ts: form class changes: line 1: import './users/' -> './modules/users': trailing slash dropped",
    ]);
  });

  it("fails a rewritten ESM specifier with '%'", () => {
    const outcome = k3a(
      { 'package.json': '{ "type": "module" }', 'tsconfig.json': nodenext, 'src/x.ts': 'export const x = 1;\n', 'src/a.ts': "import { x } from './x.js';\nexport const a = x;\n" },
      { 'package.json': '{ "type": "module" }', 'tsconfig.json': nodenext, 'src/50%off/x.ts': 'export const x = 1;\n', 'src/a.ts': "import { x } from './50%off/x.js';\nexport const a = x;\n" },
    );
    expect(details(outcome)).toEqual(["src/a.ts: form class changes: line 1: import './x.js' -> './50%off/x.js': rewritten specifier contains '#', '?' or '%', which an ESM or Vite resolver reads as URL syntax"]);
  });

  it('fails a rewritten bare package specifier that still reaches the same file', () => {
    const installed = { 'node_modules/pkg/package.json': '{ "name": "pkg", "main": "index.js" }', 'node_modules/pkg/index.js': 'exports.x = 1;\n', 'node_modules/pkg/index.d.ts': 'export declare const x: number;\n' };
    const tree = (specifier: string) => ({ '.gitignore': 'node_modules\n', 'tsconfig.json': commonjs, 'src/a.ts': `import { x } from '${specifier}';\nexport const a = x;\n` });
    const outcome = k3a(tree('pkg'), tree('pkg/index'), installed);
    expect(details(outcome)).toEqual(["src/a.ts: form class changes: line 1: import 'pkg' -> 'pkg/index': package specifier rewritten; index style directory -> file"]);
  });

  it('records an unresolved relative specifier in a moved file as a finding, and fails a split virtual module', () => {
    const jest = 'module.exports = {};\n';
    const mockTest = "jest.mock('./virtual', () => ({}), { virtual: true });\ntest('x', () => 1);\n";
    const user = "jest.mock('./virtual', () => ({}), { virtual: true });\nexport const user = 1;\n";
    const base = { 'tsconfig.json': commonjs, 'jest.config.js': jest, 'src/services/a.test.ts': mockTest };
    const alone = k3a(base, { 'tsconfig.json': commonjs, 'jest.config.js': jest, 'src/modules/a.test.ts': mockTest });
    expect(details(alone)).toEqual([]);
    expect(alone.findings.map((finding) => finding.kind)).toEqual(['unresolved-relative-moved']);
    const split = k3a({ ...base, 'src/services/user.ts': user }, { 'tsconfig.json': commonjs, 'jest.config.js': jest, 'src/modules/a.test.ts': mockTest, 'src/services/user.ts': user });
    expect(details(split)).toEqual([
      "src/modules/a.test.ts: line 1: unresolved jest.mock './virtual' named src/services/virtual like other sites in base; they now name src/modules/virtual, src/services/virtual",
      "src/services/user.ts: line 1: unresolved jest.mock './virtual' named src/services/virtual like other sites in base; they now name src/modules/virtual, src/services/virtual",
    ]);
  });

  it('fails a rootDirs-relative specifier rewritten into a physical path', () => {
    const rootDirs = JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true, rootDirs: ['src', 'generated'] }, include: ['src', 'generated'] });
    const outcome = k3a(
      { 'tsconfig.json': rootDirs, 'generated/b.ts': 'export const gen = 1;\n', 'src/a.ts': "import { gen } from './b';\nexport const main = gen;\n" },
      { 'tsconfig.json': rootDirs, 'generated/b.ts': 'export const gen = 1;\n', 'src/sub/a.ts': "import { gen } from '../../generated/b';\nexport const main = gen;\n" },
    );
    expect(details(outcome)).toEqual(["src/sub/a.ts: form class changes: line 1: import './b' -> '../../generated/b': form relative-indirect -> relative"]);
  });

  it('fails a moved typeRoots entry that a types directive needs', () => {
    const tsconfig = JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true, typeRoots: ['./typings'], types: ['env'] }, include: ['src'] });
    const outcome = k3a(
      { 'tsconfig.json': tsconfig, 'typings/env/index.d.ts': 'declare const ENV: string;\n', 'src/a.ts': 'export const a = ENV;\n' },
      { 'tsconfig.json': tsconfig, 'types/env/index.d.ts': 'declare const ENV: string;\n', 'src/a.ts': 'export const a = ENV;\n' },
    );
    expect(details(outcome)).toEqual(["tsconfig.json: type directive 'env': expected file types/env/index.d.ts (typescript), got unresolved"]);
    const referenced = k3a(
      { 'tsconfig.json': commonjs.replace('"strict":true', '"strict":true,"typeRoots":["./typings"]'), 'typings/env/index.d.ts': 'declare const ENV: string;\n', 'src/a.ts': '/// <reference types="env" />\nexport const a = ENV;\n' },
      { 'tsconfig.json': commonjs.replace('"strict":true', '"strict":true,"typeRoots":["./typings"]'), 'types/env/index.d.ts': 'declare const ENV: string;\n', 'src/a.ts': '/// <reference types="env" />\nexport const a = ENV;\n' },
    );
    expect(details(referenced)).toContain('src/a.ts: /// <reference types="env" />: expected file types/env/index.d.ts (typescript), got unresolved');
  });

  it('resolves through a workspace link into the commits, so a dropped deep-import rewrite fails', () => {
    const outcome = k3a(
      { '.gitignore': 'node_modules\n', 'tsconfig.json': commonjs, 'a/util.ts': 'export const util = 1;\n', 'src/main.ts': "import { util } from 'a/util';\nexport const main = util;\n" },
      { '.gitignore': 'node_modules\n', 'tsconfig.json': commonjs, 'a/lib/util.ts': 'export const util = 1;\n', 'src/main.ts': "import { util } from 'a/util';\nexport const main = util;\n" },
      { 'node_modules/.keep': '' },
      (root) => fs.symlinkSync('../a', path.join(root, 'node_modules/a')),
    );
    expect(details(outcome)).toEqual(["src/main.ts: line 1: import 'a/util': expected file a/lib/util.ts (typescript), got unresolved"]);
  });

  it('fails added and deleted source files', () => {
    const outcome = k3a(
      { 'tsconfig.json': commonjs, 'src/a.ts': "export const a = 1;\n", 'src/gone.ts': "import { a } from './a';\nexport const gone = a;\n" },
      { 'tsconfig.json': commonjs, 'src/a.ts': "export const a = 1;\n", 'src/copy/new.ts': "import { a } from '../a';\nexport const fresh = a + 1;\n" },
    );
    expect(details(outcome)).toEqual(['src/gone.ts: deleted: its 1 reference sites have no counterpart in head', 'src/copy/new.ts: added: its 1 reference sites have no counterpart in base']);
  });
});

describe('specifier form class', () => {
  const site = (specifier: string, extra: Partial<ReferenceSite> = {}): ReferenceSite => ({ kind: 'import', specifier, start: 0, end: specifier.length, typeOnly: false, ...extra });
  const runner = { jest: [], vitest: [], unreadable: [] };
  const form = (specifier: string, target: string, extra: Partial<ReferenceSite> = {}, options = {}) =>
    specifierForm(site(specifier, extra), { type: 'file', path: target, via: 'typescript' }, { file: 'src/a.ts', options, runner, root: '/repo', read: () => undefined });

  it('reads endings, index styles and mechanisms', () => {
    expect(form('./user.service.js', 'src/user.service.ts')).toEqual({ mechanism: 'relative', shape: 'file', ending: '.js', trailingSlash: false });
    expect(form('./users', 'src/users/index.ts')).toMatchObject({ shape: 'directory', ending: '' });
    expect(form('./users/index.js', 'src/users/index.ts')).toMatchObject({ shape: 'file', ending: '.js' });
    expect(form('./x.js', 'src/x.d.ts')).toMatchObject({ ending: '.js' });
    expect(form('./platform', 'src/platform.ios.ts')).toMatchObject({ ending: 'segment:platform' });
    expect(form('x.d.ts', 'src/x.d.ts', { kind: 'triple-slash' })).toMatchObject({ mechanism: 'relative' });
    expect(form('src/a/b.js', 'src/a/b.ts', {}, { paths: { 'src/*': ['./src/*'] } })).toMatchObject({ mechanism: 'paths:src/*' });
    expect(form('src/a/b', 'src/a/b.ts', {}, { baseUrl: '/repo' })).toMatchObject({ mechanism: 'base-url' });
    expect(form('@scope/pkg', 'packages/pkg/index.ts', {}, { baseUrl: '/repo' })).toMatchObject({ mechanism: 'package' });
    expect(matchPatternKey('@app/x/y', ['@app/*', '@app/x/*', '*'])).toBe('@app/x/*');
  });

  it('allows a directory specifier to name the file once the index is renamed away', () => {
    const forms = { before: form('./users', 'src/users/index.ts'), after: form('./users/users', 'src/users/users.ts') };
    expect(formChanges({ before: './users', after: './users/users', urlSyntax: false }, forms, { before: 'src/users/index.ts', after: 'src/users/users.ts' })).toEqual([]);
  });
});

describe('K3a on the applied executor fixtures', () => {
  for (const fixture of listFixtures().filter((candidate) => candidate.expected.outcome === 'applied')) {
    it(`passes ${fixture.name}`, () => {
      const outcome = k3a(treeOf(path.join(fixture.directory, 'before')), treeOf(path.join(fixture.directory, 'after')));
      expect(details(outcome)).toEqual([]);
      expect(outcome.metrics.rewrittenSpecifiers).toBeGreaterThan(0);
    });
  }
});

// K0: the support envelope (plan §2.5) over the package root, on both commits.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkEnvelope } from '../../src/certificate/envelope.js';
import { listFixtures } from '../helpers.js';
import { type Tree, treeOf, withContext } from './two-commit-repo.js';

const tsconfig = JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true }, include: ['src'] });
const user = 'export const user = 1;\n';
const app = (specifier: string) => `import { user } from '${specifier}';\nexport const app = user;\n`;
/** base: src/services/user.ts imported by src/app.ts; head: it moved to src/modules/user/user.ts. */
const move = (extraBase: Tree = {}, extraHead: Tree = extraBase): [Tree, Tree] => [
  { 'tsconfig.json': tsconfig, 'package.json': '{ "name": "target" }', 'src/app.ts': app('./services/user'), 'src/services/user.ts': user, ...extraBase },
  { 'tsconfig.json': tsconfig, 'package.json': '{ "name": "target" }', 'src/app.ts': app('./modules/user/user'), 'src/modules/user/user.ts': user, ...extraHead },
];

function k0([base, head]: [Tree, Tree], options: { packageRoot?: string; installed?: Record<string, string> } = {}) {
  return withContext(base, head, (context) => checkEnvelope(context), options);
}
const details = (outcome: { violations: { file?: string; detail: string }[] }) => outcome.violations.map((violation) => `${violation.file ?? ''}: ${violation.detail}`);

describe('K0 envelope', () => {
  it('passes a plain move and counts the sources', () => {
    const outcome = k0(move());
    expect(details(outcome)).toEqual([]);
    expect(outcome.metrics).toMatchObject({ moves: 1, baseTypeScriptFiles: 2, baseJavaScriptFiles: 0 });
  });

  it('declines a non-TS majority under the package root only', () => {
    const javascript = { 'src/a.js': 'exports.a = 1;\n', 'src/b.js': 'exports.b = 1;\n', 'src/c.cjs': 'exports.c = 1;\n' };
    expect(details(k0(move(javascript)))).toEqual([': non-TS majority: 3 JavaScript vs 2 TypeScript source files under the repo root']);
    const [base, head] = move();
    const nested = (tree: Tree) => Object.fromEntries([...Object.entries(tree).map(([file, text]) => [`server/${file}`, text]), ...Object.entries(javascript).map(([file, text]) => [`web/${file}`, text])]);
    expect(details(k0([nested(base), nested(head)], { packageRoot: 'server' }))).toEqual([]);
  });

  it('declines a nested package.json that sets type or imports over a moved file', () => {
    const scoped = { 'src/modules/package.json': '{ "type": "module" }' };
    expect(details(k0(move(scoped)))).toEqual(['src/modules/package.json: nested package.json sets type over src/modules/, which holds moved file src/modules/user/user.ts']);
    const imports = { 'src/services/package.json': '{ "imports": { "#db": "./db.js" } }' };
    expect(details(k0(move(imports)))).toEqual(['src/services/package.json: nested package.json sets imports over src/services/, which holds moved file src/services/user.ts']);
    expect(details(k0(move({ 'src/modules/package.json': '{ "name": "modules" }' })))).toEqual([]);
  });

  it('declines automock in any Jest config, setup code or script', () => {
    expect(details(k0(move({ 'jest.config.js': 'module.exports = { automock: true };\n' }))))
      .toEqual(['jest.config.js: Jest automock: true: with automock, whether a module is mocked depends on how it is reached']);
    expect(details(k0(move({ 'test/jest-e2e.json': '{ "projects": [{ "automock": true }] }' }))))
      .toEqual(['test/jest-e2e.json: Jest automock: true (in projects): with automock, whether a module is mocked depends on how it is reached']);
    expect(details(k0(move({ 'package.json': '{ "jest": { "automock": true }, "scripts": { "unit": "jest --automock" } }' }))))
      .toEqual(["package.json: script 'unit' runs Jest with --automock", 'package.json: Jest automock: true: with automock, whether a module is mocked depends on how it is reached']);
    expect(details(k0(move({ 'src/setup.ts': 'jest.enableAutomock();\nexport {};\n' })))).toEqual(['src/setup.ts: jest.enableAutomock() switches Jest automock on']);
    expect(details(k0(move({ 'jest.config.ts': 'export default { automock: false };\n' })))).toEqual([]);
  });

  it('declines a tracked symlink in a directory that holds a moved file', () => {
    expect(details(k0(move({ 'src/services/current': { link: 'user.ts' } }, { 'src/services/current': { link: 'user.ts' } }))))
      .toEqual(['src/services/current: tracked symlink in src/services, which holds a moved file']);
    expect(details(k0(move({ 'src/other/current': { link: 'x.ts' } })))).toEqual([]);
  });

  it('declines a moved file with a same-stem sibling of the other family', () => {
    expect(details(k0(move({ 'src/services/user.js': 'exports.user = 0;\n' }, { 'src/services/user.js': 'exports.user = 0;\n' }))))
      .toEqual(['src/services/user.ts: same-stem pair with src/services/user.js: TypeScript reads one, Node and Jest may load the other (base)']);
    expect(details(k0(move({}, { 'src/modules/user/user.jsx': 'export const user = 0;\n' }))))
      .toEqual(['src/modules/user/user.ts: same-stem pair with src/modules/user/user.jsx: TypeScript reads one, Node and Jest may load the other (head)']);
    expect(details(k0(move({ 'src/services/user.d.ts': 'export {};\n' }, { 'src/services/user.d.ts': 'export {};\n' })))).toEqual([]);
  });

  it('declines an unreadable runner config that governs a moved file or a mock of one', () => {
    const unreadable = 'module.exports = makeConfig();\n';
    expect(details(k0(move({ 'jest.config.js': unreadable }))))
      .toEqual(["jest.config.js: test runner config can't be read statically (no static config object) and governs src/modules/user/user.ts"]);
    const mocking = { 'tests/jest.config.js': unreadable, 'tests/user.test.ts': "jest.mock('../src/services/user');\n" };
    expect(details(k0(move(mocking, { ...mocking, 'tests/user.test.ts': "jest.mock('../src/modules/user/user');\n" }))))
      .toEqual(["tests/jest.config.js: test runner config can't be read statically (no static config object) and governs tests/user.test.ts"]);
  });

  it('widens an unreadable config to its package only when its runner is installed', () => {
    const frontend = { '.gitignore': 'node_modules\n', 'frontend/vite.config.ts': 'export default defineConfig(({ mode }) => {\n  return { root: mode };\n});\n' };
    expect(details(k0(move(frontend)))).toEqual([]);
    expect(details(k0(move(frontend), { installed: { 'node_modules/vitest/package.json': '{ "name": "vitest" }' } })))
      .toEqual(["frontend/vite.config.ts: test runner config can't be read statically (no static config object) and governs src/modules/user/user.ts"]);
  });

  it('declines a moved file outside the package root', () => {
    const [base, head] = move();
    const outcome = k0([{ ...base, 'server/package.json': '{}', 'server/src/main.ts': 'export {};\n' }, { ...head, 'server/package.json': '{}', 'server/src/main.ts': 'export {};\n' }], { packageRoot: 'server' });
    expect(details(outcome)).toEqual([
      'src/services/user.ts: moved file outside the package root server/ (src/services/user.ts -> src/modules/user/user.ts): the envelope, runner and oracles cover server/ only',
      'src/modules/user/user.ts: moved file outside the package root server/ (src/services/user.ts -> src/modules/user/user.ts): the envelope, runner and oracles cover server/ only',
    ]);
  });
});

describe('K0 on the applied executor fixtures', () => {
  for (const fixture of listFixtures().filter((candidate) => candidate.expected.outcome === 'applied')) {
    it(`passes ${fixture.name}`, () => {
      const outcome = k0([treeOf(path.join(fixture.directory, 'before')), treeOf(path.join(fixture.directory, 'after'))]);
      expect(details(outcome)).toEqual([]);
      expect(outcome.metrics.moves).toBeGreaterThan(0);
    });
  }
});

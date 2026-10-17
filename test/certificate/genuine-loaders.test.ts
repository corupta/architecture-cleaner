// K2's loader identity through re-exports: `vi` imported from a package the environment proves re-exports vitest's
// (kaneo's vite-plus/test) is the runner's own; anything unproven stays a violation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkByteSpans } from '../../src/certificate/byte-spans.js';
import { genuineReExports } from '../../src/certificate/genuine-loaders.js';
import { withContext } from './two-commit-repo.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** Writes files (relative path -> text) under a fresh directory, or under `root`. */
function install(files: Record<string, string>, root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-genuine-'))): string {
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}
const manifest = (fields: object) => JSON.stringify({ version: '1.0.0', ...fields });
const vitest = { 'node_modules/vitest/package.json': manifest({ name: 'vitest', type: 'module', exports: { '.': './index.js' } }), 'node_modules/vitest/index.js': 'export const vi = {};\n' };
// vite-plus 1.0.0-rc.1 as installed for kaneo: ./test is `export * from 'vitest'` (import) and `module.exports = require('vitest')` (require).
const vitePlusExports = { './test': { import: { types: './dist/test/index.d.ts', default: './dist/test/index.js' }, require: { types: './dist/test/index.d.cts', default: './dist/test/index.cjs' } } };
const vitePlus = (index = "export * from 'vitest';\n", cjs = "module.exports = require('vitest');\n") => ({
  'node_modules/vite-plus/package.json': manifest({ name: 'vite-plus', type: 'module', exports: vitePlusExports }),
  'node_modules/vite-plus/dist/test/index.js': index,
  'node_modules/vite-plus/dist/test/index.cjs': cjs,
  'node_modules/vite-plus/dist/test/index.d.ts': "export * from 'vitest';\n",
});
const genuine = { vi: new Set(['vitest']), jest: new Set(['@jest/globals']) };

describe('genuineReExports', () => {
  it("proves vite-plus/test re-exports vitest's vi under every condition of its exports", () => {
    const prove = genuineReExports(install({ ...vitest, ...vitePlus() }), genuine);
    expect(prove('vi', 'vite-plus/test', 'tests/api/a.test.ts')).toBe(true);
    expect(prove('vi', 'vitest', 'tests/a.test.ts')).toBe(true);
    // jest isn't what vitest exports, and a module of another name isn't the runner's.
    expect(prove('jest', 'vite-plus/test', 'tests/a.test.ts')).toBe(false);
    expect(prove('URL', 'vite-plus/test', 'tests/a.test.ts')).toBe(false);
  });

  it('follows named re-exports and files of the package, and packages installed nearer the importer', () => {
    const files = {
      ...vitest,
      'node_modules/kit/package.json': manifest({ name: 'kit', main: 'lib/index.js' }),
      'node_modules/kit/lib/index.js': "export { vi } from './runner.js';\nexport const helper = 1;\nexport default {};\n",
      'node_modules/kit/lib/runner.js': "export { vi, expect } from 'vitest';\n",
      'packages/web/node_modules/kit/package.json': manifest({ name: 'kit', main: 'index.js' }),
      'packages/web/node_modules/kit/index.js': 'export const vi = { mock() {} };\n',
    };
    const prove = genuineReExports(install(files), genuine);
    expect(prove('vi', 'kit', 'tests/a.test.ts')).toBe(true);
    expect(prove('vi', 'kit', 'packages/web/src/a.test.ts')).toBe(false);
  });

  it('proves nothing when a file defines or renames the name, a condition loads something else, or the package is missing', () => {
    const cases: Record<string, Record<string, string>> = {
      'defines its own vi next to the re-export': vitePlus("export * from 'vitest';\nexport const vi = { mock() {} };\n"),
      'renames another binding to vi': vitePlus("export { mocker as vi } from 'vitest';\n"),
      'another star export could supply vi': vitePlus("export * from 'vitest';\nexport * from './extra.js';\n"),
      'the require condition builds its own': vitePlus("export * from 'vitest';\n", "module.exports = { vi: { mock() {} } };\n"),
      'CommonJS that patches what it re-exports': vitePlus("export * from 'vitest';\n", "module.exports = require('vitest');\nmodule.exports.vi = {};\n"),
    };
    for (const [name, files] of Object.entries(cases)) {
      const extra: Record<string, string> = name.startsWith('another star') ? { 'node_modules/vite-plus/dist/test/extra.js': 'export const vi = {};\n' } : {};
      expect([name, genuineReExports(install({ ...vitest, ...files, ...extra }), genuine)('vi', 'vite-plus/test', 'tests/a.test.ts')]).toEqual([name, false]);
    }
    expect(genuineReExports(install(vitest), genuine)('vi', 'vite-plus/test', 'tests/a.test.ts')).toBe(false);
    const pattern = { 'node_modules/vite-plus/package.json': manifest({ name: 'vite-plus', exports: { './*': './dist/*/index.js' } }), 'node_modules/vite-plus/dist/test/index.js': "export * from 'vitest';\n" };
    expect(genuineReExports(install({ ...vitest, ...pattern }), genuine)('vi', 'vite-plus/test', 'tests/a.test.ts')).toBe(false);
  });
});

describe('K2 loader identity through a re-export', () => {
  // kaneo's tests/api: vi from vite-plus/test, its vi.mock path rewritten with the move.
  const test = (target: string) => `import { describe, it, vi } from 'vite-plus/test';\nvi.mock('${target}');\ndescribe('a', () => it('loads', () => undefined));\n`;
  const service = 'export const service = 1;\n';
  const base = { 'tests/api/a.test.ts': test('../../src/project/service'), 'src/project/service.ts': service };
  const head = { 'tests/api/a.test.ts': test('../../src/services/project.service'), 'src/services/project.service.ts': service };
  const k2 = (install?: (root: string) => void) => withContext(base, head, (context) => checkByteSpans(context).violations.map((violation) => `${violation.file}: ${violation.detail}`), install ? { install } : {});

  it("accepts the rewritten vi.mock when the environment proves vite-plus/test is vitest's vi", () => {
    expect(k2((root) => install({ ...vitest, ...vitePlus() }, root))).toEqual([]);
  });

  it('keeps the violation when nothing proves it: no node_modules, or a vite-plus/test that defines its own vi', () => {
    const violation = "tests/api/a.test.ts: line 2: vi.mock('../../src/services/project.service') calls the 'vi' declared on line 1, not the module loader: '../../src/services/project.service' isn't a specifier relative to this file";
    expect(k2()).toEqual([violation]);
    expect(k2((root) => install({ ...vitest, ...vitePlus("export * from 'vitest';\nexport const vi = { mock() {} };\n") }, root))).toEqual([violation]);
  });
});

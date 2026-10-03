// One test per bug confirmed by the S3 adversarial hunt (docs/sessions/s3.md, addendum). Each builds a minimal
// repo inline and asserts the exact rewritten specifier or the decline the contract now requires.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitRepoFs } from '../src/analyzer/repo-fs.js';
import { executeMove, type MoveResult } from '../src/executor/execute.js';
import { materialize, typecheck } from './helpers.js';

type Tree = Record<string, string | Buffer>;

function repoFrom(tree: Tree, untracked: Tree = {}): string {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-regression-src-'));
  for (const [file, content] of Object.entries(tree)) {
    fs.mkdirSync(path.dirname(path.join(staging, file)), { recursive: true });
    fs.writeFileSync(path.join(staging, file), content);
  }
  const root = materialize(staging, 'regression');
  for (const [file, content] of Object.entries(untracked)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

function move(root: string, moves: Record<string, string>): MoveResult {
  return executeMove(gitRepoFs(root), new Map(Object.entries(moves)));
}

const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const codes = (result: MoveResult) => (result.outcome === 'declined' ? [...new Set(result.declines.map((decline) => decline.code))].sort() : [result.outcome]);
const cjs = (extra: object = {}) => JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', strict: true, types: [], ...extra }, include: ['src'] });

describe('specifier forms', () => {
  it('SF-1 writes a paths key suffix once', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({ paths: { '@x/*.js': ['./src/x/*'] } }),
      'src/x/foo.ts': 'export const foo = 1;\n',
      'src/main.ts': "import { foo } from '@x/foo.js';\nexport const main = foo;\n",
    });
    expect(codes(move(root, { 'src/x/foo.ts': 'src/x/bar.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/main.ts')).toBe("import { foo } from '@x/bar.js';\nexport const main = foo;\n");
  });

  it('SF-2 keeps a trailing slash, even next to a same-named file', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'src/lib/index.ts': 'export const fromIndex = 1;\n',
      'src/lib.ts': 'export const fromFile = 2;\n',
      'src/main.ts': "import { fromIndex } from './lib/';\nexport const main = fromIndex;\n",
    });
    expect(codes(move(root, { 'src/main.ts': 'src/app/main.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/app/main.ts')).toContain("from '../lib/'");
    expect(typecheck(root)).toEqual([]);
  });

  it('SF-3 spells the file when a directory index is renamed away from index', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'src/users/index.ts': 'export const users = [];\n',
      'src/main.ts': "import { users } from './users';\nexport const main = users;\n",
    });
    expect(codes(move(root, { 'src/users/index.ts': 'src/users/users.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/main.ts')).toContain("from './users/users'");
    expect(typecheck(root)).toEqual([]);
  });

  it('SF-4 declines a relative specifier that resolved through rootDirs', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({ rootDirs: ['src', 'generated'] }).replace('"include":["src"]', '"include":["src","generated"]'),
      'generated/b.ts': 'export const b = 1;\n',
      'src/a.ts': "import { b } from './b';\nexport const a = b;\n",
    });
    expect(codes(move(root, { 'src/a.ts': 'src/nested/a.ts' }))).toEqual(['unsupported-specifier']);
  });

  it('SF-5 rewrites an extensionless JSON require', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'src/globals.d.ts': 'declare function require(id: string): unknown;\n',
      'src/config/data.json': '{ "port": 1 }\n',
      'src/app.ts': "const data = require('./config/data');\nexport default data;\n",
    });
    expect(codes(move(root, { 'src/app.ts': 'src/platform/app.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/platform/app.ts')).toContain("require('../config/data')");
  });

  it('SF-6 keeps a moduleSuffixes spelling', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({ moduleSuffixes: ['.ios', ''] }),
      'src/platform.ios.ts': 'export const platform = "ios";\n',
      'src/app.ts': "import { platform } from './platform';\nexport const app = platform;\n",
    });
    expect(codes(move(root, { 'src/app.ts': 'src/modules/app.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/modules/app.ts')).toContain("from '../platform'");
    expect(typecheck(root)).toEqual([]);
  });

  it('MSF-6 declines an ESM specifier that would contain a URL-significant character', () => {
    const root = repoFrom({
      'package.json': '{ "type": "module" }\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', strict: true, types: [] }, include: ['src'] }),
      'src/util.ts': 'export const util = 1;\n',
      'src/main.ts': "import { util } from './util.js';\nexport const main = util;\n",
    });
    expect(codes(move(root, { 'src/util.ts': 'src/c#/util.ts' }))).toEqual(['unsupported-specifier']);
  });
});

describe('reference kinds', () => {
  it('RK-01/RK-02/MSF-1 co-moves a .js with its sibling .d.ts (either side requested)', () => {
    for (const requested of ['src/greet.js', 'src/greet.d.ts']) {
      const root = repoFrom({
        'tsconfig.json': cjs({ allowJs: true }),
        'src/greet.js': 'exports.greet = () => "hi";\n',
        'src/greet.d.ts': 'export declare function greet(): string;\n',
        'src/main.ts': "import { greet } from './greet';\nexport const main = greet();\n",
      });
      const result = move(root, { [requested]: requested.replace('src/', 'src/lib/') });
      expect(codes(result)).toEqual(['applied']);
      expect(fs.existsSync(path.join(root, 'src/lib/greet.js')) && fs.existsSync(path.join(root, 'src/lib/greet.d.ts'))).toBe(true);
      expect(read(root, 'src/main.ts')).toContain("from './lib/greet'");
    }
  });

  it('RK-03 rewrites a relative /// <reference types> directive', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'src/types/env.d.ts': 'declare const APP_ENV: string;\n',
      'src/app.ts': '/// <reference types="./types/env" />\nexport const env = APP_ENV;\n',
    });
    expect(codes(move(root, { 'src/app.ts': 'src/platform/app.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/platform/app.ts')).toBe('/// <reference types="../types/env" />\nexport const env = APP_ENV;\n');
    expect(typecheck(root)).toEqual([]);
  });

  it('RK-04 rewrites JSDoc @import and import() types in checkJs files', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({ allowJs: true, checkJs: true }),
      'src/models/user.ts': 'export interface User { name: string }\n',
      'src/view.js': "/** @import { User } from './models/user' */\n/** @param {User} user @param {import('./models/user').User} other */\nexports.view = (user, other) => user.name + other.name;\n",
    });
    expect(codes(move(root, { 'src/models/user.ts': 'src/modules/user/user.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/view.js')).toContain("@import { User } from './modules/user/user'");
    expect(read(root, 'src/view.js')).toContain("import('./modules/user/user')");
    expect(typecheck(root)).toEqual([]);
  });

  it('RK-05 rewrites a declare module augmentation written through a paths alias', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({ baseUrl: '.', paths: { '@app/*': ['src/*'] } }),
      'src/models/user.ts': 'export interface User { name: string }\n',
      'src/augment.ts': "import '@app/models/user';\ndeclare module '@app/models/user' {\n  interface User { nickname?: string }\n}\nexport {};\n",
      'src/main.ts': "import type { User } from '@app/models/user';\nexport const nick = (user: User) => user.nickname;\n",
    });
    expect(codes(move(root, { 'src/models/user.ts': 'src/modules/user/user.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/augment.ts')).toContain("declare module '@app/modules/user/user'");
    expect(typecheck(root)).toEqual([]);
  });

  it('RK-06 treats import.meta.resolve in a moved file as location-sensitive', () => {
    const root = repoFrom({
      'package.json': '{ "type": "module" }\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', types: [] }, include: ['src'] }),
      'src/worker.ts': "export const worker = import.meta.resolve('./task.js');\n",
      'src/task.ts': 'export const task = 1;\n',
    });
    expect(codes(move(root, { 'src/worker.ts': 'src/jobs/worker.ts' }))).toEqual(['location-sensitive']);
  });
});

describe('move set and filesystem', () => {
  it('MSF-2 declines moving a global declaration file', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'src/types/globals.d.ts': 'declare const VERSION: string;\n',
      'src/main.ts': 'export const version = VERSION;\n',
    });
    expect(codes(move(root, { 'src/types/globals.d.ts': 'src/platform/globals.d.ts' }))).toEqual(['ambient-declaration']);
  });

  it('MSF-3 moves a file whose basename is near NAME_MAX', () => {
    const name = `${'a'.repeat(245)}.ts`;
    const root = repoFrom({
      'tsconfig.json': cjs(),
      [`src/${name}`]: 'export const long = 1;\n',
      'src/main.ts': `import { long } from './${name.slice(0, -3)}';\nexport const main = long;\n`,
    });
    expect(codes(move(root, { [`src/${name}`]: `src/lib/${name}` }))).toEqual(['applied']);
    expect(fs.existsSync(path.join(root, '.ac-move'))).toBe(false);
  });

  it('MSF-4 declines editing a file that is not valid UTF-8', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'src/util.ts': 'export const util = 1;\n',
      'src/main.ts': Buffer.concat([Buffer.from("import { util } from './util';\n// "), Buffer.from([0xff, 0xfe]), Buffer.from('\nexport const main = util;\n')]),
    });
    expect(codes(move(root, { 'src/util.ts': 'src/lib/util.ts' }))).toEqual(['unsupported-encoding']);
  });

  it('MSF-5 declines moving a tracked symlink', () => {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-regression-link-'));
    fs.mkdirSync(path.join(staging, 'src'));
    fs.writeFileSync(path.join(staging, 'tsconfig.json'), cjs());
    fs.writeFileSync(path.join(staging, 'src/real.ts'), 'export const real = 1;\n');
    fs.symlinkSync('real.ts', path.join(staging, 'src/alias.ts'));
    const root = materialize(staging, 'link');
    expect(codes(move(root, { 'src/alias.ts': 'src/lib/alias.ts' }))).toContain('symlink');
  });
});

describe('semantic preservation', () => {
  it('SEM-1 declines moving an asset declaration away from its asset', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'src/button.css': '.button {}\n',
      'src/button.css.d.ts': 'declare const styles: Record<string, string>;\nexport default styles;\n',
      'src/main.ts': "import styles from './button.css';\nexport const main = styles;\n",
    });
    expect(codes(move(root, { 'src/button.css.d.ts': 'src/ui/button.css.d.ts' }))).toEqual(['split-pair']);
  });

  it('SEM-2 declines a move that switches which node_modules copy a package loads from', () => {
    const root = repoFrom(
      { 'tsconfig.json': cjs(), '.gitignore': 'node_modules/\n', 'src/main.ts': "import dep from 'dep';\nexport const main = dep;\n" },
      { 'node_modules/dep/index.js': 'module.exports = 1;\n', 'src/nested/node_modules/dep/index.js': 'module.exports = 2;\n' },
    );
    expect(codes(move(root, { 'src/main.ts': 'src/nested/main.ts' }))).toEqual(['package-resolution-change']);
  });

  it('SEM-3 declines moving a test out of the Jest roots', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'jest.config.js': "module.exports = { roots: ['<rootDir>/src'] };\n",
      'src/sum.ts': 'export const sum = (a: number, b: number) => a + b;\n',
      'src/sum.test.ts': "import { sum } from './sum';\nexport const check = sum(1, 2);\n",
    });
    expect(codes(move(root, { 'src/sum.test.ts': 'tests/sum.test.ts' }))).toContain('test-runner-scope');
  });

  it('SEM-4 declines moving an entry whose emitted path package.json names', () => {
    const root = repoFrom({
      'package.json': '{ "main": "dist/index.js" }\n',
      'tsconfig.json': cjs({ rootDir: 'src', outDir: 'dist' }),
      'src/index.ts': 'export const index = 1;\n',
    });
    expect(codes(move(root, { 'src/index.ts': 'src/app/index.ts' }))).toEqual(['config-reference']);
  });

  it('SEM-6 declines a move that changes the extension', () => {
    const root = repoFrom({ 'tsconfig.json': cjs(), 'src/view.ts': 'export const view = 1;\n' });
    expect(codes(move(root, { 'src/view.ts': 'src/view.tsx' }))).toEqual(['extension-change']);
  });
});

// Round 2 (fix variants, multi-config repos, JS and mixed-module repos).
const esm = (extra: object = {}) => JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', strict: true, types: [], ...extra }, include: ['src'] });

describe('round 2: specifier forms', () => {
  it('MC-1 handles ${configDir} paths substitutions', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({ paths: { '@/*': ['${configDir}/src/*'] } }),
      'src/a.ts': 'export const a = 1;\n',
      'src/main.ts': "import { a } from '@/a';\nexport const main = a;\n",
    });
    expect(codes(move(root, { 'src/a.ts': 'src/lib/a.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/main.ts')).toContain("from '@/lib/a'");
  });

  it('B11 keeps a paths substitution suffix (src/modules/*/index)', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({ baseUrl: '.', paths: { '@mod/*': ['src/modules/*/index'] } }),
      'src/modules/user/index.ts': 'export const user = 1;\n',
      'src/main.ts': "import { user } from '@mod/user';\nexport const main = user;\n",
    });
    expect(codes(move(root, { 'src/modules/user/index.ts': 'src/modules/account/index.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/main.ts')).toContain("from '@mod/account'");
    expect(typecheck(root)).toEqual([]);
  });

  it('B12 keeps a directory form whose index carries a moduleSuffix', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({ moduleSuffixes: ['.ios', ''] }),
      'src/core/platform/index.ios.ts': 'export const platform = "ios";\n',
      'src/main.ts': "import { platform } from './core/platform';\nexport const main = platform;\n",
    });
    expect(codes(move(root, { 'src/core/platform/index.ios.ts': 'src/shared/platform/index.ios.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/main.ts')).toContain("from './shared/platform'");
  });

  it('B10 keeps an arbitrary-extension asset import (x.d.css.ts declares ./x.css)', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({ allowArbitraryExtensions: true }),
      'src/ui/x.css': '.x {}\n',
      'src/ui/x.d.css.ts': 'declare const styles: Record<string, string>;\nexport default styles;\n',
      'src/ui/button.ts': "import styles from './x.css';\nexport const button = styles;\n",
    });
    expect(codes(move(root, { 'src/ui/button.ts': 'src/modules/ui/button.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/modules/ui/button.ts')).toContain("from '../../ui/x.css'");
  });

  it('JSM-9 rewrites require(..) aimed at a repo-root index', () => {
    const root = repoFrom({
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', allowJs: true, types: [] }, include: ['.'] }),
      'index.js': 'module.exports = 1;\n',
      'test/a.js': "const app = require('..');\nmodule.exports = app;\n",
    });
    expect(codes(move(root, { 'test/a.js': 'test/unit/a.js' }))).toEqual(['applied']);
    expect(read(root, 'test/unit/a.js')).toContain("require('../..')");
  });

  it('B04/JSM-4 checks URL-significant characters in import() from a CJS file', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'src/util.ts': 'export const util = 1;\n',
      'src/main.ts': "export const load = () => import('./util');\n",
    });
    expect(codes(move(root, { 'src/util.ts': 'src/c#/util.ts' }))).toEqual(['unsupported-specifier']);
  });
});

describe('round 2: reference kinds', () => {
  it('B02 rewrites new URL(..., import.meta.url) in a file that stays', () => {
    const root = repoFrom({
      'package.json': '{ "type": "module" }\n',
      'tsconfig.json': esm({ lib: ['es2022', 'dom'] }),
      'src/main.ts': "export const worker = new URL('./task.ts', import.meta.url);\n",
      'src/task.ts': 'export const task = 1;\n',
    });
    expect(codes(move(root, { 'src/task.ts': 'src/jobs/task.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/main.ts')).toContain("new URL('./jobs/task.ts', import.meta.url)");
  });

  it('B03 treats computed import.meta access in a moved file as location-sensitive', () => {
    const root = repoFrom({
      'package.json': '{ "type": "module" }\n',
      'tsconfig.json': esm(),
      'src/where.ts': "const meta = import.meta;\nexport const here = meta['url'];\n",
    });
    expect(codes(move(root, { 'src/where.ts': 'src/lib/where.ts' }))).toEqual(['location-sensitive']);
  });

  it('JSM-5 scans extensionless node scripts (bin/www)', () => {
    const root = repoFrom({
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', allowJs: true, types: [] }, include: ['.'] }),
      'app.js': 'module.exports = {};\n',
      'bin/www': "#!/usr/bin/env node\nconst app = require('../app');\nmodule.exports = app;\n",
    });
    expect(codes(move(root, { 'app.js': 'src/app.js' }))).toEqual(['applied']);
    expect(read(root, 'bin/www')).toContain("require('../src/app')");
  });
});

describe('round 2: declines', () => {
  it('B01/JSM-1 declines an explicit split of a .js/.d.ts pair', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({ allowJs: true }),
      'src/greet.js': 'exports.greet = () => "hi";\n',
      'src/greet.d.ts': 'export declare function greet(): string;\n',
    });
    expect(codes(move(root, { 'src/greet.js': 'src/a/greet.js', 'src/greet.d.ts': 'src/b/greet.d.ts' }))).toEqual(['split-pair']);
  });

  it('JSM-8 declines moving one side of a same-stem .ts/.js pair (plan §2.5)', () => {
    const root = repoFrom({ 'tsconfig.json': cjs(), 'src/x.ts': 'export const x = 1;\n', 'src/x.js': 'exports.x = 1;\n' });
    expect(codes(move(root, { 'src/x.ts': 'src/lib/x.ts' }))).toContain('split-pair');
  });

  it('B14 declines moving an arbitrary-extension declaration away from its asset', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({ allowArbitraryExtensions: true }),
      'src/x.css': '.x {}\n',
      'src/x.d.css.ts': 'declare const styles: Record<string, string>;\nexport default styles;\n',
    });
    expect(codes(move(root, { 'src/x.d.css.ts': 'src/ui/x.d.css.ts' }))).toContain('split-pair');
  });

  it('B05 declines when a single-file nested package would be picked up', () => {
    const root = repoFrom(
      { 'tsconfig.json': cjs(), '.gitignore': 'node_modules/\nnode_modules\n', 'src/main.ts': "import dep from 'dep';\nexport const main = dep;\n" },
      { 'node_modules/dep/index.js': 'module.exports = 1;\n', 'src/nested/node_modules/dep.js': 'module.exports = 2;\n' },
    );
    expect(codes(move(root, { 'src/main.ts': 'src/nested/main.ts' }))).toEqual(['package-resolution-change']);
  });

  it('B06/JSM-6 reads the Jest test scope from package.json', () => {
    const root = repoFrom({
      'package.json': JSON.stringify({ jest: { roots: ['<rootDir>/src'] } }),
      'tsconfig.json': cjs(),
      'src/sum.test.ts': 'export const check = 1;\n',
    });
    expect(codes(move(root, { 'src/sum.test.ts': 'tests/sum.test.ts' }))).toContain('test-runner-scope');
  });

  it('MC-5 honours testPathIgnorePatterns', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'jest.config.js': "module.exports = { testPathIgnorePatterns: ['/fixtures/'] };\n",
      'src/sum.test.ts': 'export const check = 1;\n',
    });
    expect(codes(move(root, { 'src/sum.test.ts': 'src/fixtures/sum.test.ts' }))).toContain('test-runner-scope');
  });

  it('MC-4/B07 checks every Jest config in a monorepo, not just the last', () => {
    const root = repoFrom({
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', types: [] }, include: ['packages'] }),
      'packages/a/jest.config.js': "module.exports = { roots: ['<rootDir>/src'] };\n",
      'packages/b/jest.config.js': "module.exports = { roots: ['<rootDir>/src'] };\n",
      'packages/a/src/x.test.ts': 'export const check = 1;\n',
    });
    expect(codes(move(root, { 'packages/a/src/x.test.ts': 'packages/a/other/x.test.ts' }))).toContain('test-runner-scope');
  });

  it('JSM-7 declines when a Jest config is mutated after its declaration', () => {
    const root = repoFrom({
      'tsconfig.json': cjs(),
      'jest.config.js': "const config = {};\nconfig.roots = ['<rootDir>/src'];\nmodule.exports = config;\n",
      'src/a.ts': 'export const a = 1;\n',
    });
    expect(codes(move(root, { 'src/a.ts': 'src/lib/a.ts' }))).toEqual(['unreadable-runner-config']);
  });

  it('MC-2 declines a file whose programs resolve differently', () => {
    const root = repoFrom({
      'tsconfig.json': cjs({ baseUrl: '.', paths: { '@/*': ['src/*'] } }),
      'tsconfig.alt.json': cjs({ baseUrl: '.', paths: { '@/*': ['alt/*'] } }),
      'src/a.ts': 'export const a = 1;\n',
      'alt/a.ts': 'export const a = 2;\n',
      'src/main.ts': "import { a } from '@/a';\nexport const main = a;\n",
    });
    // Under tsconfig.json '@/a' is src/a.ts (moves, so it becomes '@/lib/a'); under tsconfig.alt.json it is
    // alt/a.ts, which '@/lib/a' would no longer reach.
    expect(codes(move(root, { 'src/a.ts': 'src/lib/a.ts' }))).toEqual(['multi-program-file']);
  });

  it('MC-6/B08 sees emitted paths with rootDir unset (TS 5 common source directory)', () => {
    const root = repoFrom({
      'package.json': '{ "main": "dist/commands/run.js" }\n',
      'tsconfig.json': cjs({ outDir: 'dist' }),
      'src/commands/run.ts': 'export const run = 1;\n',
      'src/lib/util.ts': 'export const util = 1;\n',
    });
    expect(codes(move(root, { 'src/commands/run.ts': 'src/cli/run.ts' }))).toEqual(['config-reference']);
  });

  it('MC-7 does not match a config key that equals a flat file stem', () => {
    const root = repoFrom({
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', types: [] }, include: ['*.ts', 'src'] }),
      'types.ts': 'export type Id = string;\n',
      'src/main.ts': "import type { Id } from '../types';\nexport const id: Id = 'x';\n",
    });
    expect(codes(move(root, { 'types.ts': 'src/types.ts' }))).toEqual(['applied']);
    expect(read(root, 'src/main.ts')).toContain("from './types'");
  });

  it('JSM-2 treats package.json "main": "./lib" as a reference to lib/index.js', () => {
    const root = repoFrom({
      'package.json': '{ "main": "./lib" }\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', allowJs: true, types: [] }, include: ['lib', 'src'] }),
      'lib/index.js': 'module.exports = 1;\n',
    });
    expect(codes(move(root, { 'lib/index.js': 'src/index.js' }))).toEqual(['config-reference']);
  });

  it('JSM-3 reads a package.json "type" behind a BOM', () => {
    const root = repoFrom({
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', types: [] }, include: ['src', 'esm'] }),
      'src/a.ts': 'export const a = 1;\n',
      'esm/package.json': '﻿{ "type": "module" }\n',
    });
    expect(codes(move(root, { 'src/a.ts': 'esm/a.ts' }))).toContain('module-format-change');
  });
});

describe('round 2: workspaces', () => {
  it('MC-3 sees through a workspace symlink and declines rewriting a bare package path', () => {
    const root = repoFrom({
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', types: [] }, include: ['packages'] }),
      '.gitignore': 'node_modules\n',
      'packages/a/package.json': '{ "name": "a" }\n',
      'packages/a/src/util.ts': 'export const util = 1;\n',
      'packages/b/src/main.ts': "import { util } from 'a/src/util';\nexport const main = util;\n",
    });
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.symlinkSync('../packages/a', path.join(root, 'node_modules/a'));
    const result = move(root, { 'packages/a/src/util.ts': 'packages/a/src/lib/util.ts' });
    expect(result.outcome).toBe('declined');
    expect(codes(result)).toContain('alias-escape');
  });
});

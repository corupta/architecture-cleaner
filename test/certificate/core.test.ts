// The certifier's core: committed-tree reading, pathMap inference, K1 move-set integrity, K2 byte-span confinement.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkByteSpans } from '../../src/certificate/byte-spans.js';
import { createContext } from '../../src/certificate/certify.js';
import { commitRepoFs } from '../../src/certificate/commit-fs.js';
import { checkEnvelope } from '../../src/certificate/envelope.js';
import { readCommitTree } from '../../src/certificate/git-tree.js';
import { dockerIgnored, dockerPatterns } from '../../src/certificate/ignore-files.js';
import { checkMoveSet } from '../../src/certificate/move-set-integrity.js';
import type { CertifyContext } from '../../src/certificate/types.js';

type Tree = Record<string, string | Buffer | { link: string } | { text: string; mode: '100755' }>;

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function writeTree(root: string, tree: Tree) {
  for (const entry of fs.readdirSync(root)) if (entry !== '.git') fs.rmSync(path.join(root, entry), { recursive: true, force: true });
  for (const [file, content] of Object.entries(tree)) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (typeof content === 'object' && 'link' in content) fs.symlinkSync(content.link, absolute);
    else if (typeof content === 'object' && 'mode' in content) {
      fs.writeFileSync(absolute, content.text);
      fs.chmodSync(absolute, 0o755);
    } else fs.writeFileSync(absolute, content);
  }
}

/** A git repo with `base` committed, then `head` committed on top. */
function twoCommits(base: Tree, head: Tree, { force = false } = {}): { root: string; base: string; head: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-core-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'core@ac.invalid');
  git(root, 'config', 'user.name', 'core');
  git(root, 'config', 'core.autocrlf', 'false');
  writeTree(root, base);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'base');
  const baseCommit = git(root, 'rev-parse', 'HEAD');
  writeTree(root, head);
  git(root, 'add', '-A', ...(force ? ['-f'] : []));
  git(root, 'commit', '-q', '--allow-empty', '-m', 'head');
  return { root, base: baseCommit, head: git(root, 'rev-parse', 'HEAD') };
}

function contextFor(base: Tree, head: Tree, force = false): { context: CertifyContext; cleanup(): void } {
  const repo = twoCommits(base, head, { force });
  return createContext({
    repo: repo.root, base: repo.base, head: repo.head, packageRoot: '', environment: repo.root, profile: null, oracles: false,
    workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ac-core-work-')), keep: false,
  });
}

function withContext<T>(base: Tree, head: Tree, body: (context: CertifyContext) => T, force = false): T {
  const { context, cleanup } = contextFor(base, head, force);
  try {
    return body(context);
  } finally {
    cleanup();
  }
}

const tsconfig = JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true }, include: ['src'] });

describe('pathMap inference', () => {
  it('pairs a moved file with its edited importers and keeps unchanged files', () => {
    withContext(
      { 'tsconfig.json': tsconfig, 'src/a.ts': "import { b } from './b';\nexport const a = b;\n", 'src/b.ts': 'export const b = 1;\n', 'src/c.ts': 'export const c = 2;\n' },
      { 'tsconfig.json': tsconfig, 'src/a.ts': "import { b } from './lib/b';\nexport const a = b;\n", 'src/lib/b.ts': 'export const b = 1;\n', 'src/c.ts': 'export const c = 2;\n' },
      ({ pathMap }) => {
        expect(Object.fromEntries(pathMap.moves)).toEqual({ 'src/b.ts': 'src/lib/b.ts' });
        expect(pathMap.map('src/a.ts')).toBe('src/a.ts');
        expect(pathMap.added).toEqual([]);
        expect(pathMap.deleted).toEqual([]);
      },
    );
  });

  it('matches a file that moved and had its own specifiers rewritten', () => {
    withContext(
      { 'src/x/a.ts': "import { b } from '../b';\nexport const a = b;\n", 'src/b.ts': 'export const b = 1;\n' },
      { 'src/y/z/a.ts': "import { b } from '../../b';\nexport const a = b;\n", 'src/b.ts': 'export const b = 1;\n' },
      ({ pathMap }) => expect(Object.fromEntries(pathMap.moves)).toEqual({ 'src/x/a.ts': 'src/y/z/a.ts' }),
    );
  });

  it('reports copies as additions and keeps the original in place', () => {
    withContext(
      { 'src/a.ts': 'export const a = 1;\n' },
      { 'src/a.ts': 'export const a = 1;\n', 'src/features/a.ts': 'export const a = 1;\n' },
      ({ pathMap }) => {
        expect(pathMap.moves.size).toBe(0);
        expect(pathMap.added).toEqual([{ path: 'src/features/a.ts', copyOf: 'src/a.ts' }]);
      },
    );
  });

  it('pairs identical files by basename, then by path similarity', () => {
    withContext(
      { 'src/users/index.ts': "export * from './user';\n", 'src/users/user.ts': 'export const user = 1;\n', 'src/teams/index.ts': "export * from './team';\n", 'src/teams/team.ts': 'export const team = 1;\n' },
      { 'src/modules/users/index.ts': "export * from './user';\n", 'src/modules/users/user.ts': 'export const user = 1;\n', 'src/modules/teams/index.ts': "export * from './team';\n", 'src/modules/teams/team.ts': 'export const team = 1;\n' },
      ({ pathMap }) => {
        expect(pathMap.map('src/users/index.ts')).toBe('src/modules/users/index.ts');
        expect(pathMap.map('src/teams/index.ts')).toBe('src/modules/teams/index.ts');
      },
    );
  });

  it('pairs identical barrels by where the rest of their directory went, even into renamed directories', () => {
    const barrel = "export * from './service';\n";
    withContext(
      { 'src/users/index.ts': barrel, 'src/users/service.ts': 'export const users = 1;\n', 'src/teams/index.ts': barrel, 'src/teams/service.ts': 'export const teams = 1;\n' },
      { 'src/modules/account/index.ts': barrel, 'src/modules/account/service.ts': 'export const users = 1;\n', 'src/modules/group/index.ts': barrel, 'src/modules/group/service.ts': 'export const teams = 1;\n' },
      ({ pathMap }) => {
        expect(pathMap.map('src/users/index.ts')).toBe('src/modules/account/index.ts');
        expect(pathMap.map('src/teams/index.ts')).toBe('src/modules/group/index.ts');
        expect(pathMap.ambiguous).toHaveLength(1);
      },
    );
  });

  it('infers a swap of two files whose importers were rewritten', () => {
    withContext(
      { 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n', 'src/main.ts': "import { a } from './a';\nimport { b } from './b';\nexport const sum = a + b;\n" },
      { 'src/b.ts': 'export const a = 1;\n', 'src/a.ts': 'export const b = 2;\n', 'src/main.ts': "import { a } from './b';\nimport { b } from './a';\nexport const sum = a + b;\n" },
      ({ pathMap }) => expect(Object.fromEntries(pathMap.moves)).toEqual({ 'src/a.ts': 'src/b.ts', 'src/b.ts': 'src/a.ts' }),
    );
  });

  it('keeps a file edited beyond its specifiers at its path (K2 reports it) instead of calling it deleted', () => {
    withContext(
      { 'src/a.ts': 'export const a = 1;\n' },
      { 'src/a.ts': 'export const a = 2;\n' },
      ({ pathMap }) => {
        expect(pathMap.map('src/a.ts')).toBe('src/a.ts');
        expect(pathMap.deleted).toEqual([]);
      },
    );
  });
});

describe('committed-tree file system', () => {
  it('reads committed content only, never the working tree', () => {
    const repo = twoCommits({ 'src/a.ts': 'export const a = 1;\n' }, { 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' });
    fs.writeFileSync(path.join(repo.root, 'src/a.ts'), 'dirty');
    fs.writeFileSync(path.join(repo.root, 'src/untracked.ts'), 'untracked');
    const shadow = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-core-shadow-'));
    const baseFs = commitRepoFs(readCommitTree(repo.root, repo.base), shadow);
    expect(baseFs.read('src/a.ts')).toBe('export const a = 1;\n');
    expect(baseFs.read('src/b.ts')).toBeUndefined();
    expect(baseFs.fileExists(path.join(shadow, 'src/untracked.ts'))).toBe(false);
    expect(baseFs.tracked()).toEqual(['src/a.ts']);
    expect(baseFs.directoryExists(path.join(shadow, 'src'))).toBe(true);
    expect(baseFs.entries(path.join(shadow, 'src')).files).toEqual(['a.ts']);
  });
});

describe('K0 on bytes the analyzer reads', () => {
  it('declines a UTF-16 source file: TypeScript decodes it by its byte order mark, the analyzer sees none of its imports', () => {
    const utf16 = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    const user = utf16("import { config } from '../config';\nexport const user = () => config;\n");
    const config = 'export const config = 1;\n';
    const outcome = withContext({ 'src/config.ts': config, 'src/services/user.ts': user }, { 'src/config.ts': config, 'src/modules/user/user.ts': user }, (context) => checkEnvelope(context));
    expect(outcome.violations).toEqual([
      { file: 'src/services/user.ts', detail: 'encoded as UTF-16: TypeScript reads it, the certifier reads UTF-8 and sees none of its references (base)' },
      { file: 'src/modules/user/user.ts', detail: 'encoded as UTF-16: TypeScript reads it, the certifier reads UTF-8 and sees none of its references (head)' },
    ]);
  });
});

describe('K1 move-set integrity', () => {
  const violations = (base: Tree, head: Tree) => withContext(base, head, (context) => checkMoveSet(context).violations.map((violation) => violation.detail));

  it('passes a clean move', () => {
    expect(violations({ 'src/a.ts': 'export const a = 1;\n' }, { 'src/lib/a.ts': 'export const a = 1;\n' })).toEqual([]);
  });

  it('rejects additions, deletions and copies', () => {
    expect(violations({ 'src/a.ts': 'export const a = 1;\n' }, { 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const a = 1;\n' }))
      .toEqual(['added: a copy of src/a.ts, which still exists']);
    expect(violations({ 'src/a.ts': 'export const a = 1;\n', 'src/z.ts': 'export const z = 1;\n' }, { 'src/a.ts': 'export const a = 1;\n' }))
      .toEqual(['deleted: no file in head has its content (modulo specifiers)']);
  });

  it('rejects case-only renames and extension changes', () => {
    expect(violations({ 'src/User.ts': 'export const u = 1;\n' }, { 'src/user.ts': 'export const u = 1;\n' })).toEqual(['case-only rename to src/user.ts']);
    expect(violations({ 'src/a.ts': 'export const a = 1;\n' }, { 'src/a.tsx': 'export const a = 1;\n' })[0]).toMatch(/extension changes/);
  });

  it('rejects a lost exec bit', () => {
    expect(violations({ 'bin/cli.js': { text: '#!/usr/bin/env node\n', mode: '100755' } }, { 'tools/cli.js': '#!/usr/bin/env node\n' }))
      .toEqual(['mode 100755 -> 100644 at tools/cli.js']);
  });

  it('rejects a module moved without its manual mock, and a snapshot left behind', () => {
    expect(violations(
      { 'src/user.ts': 'export const u = 1;\n', 'src/__mocks__/user.ts': 'export const u = 2;\n' },
      { 'src/users/user.ts': 'export const u = 1;\n', 'src/__mocks__/user.ts': 'export const u = 2;\n' },
    )).toEqual(['manual mock of src/user.ts should be at src/users/__mocks__/user.ts, is at src/__mocks__/user.ts']);
    expect(violations(
      { 'src/a.test.ts': "it('x', () => {});\n", 'src/__snapshots__/a.test.ts.snap': 'exports[`x 1`] = `1`;\n' },
      { 'test/a.test.ts': "it('x', () => {});\n", 'src/__snapshots__/a.test.ts.snap': 'exports[`x 1`] = `1`;\n' },
    )).toEqual(['snapshot of src/a.test.ts should be at test/__snapshots__/a.test.ts.snap, is at src/__snapshots__/a.test.ts.snap']);
  });

  it('declines a moved snapshot test when a custom snapshot resolver places its snapshots (a lost snapshot is rewritten and passes)', () => {
    const resolver = "module.exports = {\n  resolveSnapshotPath: (testPath, extension) => testPath.replace('/src/', '/snapshots/') + extension,\n};\n";
    const config = "module.exports = { snapshotResolver: '<rootDir>/snapshot-resolver.js' };\n";
    const test = "it('renders', () => expect(1).toMatchSnapshot());\n";
    const snapshot = 'exports[`renders 1`] = `2`;\n';
    expect(violations(
      { 'jest.config.js': config, 'snapshot-resolver.js': resolver, 'src/services/render.test.ts': test, 'snapshots/services/render.test.ts.snap': snapshot },
      { 'jest.config.js': config, 'snapshot-resolver.js': resolver, 'src/modules/render.test.ts': test, 'snapshots/services/render.test.ts.snap': snapshot },
    )).toEqual(["moved to src/modules/render.test.ts, and its snapshots are placed by the custom resolver in jest.config.js: their co-move can't be checked statically"]);
    expect(violations({ 'jest.config.js': config, 'src/services/a.test.ts': "it('a', () => {});\n" }, { 'jest.config.js': config, 'src/modules/a.test.ts': "it('a', () => {});\n" })).toEqual([]);
  });

  it('rejects a module that arrives next to a manual mock or snapshot that is not its own (Jest picks it up)', () => {
    const client = "export const name = () => 'real';\n";
    const mock = "export const name = () => 'mocked';\n";
    expect(violations({ 'src/lib/client.ts': client, 'src/__mocks__/client.ts': mock }, { 'src/client.ts': client, 'src/__mocks__/client.ts': mock }))
      .toEqual(["moved to src/client.ts, next to manual mock src/__mocks__/client.ts, which isn't its own"]);
    const test = "it('x', () => expect(1).toMatchSnapshot());\n";
    const stale = 'exports[`x 1`] = `2`;\n';
    expect(violations({ 'src/a/x.test.ts': test, 'src/b/__snapshots__/x.test.ts.snap': stale }, { 'src/b/x.test.ts': test, 'src/b/__snapshots__/x.test.ts.snap': stale }))
      .toEqual(["moved to src/b/x.test.ts, next to snapshot src/b/__snapshots__/x.test.ts.snap, which isn't its own"]);
  });

  it('rejects a split declaration pair', () => {
    expect(violations(
      { 'legacy/x.js': 'exports.x = 1;\n', 'legacy/x.d.ts': 'export declare const x: number;\n' },
      { 'lib/x.js': 'exports.x = 1;\n', 'types/x.d.ts': 'export declare const x: number;\n' },
    )).toEqual(expect.arrayContaining([expect.stringMatching(/declaration pair of legacy\/x.js should be at lib\/x.d.ts/)]));
  });

  it('rejects a moved symlink and a symlink whose target moved', () => {
    expect(violations({ 'src/a.ts': 'export const a = 1;\n', 'link.ts': { link: 'src/a.ts' } }, { 'lib/a.ts': 'export const a = 1;\n', 'link.ts': { link: 'src/a.ts' } }))
      .toEqual(['points at src/a.ts, which moved to lib/a.ts']);
  });

  it('rejects a move into a gitignored destination: missing from the commit, or force-added', () => {
    const base = { '.gitignore': 'generated/\n', 'src/a.ts': 'export const a = 1;\n' };
    const head = { '.gitignore': 'generated/\n', 'src/generated/a.ts': 'export const a = 1;\n' };
    expect(violations(base, head)).toEqual(['deleted: no file in head has its content (modulo specifiers)']);
    expect(withContext(base, head, (context) => checkMoveSet(context).violations.map((violation) => violation.detail), true))
      .toEqual(['.gitignore status changes: not ignored -> ignored at src/generated/a.ts']);
  });

  it('keeps every file\'s status under a moved ignore file, not only the moved files\' (a nested .npmignore that moved ships a fixture)', () => {
    const files = { 'lib/x.js': 'exports.x = 1;\n', 'lib/x.fixture.js': "exports.secret = 'hunter2';\n" };
    expect(violations({ ...files, 'lib/.npmignore': '*.fixture.js\n' }, { ...files, 'lib/legacy/.npmignore': '*.fixture.js\n' }))
      .toEqual(['.npmignore status changes: ignored -> not ignored']);
  });

  it('keeps what npm pack ships: package.json files entries are anchored at the package, and a move out of a package leaves it', () => {
    const manifest = JSON.stringify({ name: 'lib', version: '1.0.0', main: 'src/index.js', files: ['src', '!src/fixtures'] });
    const index = (specifier: string) => `module.exports = require('${specifier}');\n`;
    expect(violations({ 'package.json': manifest, 'src/index.js': index('./util'), 'src/util.js': 'exports.u = 1;\n' }, { 'package.json': manifest, 'src/index.js': index('../lib/util'), 'lib/util.js': 'exports.u = 1;\n' }))
      .toEqual(['package.json files status changes: packed by npm -> not packed by npm at lib/util.js']);
    expect(violations({ 'package.json': manifest, 'src/util.js': 'exports.u = 1;\n' }, { 'package.json': manifest, 'src/fixtures/util.js': 'exports.u = 1;\n' }))
      .toEqual(['package.json files status changes: packed by npm -> not packed by npm at src/fixtures/util.js']);
    expect(violations({ 'package.json': manifest, 'src/util.js': 'exports.u = 1;\n' }, { 'package.json': manifest, 'src/lib/util.js': 'exports.u = 1;\n' })).toEqual([]);
    const nested = { 'package.json': '{ "private": true }', 'packages/a/package.json': '{ "name": "a" }', 'packages/b/package.json': '{ "name": "b" }' };
    expect(violations({ ...nested, 'packages/a/x.ts': 'export {};\n' }, { ...nested, 'packages/b/x.ts': 'export {};\n' })).toEqual([
      'packages/a/package.json status changes: packed by npm -> not packed by npm at packages/b/x.ts',
      'packages/b/package.json status changes: not packed by npm -> packed by npm at packages/b/x.ts',
    ]);
  });

  it('keeps the checkout attributes git gives a moved file (a renamed win-*.sh loses eol=crlf, so its checked-out bytes change)', () => {
    const script = '#!/bin/sh\nprintf "%s|" hello\n';
    const attributes = 'win-*.sh text eol=crlf\n*.png binary\n';
    expect(violations({ '.gitattributes': attributes, 'scripts/win-hello.sh': script }, { '.gitattributes': attributes, 'scripts/tools/hello.sh': script }))
      .toEqual(['.gitattributes status changes: text=set eol=crlf -> no checkout attributes at scripts/tools/hello.sh']);
    expect(violations({ '.gitattributes': attributes, 'scripts/win-hello.sh': script }, { '.gitattributes': attributes, 'tools/win-hello.sh': script })).toEqual([]);
  });

  it('anchors a Dockerfile-specific ignore file at every enclosing build context', () => {
    const tree = (file: string) => ({ 'server/Dockerfile.dockerignore': 'src/legacy\nserver/legacy\n', [file]: 'export {};\n' });
    expect(violations(tree('server/src/a.ts'), tree('server/src/legacy/a.ts'))).toEqual([
      'server/Dockerfile.dockerignore (build context server) status changes: sent to the build context -> not sent to the build context at server/src/legacy/a.ts',
    ]);
    expect(violations(tree('server/a.ts'), tree('server/legacy/a.ts'))).toEqual([
      'server/Dockerfile.dockerignore (build context .) status changes: sent to the build context -> not sent to the build context at server/legacy/a.ts',
    ]);
  });

  it('reads .dockerignore with Docker semantics (anchored at the context)', () => {
    const patterns = dockerPatterns('machine-learning/\n**/dist/\n!docker/scripts\ndocker/\n');
    expect(dockerIgnored(patterns, 'machine-learning/app.py')).toBe(true);
    expect(dockerIgnored(patterns, 'server/src/modules/machine-learning/x.ts')).toBe(false);
    expect(dockerIgnored(patterns, 'server/dist/main.js')).toBe(true);
    expect(dockerIgnored(patterns, 'docker/scripts/run.sh')).toBe(true);
    expect(dockerIgnored(dockerPatterns('docker/\n!docker/scripts\n'), 'docker/scripts/run.sh')).toBe(false);
  });
});

describe('K2 byte-span confinement', () => {
  const violations = (base: Tree, head: Tree) => withContext(base, head, (context) => checkByteSpans(context).violations.map((violation) => violation.detail));
  const importer = (specifier: string, extra = '') => `${extra}import { b } from '${specifier}';\nexport const a = b;\n`;

  it('accepts specifier-only edits', () => {
    expect(violations({ 'src/a.ts': importer('./b'), 'src/b.ts': 'export const b = 1;\n' }, { 'src/a.ts': importer('./lib/b'), 'src/lib/b.ts': 'export const b = 1;\n' })).toEqual([]);
  });

  it('rejects an import type toggle, a reorder of different-shaped imports and a string edit outside spans', () => {
    expect(violations({ 'src/a.ts': importer('./b') }, { 'src/a.ts': "import type { b } from './b';\nexport const a = b;\n" })[0]).toMatch(/outside specifier spans/);
    expect(violations({ 'src/a.ts': "import { x } from './x';\nimport './y';\n" }, { 'src/a.ts': "import './y';\nimport { x } from './x';\n" })[0]).toMatch(/outside specifier spans/);
    expect(violations({ 'src/a.ts': "import { b } from './b';\nconsole.log('src/b.ts');\n" }, { 'src/a.ts': "import { b } from './b';\nconsole.log('src/lib/b.ts');\n" })[0]).toMatch(/outside specifier spans/);
  });

  it('leaves a swap of two same-shaped imports to K3 (only span interiors differ)', () => {
    expect(violations({ 'src/a.ts': "import './x';\nimport './y';\n" }, { 'src/a.ts': "import './y';\nimport './x';\n" })).toEqual([]);
  });

  it('rejects a rewritten span that breaks out of its literal', () => {
    expect(violations({ 'src/a.ts': importer('./b') }, { 'src/a.ts': importer("./b' + '") })[0]).toMatch(/sites|outside/);
  });

  it('rejects a span whose callee is a local binding, not the module loader (a host require handed in resolves from the host)', () => {
    const plugin = (specifier: string) => `export function run(require: (id: string) => { b: string }) {\n  return require('${specifier}').b;\n}\n`;
    const b = 'export const b = 1;\n';
    expect(violations({ 'src/plugin.ts': plugin('./b'), 'src/b.ts': b }, { 'src/plugins/plugin.ts': plugin('../b'), 'src/b.ts': b }))
      .toEqual(["line 2: require('../b') calls the 'require' declared on line 1, not the module loader: '../b' isn't a specifier relative to this file"]);
    // Moved with its target, the span needs no edit, and still names a path relative to the host, not to this file.
    expect(violations({ 'src/plugin.ts': plugin('./b'), 'src/b.ts': b }, { 'src/plugins/plugin.ts': plugin('./b'), 'src/plugins/b.ts': b })).toHaveLength(1);
    const genuine = (specifier: string) => [
      "import { createRequire } from 'node:module';", "import { jest } from '@jest/globals';", 'declare const vi: { mock(id: string): void };',
      'const require = createRequire(import.meta.url);', `jest.mock('${specifier}');`, `vi.mock('${specifier}');`, `export const b = require('${specifier}');`, '',
    ].join('\n');
    expect(violations({ 'src/a.ts': genuine('./b'), 'src/b.ts': b }, { 'src/a.ts': genuine('./lib/b'), 'src/lib/b.ts': b })).toEqual([]);
  });

  it('rejects a loader call the span extractor does not read, in a moved file or reaching a moved file from an unmoved one', () => {
    const user = (specifier: string) => `const config = (require)('${specifier}').config;\nconst other = require(('${specifier}') as string).config;\nexport const user = () => [config, other];\n`;
    const config = 'export const config = 1;\n';
    expect(violations({ 'src/services/user.ts': user('../config'), 'src/config.ts': config }, { 'src/modules/user/user.ts': user('../config'), 'src/config.ts': config })).toEqual([
      "line 1: (require)('../config') loads a module in a form the span extractor doesn't read, so neither K2 nor K3 sees its specifier",
      "line 2: require(('../config') as string) loads a module in a form the span extractor doesn't read, so neither K2 nor K3 sees its specifier",
    ]);
    expect(violations({ 'src/services/user.ts': user('../config'), 'src/config.ts': config }, { 'src/services/user.ts': user('../config'), 'src/lib/config.ts': config })).toEqual([
      "line 1: (require)('../config') may load moved src/config.ts (now src/lib/config.ts) in a form the span extractor doesn't read, so its specifier can't follow the move",
      "line 2: require(('../config') as string) may load moved src/config.ts (now src/lib/config.ts) in a form the span extractor doesn't read, so its specifier can't follow the move",
    ]);
    expect(violations({ 'src/services/user.ts': user('../config'), 'src/config.ts': config, 'src/x.ts': config }, { 'src/services/user.ts': user('../config'), 'src/config.ts': config, 'src/lib/x.ts': config })).toEqual([]);
    // A URL without ./ still resolves against the file; one with a scheme doesn't.
    const urls = "export const data = new URL('data.json', import.meta.url);\nexport const home = new URL('https://x.test/', import.meta.url);\n";
    expect(violations({ 'src/services/urls.ts': urls }, { 'src/modules/urls.ts': urls }))
      .toEqual(["line 1: new URL('data.json', import.meta.url) loads a module in a form the span extractor doesn't read, so neither K2 nor K3 sees its specifier"]);
  });

  it('rejects a component file the span extractor does not read that imports a moved module, or that moves with relative imports', () => {
    const component = '<script setup lang="ts">\nimport { user } from "@/services/user";\nimport Avatar from "./Avatar.vue";\n</script>\n';
    const user = 'export const user = 1;\n';
    expect(violations({ 'src/components/User.vue': component, 'src/services/user.ts': user }, { 'src/components/User.vue': component, 'src/modules/user/user.ts': user }))
      .toEqual(["line 2: '@/services/user' may name moved src/services/user.ts (now src/modules/user/user.ts) in a file the span extractor doesn't read, so it can't follow the move"]);
    expect(violations({ 'src/components/User.vue': component }, { 'src/modules/user/User.vue': component }))
      .toEqual(["moved to src/modules/user/User.vue; line 3: './Avatar.vue' is a relative import in a file the span extractor doesn't read, so it can't follow the move"]);
    expect(violations({ 'src/components/User.vue': component, 'src/lib/clock.ts': user }, { 'src/components/User.vue': component, 'src/time/clock.ts': user })).toEqual([]);
    // An alias belongs to its own package: web's `$lib/services/album.service` never names the server's file (immich).
    const packages = { 'web/package.json': '{}', 'server/package.json': '{}', 'web/src/Album.svelte': '<script>\nimport { album } from "$lib/services/album.service";\n</script>\n' };
    expect(violations({ ...packages, 'server/src/services/album.service.ts': user }, { ...packages, 'server/src/modules/album/album.service.ts': user })).toEqual([]);
  });

  it('rejects changed content in non-source and non-UTF-8 files', () => {
    expect(violations({ 'README.md': 'see src/b.ts\n' }, { 'README.md': 'see src/lib/b.ts\n' })).toEqual(['content changed in a file without specifier spans (only module specifiers may change)']);
    expect(violations({ 'src/a.ts': Buffer.from([0x2f, 0x2f, 0xff, 0x0a]) }, { 'src/a.ts': Buffer.from([0x2f, 0x2f, 0xfe, 0x0a]) })).toEqual(['content changed in a file that is not valid UTF-8']);
  });
});

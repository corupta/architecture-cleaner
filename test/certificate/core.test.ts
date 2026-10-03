// The certifier's core: committed-tree reading, pathMap inference, K1 move-set integrity, K2 byte-span confinement.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkByteSpans } from '../../src/certificate/byte-spans.js';
import { createContext } from '../../src/certificate/certify.js';
import { commitRepoFs } from '../../src/certificate/commit-fs.js';
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

  it('rejects changed content in non-source and non-UTF-8 files', () => {
    expect(violations({ 'README.md': 'see src/b.ts\n' }, { 'README.md': 'see src/lib/b.ts\n' })).toEqual(['content changed in a file without specifier spans (only module specifiers may change)']);
    expect(violations({ 'src/a.ts': Buffer.from([0x2f, 0x2f, 0xff, 0x0a]) }, { 'src/a.ts': Buffer.from([0x2f, 0x2f, 0xfe, 0x0a]) })).toEqual(['content changed in a file that is not valid UTF-8']);
  });
});

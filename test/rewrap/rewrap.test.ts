// The re-wrap (src/rewrap): which declarations it re-wraps (touched, prettier-stable at base, not at head, no
// directive on their lines) and why it skips the others; its commit certifies with K2's layout class; `ac rewrap`
// commits on a new branch and refuses to take over an existing one.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { certify } from '../../src/certificate/certify.js';
import { directiveComment as certifierDirectives } from '../../src/certificate/layout.js';
import { rewrapCommand } from '../../src/rewrap/command.js';
import { commitOnto } from '../../src/rewrap/commit.js';
import { declarationTokens, directiveComment, readFile, sameDeclarationTokens } from '../../src/rewrap/declarations.js';
import { planRewrap, type RewrapInput } from '../../src/rewrap/rewrap.js';
import { type Tree, twoCommits } from '../certificate/two-commit-repo.js';

const scratches: string[] = [];
afterAll(() => {
  for (const directory of scratches) fs.rmSync(directory, { recursive: true, force: true });
});
const scratch = (prefix: string) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratches.push(directory);
  return directory;
};

/** An environment checkout whose node_modules holds this package's prettier, or none. */
function environment(withPrettier = true): string {
  const directory = scratch('ac-rewrap-env-');
  if (withPrettier) fs.symlinkSync(path.resolve('node_modules'), path.join(directory, 'node_modules'));
  return directory;
}

const prettierrc = `${JSON.stringify({ singleQuote: true, trailingComma: 'all', printWidth: 60, semi: true })}\n`;
const letters = 'export const alpha = 1;\nexport const beta = 2;\nexport const gamma = 3;\n';
const short = "import { alpha, beta, gamma } from './letters';\n";
const moved = "import { alpha, beta, gamma } from './modules/letters/letters';\n";
const wrapped = "import {\n  alpha,\n  beta,\n  gamma,\n} from './modules/letters/letters';\n";
const use = 'export const all = [alpha, beta, gamma];\n';

function repoOf(base: Tree, head: Tree) {
  const repo = twoCommits({ '.prettierrc': prettierrc, 'package.json': '{ "name": "fixture" }\n', ...base }, { '.prettierrc': prettierrc, 'package.json': '{ "name": "fixture" }\n', ...head });
  scratches.push(repo.root);
  return repo;
}

/** A repo whose two commits hold raw bytes, with `executable` files at mode 100755 (twoCommits writes text only). */
function rawRepo(base: Record<string, string | Buffer>, head: Record<string, string | Buffer>, executable: string[] = []) {
  const root = scratch('ac-rewrap-raw-');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'rewrap@ac.invalid');
  git('config', 'user.name', 'rewrap');
  const commit = (tree: Record<string, string | Buffer>, message: string) => {
    git('rm', '-rq', '--ignore-unmatch', '.');
    for (const [file, content] of Object.entries(tree)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
      if (executable.includes(file)) fs.chmodSync(path.join(root, file), 0o755);
    }
    git('add', '-A');
    git('commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  return { root, base: commit(base, 'base'), head: commit(head, 'head') };
}

async function plan(base: Tree, head: Tree, overrides: Partial<RewrapInput> = {}) {
  const repo = repoOf(base, head);
  const result = await planRewrap({ repo: repo.root, base: repo.base, head: repo.head, checkout: repo.root, environment: environment(), packageRoot: '', ...overrides });
  return { repo, result };
}

describe('the re-wrap plan', () => {
  it('re-wraps a touched declaration that outgrew printWidth and leaves every other byte alone', async () => {
    const untouched = "import { readFileSync, writeFileSync, existsSync } from 'node:fs';\n";
    const { result } = await plan({ 'src/all.ts': `${untouched}${short}${use}`, 'src/letters.ts': letters }, { 'src/all.ts': `${untouched}${moved}${use}`, 'src/modules/letters/letters.ts': letters });
    expect(result.files).toEqual(new Map([['src/all.ts', `${untouched}${wrapped}${use}`]]));
    expect(result.declarations).toEqual([{ file: 'src/all.ts', line: 2, before: moved.trim(), after: wrapped.trim() }]);
    expect(result.skips).toEqual([]);
    expect(result.prettier).toEqual([JSON.parse(fs.readFileSync('node_modules/prettier/package.json', 'utf8')).version]);
  });

  it('leaves a touched declaration that still fits, and one whose base counterpart was not prettier-formatted', async () => {
    const fits = "import { alpha } from './modules/letters/letters';\n";
    const unformatted = "import {alpha,beta,gamma} from './letters';\n";
    const { result } = await plan({ 'src/a.ts': `import { alpha } from './letters';\n${use}`, 'src/b.ts': `${unformatted}${use}`, 'src/letters.ts': letters },
      { 'src/a.ts': `${fits}${use}`, 'src/b.ts': `${unformatted.replace('./letters', './modules/letters/letters')}${use}`, 'src/modules/letters/letters.ts': letters });
    expect(result.files.size).toBe(0);
    expect(result.skips).toEqual([{ file: 'src/b.ts', line: 1, reason: 'its base counterpart was not prettier-formatted either: the repository did not have that formatting' }]);
  });

  it('skips a declaration a directive comment acts on: right before it, inside it, or reaching it from lines above', async () => {
    const head = (prefix: string) => ({ 'src/all.ts': `${prefix}${moved}${use}`, 'src/modules/letters/letters.ts': letters });
    const base = (prefix: string) => ({ 'src/all.ts': `${prefix}${short}${use}`, 'src/letters.ts': letters });
    for (const [prefix, line] of [['// @ts-expect-error: not typed yet\n', 1], ['/* c8 ignore next 3 */\nexport const one = 1;\nexport const two = 2;\n', 1], ['// eslint-disable-next-line import/order\n// why: legacy\n', 1]] as const) {
      const { result } = await plan(base(prefix), head(prefix));
      expect(result.files.size).toBe(0);
      expect(result.skips).toEqual([{ file: 'src/all.ts', line: prefix.split('\n').length, reason: expect.stringMatching(new RegExp(`^the directive ".*" on line ${line} acts on its lines$`)) }]);
    }
    const inside = (specifier: string) => `import { alpha, /* @ts-ignore */ beta, gamma } from '${specifier}';\n${use}`;
    const { result } = await plan({ 'src/all.ts': inside('./letters'), 'src/letters.ts': letters }, { 'src/all.ts': inside('./modules/letters/letters'), 'src/modules/letters/letters.ts': letters });
    expect(result.skips.map((skip) => skip.reason)).toEqual([expect.stringMatching(/^the directive "\/\* @ts-ignore \*\/" on line 1 acts on its lines$/)]);
  });

  it('skips a declaration sharing its line, a file whose declarations were added or removed, and an added file', async () => {
    const { result } = await plan(
      { 'src/a.ts': `${short.trim()} // letters\n${use}`, 'src/b.ts': `${short}${use}`, 'src/letters.ts': letters },
      { 'src/a.ts': `${moved.trim()} // letters\n${use}`, 'src/b.ts': `import { join } from 'node:path';\n${moved}${use}`, 'src/c.ts': moved, 'src/modules/letters/letters.ts': letters },
    );
    expect(result.files.size).toBe(0);
    expect(result.skips).toEqual([
      { file: 'src/c.ts', reason: 'added since base: no file it moved from (the same text up to its module specifiers)' },
      { file: 'src/a.ts', line: 1, reason: 'shares a line with other code or a comment' },
      { file: 'src/b.ts', reason: "1 import and export-from declarations at base (src/b.ts), 2 at head: their counterparts can't be told" },
    ]);
  });

  it('skips a file when no prettier is installed for its package, when prettier ignores it, or when a source map maps it', async () => {
    const base = { 'src/all.ts': `${short}${use}`, 'src/letters.ts': letters };
    const head = { 'src/all.ts': `${moved}${use}`, 'src/modules/letters/letters.ts': letters };
    const noPrettier = await plan(base, head, { environment: environment(false) });
    expect(noPrettier.result.skips).toEqual([{ file: 'src/all.ts', reason: expect.stringMatching(/^no prettier installed for the repository root in /) }]);
    const ignored = await plan({ ...base, '.prettierignore': 'src/all.ts\n' }, { ...head, '.prettierignore': 'src/all.ts\n' });
    expect(ignored.result.skips).toEqual([{ file: 'src/all.ts', reason: 'prettier ignores it (.prettierignore or .gitignore)' }]);
    const mapped = await plan({ ...base, 'src/all.ts.map': '{}' }, { ...head, 'src/all.ts.map': '{}' });
    expect(mapped.result.skips).toEqual([{ file: 'src/all.ts', reason: 'a source map maps its lines' }]);
  });

  it('skips a file under a coverage gate (K2 refuses its layout change)', async () => {
    const gated = { 'package.json': `${JSON.stringify({ name: 'fixture', jest: { coverageThreshold: { global: { lines: 90 } } } })}\n` };
    const { result } = await plan({ 'src/all.ts': `${short}${use}`, 'src/letters.ts': letters, ...gated }, { 'src/all.ts': `${moved}${use}`, 'src/modules/letters/letters.ts': letters, ...gated });
    expect(result.skips).toEqual([{ file: 'src/all.ts', reason: 'a coverage gate measures its line totals: a threshold in package.json' }]);
  });

  it('finds a moved file\'s counterpart by its text with the specifiers blanked, where git\'s rename detection sees 40% similarity', async () => {
    const service = (specifier: string) => `import { alpha, beta, gamma } from '${specifier}';\nexport const service = [alpha, beta, gamma];\n`;
    const twin = (specifier: string) => `${service(specifier)}export const twin = true;\n`;
    const base = { 'src/services/service.ts': service('../letters'), 'src/letters.ts': letters, 'src/twin-a.ts': twin('./letters'), 'src/twin-b.ts': twin('./letters') };
    const head = { 'src/modules/service/service.ts': service('../../shared/letters/letters'), 'src/shared/letters/letters.ts': letters,
      'src/x/twin-a.ts': twin('../shared/letters/letters'), 'src/x/twin-b.ts': twin('../shared/letters/letters') };
    const { result } = await plan(base, head);
    expect([...result.files.keys()]).toEqual(['src/modules/service/service.ts']);
    // Two identical files that moved: which went where can't be told, so neither is re-wrapped.
    expect(result.skips).toEqual(['src/x/twin-a.ts', 'src/x/twin-b.ts'].map((file) => ({ file, reason: 'added since base: no file it moved from (the same text up to its module specifiers)' })));
  });

  it('skips a touched file that is not valid UTF-8 (R4): re-written as text, its other bytes would change', async () => {
    const latin1 = (text: string) => Buffer.from(text, 'latin1');
    const label = "export const label = 'caf\u00e9';\n";
    const config = { '.prettierrc': prettierrc, 'package.json': '{ "name": "fixture" }\n', 'src/letters.ts': letters };
    const repo = rawRepo(
      { ...config, 'src/latin.ts': latin1(`${short}${label}${use}`), 'src/utf.ts': `${short}${label}${use}` },
      { ...config, 'src/latin.ts': latin1(`${moved}${label}${use}`), 'src/utf.ts': `${moved}${label}${use}` },
    );
    const result = await planRewrap({ repo: repo.root, base: repo.base, head: repo.head, checkout: repo.root, environment: environment(), packageRoot: '' });
    expect(result.skips).toEqual([{ file: 'src/latin.ts', reason: 'not valid UTF-8: written back as text, its other bytes would change' }]);
    expect(result.files).toEqual(new Map([['src/utf.ts', `${wrapped}${label}${use}`]]));
  });

  it('makes a commit that certifies: K2 reports the file as layout only', async () => {
    const { repo, result } = await plan({ 'src/all.ts': `${short}${use}`, 'src/letters.ts': letters }, { 'src/all.ts': `${moved}${use}`, 'src/modules/letters/letters.ts': letters });
    const commit = commitOnto(repo.root, repo.head, result.files, 'style(fixture): re-wrap\n');
    const certificate = await certify({ repo: repo.root, base: repo.head, head: commit, packageRoot: '', environment: repo.root, profile: null, oracles: false, only: ['K0', 'K1', 'K2', 'K3a'], workDir: scratch('ac-rewrap-work-'), keep: false });
    expect(certificate.verdict).toBe('pass');
    const k2 = certificate.checks.find((check) => check.id === 'K2')!;
    expect(k2.summary).toBe('0 specifier spans changed in 0 files; 1 files changed in layout only (equal tokens and syntax trees); every other byte identical');
    expect(k2.findings).toEqual([{ kind: 'layout-only', file: 'src/all.ts', detail: 'layout only: line breaks changed in 4 places from line 1, +4 lines; stack traces name its later lines by their new numbers' }]);
  });
});

describe('the declarations it reads', () => {
  it('keeps the certifier\'s directive list (each side has its own copy: neither imports the other)', () => {
    expect(directiveComment.source).toBe(certifierDirectives.source);
  });

  it('reads top-level import and export-from declarations with their specifiers, and comments outside regexes and templates', () => {
    const text = "import a from './a';\nconst pattern = /\\/* not a comment/;\nexport { b } from './b';\nexport const c = `// not one ${a}`; // one\n";
    const reading = readFile('x.ts', text);
    expect(reading.declarations.map((declaration) => [declaration.specifier, declaration.firstLine])).toEqual([["'./a'", 1], ["'./b'", 3]]);
    expect(reading.comments.map((comment) => comment.text)).toEqual(['// one']);
  });

  it('compares a declaration\'s tokens without its clause\'s trailing comma, and with its attributes\' comma', () => {
    expect(declarationTokens("import {\n  a,\n  b, // last\n} from './x';")).toEqual(['import', '{', 'a', ',', 'b', '// last', '}', 'from', "'./x'", ';']);
    expect(sameDeclarationTokens("import { a, b } from './x';", "import {\n  a,\n  b,\n} from './x';")).toBe(true);
    expect(sameDeclarationTokens("import { a, b } from './x';", "import { a, b } from \"./x\";")).toBe(false);
    expect(sameDeclarationTokens("import x from './x.json' with { type: 'json' };", "import x from './x.json' with {\n  type: 'json',\n};")).toBe(false);
  });
});

describe('ac rewrap', () => {
  const run = async (argv: string[]) => {
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line));
    const error = vi.spyOn(console, 'error').mockImplementation((line: string) => void lines.push(line));
    try {
      return { code: await rewrapCommand(argv), lines };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  };
  const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

  it('commits on a new branch on top of head, leaves the checkout where it was, and refuses an existing branch', async () => {
    const repo = repoOf({ 'src/all.ts': `${short}${use}`, 'src/letters.ts': letters }, { 'src/all.ts': `${moved}${use}`, 'src/modules/letters/letters.ts': letters });
    const env = environment();
    const before = git(repo.root, 'rev-parse', '--abbrev-ref', 'HEAD');
    const first = await run([repo.root, `${repo.base}..${repo.head}`, '--env', env, '--branch', 'ac/s8-rewrap']);
    expect(first.code).toBe(0);
    expect(first.lines[0]).toBe(`  re-wrapped src/all.ts:1  ${moved.trim()}`);
    expect(first.lines).toContain(`1 import and export declarations re-wrapped in 1 files with prettier ${JSON.parse(fs.readFileSync('node_modules/prettier/package.json', 'utf8')).version}: line breaks, indentation and the trailing comma of their binding lists only; 1 changed source files examined, 0 skips`);
    const commit = git(repo.root, 'rev-parse', 'ac/s8-rewrap');
    expect(git(repo.root, 'rev-parse', `${commit}^`)).toBe(repo.head);
    expect(git(repo.root, 'log', '-1', '--format=%s', commit)).toBe('style(src): re-wrap the import lines the moves lengthened');
    expect(git(repo.root, 'show', `${commit}:src/all.ts`)).toBe(`${wrapped}${use}`.trim());
    expect(git(repo.root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(before);
    expect(git(repo.root, 'rev-parse', 'HEAD')).toBe(repo.head);
    expect(git(repo.root, 'status', '--porcelain')).toBe('');
    const again = await run([repo.root, `${repo.base}..${repo.head}`, '--env', env, '--branch', 'ac/s8-rewrap']);
    expect(again).toEqual({ code: 2, lines: ["ac rewrap: branch ac/s8-rewrap already exists; name a new one, or the checkout's current branch when it is clean at the head commit"] });
  });

  it('moves the checkout\'s current branch forward when it is named and clean at head; reads head from a worktree otherwise', async () => {
    const repo = repoOf({ 'src/all.ts': `${short}${use}`, 'src/letters.ts': letters }, { 'src/all.ts': `${moved}${use}`, 'src/modules/letters/letters.ts': letters });
    const current = git(repo.root, 'rev-parse', '--abbrev-ref', 'HEAD');
    expect((await run([repo.root, `${repo.base}..${repo.head}`, '--env', environment(), '--branch', current])).code).toBe(0);
    expect(git(repo.root, 'rev-parse', 'HEAD^')).toBe(repo.head);
    expect(fs.readFileSync(path.join(repo.root, 'src/all.ts'), 'utf8')).toBe(`${wrapped}${use}`);
    git(repo.root, 'checkout', '-q', repo.base);
    const fromWorktree = await run([repo.root, `${repo.base}..${repo.head}`, '--env', environment(), '--branch', 'from-worktree']);
    expect(fromWorktree.code).toBe(0);
    expect(git(repo.root, 'show', 'from-worktree:src/all.ts')).toBe(`${wrapped}${use}`.trim());
    expect(git(repo.root, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('takes a package directory as <repo> for its repository (R3): that package\'s .prettierignore holds, file modes stay', async () => {
    const both = {
      '.prettierrc': prettierrc, 'package.json': '{ "name": "root" }\n', 'pkg/package.json': '{ "name": "pkg" }\n', 'pkg/.prettierignore': 'src/generated.ts\n',
    };
    const repo = rawRepo(
      { ...both, 'pkg/src/all.ts': `${short}${use}`, 'pkg/src/generated.ts': `${short}${use}`, 'pkg/src/letters.ts': letters },
      { ...both, 'pkg/src/all.ts': `${moved}${use}`, 'pkg/src/generated.ts': `${moved}${use}`, 'pkg/src/modules/letters/letters.ts': letters },
      ['pkg/src/all.ts'],
    );
    const { code, lines } = await run([path.join(repo.root, 'pkg'), `${repo.base}..${repo.head}`, '--env', environment(), '--branch', 'from-pkg']);
    expect(code).toBe(0);
    expect(lines).toContain('  skipped pkg/src/generated.ts: prettier ignores it (.prettierignore or .gitignore)');
    expect(git(repo.root, 'diff', '--name-only', repo.head, 'from-pkg')).toBe('pkg/src/all.ts');
    expect(git(repo.root, 'ls-tree', 'from-pkg', 'pkg/src/all.ts')).toMatch(/^100755 /);
    expect(lines.at(-1)).toContain(`certify it: ac certify ${fs.realpathSync(repo.root)} ${repo.head.slice(0, 12)}..`);
  });

  it('makes no commit when nothing needs a re-wrap, and prints the usage without --env', async () => {
    const repo = repoOf({ 'src/all.ts': `${short}${use}` }, { 'src/all.ts': `${short}${use}\n` });
    const nothing = await run([repo.root, `${repo.base}..${repo.head}`, '--env', environment()]);
    expect(nothing.code).toBe(0);
    expect(nothing.lines.at(-1)).toBe('nothing to re-wrap: no commit made');
    expect(git(repo.root, 'branch', '--list', 'ac/rewrap-*')).toBe('');
    expect((await run([repo.root, `${repo.base}..${repo.head}`])).code).toBe(2);
  });
});

// K4 location scan: path-exposing APIs in moved files, computed loads into changed directories (SEM-5), and
// old-path strings, on tiny base/head commit pairs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createContext } from '../../src/certificate/certify.js';
import { locationScan } from '../../src/certificate/location-scan.js';
import { coverageGated, globToRegExp } from '../../src/certificate/old-path-scan.js';
import type { CheckResult } from '../../src/certificate/types.js';
import { listFixtures, materialize } from '../helpers.js';

const created: string[] = [];
afterAll(() => {
  for (const directory of created) fs.rmSync(directory, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function writeTree(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

/** A repo with `files` committed as base, then `moves` applied with git mv and `edits` written, committed as head. */
function commitPair(files: Record<string, string>, moves: Record<string, string>, edits: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-k4-'));
  created.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'k4@ac.invalid');
  git(root, 'config', 'user.name', 'k4');
  writeTree(root, files);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  for (const [from, to] of Object.entries(moves)) {
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
    git(root, 'mv', from, to);
  }
  writeTree(root, edits);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'head');
  return root;
}

async function scan(repo: string, base = 'HEAD~1', head = 'HEAD', packageRoot = ''): Promise<CheckResult> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-k4-work-'));
  created.push(workDir);
  const { context, cleanup } = createContext({ repo, base, head, packageRoot, environment: repo, profile: null, oracles: false, workDir, keep: false });
  try {
    return await locationScan.run(context);
  } finally {
    cleanup();
  }
}

const details = (outcome: CheckResult) => outcome.violations.map((violation) => `${violation.file}: ${violation.detail}`);

describe('K4 path-exposing APIs in moved files', () => {
  it('flags a moved __dirname user and says where its path now points', async () => {
    const repo = commitPair({
      'src/services/mailer.ts': "import fs from 'fs';\nimport path from 'path';\nexport const template = () => fs.readFileSync(path.join(__dirname, '../templates/mail.hbs'), 'utf8');\n",
      'src/templates/mail.hbs': 'Hello\n',
    }, { 'src/services/mailer.ts': 'src/modules/mail/mailer.ts' });
    const outcome = await scan(repo);
    expect(outcome.status).toBe('fail');
    expect(details(outcome)).toEqual([
      "src/services/mailer.ts: moved to src/modules/mail/mailer.ts; line 3: __dirname: path.join(__dirname, '../templates/mail.hbs') pointed at src/templates/mail.hbs (exists in base), now at src/modules/templates/mail.hbs (missing in head)",
    ]);
  });

  it('flags a moved import.meta.dirname user (the G3 database.repository break)', async () => {
    const repo = commitPair({
      'server/package.json': '{ "type": "module" }\n',
      'server/src/repositories/database.repository.ts': "import { join } from 'node:path';\nexport const migrationFolder = join(import.meta.dirname, '..', 'schema/migrations');\n",
      'server/src/schema/migrations/1-init.ts': 'export const up = 1;\n',
    }, { 'server/src/repositories/database.repository.ts': 'server/src/features/database/repositories/database.repository.ts' });
    const outcome = await scan(repo, 'HEAD~1', 'HEAD', 'server');
    expect(details(outcome)).toEqual([
      "server/src/repositories/database.repository.ts: moved to server/src/features/database/repositories/database.repository.ts; line 2: import.meta.dirname: join(import.meta.dirname, '..', 'schema/migrations') pointed at server/src/schema/migrations (exists in base), now at server/src/features/database/schema/migrations (missing in head)",
    ]);
  });

  it('accepts a rename that keeps the directory for a __dirname-only user, but not for __filename', async () => {
    const repo = commitPair({
      'src/a.ts': "import path from 'path';\nexport const assets = path.join(__dirname, 'assets');\nexport const self = __filename;\n",
      'src/assets/x.txt': 'x\n',
    }, { 'src/a.ts': 'src/b.ts' });
    const outcome = await scan(repo);
    expect(details(outcome)).toEqual(['src/a.ts: moved to src/b.ts; line 3: __filename: __filename pointed at src/a.ts (exists in base), now at src/b.ts (exists in head)']);
  });

  it('flags the rest of the E2 list in a moved file and keeps logged stack traces as findings', async () => {
    const source = [
      "import { createRequire } from 'node:module';",
      "import { readdirSync } from 'node:fs';",
      "import { Worker } from 'node:worker_threads';",
      "import { fork } from 'node:child_process';",
      "import fg from 'fast-glob';",
      'export const url = import.meta.url;',
      'export const req = createRequire(import.meta.url);',
      'export const entry = process.argv[1];',
      "export const files = readdirSync('migrations');",
      "export const worker = new Worker(new URL('./w.js', import.meta.url));",
      "export const child = fork('./scripts/job.js');",
      "export const matches = fg.sync('src/**/*.ts');",
      'export function load(name: string) { return import(`./plugins/${name}.js`); }',
      "export function where() { return new Error().stack!.split('\\n')[2]; }",
      "export function log(error: Error) { console.error('failed', error.stack); }",
      'export const env = import.meta.env;',
      'export const stack = { stack: 1 }.stack;',
      '',
    ].join('\n');
    const repo = commitPair({ 'package.json': '{ "type": "module" }\n', 'src/tools.ts': source }, { 'src/tools.ts': 'src/shared/tools.ts' });
    const outcome = await scan(repo);
    const lines = outcome.violations.map((violation) => /line (\d+)/.exec(violation.detail)![1]).map(Number);
    expect([...new Set(lines)].sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(outcome.findings.map((finding) => finding.kind)).toEqual(['stack-text']);
  });

  it('ignores opaque arguments: a moved file reading a configured path or forwarding to child_process', async () => {
    const repo = commitPair({
      'src/storage.ts': [
        "import fs from 'node:fs/promises';",
        "import { fork, spawn } from 'node:child_process';",
        "import fastGlob from 'fast-glob';",
        "import path from 'node:path';",
        'export const list = (folder: string) => fs.readdir(folder);',
        'export const crawl = (paths: string[]) => fastGlob.glob(paths, { absolute: true });',
        'export const run = (...args: Parameters<typeof fork>) => fork(...args);',
        "export const probe = (input: string) => spawn('ffprobe', ['-v', 'quiet', input]);",
        'export const message = (importPath: string) => `try ${path.resolve(importPath)}`;',
        'export class Repo { stack = 1; get size() { return this.stack; } }',
        '',
      ].join('\n'),
    }, { 'src/storage.ts': 'src/modules/storage/storage.ts' });
    const outcome = await scan(repo);
    expect(details(outcome)).toEqual([]);
    expect(outcome.status).toBe('pass');
  });
});

describe('K4 computed loads in non-moved files (SEM-5)', () => {
  const handlers = {
    'src/handlers/create.ts': 'export const create = 1;\n',
    'src/handlers/delete.ts': 'export const remove = 1;\n',
  };
  const moves = { 'src/handlers/create.ts': 'src/modules/create/create.handler.ts' };

  it('flags require(path.join(__dirname, ...)) into a directory whose files moved', async () => {
    const repo = commitPair({ ...handlers, 'src/loader.ts': "import path from 'path';\nexport const load = (name: string) => require(path.join(__dirname, 'handlers', name));\n" }, moves);
    const outcome = await scan(repo);
    expect(details(outcome)).toEqual([
      "src/loader.ts: line 2: require(…) path.join(__dirname, 'handlers', name) computes a path inside src/handlers, whose tracked contents changed (create.ts)",
    ]);
  });

  it('flags a template import() and a readdirSync of the changed directory', async () => {
    const repo = commitPair({
      ...handlers,
      'src/registry.ts': [
        "import { readdirSync } from 'fs';",
        "import { join } from 'path';",
        "const directory = join(__dirname, 'handlers');",
        'export const names = readdirSync(directory);',
        'export const load = (name: string) => import(`./handlers/${name}.js`);',
        '',
      ].join('\n'),
    }, moves);
    const outcome = await scan(repo);
    expect(details(outcome)).toEqual([
      'src/registry.ts: line 4: readdirSync(…) directory lists directory src/handlers, whose entries changed',
      'src/registry.ts: line 5: import(…) `./handlers/${name}.js` computes a path inside src/handlers, whose tracked contents changed (create.ts)',
      "src/registry.ts: line 3: join(__dirname, 'handlers') uses directory src/handlers, whose tracked contents changed (below it: create.ts)",
    ]);
  });

  it('leaves computed paths alone when their directory did not change, and roots that contain the file', async () => {
    const repo = commitPair({
      ...handlers,
      'src/views/index.html': '<html></html>\n',
      'src/app.ts': "import path from 'path';\nexport const views = path.join(__dirname, 'views');\nexport const root = path.resolve(__dirname, '..');\n",
    }, moves);
    expect(details(await scan(repo))).toEqual([]);
  });

  it('records an opaque dynamic load as a finding', async () => {
    const repo = commitPair({ ...handlers, 'src/plugins.ts': 'export const load = (file: string) => import(file);\n' }, moves);
    const outcome = await scan(repo);
    expect(outcome.status).toBe('pass');
    expect(outcome.findings.map((finding) => finding.kind)).toEqual(['opaque-dynamic-load']);
  });
});

describe('K4 old-path strings', () => {
  const app = {
    'package.json': JSON.stringify({ main: 'dist/server.js', scripts: { start: 'node dist/server.js', dev: 'tsx src/server.ts' } }, null, 2) + '\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'dist', rootDir: 'src', module: 'commonjs' }, include: ['src'] }) + '\n',
    'Dockerfile': 'FROM node:22\nWORKDIR /app\nCOPY dist ./dist\n# entry: dist/server.js\nCMD ["node", "/app/dist/server.js"]\n',
    'README.md': 'Start with `node dist/server.js`; the code is in src/server.ts.\n',
    'src/server.ts': 'export const port = 3000;\n',
    'src/notes.ts': "// see src/server.ts for the port\nexport const name = 'notes';\n",
  };

  it('flags package.json main/scripts and the Dockerfile; README and comments are findings', async () => {
    const repo = commitPair(app, { 'src/server.ts': 'src/app/server.ts' });
    const outcome = await scan(repo);
    expect(details(outcome)).toEqual([
      "Dockerfile: line 5: '/app/dist/server.js' is the emitted path (dist from src) of src/server.ts (moved to src/app/server.ts) [infra]",
      "package.json: line 2: 'dist/server.js' is the emitted path (dist from src) of src/server.ts (moved to src/app/server.ts) [config at main]",
      "package.json: line 4: 'dist/server.js' is the emitted path (dist from src) of src/server.ts (moved to src/app/server.ts) [config at scripts.start]",
      "package.json: line 5: 'src/server.ts' is the old path of src/server.ts (moved to src/app/server.ts) [config at scripts.dev]",
    ]);
    expect(outcome.findings.map((finding) => `${finding.kind} ${finding.file}`)).toEqual([
      'old-path-in-comment Dockerfile',
      'old-path-in-docs README.md',
      'old-path-in-docs README.md',
      'old-path-in-comment src/notes.ts',
    ]);
  });

  it('does not match a needle inside a longer path or word', async () => {
    const repo = commitPair({
      'src/user.ts': 'export const user = 1;\n',
      'src/users.ts': 'export const users = 1;\n',
      'config.json': JSON.stringify({ a: 'src/user.tsx', b: 'lib/src/user.ts', c: 'src/user.ts.bak', d: 'src/users.ts', e: 'src/user-profile', f: 'xsrc/user.ts', g: 'src/user' }, null, 2) + '\n',
    }, { 'src/user.ts': 'src/modules/user/user.ts' });
    const outcome = await scan(repo);
    expect(details(outcome)).toEqual(["config.json: line 8: 'src/user' is the old path without extension of src/user.ts (moved to src/modules/user/user.ts) [config at g]"]);
  });

  it('anchors relative mentions at the mentioning file and the package root; ungated coverage settings are findings', async () => {
    const repo = commitPair({
      'server/package.json': '{}\n',
      'server/src/services/album.service.ts': 'export const album = 1;\n',
      'server/test/vitest.config.mjs': "export default { test: { setupFiles: ['../src/services/album.service.ts'], coverage: { exclude: ['src/services/album.service.ts'], include: ['src/services/**'] } } };\n",
      '.github/workflows/test.yml': 'jobs:\n  test:\n    steps:\n      - run: node server/src/services/album.service.ts\n',
    }, { 'server/src/services/album.service.ts': 'server/src/modules/album/album.service.ts' });
    const outcome = await scan(repo, 'HEAD~1', 'HEAD', 'server');
    expect(details(outcome).sort()).toEqual([
      ".github/workflows/test.yml: line 4: 'server/src/services/album.service.ts' is the old path of server/src/services/album.service.ts (moved to server/src/modules/album/album.service.ts) [CI at jobs.test.steps.run]",
      "server/test/vitest.config.mjs: line 1: '../src/services/album.service.ts' is the old path of server/src/services/album.service.ts (moved to server/src/modules/album/album.service.ts) [config at test.setupFiles]",
    ]);
    expect(outcome.findings.filter((finding) => finding.kind === 'coverage-scope').map((finding) => finding.detail)).toEqual(expect.arrayContaining([
      expect.stringContaining("'src/services/**' is the glob server/src/services/**"),
      expect.stringContaining("'src/services/album.service.ts' is the old path"),
    ]));
    expect(outcome.metrics.coverageViolations).toBe(0);
  });

  it('keeps a coverage setting a violation when a threshold gates on it', async () => {
    const repo = commitPair({
      'src/services/album.service.ts': 'export const album = 1;\n',
      'jest.config.js': "module.exports = { collectCoverageFrom: ['src/services/**'], coverageThreshold: { global: { lines: 80 } } };\n",
    }, { 'src/services/album.service.ts': 'src/modules/album/album.service.ts' });
    const outcome = await scan(repo);
    expect(details(outcome)).toEqual([expect.stringContaining('a coverage setting with a threshold')]);
    expect(outcome.metrics.coverageViolations).toBe(1);
  });

  it('reads coverage gates from thresholds and check-coverage', () => {
    expect(coverageGated("coverageThreshold: { global: { branches: 0, lines: 0 } }")).toBe(false);
    expect(coverageGated("coverage: { thresholds: { lines: 90 } }")).toBe(true);
    expect(coverageGated("coverage: { thresholds: { 'src/a.ts': { lines: 0.5 } } }")).toBe(true);
    expect(coverageGated('{ "check-coverage": true, "lines": 80 }')).toBe(true);
    expect(coverageGated("coverage: { include: ['src/v2/**'] }")).toBe(false);
  });

  it('names location-observing code in added files: copies, and files with no base counterpart (G3 copy-instead-of-move)', async () => {
    const original = "import { join } from 'node:path';\nexport const migrations = join(import.meta.dirname, '..', 'schema/migrations');\n";
    const repo = commitPair({ 'src/repositories/database.repository.ts': original }, {}, {
      'src.backup/repositories/database.repository.ts': original,
      'src/features/database/repositories/database.repository.ts': original.replace("'node:path'", '"node:path"'),
    });
    const outcome = await scan(repo);
    expect(details(outcome)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^src\.backup\/repositories\/database\.repository\.ts: a copy of src\/repositories\/database\.repository\.ts; line 2: import\.meta\.dirname/),
      'src/features/database/repositories/database.repository.ts: added with no base counterpart; line 2: import.meta.dirname',
    ]));
    expect(outcome.metrics.copiedFileHazards).toBe(2);
  });

  it('skips old paths inside specifier spans (K3 judges those)', async () => {
    const repo = commitPair({
      'src/services/x.ts': 'export const x = 1;\n',
      'src/main.ts': "import { x } from './services/x';\nexport const y = x;\n",
    }, { 'src/services/x.ts': 'src/modules/x/x.ts' });
    expect(details(await scan(repo))).toEqual([]);
  });

  it('flags paths inside a directory the move emptied', async () => {
    const repo = commitPair({
      'src/dtos/a.dto.ts': 'export const a = 1;\n',
      'scripts/check.sh': 'ls src/dtos/\ngrep -r foo src/dtos/*.ts\n',
    }, { 'src/dtos/a.dto.ts': 'src/modules/a/a.dto.ts' });
    expect(details(await scan(repo))).toEqual([
      "scripts/check.sh: line 1: 'src/dtos/' is the directory the move emptied of src/dtos (moved to src/modules/a) [config]",
      "scripts/check.sh: line 2: 'src/dtos/*.ts' is the glob src/dtos/*.ts whose matches change (1 moved files, e.g. src/dtos/a.dto.ts -> src/modules/a/a.dto.ts) of src/dtos/a.dto.ts (moved to src/modules/a/a.dto.ts) [config]",
    ]);
  });
});

describe('K4 on executor fixtures', () => {
  const fixtures = listFixtures();

  /** before/ as the base commit, then `tree` (after/, or before/ with the pathmap applied by git mv) as head. */
  function certifyPair(directory: string, label: string, head: { tree?: string; moves?: Map<string, string> }): string {
    const repo = materialize(path.join(directory, 'before'), label);
    created.push(repo);
    if (head.tree) {
      for (const entry of fs.readdirSync(repo)) if (entry !== '.git') fs.rmSync(path.join(repo, entry), { recursive: true, force: true });
      fs.cpSync(head.tree, repo, { recursive: true });
    }
    for (const [from, to] of head.moves ?? []) {
      fs.mkdirSync(path.dirname(path.join(repo, to)), { recursive: true });
      git(repo, 'mv', from, to);
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'head');
    return repo;
  }

  for (const fixture of fixtures.filter((candidate) => candidate.expected.outcome === 'applied')) {
    it(`passes the applied fixture ${fixture.name}`, async () => {
      const repo = certifyPair(fixture.directory, fixture.name, { tree: path.join(fixture.directory, 'after') });
      const outcome = await scan(repo);
      expect(details(outcome)).toEqual([]);
    });
  }

  for (const [name, expected] of [
    ['decline-location-sensitive', /__dirname/],
    ['decline-dynamic-reference', /computed specifier/],
    ['decline-config-reference', /jest\.config\.js: line 3: '\/src\/setup\.ts' is the old path of src\/setup\.ts .*\[config at setupFiles\]/],
  ] as const) {
    it(`fails ${name} when its moves are forced through`, async () => {
      const fixture = fixtures.find((candidate) => candidate.name === name)!;
      const repo = certifyPair(fixture.directory, name, { moves: fixture.moves });
      const outcome = await scan(repo);
      expect(outcome.status).toBe('fail');
      expect(details(outcome).some((detail) => expected.test(detail))).toBe(true);
    });
  }
});

describe('globToRegExp', () => {
  it('handles **, *, ?, classes and braces', () => {
    expect(globToRegExp('src/**/*.ts').test('src/a/b/c.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('src/c.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/c.ts')).toBe(false);
    expect(globToRegExp('src/services/**').test('src/services/a/b.ts')).toBe(true);
    expect(globToRegExp('src/{a,b}/?.ts').test('src/b/x.ts')).toBe(true);
    expect(globToRegExp('src/[!x]*.ts').test('src/x1.ts')).toBe(false);
  });

  it('reads a bracket that is no valid class as itself (a TOML table in mise.toml), instead of throwing', () => {
    expect(globToRegExp('e2e/[tasks.playwright-install]').test('e2e/[tasks.playwright-install]')).toBe(true);
    expect(globToRegExp('e2e/[tasks.playwright-install]').test('e2e/t')).toBe(false);
  });
});

// Red-team regressions for K4 (location scan) and K6 (test inventory): each base/head pair here certified PASS
// while the head behaved differently (confirmed by running both commits), until the fix named in the test.
import { describe, expect, it } from 'vitest';
import { locationScan } from '../../src/certificate/location-scan.js';
import type { CheckResult } from '../../src/certificate/types.js';
import { certifyFiles, checkOf, type Files, installed, jestNodeModules, localNodeModules, variant } from './runner-repos.js';
import { withContext } from './two-commit-repo.js';

const k4 = (base: Files, head: Files): Promise<CheckResult> => withContext(base, head, async (context) => locationScan.run(context));
const details = (outcome: CheckResult) => outcome.violations.map((violation) => `${violation.file}: ${violation.detail}`);

const esm = {
  'package.json': JSON.stringify({ name: 'red-team', type: 'module', scripts: { start: 'node src/main.ts' } }) + '\n',
  'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ['src'] }) + '\n',
};
const emitted = {
  'package.json': JSON.stringify({ name: 'red-team', scripts: { build: 'tsc', start: 'node dist/main.js' } }) + '\n',
  'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', strict: true, outDir: 'dist', rootDir: 'src' }, include: ['src'] }) + '\n',
};
const handlers = {
  'src/handlers/create.ts': "export default () => 'created';\n",
  'src/handlers/remove.ts': "export default () => 'removed';\n",
};
const handlerMove = { 'src/handlers/create.ts': 'src/modules/create/create.ts' };

describe('K4 red team: loads K4 could not evaluate', () => {
  const registry = "const handlers: Record<string, string> = { create: './handlers/create.ts', remove: './handlers/remove.ts' };\nexport const run = async (name: string) => (await import(handlers[name]!)).default();\n";

  it('fails a relative path string naming a moved module when an opaque import() can take it (head: ERR_MODULE_NOT_FOUND)', async () => {
    const base = { ...esm, ...handlers, 'src/registry.ts': registry };
    const outcome = await k4(base, variant(base, handlerMove));
    expect(details(outcome)).toEqual([
      "src/registry.ts: line 1: './handlers/create.ts' is the old path of src/handlers/create.ts (moved to src/modules/create/create.ts) [code at create]; the opaque load at src/registry.ts line 2 can take it as a module path",
    ]);
    expect(outcome.findings.map((finding) => finding.kind)).toEqual(['opaque-dynamic-load']);
  });

  it('keeps such a string a finding when no load in the repository takes an opaque path', async () => {
    const base = { ...esm, ...handlers, 'src/hint.ts': "export const hint = './handlers/create.ts';\n" };
    const outcome = await k4(base, variant(base, handlerMove));
    expect(outcome.status).toBe('pass');
    expect(outcome.findings.map((finding) => finding.kind)).toEqual(['relative-path-string']);
  });

  it('widens a conditional with more than four branches instead of dropping the fifth', async () => {
    const base = {
      ...esm,
      ...handlers,
      'src/registry.ts': "export const run = async (kind: string, name: string) => {\n  const directory = kind === 'a' ? './a/' : kind === 'b' ? './b/' : kind === 'c' ? './c/' : kind === 'd' ? './d/' : './handlers/';\n  return (await import(directory + name + '.ts')).default();\n};\n",
    };
    const outcome = await k4(base, variant(base, handlerMove));
    expect(details(outcome)).toContain("src/registry.ts: line 3: import(…) directory + name + '.ts' computes a path inside src, whose tracked contents changed (handlers, modules)");
  });

  it('maps x.js beside a moved x.ts to its emitted twin: new Worker(join(__dirname, "jobs", "worker.js")) from dist', async () => {
    const base = {
      ...emitted,
      'src/main.ts': "import { Worker } from 'node:worker_threads';\nimport path from 'node:path';\nexport const worker = new Worker(path.join(__dirname, 'jobs', 'worker.js'));\n",
      'src/jobs/worker.ts': "import { parentPort } from 'node:worker_threads';\nparentPort!.postMessage('ran');\n",
      'src/jobs/other.ts': 'export const other = 1;\n',
    };
    const outcome = await k4(base, variant(base, { 'src/jobs/worker.ts': 'src/modules/jobs/worker.ts' }));
    expect(details(outcome)).toEqual([
      "src/main.ts: line 3: new Worker(…) path.join(__dirname, 'jobs', 'worker.js') names src/jobs/worker.ts (moved to src/modules/jobs/worker.ts)",
    ]);
  });

  it('fails a glob loader whose matches keep their set but change their sorted order (route precedence)', async () => {
    const app = "import fs from 'node:fs';\nimport path from 'node:path';\nconst routes: { pattern: RegExp }[] = [];\nfor (const file of fs.globSync('src/**/*.route.ts').sort()) routes.push(await import(path.resolve(file)));\nexport const route = (url: string) => routes.find((candidate) => candidate.pattern.test(url));\n";
    const base = {
      ...esm,
      'src/app.ts': app,
      'src/routes/a-me.route.ts': 'export const pattern = /^\\/users\\/me$/;\n',
      'src/routes/b-user.route.ts': 'export const pattern = /^\\/users\\/[^/]+$/;\n',
    };
    const reordered = await k4(base, variant(base, { 'src/routes/a-me.route.ts': 'src/modules/users/me.route.ts', 'src/routes/b-user.route.ts': 'src/modules/users/by-id.route.ts' }));
    expect(details(reordered)).toContain('src/app.ts: line 4: fs.globSync(…) \'src/**/*.route.ts\' matches the same files in a different order: in code-unit sorted order, match 1 is src/routes/a-me.route.ts in base (now src/modules/users/me.route.ts) but src/modules/users/by-id.route.ts in head (was src/routes/b-user.route.ts)');
    const ordered = await k4(base, variant(base, { 'src/routes/a-me.route.ts': 'src/modules/users/a-me.route.ts', 'src/routes/b-user.route.ts': 'src/modules/users/b-user.route.ts' }));
    expect(details(ordered)).toEqual([]);
  });
});

describe('K4 red team: moved files that observe their location indirectly', () => {
  const callerHelper = [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    'export function callerDirectory(): string {',
    '  const holder: { stack?: string } = {};',
    '  Error.captureStackTrace(holder, callerDirectory);',
    "  const frame = holder.stack!.split('\\n')[2]!;",
    "  return path.dirname(/\\((.*):\\d+:\\d+\\)$/.exec(frame)![1]!);",
    '}',
    "export const readBeside = (name: string) => fs.readFileSync(path.join(callerDirectory(), name), 'utf8');",
    '',
  ].join('\n');

  it('fails a moved file that imports an unmoved helper reading its caller location from the stack, and the sibling it names', async () => {
    const base = {
      ...esm,
      'src/lib/caller.ts': callerHelper,
      'src/services/mail.txt': 'Hello\n',
      'src/services/mailer.ts': "import { readBeside } from '../lib/caller.ts';\nexport const template = () => readBeside('mail.txt');\n",
    };
    const head = variant(base, { 'src/services/mailer.ts': 'src/modules/mail/mailer.ts' }, { 'src/modules/mail/mailer.ts': [["'../lib/caller.ts'", "'../../lib/caller.ts'"]] });
    const outcome = await k4(base, head);
    expect(details(outcome)).toEqual([
      "src/services/mailer.ts: moved to src/modules/mail/mailer.ts; imports src/lib/caller.ts, which reads its caller's location (line 6: holder.stack!: inspects a stack trace, whose frames name files): it now sees src/modules/mail/mailer.ts",
      "src/services/mailer.ts: moved to src/modules/mail/mailer.ts; line 2: 'mail.txt' names src/services/mail.txt beside the file in base; from the new location it names src/modules/mail/mail.txt, while src/services/mail.txt is at src/services/mail.txt",
    ]);
  });

  it('fails a moved test whose toMatchFileSnapshot path is resolved against the test file', async () => {
    const base = {
      'package.json': '{ "type": "module" }\n',
      'src/views/render.ts': 'export const render = (name: string) => `<b>${name}</b>`;\n',
      'src/views/render.test.ts': "import { expect, it } from 'vitest';\nimport { render } from './render.js';\nit('renders', async () => {\n  await expect(render('Ada')).toMatchFileSnapshot('../../test/cards/card.html');\n});\n",
      'test/cards/card.html': '<b>Ada</b>',
    };
    const head = variant(base, { 'src/views/render.ts': 'src/modules/user/views/render.ts', 'src/views/render.test.ts': 'src/modules/user/views/render.test.ts' });
    const outcome = await k4(base, head);
    expect(details(outcome)).toEqual([
      "src/views/render.test.ts: moved to src/modules/user/views/render.test.ts; line 4: toMatchFileSnapshot('../../test/cards/card.html') resolves its path against the test file",
      "src/views/render.test.ts: moved to src/modules/user/views/render.test.ts; line 4: '../../test/cards/card.html' names test/cards/card.html beside the file in base; from the new location it names src/modules/test/cards/card.html, while test/cards/card.html is at test/cards/card.html",
    ]);
  });
});

describe('K4 red team: old paths that are not spelled as a moved file', () => {
  const lambda = {
    ...emitted,
    'serverless.yml': 'functions:\n  create:\n    handler: dist/handlers/create.handler\n',
    'src/handlers/create.ts': 'export const handler = async () => ({ statusCode: 201 });\n',
    'src/handlers/remove.ts': 'export const handler = async () => ({ statusCode: 200 });\n',
  };

  it('fails a serverless handler reference (<module>.<export>) to a moved file', async () => {
    const outcome = await k4(lambda, variant(lambda, handlerMove));
    expect(details(outcome)).toEqual([
      "serverless.yml: line 3: 'dist/handlers/create.handler' is the emitted path without extension, as a handler reference of src/handlers/create.ts (moved to src/modules/create/create.ts) [infra at functions.create.handler]",
    ]);
  });

  it('fails a directory named in config whose contents the move changes (package.json files)', async () => {
    const base = {
      ...emitted,
      'package.json': JSON.stringify({ name: 'red-team', main: 'dist/index.js', files: ['dist/index.js', 'dist/handlers'] }, null, 2) + '\n',
      ...handlers,
      'src/index.ts': "export { default as create } from './handlers/create';\n",
    };
    const head = variant(base, handlerMove, { 'src/index.ts': [["'./handlers/create'", "'./modules/create/create'"]] });
    const outcome = await k4(base, head);
    expect(details(outcome)).toEqual([
      "package.json: line 6: 'dist/handlers' is the directory src/handlers (as dist/handlers), whose contents change with the move of src/handlers/create.ts (moved to src/modules/create/create.ts) [config at files]",
    ]);
  });
});

describe('K6 red team under vitest: snapshot files keyed by test path', () => {
  const repo: Files = {
    'package.json': JSON.stringify({ name: 'snapshots', private: true, type: 'module', scripts: { test: 'vitest run' } }),
    'vitest.config.mjs': "export default {\n  test: {\n    include: ['src/**/*.test.ts'],\n    resolveSnapshotPath: (testPath, extension) => testPath.replace('/src/', '/snapshots/') + extension,\n  },\n};\n",
    'snapshots/services/greet.test.ts.snap': '// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html\n\nexports[`greets 1`] = `"hello Ada"`;\n',
    'src/services/greet.ts': 'export const greet = (name: string) => `hello ${name}`;\n',
    'src/services/greet.test.ts': "import { expect, it } from 'vitest';\nimport { greet } from './greet.js';\n\nit('greets', () => {\n  expect(greet('Ada')).toMatchSnapshot();\n});\n",
  };
  const moves = { 'src/services/greet.ts': 'src/modules/greet/greet.ts', 'src/services/greet.test.ts': 'src/modules/greet/greet.test.ts' };

  it('fails a test moved away from the snapshot its resolveSnapshotPath names (head: 1 snapshot written, or failed under CI)', async () => {
    const check = checkOf(await certifyFiles(repo, variant(repo, moves), { only: ['K6'], nodeModules: localNodeModules }), 'K6');
    expect(check.violations.map((violation) => `${violation.file}: ${violation.detail}`)).toEqual([
      'src/modules/greet/greet.test.ts: snapshot file: base reads snapshots/services/greet.test.ts.snap (tracked), head reads snapshots/modules/greet/greet.test.ts.snap (not tracked); snapshots/services/greet.test.ts.snap is at snapshots/services/greet.test.ts.snap in head',
    ]);
  });

  it('passes the same move with the snapshot moved along', async () => {
    const head = variant(repo, { ...moves, 'snapshots/services/greet.test.ts.snap': 'snapshots/modules/greet/greet.test.ts.snap' });
    const check = checkOf(await certifyFiles(repo, head, { only: ['K6'], nodeModules: localNodeModules }), 'K6');
    expect(check.violations).toEqual([]);
    expect(check.metrics.snapshotFileChanges).toBe(0);
  });
});

describe.skipIf(!installed(jestNodeModules, 'jest'))('K6 red team under jest: projects', () => {
  const repo: Files = {
    'package.json': JSON.stringify({ name: 'projects', private: true, scripts: { test: 'jest' } }),
    'jest.config.cjs': [
      'module.exports = {',
      '  projects: [',
      "    { displayName: 'browser', testRegex: '/src/ui/.*\\\\.test\\\\.js$', setupFiles: ['<rootDir>/test/browser-globals.cjs'] },",
      "    { displayName: 'server', testRegex: '\\\\.test\\\\.js$', testPathIgnorePatterns: ['/node_modules/', '/src/ui/'] },",
      '  ],',
      '};',
      '',
    ].join('\n'),
    'test/browser-globals.cjs': "globalThis.document = { title: 'Users' };\n",
    'src/server/health.test.js': "test('health', () => expect(1).toBe(1));\n",
    'src/ui/layout.test.js': "test('layout', () => expect(globalThis.document.title).toBe('Users'));\n",
    'src/ui/users/title.cjs': "exports.title = (document) => (document ? document.title : 'no document');\n",
    'src/ui/users/title.test.js': "const { title } = require('./title.cjs');\n\ntest('renders the title', () => expect(title(globalThis.document)).toBe('Users'));\n",
  };

  it('fails a test moved into another project, which --listTests and the per-file cases do not show (head: no document)', async () => {
    const head = variant(repo, { 'src/ui/users/title.cjs': 'src/modules/users/title.cjs', 'src/ui/users/title.test.js': 'src/modules/users/title.test.js' });
    const check = checkOf(await certifyFiles(repo, head, { only: ['K6'], nodeModules: jestNodeModules }), 'K6');
    expect(check.violations.map((violation) => `${violation.file}: ${violation.detail}`)).toEqual([
      "src/modules/users/title.test.js: jest projects: 'browser' in base (as src/ui/users/title.test.js), 'server' in head (a project brings its own setupFiles, environment and transforms)",
    ]);
  }, 120_000);
});

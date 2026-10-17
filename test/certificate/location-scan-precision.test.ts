// K4 precision (S7 round 2, found by certifying `ac scramble`'s type-folder flattening): strings that are not paths
// into the change become findings, each next to the true positive that must still fail. Every false positive here
// is the shape of one the scrambles of hoppscotch, kaneo and ghostfolio produced.
import { describe, expect, it } from 'vitest';
import { locationScan } from '../../src/certificate/location-scan.js';
import type { CheckResult } from '../../src/certificate/types.js';
import { type Files, variant } from './runner-repos.js';
import { withContext } from './two-commit-repo.js';

const k4 = (base: Files, head: Files, packageRoot = ''): CheckResult => withContext(base, head, (context) => locationScan.run(context) as CheckResult, { packageRoot });
const details = (outcome: CheckResult) => outcome.violations.map((violation) => `${violation.file}: ${violation.detail}`);
const findingsOf = (outcome: CheckResult, kind: string) => outcome.findings.filter((finding) => finding.kind === kind).map((finding) => `${finding.file}: ${finding.detail}`);

// A type-sliced Nest-style backend: `src/team/` and `src/admin/` are emptied by the flattening.
const backend: Files = {
  'package.json': JSON.stringify({ name: 'backend', private: true }) + '\n',
  'src/team/team.service.ts': 'export class TeamService {}\n',
  'src/admin/admin.service.ts': 'export class AdminService {}\n',
  'src/admin/sub/audit.ts': 'export const audit = 1;\n',
};
const flatten = { 'src/team/team.service.ts': 'src/services/team.service.ts', 'src/admin/admin.service.ts': 'src/services/admin.service.ts', 'src/admin/sub/audit.ts': 'src/utils/audit.ts' };
const scan = (files: Files, moves: Record<string, string> = flatten) => k4({ ...backend, ...files }, variant({ ...backend, ...files }, moves));

describe('K4 precision: comments and types', () => {
  it('reads a JSDoc block as a comment (kaneo s3.ts), but not the value it documents', () => {
    const outcome = scan({
      'src/storage.ts': "/** Call only after checking the object's team/workspace key prefix. */\nexport const prefix = 'src/team/team.service.ts';\n",
    });
    expect(findingsOf(outcome, 'old-path-in-comment')).toEqual([expect.stringMatching(/^src\/storage\.ts: line 1: 'team\/workspace'/)]);
    expect(details(outcome)).toEqual([expect.stringMatching(/^src\/storage\.ts: line 2: 'src\/team\/team\.service\.ts' is the old path/)]);
  });

  it('takes strings in types as erased (hoppscotch topicsDefs.ts), not strings in values', () => {
    const outcome = scan({
      'src/topics.ts': "export type Topics = { [topic: `team/${string}/member_added`]: number };\nexport type Failure = Either<'team/invalid_id', number>;\ntype Either<L, R> = L | R;\n",
      'src/reader.ts': "import fs from 'node:fs';\nexport const read = () => fs.readFileSync('src/team/team.service.ts', 'utf8');\n",
    });
    expect(findingsOf(outcome, 'old-path-in-type')).toHaveLength(2);
    expect(details(outcome)).toEqual([
      "src/reader.ts: line 2: fs.readFileSync(…) 'src/team/team.service.ts' names src/team/team.service.ts (moved to src/services/team.service.ts)",
      "src/reader.ts: line 2: 'src/team/team.service.ts' is the old path of src/team/team.service.ts (moved to src/services/team.service.ts) [code]",
    ]);
  });
});

describe('K4 precision: strings that only non-path consumers take', () => {
  it('passes Nest route strings (ghostfolio), not a string given to a decorator of the same kind from elsewhere', () => {
    const controller = [
      "import { Controller, Get } from '@nestjs/common';",
      "import { Render } from './render';",
      "@Controller('team/queue')",
      'export class QueueController {',
      "  @Get(['team/', 'admin/:id/test']) list() { return 1; }",
      "  @Render('admin/sub') view() { return 1; }",
      '}',
      '',
    ].join('\n');
    const outcome = scan({ 'src/queue.controller.ts': controller, 'src/render.ts': 'export const Render = (template: string) => () => template;\n' });
    expect(findingsOf(outcome, 'non-path-string').map((finding) => finding.replace(/ is the .*the string goes only to/, ' …'))).toEqual([
      "src/queue.controller.ts: line 3: 'team/queue' … an HTTP route (Controller from @nestjs/common)",
      "src/queue.controller.ts: line 5: 'team/' … an HTTP route (Get from @nestjs/common)",
      "src/queue.controller.ts: line 5: 'admin/' … an HTTP route (Get from @nestjs/common)",
    ]);
    expect(details(outcome)).toEqual([expect.stringMatching(/^src\/queue\.controller\.ts: line 6: 'admin\/sub' is the directory the move emptied of src\/admin\/sub/)]);
  });

  it('passes test titles and values an assertion compares, not a test table or a custom matcher', () => {
    const spec = [
      "it('publishes team/<id>/member_added', () => {",
      "  expect(publish).toHaveBeenCalledWith(`team/${id}/member_added`, 1);",
      "  expect(topic).not.toBe('admin/x');",
      '});',
      "it.each(['src/team/team.service.ts'])('reads %s', (file) => read(file));",
      "expect('src/admin/sub').toExistOnDisk();",
      '',
    ].join('\n');
    const outcome = scan({ 'src/topics.spec.ts': spec });
    expect(findingsOf(outcome, 'non-path-string').map((finding) => /line (\d+).*goes only to (.*)$/.exec(finding)!.slice(1).join(': '))).toEqual([
      '1: the title of a it() block',
      '2: a value toHaveBeenCalledWith compares',
      '3: a value toBe compares',
    ]);
    expect(details(outcome).map((detail) => /line (\d+): '([^']+)' is the (\S+ \S+)/.exec(detail)!.slice(1).join(' '))).toEqual([
      '5 src/team/team.service.ts old path',
      '6 src/admin/sub directory the',
    ]);
  });

  it('follows a string through a constant, a loop and a local function, and stops at a consumer that reads files', () => {
    const source = [
      "import fs from 'node:fs';",
      "const ROUTES = ['/team/{id}', '/admin/{id}'];",
      'for (const route of ROUTES) console.log(route);',
      "function request(path: string) { return path.startsWith('/') ? fetch(`https://api${path}`) : null; }",
      "export const repos = () => request('/team/repos?page=1');",
      'function load(file: string) { return fs.readFileSync(file); }',
      "export const audit = () => load('src/admin/sub/audit.ts');",
      '',
    ].join('\n');
    const outcome = scan({ 'src/client.ts': source });
    expect(findingsOf(outcome, 'non-path-string').map((finding) => /line (\d+).*goes only to (.*)$/.exec(finding)!.slice(1).join(': '))).toEqual([
      '5: a URL (fetch); a string test (startsWith)',
    ]);
    // ROUTES flows into a for-of whose variable only console.log reads, but an array element is judged with the
    // array's other uses: here none, so it stays open and the absolute-path reading decides (finding below).
    expect(findingsOf(outcome, 'absolute-path-string')).toHaveLength(2);
    expect(details(outcome)).toEqual([
      'src/client.ts: line 6: fs.readFileSync(…) file names src/admin/sub/audit.ts (moved to src/utils/audit.ts)',
      "src/client.ts: line 7: 'src/admin/sub/audit.ts' is the old path of src/admin/sub/audit.ts (moved to src/utils/audit.ts) [code]",
    ]);
  });

  it('passes a sentence under a prose key in JSON and code (kaneo sentry/alerts.json), not a bare path under it or under another key', () => {
    const outcome = scan({
      'sentry/alerts.json': JSON.stringify({ alerts: [{ description: 'Covers the crons in src/team/team.service.ts.', path: 'src/team/team.service.ts' }] }, null, 2) + '\n',
      'src/model.ts': "export const field = { description: 'Workspace ID (of team/user ID)', example: 'src/team/team.service.ts' };\n",
      'schema.json': JSON.stringify({ description: 'src/team/team.service.ts' }) + '\n',
    });
    expect(findingsOf(outcome, 'non-path-string').map((finding) => finding.split(':')[0])).toEqual(['sentry/alerts.json', 'src/model.ts']);
    expect(details(outcome).map((detail) => detail.split(': line')[0])).toEqual(['schema.json', 'sentry/alerts.json', 'src/model.ts']);
  });
});

describe('K4 precision: where a path is read', () => {
  it('judges a string inside a path built from __dirname by the path it builds (hoppscotch sibling vite configs)', () => {
    const files: Files = {
      'server/package.json': '{}\n',
      'server/src/util/format.ts': 'export const format = 1;\n',
      'kernel/package.json': '{}\n',
      'kernel/vite.config.ts': "import { resolve } from 'node:path';\nexport default { resolve: { alias: { '@util': resolve(__dirname, './src/util'), '@server': resolve(__dirname, '../server/src/util') } } };\n",
    };
    const outcome = k4(files, variant(files, { 'server/src/util/format.ts': 'server/src/shared/format.ts' }), 'server');
    expect(findingsOf(outcome, 'resolved-path-string')).toEqual([expect.stringContaining("which names kernel/src/util: nothing the move changed")]);
    expect(details(outcome)).toEqual([
      "kernel/vite.config.ts: line 2: '../server/src/util' is a segment of resolve(__dirname, '../server/src/util'), which names server/src/util: the directory the move emptied of server/src/util (moved to server/src/shared) [config at resolve.alias.@server]",
    ]);
  });

  it('reads a Nix input\'s dir in its own source tree (hoppscotch devenv.lock), a local path input in this checkout', () => {
    const lock = (type: string) => JSON.stringify({ nodes: { devenv: { locked: { dir: 'src/team', type, ...(type === 'path' ? { path: '.' } : { owner: 'cachix', repo: 'devenv' }) } } }, version: 7 }, null, 2) + '\n';
    const foreign = scan({ 'devenv.lock': lock('github') });
    expect(findingsOf(foreign, 'non-path-string')).toEqual([expect.stringContaining("a directory of the Nix input 'devenv' (github cachix/devenv)")]);
    expect(details(foreign)).toEqual([]);
    expect(details(scan({ 'devenv.lock': lock('path') }))).toEqual([expect.stringMatching(/^devenv\.lock: line 5: 'src\/team' is the directory the move emptied/)]);
  });

  it('reads an absolute glob in code at the repository and package root only (kaneo routes), not a path after a substitution', () => {
    const source = [
      "export const route = { path: '/team/{teamId}' };",
      "export const container = '/src/team/*.ts';",
      "export const hook = (base: string, id: string) => `${base.replace(/\\/$/, '')}/team/webhook/${id}`;",
      '',
    ].join('\n');
    const outcome = scan({ 'src/routes/team.routes.ts': source });
    expect(findingsOf(outcome, 'absolute-path-string')).toEqual([expect.stringMatching(/line 1: '\/team\/\{teamId\}'/)]);
    expect(details(outcome).map((detail) => /line (\d+): '([^']+)' is the (glob \S+)/.exec(detail)!.slice(1).join(' '))).toEqual([
      '2 /src/team/*.ts glob src/team/*.ts',
      '3 /team/webhook/${id} glob src/team/webhook/${id}',
    ]);
  });
});

describe('K4 precision: strings below an emptied directory that reach nothing (hoppscotch errors.ts, pubsub topics)', () => {
  it('records an error code and a topic read only at the file\'s directory as findings', () => {
    const outcome = scan({
      'src/errors.ts': "export const ONLY_ONE_ADMIN = 'admin/only_one_admin_account_found' as const;\n",
      'src/publisher.ts': 'export const publish = (bus: { publish(topic: string): void }, id: string) => bus.publish(`team/${id}/member_added`);\n',
    });
    expect(details(outcome)).toEqual([]);
    expect(findingsOf(outcome, 'unreachable-path-string').map((finding) => /line \d+: '([^']+)'/.exec(finding)![1])).toEqual(['admin/only_one_admin_account_found', 'team/${id}/member_added']);
    expect(findingsOf(outcome, 'unreachable-path-string')[0]).toContain('only src/admin around it is gone, which matters only to a consumer rooted there that creates files in it');
  });

  it('keeps a string that reaches the change from the cwd, the emptied directory itself, a moved subdirectory, or a dynamic end', () => {
    const outcome = scan({
      'src/strings.ts': [
        "export const cache = 'src/admin/cache.json';",
        "export const folder = 'admin/';",
        "export const sub = 'admin/sub';",
        'export const anything = (id: string) => `team/${id}`;',
        'export const audit = (id: string) => `admin/${id}/audit.ts`;',
        '',
      ].join('\n'),
    });
    expect(details(outcome).map((detail) => /line (\d+)/.exec(detail)![1])).toEqual(['1', '2', '3', '4', '5']);
    expect(findingsOf(outcome, 'unreachable-path-string')).toEqual([]);
  });

  it('keeps it when the repository computes the directory it is read at (a consumer rooted there)', () => {
    const files = {
      'src/errors.ts': "export const ONLY_ONE_ADMIN = 'admin/only_one_admin_account_found';\n",
      'src/main.ts': "import { join } from 'node:path';\nexport const logs = { root: join(__dirname) };\n",
    };
    expect(details(scan(files))).toEqual([expect.stringMatching(/^src\/errors\.ts: line 1: 'admin\/only_one_admin_account_found' is the path inside a directory the move emptied/)]);
  });
});

describe('K4 precision: computed paths whose parts are all known (kaneo release scripts)', () => {
  const scripts = (body: string): Files => ({
    'package.json': '{}\n',
    'apps/api/src/project/project.service.ts': 'export const project = 1;\n',
    'scripts/release.mjs': `import { readFileSync, writeFileSync } from 'node:fs';\nimport { dirname, join } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nconst root = join(dirname(fileURLToPath(import.meta.url)), '..');\n${body}`,
  });
  const move = { 'apps/api/src/project/project.service.ts': 'apps/api/src/services/project.service.ts' };
  const run = (body: string) => { const files = scripts(body); return details(k4(files, variant(files, move))); };

  it('evaluates a local function\'s parameter from its calls and a loop variable from its array', () => {
    expect(run("function rewrite(relativePath) { writeFileSync(join(root, relativePath), readFileSync(join(root, relativePath))); }\nrewrite('package.json');\nfor (const file of ['package.json', 'scripts/release.mjs']) readFileSync(join(root, file));\n")).toEqual([]);
  });

  it('still fails a call or an element that names a moved file, and a parameter it can\'t pin down', () => {
    expect(run("function rewrite(relativePath) { readFileSync(join(root, relativePath)); }\nrewrite('package.json');\nrewrite('apps/api/src/project/project.service.ts');\n")).toEqual([
      'scripts/release.mjs: line 5: readFileSync(…) join(root, relativePath) names apps/api/src/project/project.service.ts (moved to apps/api/src/services/project.service.ts)',
      expect.stringMatching(/^scripts\/release\.mjs: line 7: 'apps\/api\/src\/project\/project\.service\.ts' is the old path/),
    ]);
    expect(run("for (const file of ['package.json', 'apps/api/src/project/project.service.ts']) readFileSync(join(root, file));\n")).toEqual([
      'scripts/release.mjs: line 5: readFileSync(…) join(root, file) names apps/api/src/project/project.service.ts (moved to apps/api/src/services/project.service.ts)',
      expect.stringMatching(/^scripts\/release\.mjs: line 5: 'apps\/api\/src\/project\/project\.service\.ts' is the old path/),
    ]);
    expect(run("function rewrite(relativePath) { relativePath = relativePath.trim(); readFileSync(join(root, relativePath)); }\nrewrite('package.json');\n"))
      .toEqual([expect.stringContaining('computes a path inside ., whose tracked contents changed')]);
    expect(run("export function rewrite(relativePath) { readFileSync(join(root, relativePath)); }\nrewrite('package.json');\n"))
      .toEqual([expect.stringContaining('computes a path inside ., whose tracked contents changed')]);
  });
});

// Kysely common table expressions in the facts' table scan (s7.md item 10): planner rules 1 read every
// `selectFrom`/join literal as a table, so `db.with('cte', …).selectFrom('cte')` read a table `cte`; rules 2 read the
// alias as what it is. Unit cases on scanTables, then the rules threaded through buildFacts, planRepo's edit prompt and
// the findings' target.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { loadTarget } from '../../src/findings/target.js';
import type { Gateway, StructuredRequest, StructuredResult } from '../../src/gateway/types.js';
import { defaultCriticSettings } from '../../src/planner/critic.js';
import { defaultEditSettings } from '../../src/planner/edit.js';
import { buildFacts } from '../../src/planner/facts.js';
import { scanTables } from '../../src/planner/facts-scan.js';
import { planRepo } from '../../src/planner/plan.js';

/** A Kysely-style file: `body` is the method bodies of a repository class over an untyped `db`. */
const repository = (...body: string[]) => ['declare const db: any;', 'export class Repository {', ...body.map((line) => `  ${line}`), '}', ''].join('\n');
const scanned = (text: string) => ({ rules1: scanTables(text, 1), rules2: scanTables(text, 2) });
/** JSX text holding backticks and a call's shape around a real query: parsed as TS, the backticks would make a template. */
const view = "declare const db: any;\nexport const View = () => <p>Press ` to open</p>;\nexport const load = () => db.selectFrom('album').execute();\nexport const Help = () => <p>or ` again, selectFrom('draft')</p>;\n";

describe('scanTables: Kysely common table expressions', () => {
  it('a plain alias read is no table under rules 2, a table under rules 1', () => {
    const text = repository("recent() { return db.with('recent', (qb) => qb.selectFrom('asset').selectAll()).selectFrom('recent').selectAll().execute(); }");
    expect(scanned(text)).toEqual({ rules1: { reads: ['asset', 'recent'], writes: [] }, rules2: { reads: ['asset'], writes: [] } });
  });

  it("a with that shadows a real table: its own body still reads the table, the query after it reads the alias", () => {
    const shadowing = repository("own() { return db.with('asset', (qb) => qb.selectFrom('asset').where('ownerId', '=', 1)).selectFrom('asset').innerJoin('album', 'album.id', 'asset.albumId').selectAll().execute(); }");
    expect(scanned(shadowing).rules2).toEqual({ reads: ['album', 'asset'], writes: [] });
    // Control: when the body reads another table, the read after it is the alias alone.
    const aliasOnly = repository("own() { return db.with('asset', (qb) => qb.selectFrom('album_asset')).selectFrom('asset').selectAll().execute(); }");
    expect(scanned(aliasOnly)).toEqual({ rules1: { reads: ['album_asset', 'asset'], writes: [] }, rules2: { reads: ['album_asset'], writes: [] } });
  });

  it('a recursive tree(id, parentId) is the alias inside its own body and after it', () => {
    const text = repository(
      'descendants(id: string) {',
      "  return db.withRecursive('tree(id, parentId)', (qb) => qb.selectFrom('tag').select(['id', 'parentId']).where('id', '=', id)",
      "    .unionAll((eb) => eb.selectFrom('tag').innerJoin('tree', 'tag.parentId', 'tree.id').select(['tag.id', 'tag.parentId'])))",
      "    .selectFrom('tree').selectAll().execute();",
      '}',
    );
    expect(scanned(text)).toEqual({ rules1: { reads: ['tag', 'tree'], writes: [] }, rules2: { reads: ['tag'], writes: [] } });
  });

  it('an alias read in a nested where callback, with a property call or a destructured selectFrom', () => {
    const text = repository(
      "inAlbums() { return db.with('mine', (qb) => qb.selectFrom('album').select('id')).selectFrom('asset')",
      "  .where((eb) => eb('asset.albumId', 'in', eb.selectFrom('mine').select('mine.id')))",
      "  .where(({ exists, selectFrom }) => exists(selectFrom('mine').whereRef('mine.id', '=', 'asset.albumId'))).selectAll().execute(); }",
    );
    expect(scanned(text)).toEqual({ rules1: { reads: ['album', 'asset', 'mine'], writes: [] }, rules2: { reads: ['album', 'asset'], writes: [] } });
  });

  it("a separate query reading a real table of the alias's name still reads the table", () => {
    const text = repository(
      "faces() { return db.with('person', (qb) => qb.selectFrom('face')).selectFrom('person').selectAll().execute(); }",
      "people() { return db.selectFrom('person').selectAll().execute(); }",
    );
    expect(scanned(text).rules2).toEqual({ reads: ['face', 'person'], writes: [] });
    expect(scanTables(repository("faces() { return db.with('person', (qb) => qb.selectFrom('face')).selectFrom('person').selectAll().execute(); }"), 2).reads).toEqual(['face']);
  });

  it('await chains, non-null assertions and a template literal name', () => {
    const text = repository(
      "async counts() { const rows = await db.with('cte', (qb) => qb.selectFrom('asset').select('id')).selectFrom('cte').selectAll().execute(); return rows; }",
      "async first() { return (await db.with('res', (qb) => qb.selectFrom('exif')).selectFrom(`res`).selectAll().executeTakeFirst())!; }",
      "async other() { return await db!.with('today', (qb) => qb.selectFrom('memory')).selectFrom('today').leftJoin('today as t', 'a', 'b').execute(); }",
    );
    expect(scanned(text)).toEqual({ rules1: { reads: ['asset', 'cte', 'exif', 'memory', 'res', 'today'], writes: [] }, rules2: { reads: ['asset', 'exif', 'memory'], writes: [] } });
  });

  it('the builder form names the alias too (immich person.repository: `.with((cte) => cte(\'mapping\').materialized(), …)`)', () => {
    const text = repository(
      "remap() { return db.with('shared', (qb) => qb.selectFrom('person').select('person.groupId as oldId'))",
      "  .with((cte) => cte('mapping').materialized(), (qb) => qb.selectFrom('shared').select(['shared.oldId']))",
      "  .with('created', (qb) => qb.insertInto('person_group').expression((eb) => eb.selectFrom('mapping').select(['mapping.oldId'])))",
      "  .selectFrom('mapping').select(['mapping.oldId']).execute(); }",
    );
    // A later expression reads an earlier one's alias; writes are never aliases.
    expect(scanned(text)).toEqual({
      rules1: { reads: ['mapping', 'person', 'shared'], writes: ['person_group'] },
      rules2: { reads: ['person'], writes: ['person_group'] },
    });
  });

  it('a query built across statements is not one chain: its later read of the alias stays a table read', () => {
    const text = repository("split() { const base = db.with('cte', (qb) => qb.selectFrom('asset')); return base.selectFrom('cte').selectAll().execute(); }");
    expect(scanned(text)).toEqual({ rules1: { reads: ['asset', 'cte'], writes: [] }, rules2: { reads: ['asset', 'cte'], writes: [] } });
  });

  it("a with that isn't on a Kysely query declares nothing: ts-pattern's handlers read real tables (review P1)", () => {
    const text = repository(
      "byKind(kind: string) { return match(kind).with('album', () => db.selectFrom('asset').selectAll().execute()).with('asset', () => db.selectFrom('album').selectAll().execute()).exhaustive(); }",
      "joined(kind: string) { return match(kind).with('user', () => 1).with('other', () => db.selectFrom('asset').innerJoin('user', 'user.id', 'asset.ownerId').execute()).otherwise(() => 0); }",
    );
    expect(scanned(text)).toEqual({ rules1: { reads: ['album', 'asset', 'user'], writes: [] }, rules2: { reads: ['album', 'asset', 'user'], writes: [] } });
  });

  it("a later declaration's name is the table inside an earlier one's body, unless the list is recursive (review P2)", () => {
    const earlier = repository(
      "recent() { return db.with('recent', (qb) => qb.selectFrom('asset').select('id')).with('asset', (qb) => qb.selectFrom('recent').select('id')).selectFrom('asset').selectAll().execute(); }",
    );
    expect(scanned(earlier)).toEqual({ rules1: { reads: ['asset', 'recent'], writes: [] }, rules2: { reads: ['asset'], writes: [] } });
    const joined = repository(
      "faces() { return db.with('recent', (qb) => qb.selectFrom('person').innerJoin('asset', 'asset.id', 'person.assetId')).with('asset', (qb) => qb.selectFrom('recent')).selectFrom('asset').selectAll().execute(); }",
    );
    expect(scanned(joined).rules2).toEqual({ reads: ['asset', 'person'], writes: [] });
    // Control: declared first, the alias is what a later body reads.
    const reversed = repository(
      "faces() { return db.with('asset', (qb) => qb.selectFrom('person')).with('recent', (qb) => qb.selectFrom('asset')).selectFrom('recent').selectAll().execute(); }",
    );
    expect(scanned(reversed).rules2).toEqual({ reads: ['person'], writes: [] });
    // Kysely: the first call decides whether the whole list is recursive; in a recursive list every name is visible.
    const recursiveFirst = repository("tree() { return db.withRecursive('a', (qb) => qb.selectFrom('b')).with('b', (qb) => qb.selectFrom('tag')).selectFrom('a').selectAll().execute(); }");
    expect(scanned(recursiveFirst).rules2).toEqual({ reads: ['tag'], writes: [] });
    const recursiveLater = repository("tree() { return db.with('a', (qb) => qb.selectFrom('b')).withRecursive('b', (qb) => qb.selectFrom('tag')).selectFrom('a').selectAll().execute(); }");
    expect(scanned(recursiveLater).rules2).toEqual({ reads: ['b', 'tag'], writes: [] });
  });

  it('rules 2 count no match in a comment, a string or a template text; rules 1 count them all (review P3)', () => {
    const query = "export const q = (db: any) => db.with('cte', (qb: any) => qb.selectFrom('asset').select('id')).selectFrom('cte').selectAll().execute();";
    const mentions = [
      "// db.selectFrom('cte') is how we used to read it",
      "/* db.selectFrom('cte') */",
      "export const doc = \"db.selectFrom('cte')\";",
      "export const snippet = `db.selectFrom('cte')`;",
      "// .innerJoin('cte', 'cte.id', 'x.id')",
      '/** @example db.selectFrom(\'cte\') */',
    ];
    for (const mention of mentions) expect(scanned(`${mention}\n${query}\n`), mention).toEqual({ rules1: { reads: ['asset', 'cte'], writes: [] }, rules2: { reads: ['asset'], writes: [] } });
    // Every shape: a commented-out Kysely write, Prisma call or Drizzle call is no table under rules 2.
    const commented = [
      "// db.insertInto('audit')",
      "declare const prisma: any;\n// prisma.team.findMany()\nexport const drop = () => prisma.member.delete({});",
      "declare const db: any;\ndeclare const taskTable: unknown;\nexport const tasks = () => db.select().from(taskTable); // db.delete(userTable)",
    ].join('\n');
    expect(scanned(commented)).toEqual({ rules1: { reads: ['task', 'team'], writes: ['audit', 'member', 'user'] }, rules2: { reads: ['task'], writes: ['member'] } });
    // A call inside a template's substitution is code.
    expect(scanTables("declare const db: any;\nexport const s = `${db.selectFrom('album')}`;\n", 2).reads).toEqual(['album']);
  });

  it("parses a .tsx file as TSX: a backtick in JSX text starts no template that hides a call", () => {
    expect(scanTables(view, 2, 'src/views/album.view.tsx')).toEqual({ reads: ['album'], writes: [] });
    expect(scanTables(view, 1, 'src/views/album.view.tsx')).toEqual({ reads: ['album', 'draft'], writes: [] });
  });

  it('a file without with() and the Prisma and Drizzle shapes scan the same under both rules', () => {
    const texts = [
      repository("find() { return db.selectFrom('album').innerJoin('album_asset', 'a', 'b'); }", "add() { return db.insertInto('album_asset'); }"),
      'declare const prisma: any;\nexport const teams = () => prisma.team.findMany();\nexport const drop = () => prisma.team.delete({});\n',
      'declare const db: any;\ndeclare const taskTable: unknown;\nexport const tasks = () => db.select().from(taskTable).with(1);\n',
      // A with() that isn't Kysely's (an array's `with(index, value)`): nothing to leave out.
      repository("find() { const list = [1].with(0, 2); return db.selectFrom('album').where('id', 'in', list); }"),
    ];
    for (const text of texts) expect(scanTables(text, 2), text).toEqual(scanTables(text, 1));
  });
});

const sources: Record<string, string> = {
  'server/package.json': '{ "name": "fixture", "type": "module", "main": "dist/main.js" }\n',
  'server/tsconfig.json': '{ "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext", "target": "es2022", "strict": true }, "include": ["src"] }\n',
  'server/src/main.ts': "import { AlbumService } from './services/album.service.js';\nexport const app = [AlbumService];\n",
  'server/src/services/album.service.ts': "import { AlbumRepository } from '../repositories/album.repository.js';\nexport class AlbumService {\n  constructor(readonly albums: AlbumRepository) {}\n}\n",
  'server/src/repositories/album.repository.ts': repository(
    "recent() { return db.with('recent', (qb) => qb.selectFrom('album').selectAll()).selectFrom('recent').innerJoin('album_asset', 'a', 'b').selectAll().execute(); }",
    "add() { return db.insertInto('album_asset'); }",
  ),
  'server/src/views/album.view.tsx': view,
};

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cte-aliases-'));
afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));
const repoRoot = path.join(temporary, 'repo');
for (const [file, text] of Object.entries(sources)) {
  fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, file), text);
}
const git = (...args: string[]) => execFileSync('git', ['-C', repoRoot, '-c', 'user.name=fixture', '-c', 'user.email=fixture@ac.invalid', ...args], { encoding: 'utf8' }).trim();
git('init', '-q');
git('add', '-A');
git('commit', '-q', '-m', 'fixture');
const repositoryFile = 'src/repositories/album.repository.ts';
const tablesUnder = (rules: 1 | 2) => buildFacts(gitRepoFs(repoRoot), { packageRoot: 'server', moduleRoot: 'src', rules }).files.find((file) => file.path === repositoryFile)?.tables;

describe('the planner rules decide the facts', () => {
  it('buildFacts scans under the rules it is given', () => {
    expect(tablesUnder(1)).toEqual({ reads: ['album', 'album_asset', 'recent'], writes: ['album_asset'] });
    expect(tablesUnder(2)).toEqual({ reads: ['album', 'album_asset'], writes: ['album_asset'] });
    // buildFacts hands the scan the file's name, so a .tsx file is parsed as TSX.
    expect(buildFacts(gitRepoFs(repoRoot), { packageRoot: 'server', moduleRoot: 'src', rules: 2 }).files.find((file) => file.path === 'src/views/album.view.tsx')?.tables).toEqual({ reads: ['album'], writes: [] });
  });

  it("planRepo reads the facts under its edit settings' rules: the edit prompt shows what they scanned", async () => {
    const prompts: string[] = [];
    // No edit comes back, so the draft wins and no critic is asked.
    const gateway: Gateway = {
      async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
        prompts.push(request.messages[1]!.content);
        return { choices: [{ index: 0, finishReason: 'length', error: 'truncated', reasoning: null }], usage: null, costUsd: 0, replayed: true, key: 'k:0' };
      },
      spent: () => ({ run: 0, global: 0 }),
    };
    for (const rules of [1, 2] as const) {
      const run = await planRepo(gitRepoFs(repoRoot), gateway, { packageRoot: 'server', moduleRoot: 'src', pins: [], edit: { ...defaultEditSettings, samples: 1, rules }, critic: defaultCriticSettings });
      expect(run.rules).toBe(rules);
      expect(run.facts.files.find((file) => file.path === repositoryFile)?.tables).toEqual(tablesUnder(rules));
    }
    const fileLine = (prompt: string) => prompt.split('\n').find((line) => line.includes(' repositories/album.repository.ts '));
    expect(prompts.map(fileLine).map((line) => /tbl:\S+/.exec(line ?? '')?.[0])).toEqual(['tbl:r[album,album_asset,recent]w[album_asset]', 'tbl:r[album,album_asset]w[album_asset]']);
  });

  it("the findings' target reads the code under the latest rules, whatever rules the run's plan had", () => {
    const planText = `version: 1\npackageRoot: server\nmoduleRoot: src\nsha: SHA\ngroups:\n  module/album:\n    - { path: ${repositoryFile} }\n    - { path: src/services/album.service.ts }\npinned:\n`;
    const target = loadTarget({ repo: repoRoot, environment: repoRoot, base: git('rev-parse', 'HEAD'), packageRoot: 'server', moduleRoot: 'src', pins: [], planText });
    expect(target.facts.files.find((file) => file.path === repositoryFile)?.tables).toEqual(tablesUnder(defaultEditSettings.rules));
    expect(defaultEditSettings.rules).toBe(2);
  });
});

// A small type-sliced repo with one of each code finding (a base class injecting ten repositories into three
// services, a module cycle, a table two groups write, production code importing test code) and a synthetic run
// directory over it (contract C7): run.json, plan/plan.yaml and plan.md, step, rung and whole-PR certificates.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repositoryNames = ['album', 'user', 'tag', 'asset', 'session', 'job', 'event', 'crypto', 'storage', 'logging'];
const className = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)}Repository`;
const tableWrites: Record<string, string> = { album: "insertInto('album')", asset: "updateTable('asset')", tag: "deleteFrom('asset')" };

export const files: Record<string, string> = {
  'server/package.json': '{ "name": "fixture", "private": true, "type": "module" }\n',
  'server/tsconfig.json': '{ "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext", "target": "es2022", "strict": true }, "include": ["src"] }\n',
  'server/src/db.ts': 'export interface Db {\n  insertInto(table: string): unknown;\n  updateTable(table: string): unknown;\n  deleteFrom(table: string): unknown;\n}\n',
  ...Object.fromEntries(repositoryNames.map((name) => [
    `server/src/repositories/${name}.repository.ts`,
    `import type { Db } from '../db.js';\nexport class ${className(name)} {\n  constructor(private readonly db: Db) {}\n  touch() {\n    return ${tableWrites[name] ? `this.db.${tableWrites[name]}` : `'${name}'`};\n  }\n}\n`,
  ])),
  'server/src/services/base.service.ts': [
    ...repositoryNames.map((name) => `import { ${className(name)} } from '../repositories/${name}.repository.js';`),
    'export class BaseService {',
    '  constructor(',
    ...repositoryNames.map((name) => `    protected ${name === 'logging' ? 'logger' : `${name}Repository`}: ${className(name)},`),
    '  ) {}',
    '}',
    '',
  ].join('\n'),
  'server/src/services/album.service.ts': "import { BaseService } from './base.service.js';\nimport { userLabel } from './user.service.js';\nexport const albumCount = () => 1;\nexport class AlbumService extends BaseService {\n  list() {\n    return [this.albumRepository.touch(), this.assetRepository.touch(), userLabel()];\n  }\n}\n",
  'server/src/services/album.service.spec.ts': "import { AlbumService } from './album.service.js';\nexport const subject = AlbumService;\n",
  'server/src/services/user.service.ts': "import { BaseService } from './base.service.js';\nimport { albumCount } from './album.service.js';\nexport const userLabel = () => `user ${albumCount()}`;\nexport class UserService extends BaseService {\n  find() {\n    return this.userRepository.touch();\n  }\n}\n",
  'server/src/services/tag.service.ts': "import { BaseService as Base } from './base.service.js';\nexport class TagService extends Base {\n  tag() {\n    this.logger.touch();\n    return [this.tagRepository.touch(), this.assetRepository.touch()];\n  }\n}\n",
  'server/src/utils/clock.ts': "import { fixedNow } from '../../test/clock.fake.js';\nexport const now = () => fixedNow();\n",
  'server/test/clock.fake.ts': 'export const fixedNow = () => 0;\n',
  'docs/architecture.md': 'Services live in server/src/services.\n',
};

export const planYaml = `version: 1
packageRoot: server
moduleRoot: src
sha: SHA
groups:
  module/album:
    - { path: src/repositories/album.repository.ts }
    - { path: src/services/album.service.ts, tests: [src/services/album.service.spec.ts] }
  module/asset:
    - { path: src/repositories/asset.repository.ts }
  module/tag:
    - { path: src/repositories/tag.repository.ts }
    - { path: src/services/tag.service.ts }
  module/user:
    - { path: src/repositories/user.repository.ts }
    - { path: src/services/user.service.ts }
  platform/database:
    - { path: src/db.ts }
    - { path: src/repositories/crypto.repository.ts }
    - { path: src/repositories/event.repository.ts }
    - { path: src/repositories/job.repository.ts }
    - { path: src/repositories/logging.repository.ts }
    - { path: src/repositories/session.repository.ts }
    - { path: src/repositories/storage.repository.ts }
  shared/shared:
    - { path: src/services/base.service.ts }
    - { path: src/utils/clock.ts }
pinned:
`;

export const planMarkdown = '# fixture plan\n\nfixture `server/` @ `0000000000`. Planner: deterministic facts and seeds draft → Nemotron 3 Ultra (medium_effort) edits the draft → the validator ranks the edits.\n\n- Cost: **$0.1234** in 2 calls\n';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function createRepo(): { root: string; base: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-findings-repo-'));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixtures@ac.invalid');
  git(root, 'config', 'user.name', 'fixtures');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  return { root, base: git(root, 'rev-parse', 'HEAD') };
}

const digest = (index: number) => `sha256:${String(index).repeat(64).slice(0, 64)}`;
const head = 'f'.repeat(40);

/** A certificate as the certifier stores it, with only what the findings log reads filled in. */
function certificate(base: string, findings: Record<string, { kind: string; file?: string; detail: string }[]>, extra: Record<string, unknown> = {}) {
  const checks = ['K0', 'K1', 'K2', 'K3a', 'K4', 'K6', 'K7', ...(extra.scope === 'full' ? ['K8'] : [])].map((id) => ({
    id, title: id, status: 'pass', summary: '', metrics: {}, violations: [], findings: findings[id] ?? [], durationMs: 1,
  }));
  return { format: 'ac-certificate/2', base, head, baseTree: 'a'.repeat(40), headTree: 'b'.repeat(40), pathMap: { entries: {} }, checks, verdict: 'pass', scope: 'static', residualRisk: ['external consumers', 'runtime fs contents'], digest: digest(1), ...extra };
}

const docsFinding = (move: string) => ({ kind: 'old-path-in-docs', file: 'docs/architecture.md', detail: `line 1: 'server/src/services' is the directory server/src/services, whose contents change with the move of ${move}` });

/** A run directory over `repo` at `base`: two certified R1 steps, a partial R1 rung certificate and a whole-PR one. */
export function createRunDirectory(repo: string, base: string, options: { boundaries?: unknown } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-findings-run-'));
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : `${JSON.stringify(value, null, 1)}\n`);
  };
  const record = (file: string, scope: 'full' | 'static', index: number) => ({ file, verdict: 'pass', scope, digest: digest(index), base, head, failing: [] });
  const step = (index: number, group: string, moved: number) => ({
    index, rung: 'R1', group, moves: {}, entries: [], status: 'certified', round: 1, attempts: [], commit: head, certificate: record(`certificates/00${index}-R1-${group.replace('/', '-')}.json`, 'static', index),
    counts: { filesMoved: moved, specifierEdits: 3 * moved, filesEdited: moved + 1 }, durationMs: 1000,
  });
  write('run.json', {
    format: 'ac-run/1', status: 'completed', tool: { name: 'architecture-cleaner', version: '0.1.0' }, repo, environment: repo,
    profile: { name: 'fixture', packageRoot: 'server', node: 'system', plan: { moduleRoot: 'src' } }, packageRoot: 'server', moduleRoot: 'src',
    base, baseTree: 'a'.repeat(40), branch: 'ac/fixture', head,
    plan: { file: 'plan/plan.yaml', source: 'planner', sha256: '0'.repeat(64), steps: 2, moves: 5 }, rungsRequested: ['R0', 'R1'], options: { jobs: 1, injectFault: null },
    rungs: [
      { id: 'R0', status: 'passed', durationMs: 1 },
      { id: 'R1', status: 'certified', start: base, end: head, certificate: { ...record('rungs/R1.json', 'full', 7), partial: false }, durationMs: 1 },
    ],
    steps: [step(1, 'module/album', 3), step(2, 'module/user', 2), { index: 3, rung: 'R1', group: 'module/tag', moves: {}, entries: [], status: 'pinned', round: 1, attempts: [], durationMs: 5 }],
    pins: [{ file: 'server/src/services/tag.service.ts', step: 3, group: 'module/tag', reason: 'step-pinned' }],
    findings: [
      { kind: 'ungated-coverage-glob', step: 1, rung: 'R1', files: ['server/vitest.config.mjs'], detail: "server/vitest.config.mjs line 4 [test.coverage.include]: coverage glob 'src/services/**' matches differently for server/src/services/album.service.ts" },
      { kind: 'ungated-coverage-glob', step: 2, rung: 'R1', files: ['server/vitest.config.mjs'], detail: "server/vitest.config.mjs line 4 [test.coverage.include]: coverage glob 'src/services/**' matches differently for server/src/services/user.service.ts" },
      { kind: 'step-pinned', step: 3, rung: 'R1', files: ['server/src/repositories/tag.repository.ts', 'server/src/services/tag.service.ts'], detail: 'still failing after 2 replans: K3a server/src/services/tag.service.ts: expected file server/src/modules/tag/tag.repository.ts' },
    ],
    quarantine: [], fault: null, certificate: record('certificate.json', 'full', 9),
    cost: { budgetRun: null, mode: 'replay', llmUsd: 0, planRecordedUsd: 0.1234 },
    timeline: { startedAt: '2026-10-14T00:00:00.000Z', durationMs: 754_000, preflightMs: 1, baselineMs: 1, stepsMs: 1, rungCertificationMs: 1, bisectMs: 0, runCertificationMs: 1, resumedAt: [] },
  });
  write('plan/plan.yaml', planYaml.replace('SHA', base));
  write('plan/plan.md', planMarkdown);
  write('certificates/001-R1-module-album.json', certificate(base, { K4: [docsFinding('server/src/services/album.service.ts')], K7: [{ kind: 'default-root-dir', file: 'server/tsconfig.json', detail: 'emits into server/dist without a rootDir' }] }));
  write('certificates/002-R1-module-user.json', certificate(base, { K4: [docsFinding('server/src/services/user.service.ts')], K7: [{ kind: 'default-root-dir', file: 'server/tsconfig.json', detail: 'emits into server/dist without a rootDir' }] }));
  write('certificates/failed/003-R1-module-tag-attempt1.json', certificate(base, { K4: [{ kind: 'stack-text', file: 'server/src/services/tag.service.ts', detail: 'a failed attempt: never read' }] }));
  write('rungs/R1.json', certificate(base, { K4: [docsFinding('server/src/services/album.service.ts')], K8: [{ kind: 'flaky-test', file: 'server/src/services/album.service.spec.ts', detail: 'suite > lists albums: passed, then failed (log /tmp/ac-work/run-1/unit.log)' }] }, { scope: 'full', digest: digest(7) }));
  write('certificate.json', certificate(base, { K8: [{ kind: 'flaky-test', file: 'server/src/services/album.service.spec.ts', detail: 'suite > lists albums: passed, then failed (log /tmp/ac-work/run-2/unit.log)' }] }, { scope: 'full', digest: digest(9) }));
  if (options.boundaries) write('boundaries/report.json', options.boundaries);
  write('report.md', '# placeholder\n');
  return root;
}

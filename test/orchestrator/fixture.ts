// A small type-sliced repo for `ac run` (server/ package, src/controllers|services|repositories|utils), its plan.yaml
// and a profile whose oracles are node scripts tracked in the repo: a tsc stand-in (diagnostics for files containing
// ERROR) and a test-runner stand-in (jest-shaped report from tests/*.cases.json).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OracleSpec, Profile } from '../../src/certificate/profile.js';

export type Files = Record<string, string>;

const checker = `import fs from 'node:fs';
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(directory + '/' + entry.name) : [directory + '/' + entry.name]);
const errors = walk('src').filter((file) => fs.readFileSync(file, 'utf8').includes('ERROR'));
for (const file of errors) console.log(file + "(1,1): error TS9999: '" + file + "' says ERROR.");
process.exit(errors.length ? 2 : 0);
`;

const runner = `import fs from 'node:fs';
import path from 'node:path';
const testResults = fs.readdirSync('tests').filter((file) => file.endsWith('.cases.json')).map((file) => {
  const cases = JSON.parse(fs.readFileSync('tests/' + file, 'utf8'));
  return { name: path.resolve('tests/' + file), status: cases.some(([, status]) => status === 'failed') ? 'failed' : 'passed', message: '',
    assertionResults: cases.map(([title, status]) => ({ ancestorTitles: ['suite'], title, fullName: 'suite ' + title, status })) };
});
const failed = testResults.some((result) => result.status === 'failed');
fs.writeFileSync(process.argv[2], JSON.stringify({ success: !failed, snapshot: { added: 0, filesAdded: 0, updated: 0, unchecked: 0 }, testResults }));
process.exit(failed ? 1 : 0);
`;

export const sources: Files = {
  'server/package.json': '{ "name": "fixture", "private": true, "type": "module" }\n',
  'server/tsconfig.json': '{ "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext", "target": "es2022", "strict": true }, "include": ["src"] }\n',
  'server/tools/check.mjs': checker,
  'server/tools/run-tests.mjs': runner,
  'server/tests/user.cases.json': '[["finds a user", "passed"], ["formats a name", "passed"]]\n',
  'server/src/main.ts': "import { AlbumController } from './controllers/album.controller.js';\nimport { UserController } from './controllers/user.controller.js';\nexport const controllers = [AlbumController, UserController];\n",
  'server/src/controllers/album.controller.ts': "import { AlbumService } from '../services/album.service.js';\nexport class AlbumController {\n  constructor(readonly albums: AlbumService) {}\n}\n",
  'server/src/services/album.service.ts': "import { AlbumRepository } from '../repositories/album.repository.js';\nimport { AlbumStore } from '../repositories/AlbumStore.js';\nimport { title } from '../utils/format.js';\nexport class AlbumService {\n  constructor(readonly albums: AlbumRepository, readonly store: AlbumStore) {}\n  name(id: string) { return title(id); }\n}\n",
  'server/src/repositories/album.repository.ts': "export class AlbumRepository {\n  find(id: string) { return { id }; }\n}\n",
  'server/src/repositories/AlbumStore.ts': "export class AlbumStore {\n  cache = new Map<string, unknown>();\n}\n",
  'server/src/controllers/user.controller.ts': "import { UserService } from '../services/user.service.js';\nexport class UserController {\n  constructor(readonly users: UserService) {}\n}\n",
  'server/src/services/user.service.ts': "import { UserRepository } from '../repositories/user.repository.js';\nimport { title } from '../utils/format.js';\nexport class UserService {\n  constructor(readonly users: UserRepository) {}\n  name(id: string) { return title(id); }\n}\n",
  'server/src/services/user.service.spec.ts': "import { UserService } from './user.service.js';\nexport const subject = UserService;\n",
  'server/src/repositories/user.repository.ts': "export class UserRepository {\n  find(id: string) { return { id }; }\n}\n",
  'server/src/utils/format.ts': 'export const title = (text: string) => text.toUpperCase();\n',
};

/** A location-sensitive file in the user group: the executor declines to move it. */
export const userPaths: Files = {
  'server/src/services/user-paths.ts': "import { dirname } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nexport const here = dirname(fileURLToPath(import.meta.url));\n",
};

export interface PlanEntry {
  path: string;
  tests?: string[];
}

export const groups: Record<string, PlanEntry[]> = {
  'module/album': [{ path: 'src/controllers/album.controller.ts' }, { path: 'src/repositories/AlbumStore.ts' }, { path: 'src/repositories/album.repository.ts' }, { path: 'src/services/album.service.ts' }],
  'module/user': [{ path: 'src/controllers/user.controller.ts' }, { path: 'src/repositories/user.repository.ts' }, { path: 'src/services/user.service.ts', tests: ['src/services/user.service.spec.ts'] }],
  'shared/format': [{ path: 'src/utils/format.ts' }],
};

export function planYaml(sha: string, planGroups: Record<string, PlanEntry[]> = groups): string {
  const lines = ['# fixture plan', 'version: 1', 'packageRoot: server', 'moduleRoot: src', `sha: "${sha}"`, 'groups:'];
  for (const [key, entries] of Object.entries(planGroups)) {
    lines.push(`  ${key}:`);
    for (const entry of entries) lines.push(`    - { path: ${entry.path}${entry.tests ? `, tests: [${entry.tests.join(', ')}]` : ''} }`);
  }
  lines.push('pinned:', '  - { path: src/main.ts, reason: entrypoint, detail: "the entry point" }');
  return `${lines.join('\n')}\n`;
}

export const typecheck: OracleSpec = { name: 'tsc', kind: 'exit-zero', cwd: 'server', command: ['node', 'tools/check.mjs'], diagnostics: 'tsc' };
export const unit: OracleSpec = { name: 'unit', kind: 'tests', format: 'jest', cwd: 'server', command: ['node', 'tools/run-tests.mjs', '{artifacts}/report.json'], report: '{artifacts}/report.json' };

export function profileOf(oracles: OracleSpec[] = [typecheck, unit]): Profile {
  return { name: 'fixture', packageRoot: 'server', node: 'system', oracles, plan: { moduleRoot: 'src' } };
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export interface FixtureRepo {
  repo: string;
  base: string;
  /** A scratch directory for the run directory and plan files. */
  scratch: string;
}

/** The repo committed once (with a local identity, as a user's checkout has one). */
export function fixtureRepo(files: Files = sources): FixtureRepo {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-run-'));
  const repo = path.join(scratch, 'repo');
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  }
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'fixture@ac.invalid');
  git(repo, 'config', 'user.name', 'fixture');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'fixture');
  return { repo, base: git(repo, 'rev-parse', 'HEAD'), scratch };
}

export const gitOf = git;

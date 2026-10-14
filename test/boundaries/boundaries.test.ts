// R4 end to end on a small committed repo: dependency-cruiser runs for real (baseline, check, anti-vacuity), through
// the immich-style `src/*` path alias with `.js` specifiers, and the command checks the committed rules.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { boundariesCommand } from '../../src/boundaries/command.js';
import { buildBoundaryRules, type BoundaryRules } from '../../src/boundaries/index.js';
import { twoCommits } from '../certificate/two-commit-repo.js';

const tree: Record<string, string> = {
  'server/package.json': '{ "name": "fixture", "private": true, "type": "module" }\n',
  'server/tsconfig.json': '{ "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext", "strict": true, "paths": { "src/*": ["./src/*"] } }, "include": ["src"] }\n',
  'server/src/main.ts': "import { services } from 'src/platform/registry/services.js';\nexport default services;\n",
  // album ⇄ user through their DTOs (album → user twice, one of them type-only; user → album once: the back-edge).
  'server/src/modules/album/album.dto.ts': "import type { UserDto } from 'src/modules/user/user.dto.js';\nexport class AlbumDto { owner?: UserDto }\n",
  'server/src/modules/album/album.service.ts': "import { AlbumRepository } from './album.repository.js';\nimport { UserDto } from 'src/modules/user/user.dto.js';\nimport { AssetDto } from 'src/modules/asset/asset.dto.js';\nimport { log } from 'src/platform/logging/logger.js';\nexport class AlbumService { constructor(readonly albums: AlbumRepository) { log(UserDto, AssetDto); } }\n",
  'server/src/modules/album/album.repository.ts': "import { Kysely } from 'kysely';\nexport class AlbumRepository { db?: Kysely<unknown> }\n",
  // The controller reaches a table definition: a controller-to-persistence violation.
  'server/src/modules/album/album.controller.ts': "import { AlbumService } from './album.service.js';\nimport { albumTable } from 'src/schema/tables/album.table.js';\nexport class AlbumController { constructor(readonly service: AlbumService) { void albumTable; } }\n",
  'server/src/modules/user/user.dto.ts': "import { AlbumDto } from 'src/modules/album/album.dto.js';\nexport class UserDto { albums: AlbumDto[] = [] }\n",
  'server/src/modules/user/user.service.ts': "import { LoggingRepository } from 'src/platform/logging/logging.repository.js';\nexport class UserService { constructor(readonly logger: LoggingRepository) {} }\n",
  'server/src/modules/user/user.controller.ts': "import { UserService } from './user.service.js';\nimport { LoggingRepository } from 'src/platform/logging/logging.repository.js';\nexport class UserController { constructor(readonly service: UserService, readonly logger: LoggingRepository) {} }\n",
  'server/src/modules/asset/asset.dto.ts': 'export class AssetDto {}\n',
  'server/src/modules/asset/asset.service.ts': "import { AssetDto } from './asset.dto.js';\nexport class AssetService { dto = AssetDto }\n",
  'server/src/platform/logging/logger.ts': 'export const log = (...values: unknown[]) => values.length;\n',
  'server/src/platform/logging/logging.repository.ts': 'export class LoggingRepository { log(message: string) { return message; } }\n',
  // A platform file importing a module: a platform-to-modules violation. The registry does it by design: exempt.
  'server/src/platform/storage/storage.core.ts': "import { AssetDto } from 'src/modules/asset/asset.dto.js';\nexport const storage = { dto: AssetDto };\n",
  'server/src/platform/registry/services.ts': "import { AlbumService } from 'src/modules/album/album.service.js';\nimport { UserService } from 'src/modules/user/user.service.js';\nimport { AssetService } from 'src/modules/asset/asset.service.js';\nexport const services = [AlbumService, UserService, AssetService];\n",
  // shared importing a module: a shared-is-a-leaf violation; a shared spec doing the same is a test: exempt.
  'server/src/shared/types.ts': "import type { UserDto } from 'src/modules/user/user.dto.js';\nexport type Owner = UserDto;\n",
  'server/src/shared/date.ts': 'export const today = () => new Date();\n',
  'server/src/shared/date.spec.ts': "import { AlbumService } from 'src/modules/album/album.service.js';\nexport const subject = AlbumService;\n",
  'server/src/schema/tables/album.table.ts': "export const albumTable = 'album';\n",
};

const logs: string[] = [];
let repo: string;
let result: BoundaryRules;
let workDir: string;

beforeAll(async () => {
  repo = twoCommits(tree, tree).root;
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-boundaries-test-'));
  result = await buildBoundaryRules({ repo, environment: repo, packageRoot: 'server', moduleRoot: 'src', workDir, log: (message) => logs.push(message) });
}, 120_000);

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

describe('R4 on a committed tree', () => {
  test('the module DAG order, its back-edge and the public files', () => {
    const { report } = result;
    expect(report.order).toEqual(['module/album', 'module/user', 'module/asset']);
    expect(report.backEdges).toEqual([{ from: 'module/user', to: 'module/album', files: 1, sample: [{ from: 'src/modules/user/user.dto.ts', to: 'src/modules/album/album.dto.ts' }] }]);
    expect(report.sccs).toEqual([['module/album', 'module/user']]);
    expect(report.publicFiles).toEqual({
      'module/album': ['src/modules/album/album.dto.ts'], 'module/asset': ['src/modules/asset/asset.dto.ts'], 'module/user': ['src/modules/user/user.dto.ts'],
    });
    expect(report.folders.map((folder) => folder.key)).toEqual([
      'module/album', 'module/asset', 'module/user', 'other:src', 'other:src/schema/tables', 'platform/logging', 'platform/registry', 'platform/storage', 'shared',
    ]);
  });

  test('today\'s violations are frozen per rule, type-only imports included, tests and the composition root exempt', () => {
    const counts = Object.fromEntries(result.report.baseline.filter((entry) => entry.count).map((entry) => [entry.rule, entry.count]));
    // The album ⇄ user cycle runs through album.dto's `import type`: dependency-cruiser sees it only with
    // tsPreCompilationDeps (and reports a cycle once, whichever import it starts from).
    expect(counts).toEqual({
      'shared-is-a-leaf': 1, 'platform-not-to-modules': 1, 'controller-not-to-persistence': 1, 'no-cycle-leaving-a-folder': 1, 'module-dag/user': 1,
    });
    const known = JSON.parse(result.files.get('server/.dependency-cruiser-known-violations.json')!) as { from: string; to: string; rule: { name: string } }[];
    expect(known.find((violation) => violation.rule.name === 'controller-not-to-persistence')).toMatchObject({ from: 'src/modules/album/album.controller.ts', to: 'src/schema/tables/album.table.ts' });
    expect(known.map((violation) => violation.from)).not.toContain('src/platform/registry/services.ts');
    expect(known.map((violation) => violation.from)).not.toContain('src/shared/date.spec.ts');
    expect(known.map((violation) => violation.from)).not.toContain('src/modules/user/user.controller.ts');
  });

  test('every rule fires on its own synthetic violation, and nothing else breaks', () => {
    expect(result.antiVacuity).toHaveLength(result.report.rules.length);
    expect(result.antiVacuity.filter((entry) => !entry.fired)).toEqual([]);
    expect(result.antiVacuity.filter((entry) => entry.detail.includes('also broke'))).toEqual([]);
    expect(result.unexpected).toEqual([]);
    expect(logs.some((line) => line.includes('check with the baseline: 0 new'))).toBe(true);
  });

  test('two files at the package root, the summary with the command, and the repo untouched', () => {
    expect([...result.files.keys()]).toEqual(['server/.dependency-cruiser.json', 'server/.dependency-cruiser-known-violations.json']);
    for (const text of result.files.values()) expect(text.endsWith('\n') && text.startsWith('[\n  {') !== text.startsWith('{\n  "forbidden"')).toBe(true);
    expect(result.summary).toMatch(/^10 rules over 3 modules \(1 back-edges against the DAG order\), 5 known violations frozen in the baseline, 10\/10 rules fired/);
    expect(result.command).toMatch(/^npx -y -p dependency-cruiser@18\.\d+\.\d+ -p typescript@6\.\d+\.\d+ depcruise src --config \.dependency-cruiser\.json --ignore-known \.dependency-cruiser-known-violations\.json$/);
    expect(git('status', '--porcelain')).toBe('');
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);
    expect(fs.readdirSync(workDir)).toEqual([]);
  });

  test('--check passes on the committed rules and fails on a new forbidden import', async () => {
    for (const [file, content] of result.files) fs.writeFileSync(path.join(repo, file), content);
    git('add', '-A');
    git('commit', '-q', '-m', 'boundary rules');
    const output: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => void output.push(line));
    try {
      expect(await boundariesCommand(repo, { root: 'server', 'module-root': 'src', check: true })).toBe(0);
      fs.writeFileSync(path.join(repo, 'server/src/platform/logging/logger.ts'), "import 'src/modules/user/user.dto.js';\nexport const log = (...values: unknown[]) => values.length;\n");
      expect(await boundariesCommand(repo, { root: 'server', 'module-root': 'src', check: true })).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(output).toContain('platform-not-to-modules: src/platform/logging/logger.ts -> src/modules/user/user.dto.ts');
    expect(output.at(-1)).toMatch(/^1 new violations, 5 known/);
  }, 60_000);
});

// R3 steps (contract C5) and the filename-observability guard: every rename the guard refuses names its reason.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { executeMove } from '../../src/executor/execute.js';
import { normalizationSteps, type RenameDecline } from '../../src/filename-normalization/index.js';
import { cjs, read, repoFrom } from '../executor/repo.js';

const options = { packageRoot: '', moduleRoot: 'src' };
const tsconfig = cjs({}, ['src']);
const reasons = (declined: RenameDecline[]) => Object.fromEntries(declined.map((decline) => [decline.file, decline.reason]));
const stepMoves = (root: string) => normalizationSteps(gitRepoFs(root), options).steps.map((step) => [step.group, Object.fromEntries(step.moves)]);

describe('normalizationSteps', () => {
  it('renames per folder in path order, specs with their subject, and the steps apply', () => {
    const root = repoFrom({
      'tsconfig.json': tsconfig,
      'src/modules/user/userController.ts': "import { UserService } from './user_service';\nexport class UserController { constructor(readonly service: UserService) {} }\n",
      'src/modules/user/userController.spec.ts': "import { UserController } from './userController';\nexport const spec = UserController;\n",
      'src/modules/user/user_service.ts': 'export class UserService {}\n',
      'src/modules/user/user.repository.ts': 'export class UserRepository {}\n',
      'src/platform/http/view-repository.ts': 'export const view = 1;\n',
      'src/shared/mediaUtils.ts': "export { view } from '../platform/http/view-repository';\n",
      'src/services/legacyService.ts': "import { view } from '../shared/mediaUtils';\nexport const legacy = view;\n",
    });
    const { steps, declined } = normalizationSteps(gitRepoFs(root), options);
    expect(declined).toEqual([]);
    expect(steps.map((step) => [step.index, step.rung, step.group, Object.fromEntries(step.moves)])).toEqual([
      [1, 'R3', 'module/user', {
        'src/modules/user/userController.spec.ts': 'src/modules/user/user.controller.spec.ts',
        'src/modules/user/userController.ts': 'src/modules/user/user.controller.ts',
        'src/modules/user/user_service.ts': 'src/modules/user/user.service.ts',
      }],
      [2, 'R3', 'platform/http', { 'src/platform/http/view-repository.ts': 'src/platform/http/view.repository.ts' }],
      [3, 'R3', 'shared/shared', { 'src/shared/mediaUtils.ts': 'src/shared/media.utils.ts' }],
    ]);
    for (const step of steps) {
      expect(executeMove(gitRepoFs(root), step.moves).outcome).toBe('applied');
      execFileSync('git', ['-C', root, 'commit', '-q', '-m', step.group]);
    }
    expect(read(root, 'src/modules/user/user.controller.ts')).toContain("from './user.service'");
    expect(read(root, 'src/modules/user/user.controller.spec.ts')).toContain("from './user.controller'");
    expect(read(root, 'src/shared/media.utils.ts')).toContain("from '../platform/http/view.repository'");
    expect(read(root, 'src/services/legacyService.ts')).toContain("from '../shared/media.utils'");
    expect(stepMoves(root)).toEqual([]);
  });

  it('refuses case-only renames, occupied and shared destinations, and unparseable names', () => {
    const root = repoFrom({
      'tsconfig.json': tsconfig,
      'src/modules/user/User.service.ts': 'export const a = 1;\n',
      'src/modules/order/orderService.ts': 'export const b = 1;\n',
      'src/modules/order/order.service.ts': 'export const c = 1;\n',
      'src/modules/tag/tagService.ts': 'export const d = 1;\n',
      'src/modules/tag/tag_service.ts': 'export const e = 1;\n',
      'src/modules/auth/OAuthService.ts': 'export const f = 1;\n',
    });
    const { steps, declined } = normalizationSteps(gitRepoFs(root), options);
    expect(steps).toEqual([]);
    expect(reasons(declined)).toEqual({
      'src/modules/auth/OAuthService.ts': 'unparseable',
      'src/modules/order/orderService.ts': 'destination-exists',
      'src/modules/tag/tagService.ts': 'destination-clash',
      'src/modules/tag/tag_service.ts': 'destination-clash',
      'src/modules/user/User.service.ts': 'case-only',
    });
  });

  it('refuses a file whose name is observed at runtime', () => {
    const root = repoFrom({
      'tsconfig.json': tsconfig,
      'src/globals.d.ts': 'declare const __filename: string;\ndeclare const require: { resolve(id: string): string };\n',
      'src/modules/user/userService.ts': 'export const self = __filename;\n',
      'src/modules/user/userController.ts': 'export const controller = 1;\n',
      'src/modules/user/userGuard.ts': 'export const guard = 1;\n',
      'src/main.ts': "export const where = require.resolve('./modules/user/userController');\n",
    });
    const { steps, declined } = normalizationSteps(gitRepoFs(root), options);
    expect(reasons(declined)).toEqual({ 'src/modules/user/userController.ts': 'filename-observed', 'src/modules/user/userService.ts': 'filename-observed' });
    expect(steps.map((step) => Object.fromEntries(step.moves))).toEqual([{ 'src/modules/user/userGuard.ts': 'src/modules/user/user.guard.ts' }]);
  });

  it('refuses files that loaders take by name: globs in code, unreadable loadModules, readdir of the folder', () => {
    const files = {
      'tsconfig.json': cjs({ outDir: 'dist', rootDir: 'src' }, ['src']),
      'src/globals.d.ts': "declare const __dirname: string;\ndeclare function join(...parts: string[]): string;\ndeclare const fs: { readdirSync(path: string): string[] };\ndeclare const container: { loadModules(patterns: unknown): void };\n",
      'src/modules/user/userService.ts': 'export const a = 1;\n',
      'src/modules/order/orderService.ts': 'export const b = 1;\n',
      'src/modules/tag/tagService.ts': 'export const c = 1;\n',
    };
    const globbed = repoFrom({ ...files, 'src/main.ts': "container.loadModules(['src/modules/user/*.ts']);\nexport const entities = ['dist/modules/order/*.js'];\n" });
    expect(reasons(normalizationSteps(gitRepoFs(globbed), options).declined)).toEqual({
      'src/modules/order/orderService.ts': 'name-from-file-loader',
      'src/modules/user/userService.ts': 'name-from-file-loader',
    });
    const listed = repoFrom({ ...files, 'src/main.ts': "export const names = fs.readdirSync(join(__dirname, 'modules/tag'));\n" });
    expect(reasons(normalizationSteps(gitRepoFs(listed), options).declined)).toEqual({ 'src/modules/tag/tagService.ts': 'name-from-file-loader' });
    const unreadable = repoFrom({ ...files, 'src/main.ts': "const patterns = ['src/**/*.ts'];\ncontainer.loadModules(patterns);\n" });
    expect(Object.values(reasons(normalizationSteps(gitRepoFs(unreadable), options).declined))).toEqual(['name-from-file-loader', 'name-from-file-loader', 'name-from-file-loader']);
  });

  it('refuses a spec paired with a snapshot, and its subject with it', () => {
    const root = repoFrom({
      'tsconfig.json': tsconfig,
      'src/modules/user/userService.ts': 'export const a = 1;\n',
      'src/modules/user/userService.spec.ts': "import { a } from './userService';\nexport const spec = a;\n",
      'src/modules/user/__snapshots__/userService.spec.ts.snap': '// snapshot\n',
    });
    const { steps, declined } = normalizationSteps(gitRepoFs(root), options);
    expect(steps).toEqual([]);
    expect(reasons(declined)).toEqual({ 'src/modules/user/userService.spec.ts': 'snapshot-pair', 'src/modules/user/userService.ts': 'with-pair' });
  });

  it('refuses an old name spelled in a tracked file, but not in imports, comments or docs', () => {
    const root = repoFrom({
      'tsconfig.json': tsconfig,
      'src/modules/user/userService.ts': 'export const a = 1;\n',
      'src/modules/order/orderService.ts': 'export const b = 1;\n',
      'src/modules/tag/tagService.ts': 'export const c = 1;\n',
      'src/main.ts': "// see modules/tag/tagService.ts\nimport { c } from './modules/tag/tagService';\nexport const label = 'modules/user/userService';\nexport const tag = c;\n",
      'deploy/routes.json': '{ "handler": "orderService.js" }\n',
      'docs/notes.md': 'userService.ts and orderService.ts and tagService.ts\n',
    });
    const { declined } = normalizationSteps(gitRepoFs(root), options);
    expect(reasons(declined)).toEqual({ 'src/modules/order/orderService.ts': 'name-in-text', 'src/modules/user/userService.ts': 'name-in-text' });
    expect(declined.find((decline) => decline.file.endsWith('userService.ts'))!.detail).toBe("src/main.ts line 3 spells '/userService'");
  });

  it('refuses renames that suffix-keyed tools would see: the Nest swagger plugin, test globs, lint globs', () => {
    const root = repoFrom({
      'tsconfig.json': tsconfig,
      'nest-cli.json': JSON.stringify({ compilerOptions: { plugins: [{ name: '@nestjs/swagger', options: { introspectComments: true } }] } }),
      'jest.config.js': "module.exports = { testMatch: ['**/*.controller.spec.ts', '**/*-spec.ts'] };\n",
      'eslint.config.mjs': "export default [{ files: ['src/**/*.repository.ts'], rules: {} }];\n",
      'src/modules/user/user-dto.ts': 'export class UserDto {}\n',
      'src/modules/user/userController.spec.ts': 'export const spec = 1;\n',
      'src/modules/user/userRepository.ts': 'export class UserRepository {}\n',
      'src/modules/user/userGuard.ts': 'export class UserGuard {}\n',
    });
    const { steps, declined } = normalizationSteps(gitRepoFs(root), options);
    expect(reasons(declined)).toEqual({
      'src/modules/user/user-dto.ts': 'suffix-tooling',
      'src/modules/user/userController.spec.ts': 'suffix-tooling',
      'src/modules/user/userRepository.ts': 'suffix-tooling',
    });
    expect(declined.find((decline) => decline.file.endsWith('user-dto.ts'))!.detail).toContain('@nestjs/swagger dtoFileNameSuffix [.dto.ts, .entity.ts] would start transforming it');
    expect(steps.map((step) => Object.fromEntries(step.moves))).toEqual([{ 'src/modules/user/userGuard.ts': 'src/modules/user/user.guard.ts' }]);
  });

  it('reads the swagger plugin options, and refuses a rename that leaves a tsconfig program', () => {
    const root = repoFrom({
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', types: [] }, include: ['src'], exclude: ['src/**/*.mock.ts'] }),
      'nest-cli.json': JSON.stringify({ compilerOptions: { plugins: [{ name: '@nestjs/swagger', options: { dtoFileNameSuffix: '.input.ts' } }] } }),
      'src/modules/user/user-dto.ts': 'export class UserDto {}\n',
      'src/modules/user/user-input.ts': 'export class UserInput {}\n',
      'src/modules/user/userMock.ts': 'export const mock = 1;\n',
    });
    const { steps, declined } = normalizationSteps(gitRepoFs(root), options);
    expect(reasons(declined)).toEqual({ 'src/modules/user/user-input.ts': 'suffix-tooling', 'src/modules/user/userMock.ts': 'suffix-tooling' });
    expect(declined.find((decline) => decline.file.endsWith('userMock.ts'))!.detail).toBe('tsconfig programs [tsconfig.json] -> []');
    expect(steps.map((step) => Object.fromEntries(step.moves))).toEqual([{ 'src/modules/user/user-dto.ts': 'src/modules/user/user.dto.ts' }]);
  });

  it("drops what the executor's dry run declines, with the executor's reason", () => {
    const root = repoFrom({
      'tsconfig.json': tsconfig,
      'src/globals.d.ts': 'declare const __dirname: string;\n',
      'src/modules/user/userService.ts': 'export const where = __dirname;\n',
      'src/modules/user/userGuard.ts': 'export const guard = 1;\n',
    });
    const { steps, declined } = normalizationSteps(gitRepoFs(root), options);
    expect(reasons(declined)).toEqual({ 'src/modules/user/userService.ts': 'executor-location-sensitive' });
    expect(steps.map((step) => Object.fromEntries(step.moves))).toEqual([{ 'src/modules/user/userGuard.ts': 'src/modules/user/user.guard.ts' }]);
  });

  it('reads the package root and module root', () => {
    const root = repoFrom({
      'server/tsconfig.json': tsconfig,
      'server/app/modules/user/userService.ts': 'export const a = 1;\n',
      'server/src/modules/user/userGuard.ts': 'export const b = 1;\n',
    });
    const { steps } = normalizationSteps(gitRepoFs(root), { packageRoot: 'server', moduleRoot: 'app' });
    expect(steps.map((step) => [step.group, Object.fromEntries(step.moves)])).toEqual([['module/user', { 'server/app/modules/user/userService.ts': 'server/app/modules/user/user.service.ts' }]]);
  });
});

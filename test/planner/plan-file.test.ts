// plan.yaml round trip and plan.yaml → steps (one pathMap per group, basenames kept, collisions in subfolders).
import { describe, expect, it } from 'vitest';
import { planFileOf, readPlanYaml, writePlanYaml } from '../../src/planner/plan-file.js';
import { stepFileName, stepJson, stepsOf } from '../../src/planner/steps.js';
import type { Facts, FileFact, Plan, Placement } from '../../src/planner/types.js';

const file = (id: number, path: string, tests: string[] = []): FileFact => ({
  path, id, role: 'other', loc: 1, exports: [], primaryExport: null, tables: { reads: [], writes: [] }, routes: [], tests,
});

const facts: Facts = {
  packageRoot: 'server',
  moduleRoot: 'src',
  sha: '02063972e82b1bfd17b6fc2e3b3ff39936229ea5',
  files: [
    file(1, 'src/controllers/album.controller.ts', ['src/controllers/album.controller.spec.ts']),
    file(2, 'src/database.ts'),
    file(3, 'src/services/album.service.ts', ['src/services/album.service.spec.ts']),
    file(4, 'src/services/database.service.ts'),
    file(5, 'src/utils/database.ts', ['src/utils/database.spec.ts']),
  ],
  edges: [],
  pins: [{ path: 'src/main.ts', reason: 'entrypoint', detail: 'nest-cli.json entryFile "main"' }],
};

const placement = (path: string, kind: Placement['kind'], name: string, extra: Partial<Placement> = {}): Placement =>
  ({ path, kind, name, confidence: 'seed', contested: false, source: 'draft', ...extra });

const plan: Plan = {
  placements: [
    placement('src/controllers/album.controller.ts', 'module', 'album'),
    placement('src/database.ts', 'platform', 'database'),
    placement('src/services/album.service.ts', 'module', 'album', { confidence: 'propagated-weak', contested: true, source: 'planner', rationale: 'album: "the" owner, yes' }),
    placement('src/services/database.service.ts', 'platform', 'database'),
    placement('src/utils/database.ts', 'platform', 'database'),
  ],
};

describe('plan.yaml', () => {
  const text = writePlanYaml(planFileOf(facts, plan), 'ac plan for immich server/ @ 02063972e8');

  it('writes one line per file, groups ordered module → platform → shared', () => {
    expect(text).toContain('  module/album:\n    - { path: src/controllers/album.controller.ts, tests: [src/controllers/album.controller.spec.ts], confidence: seed }');
    expect(text).toContain('rationale: "album: \\"the\\" owner, yes"');
    expect(text.indexOf('module/album:')).toBeLessThan(text.indexOf('platform/database:'));
    expect(text).toContain('pinned:\n  - { path: src/main.ts, reason: entrypoint, detail: "nest-cli.json entryFile \\"main\\"" }');
  });

  it('reads back what it wrote', () => {
    const read = readPlanYaml(text);
    expect(read.packageRoot).toBe('server');
    expect([...read.groups.keys()]).toEqual(['module/album', 'platform/database']);
    expect(read.groups.get('module/album')![1]).toEqual({ path: 'src/services/album.service.ts', tests: ['src/services/album.service.spec.ts'], confidence: 'propagated-weak', contested: true, source: 'planner', rationale: 'album: "the" owner, yes' });
    expect(writePlanYaml(read, 'ac plan for immich server/ @ 02063972e8')).toBe(text);
  });

  it('rejects a file listed twice, a pinned file listed, and malformed group keys', () => {
    expect(() => readPlanYaml(text.replace('platform/database:\n', 'platform/database:\n    - { path: src/services/album.service.ts }\n'))).toThrow(/listed in both/);
    expect(() => readPlanYaml(text.replace('platform/database:\n', 'platform/database:\n    - { path: src/main.ts }\n'))).toThrow(/pinned/);
    expect(() => readPlanYaml(text.replace('module/album:', 'modules/Album:'))).toThrow(/group keys/);
  });

  it('quotes values YAML would misread: a leading @ (reserved) and .inf/.nan (numbers)', () => {
    const typesFacts: Facts = { ...facts, packageRoot: '@scope/server', moduleRoot: '.', files: [file(1, '@types/custom/helper.ts', ['.inf']), file(2, '.nan')],
      pins: [{ path: '@types/custom/index.d.ts', reason: 'ambient-declaration', detail: 'typeRoots' }] };
    const typesPlan: Plan = { placements: [placement('@types/custom/helper.ts', 'module', 'helper'), placement('.nan', 'module', 'helper')] };
    const written = writePlanYaml(planFileOf(typesFacts, typesPlan), 'ac plan for @scope/server');
    expect(written).toContain('packageRoot: "@scope/server"');
    expect(written).toContain('- { path: "@types/custom/helper.ts", tests: [".inf"], confidence: seed }');
    const read = readPlanYaml(written);
    expect(read.packageRoot).toBe('@scope/server');
    expect(read.groups.get('module/helper')!.map((entry) => [entry.path, ...entry.tests])).toEqual([['.nan'], ['@types/custom/helper.ts', '.inf']]);
    expect(read.pinned[0]!.path).toBe('@types/custom/index.d.ts');
    expect(writePlanYaml(read, 'ac plan for @scope/server')).toBe(written);
    expect(writePlanYaml({ ...read, packageRoot: 'packages/@scope/server' }, 'title')).toContain('packageRoot: packages/@scope/server\n');
  });

  it('accepts a human edit: a renamed group and a moved line', () => {
    const edited = text.replace('platform/database:', 'platform/db:');
    expect([...readPlanYaml(edited).groups.keys()]).toEqual(['module/album', 'platform/db']);
  });
});

describe('steps', () => {
  const steps = stepsOf(planFileOf(facts, plan));

  it('one step per group: modules are R1, then platform and shared are R2', () => {
    expect(steps.map((step) => [step.index, step.rung, step.group])).toEqual([[1, 'R1', 'module/album'], [2, 'R2', 'platform/database']]);
    expect(stepFileName(steps[0]!, steps.length)).toBe('01-module-album.json');
  });

  it('moves files with their tests, repo-relative, basenames kept', () => {
    expect(Object.fromEntries(steps[0]!.moves)).toEqual({
      'server/src/controllers/album.controller.ts': 'server/src/modules/album/album.controller.ts',
      'server/src/controllers/album.controller.spec.ts': 'server/src/modules/album/album.controller.spec.ts',
      'server/src/services/album.service.ts': 'server/src/modules/album/album.service.ts',
      'server/src/services/album.service.spec.ts': 'server/src/modules/album/album.service.spec.ts',
    });
    expect(JSON.parse(stepJson(steps[0]!)).moves['server/src/services/album.service.ts']).toBe('server/src/modules/album/album.service.ts');
  });

  it('keeps the old parent folder for files whose basename collides (not at the module root), and their tests follow', () => {
    expect(Object.fromEntries(steps[1]!.moves)).toEqual({
      'server/src/database.ts': 'server/src/platform/database/database.ts',
      'server/src/services/database.service.ts': 'server/src/platform/database/database.service.ts',
      'server/src/utils/database.ts': 'server/src/platform/database/utils/database.ts',
      'server/src/utils/database.spec.ts': 'server/src/platform/database/utils/database.spec.ts',
    });
    expect(steps[1]!.disambiguated).toEqual(['src/utils/database.ts']);
  });

  it('leaves out files already at their destination', () => {
    const settled = { ...planFileOf(facts, plan), groups: new Map([['module/album', [{ path: 'src/modules/album/album.service.ts', tests: [] }]]]) };
    expect(stepsOf(settled)[0]!.moves.size).toBe(0);
  });
});

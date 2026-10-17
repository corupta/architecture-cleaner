// The planned scramble on a synthetic inventory: targets, collisions, H1, tests, the type folder that would shadow a
// module file, and exclusions.
import { describe, expect, it } from 'vitest';
import type { CodeFile, Inventory } from '../../src/scramble/inventory.js';
import { layoutScramble } from '../../src/scramble/layout.js';
import type { ScrambleManifest } from '../../src/scramble/types.js';

const manifest: ScrambleManifest = { name: 'demo', sha: 'abc1234', packageRoot: '', moduleRoot: 'src', depth: { plugins: 2 }, shared: ['types'], exclude: ['^src/generated/'] };

const code = (file: string, extra: Partial<CodeFile> = {}): CodeFile => ({
  path: file, barrel: false, decorators: new Set(), router: false, typeOnlyExports: false, primaryExport: null, ...extra,
});

function inventoryOf(files: CodeFile[], tests: Inventory['tests'] = [], other: string[] = []): Inventory {
  return {
    code: files.toSorted((a, b) => (a.path < b.path ? -1 : 1)),
    tests,
    declarations: [],
    outside: [],
    tracked: [...files.map((file) => file.path), ...tests.map((test) => test.path), ...other].sort(),
  };
}

const destinations = (inventory: Inventory, variant: 'default' | 'H1' = 'default') =>
  Object.fromEntries(layoutScramble(manifest, variant, inventory).entities.map((entity) => [entity.original, entity.scrambled]));

describe('layoutScramble', () => {
  it('moves feature files into type folders, keeps sub-feature qualifiers and leaves shared and root files', () => {
    const inventory = inventoryOf([
      code('src/main.ts'),
      code('src/types/user.ts'),
      code('src/team/team.service.ts'),
      code('src/team/dto/create-team.dto.ts'),
      code('src/auth/strategies/github.strategy.ts'),
      code('src/plugins/github/webhook/handle.ts', { decorators: new Set(['Injectable']) }),
      code('src/generated/client.ts'),
      code('src/team/index.ts', { barrel: true }),
    ]);
    const layout = layoutScramble(manifest, 'default', inventory);
    expect(Object.fromEntries(layout.entities.map((entity) => [entity.original, [entity.scrambled, entity.truth, entity.type]]))).toEqual({
      'src/auth/strategies/github.strategy.ts': ['src/strategies/github.strategy.ts', 'auth', 'strategy'],
      'src/main.ts': ['src/main.ts', 'root', 'util'],
      'src/plugins/github/webhook/handle.ts': ['src/services/webhook/handle.ts', 'plugins/github', 'service'],
      'src/team/dto/create-team.dto.ts': ['src/dtos/create-team.dto.ts', 'team', 'dto'],
      'src/team/team.service.ts': ['src/services/team.service.ts', 'team', 'service'],
      'src/types/user.ts': ['src/types/user.ts', 'shared:types', 'util'],
    });
    expect(layout.excluded).toEqual([
      { path: 'src/generated/client.ts', reason: 'excluded by the manifest (^src/generated/)' },
      { path: 'src/team/index.ts', reason: 'barrel (re-exports only)' },
    ]);
  });

  it('renames colliding files from their primary export, else prefixes the feature (leaky), else counts', () => {
    const inventory = inventoryOf([
      code('src/task/index.ts', { router: true, primaryExport: 'task' }),
      code('src/column/index.ts', { router: true, primaryExport: 'default' }),
      code('src/label/index.ts', { router: true, primaryExport: null }),
      code('src/a/helper.ts', { primaryExport: 'formatDate' }),
      code('src/b/helper.ts', { primaryExport: 'formatDate' }),
    ]);
    const layout = layoutScramble(manifest, 'default', inventory);
    expect(Object.fromEntries(layout.entities.map((entity) => [entity.original, [entity.scrambled, entity.leaky]]))).toEqual({
      'src/a/helper.ts': ['src/utils/format-date.ts', false],
      'src/b/helper.ts': ['src/utils/format-date-2.ts', true],
      'src/column/index.ts': ['src/routes/column.index.ts', true],
      'src/label/index.ts': ['src/routes/label.index.ts', true],
      'src/task/index.ts': ['src/routes/task.ts', false],
    });
  });

  it('treats a file that stays (or differs only in case) as occupying its path', () => {
    const inventory = inventoryOf([code('src/team/Team.service.ts', { primaryExport: 'TeamService' })], [], ['src/services/team.service.ts']);
    expect(destinations(inventory)['src/team/Team.service.ts']).toBe('src/services/team.service-2.ts');
  });

  it('uses the singular folder when the plural would shadow a module file (src/utils.ts next to src/utils/)', () => {
    const inventory = inventoryOf([code('src/utils.ts'), code('src/auth/helper.ts'), code('src/auth/auth.service.ts')]);
    expect(destinations(inventory)).toMatchObject({ 'src/auth/helper.ts': 'src/util/helper.ts', 'src/auth/auth.service.ts': 'src/services/auth.service.ts' });
  });

  it('moves co-located tests with their subject and renames them with it', () => {
    const inventory = inventoryOf(
      [code('src/a/helper.ts', { primaryExport: 'formatDate' }), code('src/b/helper.ts', { primaryExport: 'parseDate' }), code('src/c/c.service.ts')],
      [{ path: 'src/a/helper.spec.ts', subject: 'src/a/helper.ts' }, { path: 'src/c/c.service.test.ts', subject: 'src/c/c.service.ts' }, { path: 'src/c/e2e.spec.ts', subject: null }],
    );
    const layout = layoutScramble(manifest, 'default', inventory);
    expect([...layout.tests].map(([subject, tests]) => [subject, Object.fromEntries(tests)])).toEqual([
      ['src/a/helper.ts', { 'src/a/helper.spec.ts': 'src/utils/format-date.spec.ts' }],
      ['src/c/c.service.ts', { 'src/c/c.service.test.ts': 'src/services/c.service.test.ts' }],
    ]);
    expect(layout.excluded.filter((entry) => entry.reason.startsWith('test'))).toEqual([
      { path: 'src/a/helper.spec.ts', reason: 'test (moves with src/a/helper.ts)' },
      { path: 'src/c/c.service.test.ts', reason: 'test (moves with src/c/c.service.ts)' },
      { path: 'src/c/e2e.spec.ts', reason: 'test with no co-located subject' },
    ]);
  });

  it('H1 gives every moving feature file an opaque, unique name and keeps the extension', () => {
    const inventory = inventoryOf([code('src/team/team.service.ts'), code('src/team/team.controller.tsx'), code('src/team/helper.ts'), code('src/types/user.ts')],
      [{ path: 'src/team/team.service.spec.ts', subject: 'src/team/team.service.ts' }]);
    const layout = layoutScramble(manifest, 'H1', inventory);
    const byOriginal = Object.fromEntries(layout.entities.map((entity) => [entity.original, entity.scrambled]));
    expect(byOriginal['src/team/team.service.ts']).toMatch(/^src\/services\/s-[0-9a-f]{4}\.service\.ts$/);
    expect(byOriginal['src/team/team.controller.tsx']).toMatch(/^src\/controllers\/c-[0-9a-f]{4}\.controller\.tsx$/);
    expect(byOriginal['src/team/helper.ts']).toMatch(/^src\/utils\/u-[0-9a-f]{4}\.ts$/);
    expect(byOriginal['src/types/user.ts']).toBe('src/types/user.ts');
    expect(layout.entities.every((entity) => !entity.leaky)).toBe(true);
    const service = byOriginal['src/team/team.service.ts']!;
    expect(layout.tests.get('src/team/team.service.ts')!.get('src/team/team.service.spec.ts')).toBe(service.replace(/\.ts$/, '.spec.ts'));
    expect(destinations(inventory, 'H1')).toEqual(byOriginal);
  });

  it('H1 lengthens a hash that collides', () => {
    // 600 services in one folder: some four-hex prefixes repeat, every name stays unique.
    const files = Array.from({ length: 600 }, (_, index) => code(`src/f${index}/x${index}.service.ts`));
    const names = layoutScramble(manifest, 'H1', inventoryOf(files)).entities.map((entity) => entity.scrambled);
    expect(new Set(names).size).toBe(600);
    expect(names.some((name) => /s-[0-9a-f]{6}\.service\.ts$/.test(name))).toBe(true);
  });
});

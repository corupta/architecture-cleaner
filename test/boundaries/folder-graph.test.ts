import { describe, expect, test } from 'vitest';
import { folderGraph, folderOf } from '../../src/boundaries/folder-graph.js';
import { persistenceOf } from '../../src/boundaries/persistence.js';
import { analysisOf } from './analysis.js';

describe('folders', () => {
  test('module, platform, shared, and other folders for what stayed in place', () => {
    expect(folderOf('src/modules/album/album.service.ts', 'src')).toEqual({ key: 'module/album', path: 'src/modules/album' });
    expect(folderOf('src/modules/album/sub/x.ts', 'src')).toEqual({ key: 'module/album', path: 'src/modules/album' });
    expect(folderOf('src/platform/logging/logger.ts', 'src')).toEqual({ key: 'platform/logging', path: 'src/platform/logging' });
    expect(folderOf('src/shared/date.ts', 'src')).toEqual({ key: 'shared', path: 'src/shared' });
    expect(folderOf('src/schema/tables/album.table.ts', 'src')).toEqual({ key: 'other:src/schema/tables', path: 'src/schema/tables' });
    expect(folderOf('src/modules/loose.ts', 'src')).toEqual({ key: 'other:src/modules', path: 'src/modules' });
    expect(folderOf('main.ts', '')).toEqual({ key: 'other:.', path: '' });
    expect(folderOf('modules/user/user.ts', '')).toEqual({ key: 'module/user', path: 'modules/user' });
  });
});

describe('the folder graph', () => {
  const analysis = analysisOf({
    'server/src/modules/album/album.service.ts': [
      'server/src/modules/user/user.dto.ts', { to: 'server/src/modules/user/user.dto.ts', typeOnly: true },
      { to: 'server/src/modules/user/user.repository.ts', typeOnly: true }, 'server/src/modules/album/album.repository.ts',
      { to: 'server/src/modules/user/user.mock.ts', kind: 'mock' }, { specifier: 'kysely' },
    ],
    'server/src/modules/album/album.repository.ts': [],
    'server/src/modules/user/user.dto.ts': [],
    'server/src/modules/user/user.repository.ts': [],
    'server/src/modules/user/user.service.ts': ['server/src/modules/user/user.repository.ts'],
    'server/src/modules/user/user.service.spec.ts': ['server/src/modules/album/album.repository.ts'],
    'server/src/platform/registry/services.ts': ['server/src/modules/user/user.service.ts', 'server/src/modules/album/album.service.ts'],
    'server/src/shared/date.ts': [],
    'server/test/utils.ts': ['server/src/modules/album/album.repository.ts'],
    'web/src/app.ts': ['server/src/modules/album/album.service.ts'],
  });
  const graph = folderGraph(analysis, { packageRoot: 'server', moduleRoot: 'src' });

  test('counts file pairs once, value and type-only, and keeps a sample', () => {
    const albumToUser = graph.edges.find((edge) => edge.from === 'module/album' && edge.to === 'module/user')!;
    expect(albumToUser).toEqual({
      from: 'module/album', to: 'module/user', files: 2, typeOnlyFiles: 1,
      sample: [{ from: 'src/modules/album/album.service.ts', to: 'src/modules/user/user.dto.ts' }, { from: 'src/modules/album/album.service.ts', to: 'src/modules/user/user.repository.ts' }],
    });
    // A value and a type-only import of the same file make a value pair.
    expect(graph.pairs.find((pair) => pair.to === 'src/modules/user/user.dto.ts')!.typeOnly).toBe(false);
  });

  test('tests are no importers, mocks no edges, and files outside the package or the module root are left out', () => {
    expect(graph.pairs.map((pair) => pair.from)).not.toContain('src/modules/user/user.service.spec.ts');
    expect(graph.pairs.map((pair) => pair.to)).not.toContain('src/modules/user/user.mock.ts');
    expect(graph.folders.map((folder) => folder.key)).toEqual(['module/album', 'module/user', 'platform/registry', 'shared']);
    expect(graph.folders.find((folder) => folder.key === 'module/user')!.files).toBe(4);
    expect(graph.modules).toEqual(['module/album', 'module/user']);
  });

  test('public files are what other folders import, but not the composition root', () => {
    expect(graph.compositionRoot).toBe('platform/registry');
    expect(graph.publicFiles).toEqual({ 'module/album': [], 'module/user': ['src/modules/user/user.dto.ts', 'src/modules/user/user.repository.ts'] });
    expect(graph.edges.some((edge) => edge.from === 'platform/registry' && edge.to === 'module/album')).toBe(true);
  });
});

describe('persistence', () => {
  test('data-access files that reach a database or the schema, adapters that do not, schema by place and name', () => {
    const analysis = analysisOf({
      'server/src/modules/album/album.repository.ts': [{ specifier: 'kysely' }],
      'server/src/modules/user/user.repository.ts': ['server/src/schema/tables/user.table.ts'],
      'server/src/platform/logging/logging.repository.ts': [{ specifier: 'nestjs-cls' }],
      'server/src/modules/user/user.dao.ts': [{ specifier: '@prisma/client/runtime' }],
      'server/src/schema/tables/user.table.ts': [],
      'server/src/schema/migrations/1-init.ts': [],
      'server/src/modules/album/album.entity.ts': [],
      'server/src/modules/album/album.repository.spec.ts': [{ specifier: 'kysely' }],
      'server/src/modules/user/user.service.ts': [{ specifier: 'kysely' }],
    });
    expect(persistenceOf(analysis, { packageRoot: 'server', moduleRoot: 'src' })).toEqual({
      dataAccess: ['src/modules/album/album.repository.ts', 'src/modules/user/user.dao.ts', 'src/modules/user/user.repository.ts'],
      adapters: ['src/platform/logging/logging.repository.ts'],
      schema: ['src/modules/album/album.entity.ts', 'src/schema/migrations/1-init.ts', 'src/schema/tables/user.table.ts'],
    });
  });
});

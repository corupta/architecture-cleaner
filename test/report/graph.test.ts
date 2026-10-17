import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { browsableUrl, composedPathMap, computeRunGraph, displayFolder, filesFlow, graphJson, graphSide, readRunGraph } from '../../src/report/graph.js';
import type { RunState } from '../../src/orchestrator/types.js';
import { analysisOf } from '../boundaries/analysis.js';
import { makeRunFixture } from './fixture.js';

describe('display folders', () => {
  it('keeps the layout folders and collapses everything else to the first directory under the module root', () => {
    expect(displayFolder('src/modules/album/album.service.ts', 'src')).toEqual({ key: 'module/album', kind: 'module' });
    expect(displayFolder('src/platform/database/database.ts', 'src')).toEqual({ key: 'platform/database', kind: 'platform' });
    expect(displayFolder('src/shared/util/a.ts', 'src')).toEqual({ key: 'shared', kind: 'shared' });
    expect(displayFolder('src/schema/tables/album.table.ts', 'src')).toEqual({ key: 'src/schema/', kind: 'folder' });
    expect(displayFolder('src/main.ts', 'src')).toEqual({ key: 'src/', kind: 'root' });
    expect(displayFolder('test/utils.ts', 'src')).toEqual({ key: 'test/', kind: 'outside' });
    expect(displayFolder('controllers/a.ts', '')).toEqual({ key: 'controllers/', kind: 'folder' });
  });
});

describe('graph aggregation', () => {
  it('counts file pairs inside and across display folders, production importers only, and finds folder cycles', () => {
    const analysis = analysisOf({
      'server/src/controllers/a.controller.ts': ['server/src/services/a.service.ts', 'server/src/dtos/a.dto.ts'],
      'server/src/controllers/a.controller.spec.ts': ['server/src/controllers/a.controller.ts', 'server/src/services/a.service.ts'],
      'server/src/services/a.service.ts': ['server/src/services/base.service.ts', { to: 'server/src/dtos/a.dto.ts', typeOnly: true }],
      'server/src/services/base.service.ts': ['server/src/controllers/a.controller.ts'],
      'server/src/dtos/a.dto.ts': [],
      'server/src/main.ts': ['server/src/controllers/a.controller.ts'],
    });
    const side = graphSide(analysis, { packageRoot: 'server', moduleRoot: 'src' }, { commit: 'c'.repeat(40), tree: 't'.repeat(40) });
    expect(side.folders.map((folder) => [folder.key, folder.files, folder.productionFiles, folder.internalPairs])).toEqual([
      ['src/controllers/', 2, 1, 0],
      ['src/dtos/', 1, 1, 0],
      ['src/services/', 2, 2, 1],
      ['src/', 1, 1, 0],
    ]);
    expect(side.edges).toEqual([
      { from: 'src/', to: 'src/controllers/', pairs: 1, typeOnlyPairs: 0 },
      { from: 'src/controllers/', to: 'src/dtos/', pairs: 1, typeOnlyPairs: 0 },
      { from: 'src/controllers/', to: 'src/services/', pairs: 1, typeOnlyPairs: 0 },
      { from: 'src/services/', to: 'src/controllers/', pairs: 1, typeOnlyPairs: 0 },
      { from: 'src/services/', to: 'src/dtos/', pairs: 1, typeOnlyPairs: 1 },
    ]);
    expect([side.internalPairs, side.crossPairs]).toEqual([1, 5]);
    expect(side.cycles).toEqual([['src/controllers/', 'src/services/']]);
  });

  it('leaves the composition root out of the cycles', () => {
    const analysis = analysisOf({
      'src/platform/registry/index.ts': ['src/modules/a/a.ts'],
      'src/modules/a/a.ts': ['src/platform/registry/index.ts'],
    });
    const side = graphSide(analysis, { packageRoot: '', moduleRoot: 'src' }, { commit: 'c', tree: 't' });
    expect(side.edges).toHaveLength(2);
    expect(side.cycles).toEqual([]);
  });
});

describe('path maps and files flow', () => {
  const step = (index: number, status: 'certified' | 'pinned', pathMap: Record<string, string>) => ({ index, status, pathMap }) as unknown as RunState['steps'][number];

  it('composes the certified steps in order (an R3 rename after a move) and skips steps that did not commit', () => {
    const map = composedPathMap({
      steps: [
        step(3, 'certified', { 'src/modules/a/A.ts': 'src/modules/a/a.ts' }),
        step(1, 'certified', { 'src/x/A.ts': 'src/modules/a/A.ts', 'src/x/b.ts': 'src/modules/a/b.ts' }),
        step(2, 'pinned', { 'src/x/c.ts': 'src/modules/c/c.ts' }),
      ],
    });
    expect([...map]).toEqual([['src/x/A.ts', 'src/modules/a/a.ts'], ['src/x/b.ts', 'src/modules/a/b.ts']]);
  });

  it('counts every base file by its base and head folder, and reports files the head tree lacks', () => {
    const { flow, unmatched } = filesFlow(
      ['app/src/x/a.ts', 'app/src/x/b.ts', 'app/src/y/c.ts', 'app/src/y/gone.ts'],
      new Set(['app/src/modules/a/a.ts', 'app/src/modules/a/b.ts', 'app/src/y/c.ts']),
      new Map([['app/src/x/a.ts', 'app/src/modules/a/a.ts'], ['app/src/x/b.ts', 'app/src/modules/a/b.ts']]),
      { packageRoot: 'app', moduleRoot: 'src' },
    );
    expect(flow).toEqual([{ from: 'src/x/', to: 'module/a', files: 2 }, { from: 'src/y/', to: 'src/y/', files: 1 }]);
    expect(unmatched).toEqual(['app/src/y/gone.ts']);
  });
});

describe('origin URLs', () => {
  it('turns https and ssh remotes into browsable URLs without credentials or .git', () => {
    expect(browsableUrl('https://github.com/immich-app/immich.git')).toBe('https://github.com/immich-app/immich');
    expect(browsableUrl('https://user:token@github.com/a/b')).toBe('https://github.com/a/b');
    expect(browsableUrl('git@github.com:a/b.git')).toBe('https://github.com/a/b');
    expect(browsableUrl('/home/someone/repo')).toBeNull();
  });
});

describe('computeRunGraph on a real git chain', () => {
  it('analyzes base and head from git objects and maps the files through the steps', () => {
    const fixture = makeRunFixture();
    const graph = computeRunGraph({ repo: fixture.repo, state: fixture.state });
    expect(graph.base.commit).toBe(fixture.state.base);
    expect(graph.head.commit).toBe(fixture.state.head);
    expect(graph.base.folders.map((folder) => [folder.key, folder.files])).toEqual([['src/controllers/', 3], ['src/services/', 2], ['src/', 1]]);
    expect(graph.head.folders.map((folder) => [folder.key, folder.files])).toEqual([['src/services/', 1], ['src/', 1], ['module/order', 1], ['module/user', 3]]);
    // The import pairs survive the moves: the same 6 pairs, regrouped.
    expect([graph.base.internalPairs, graph.base.crossPairs]).toEqual([1, 5]);
    expect([graph.head.internalPairs, graph.head.crossPairs]).toEqual([1, 5]);
    expect(graph.flow).toEqual([
      { from: 'src/', to: 'src/', files: 1 },
      { from: 'src/controllers/', to: 'module/order', files: 1 },
      { from: 'src/controllers/', to: 'module/user', files: 2 },
      { from: 'src/services/', to: 'module/user', files: 1 },
      { from: 'src/services/', to: 'src/services/', files: 1 },
    ]);
    expect(graph.unmatched).toEqual([]);
    expect(graph.origin).toBeNull();

    fs.writeFileSync(path.join(fixture.directory, 'graph.json'), graphJson(graph));
    expect(readRunGraph(fixture.directory, fixture.state)).toEqual(graph);
    expect(readRunGraph(fixture.directory, { ...fixture.state, head: fixture.commits[3]! })).toBeNull();
  });
});

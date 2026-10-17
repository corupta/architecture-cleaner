// The bench baselines on small synthetic facts: B0 type folders, the name-token family (full stem, anchored with
// prefix merging), export tokens that survive opaque file names (H1), the seeds draft from both seed sources, and
// Louvain (deterministic per seed, finds two weakly joined cliques).
import { describe, expect, it } from 'vitest';
import {
  baselinePartitions, exportName, louvainClusters, louvainPartitions, louvainResolutions, louvainSeeds, mulberry32, nameTokenAnchored,
  nameTokenFullStem, renamedFacts, typeFolders,
} from '../../src/bench/baselines.js';
import { seedDraft } from '../../src/planner/seeds.js';
import type { Edge, Facts, FileFact } from '../../src/planner/types.js';

type FileSpec = [path: string, role: string, primaryExport?: string];

function factsOf(files: FileSpec[], edges: [string, string, number?][] = []): Facts {
  const sorted = [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    packageRoot: 'server',
    moduleRoot: 'src',
    sha: 'test',
    files: sorted.map(([filePath, role, primaryExport], index): FileFact => ({
      path: filePath, id: index + 1, role, loc: 1, exports: primaryExport ? [primaryExport] : [], primaryExport: primaryExport ?? null,
      tables: { reads: [], writes: [] }, routes: [], tests: [],
    })),
    edges: edges.map(([from, to, weight = 1]): Edge => ({ from, to, weight, typeOnly: weight < 1, kinds: ['import'], symbols: [] })),
    pins: [],
  };
}

const scrambled = factsOf([
  ['src/main.ts', 'entrypoint'],
  ['src/services/team.service.ts', 'service', 'TeamService'],
  ['src/services/team-collection.service.ts', 'service', 'TeamCollectionService'],
  ['src/controllers/team-collection.controller.ts', 'controller', 'TeamCollectionController'],
  ['src/dto/team-collection-input.dto.ts', 'dto', 'CreateTeamCollectionInput'],
  ['src/utils/collection-sort.ts', 'util', 'sortCollections'],
]);

describe('B0 and the name-token family', () => {
  it('B0 puts each file in its first folder under the module root, root files in `root`', () => {
    expect(Object.fromEntries(typeFolders(scrambled))).toEqual({
      'src/controllers/team-collection.controller.ts': 'controllers',
      'src/dto/team-collection-input.dto.ts': 'dto',
      'src/main.ts': 'root',
      'src/services/team-collection.service.ts': 'services',
      'src/services/team.service.ts': 'services',
      'src/utils/collection-sort.ts': 'utils',
    });
  });

  it('full stem groups by the whole stem; anchored joins the longest entity anchor a stem contains', () => {
    const fullStem = nameTokenFullStem(scrambled);
    expect(fullStem.get('src/dto/team-collection-input.dto.ts')).toBe('team-collection-input');
    expect(fullStem.get('src/services/team-collection.service.ts')).toBe('team-collection');
    const anchored = nameTokenAnchored(scrambled);
    expect(anchored.get('src/dto/team-collection-input.dto.ts')).toBe('team-collection');
    expect(anchored.get('src/controllers/team-collection.controller.ts')).toBe('team-collection');
    expect(anchored.get('src/services/team.service.ts')).toBe('team');
    // `collection` is in four stems, so it is an anchor of its own (shared by >= 3 stems).
    expect(anchored.get('src/utils/collection-sort.ts')).toBe('collection');
  });
});

describe('export names (H1: opaque file names)', () => {
  const opaque = factsOf([
    ['src/services/s-1a2b.service.ts', 'service', 'TeamService'],
    ['src/services/s-3c4d.service.ts', 'service', 'TeamCollectionService'],
    ['src/controllers/c-5e6f.controller.ts', 'controller', 'TeamCollectionController'],
    ['src/utils/u-7a8b.ts', 'util'],
  ], [['src/controllers/c-5e6f.controller.ts', 'src/services/s-3c4d.service.ts'], ['src/utils/u-7a8b.ts', 'src/services/s-1a2b.service.ts']]);

  it('names every file after its primary export, keeps keys unique, and maps edges along', () => {
    const view = renamedFacts(opaque, exportName);
    expect(view.facts.files.map((file) => file.path)).toEqual([
      'src/controllers/c-5e6f.controller.ts/TeamCollectionController.ts',
      'src/services/s-1a2b.service.ts/TeamService.ts',
      'src/services/s-3c4d.service.ts/TeamCollectionService.ts',
      'src/utils/u-7a8b.ts/.ts',
    ]);
    expect(view.facts.edges[0]).toMatchObject({ from: 'src/controllers/c-5e6f.controller.ts/TeamCollectionController.ts', to: 'src/services/s-3c4d.service.ts/TeamCollectionService.ts' });
    expect(view.original.get('src/utils/u-7a8b.ts/.ts')).toBe('src/utils/u-7a8b.ts');
  });

  it('export-token recovers the features file names hide; the file-name methods cannot', () => {
    const partitions = new Map(baselinePartitions(opaque).map((partition) => [partition.method, partition.assignment]));
    expect(Object.fromEntries(partitions.get('export-token (anchored)')!)).toMatchObject({
      'src/controllers/c-5e6f.controller.ts': 'team-collection',
      'src/services/s-3c4d.service.ts': 'team-collection',
      'src/services/s-1a2b.service.ts': 'team',
    });
    // The seeds draft from export names propagates the unnamed util to the one file it imports.
    expect(partitions.get('seeds draft (export names)')!.get('src/utils/u-7a8b.ts')).toBe('team');
    expect(new Set(partitions.get('name-token (anchored)')!.values()).has('team-collection')).toBe(false);
  });

  it('lists every method once, the planner draft as kind `draft` equal to seedDraft', () => {
    const partitions = baselinePartitions(opaque);
    expect(partitions.map((partition) => `${partition.kind}: ${partition.method}`)).toEqual([
      'baseline: B0 type folders', 'baseline: name-token (full stem)', 'baseline: name-token (anchored)', 'baseline: export-token (anchored)',
      'baseline: seeds draft (export names)', 'draft: seeds draft',
    ]);
    expect(partitions.at(-1)!.assignment).toEqual(seedDraft(opaque).assignment);
    for (const partition of partitions) expect([...partition.assignment.keys()]).toEqual(opaque.files.map((file) => file.path));
  });
});

describe('Louvain', () => {
  const clique = (prefix: string): [string, string][] => {
    const members = [1, 2, 3, 4].map((index) => `src/${prefix}/f${index}.ts`);
    return members.flatMap((from, at) => members.slice(at + 1).map((to): [string, string] => [from, to]));
  };
  const twoCliques = factsOf(
    [1, 2, 3, 4].flatMap((index): FileSpec[] => [[`src/a/f${index}.ts`, 'util'], [`src/b/f${index}.ts`, 'util']]),
    [...clique('a'), ...clique('b'), ['src/a/f1.ts', 'src/b/f1.ts', 0.5]],
  );

  it('splits two cliques joined by one type-only edge, and gives the same answer for the same seed', () => {
    const clusters = louvainClusters(twoCliques, { seed: 1, resolution: 1 });
    const label = (file: string) => clusters.get(file);
    expect(new Set(clusters.values()).size).toBe(2);
    for (const index of [2, 3, 4]) {
      expect(label(`src/a/f${index}.ts`)).toBe(label('src/a/f1.ts'));
      expect(label(`src/b/f${index}.ts`)).toBe(label('src/b/f1.ts'));
    }
    expect(louvainClusters(twoCliques, { seed: 1, resolution: 1 })).toEqual(clusters);
  });

  it('runs every resolution with seeds 1-5', () => {
    const runs = louvainPartitions(twoCliques);
    expect([...runs.keys()]).toEqual([...louvainResolutions]);
    for (const partitions of runs.values()) expect(partitions).toHaveLength(louvainSeeds.length);
  });

  it("seeds Louvain with the spike's mulberry32", () => {
    const first = mulberry32(1);
    const again = mulberry32(1);
    const values = [first(), first(), first()];
    expect([again(), again(), again()]).toEqual(values);
    for (const value of values) expect(value >= 0 && value < 1).toBe(true);
  });
});

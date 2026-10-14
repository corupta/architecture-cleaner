// The critic's gate (S6): suggestions compared per warning code and group, merges that need evidence, and registry
// groups that hold registries only. The fixture replays, in miniature, the three misplacements the S5 critic put into
// the committed immich plan: EXIF metadata merged into system-metadata on a shared word, platform/move renamed to the
// one-file module/move-history, and app.repository moved out of shared/ into platform/registry.
import { describe, expect, it } from 'vitest';
import { addedIssues, applyCritique, applyCritiques, type Critique } from '../../src/planner/critic.js';
import type { Draft, Edge, Facts, FileFact, GroupKind, Issue, Placement, Plan } from '../../src/planner/types.js';
import { validatePlan } from '../../src/planner/validate.js';

const file = (path: string, role: string, extra: Partial<FileFact> = {}): Omit<FileFact, 'id'> =>
  ({ path, role, loc: 10, exports: [], primaryExport: null, tables: { reads: [], writes: [] }, routes: [], tests: [], ...extra });
const edge = (from: string, to: string): Edge => ({ from, to, weight: 1, typeOnly: false, kinds: ['import'], symbols: [] });

const paths = {
  systemMetadataController: 'src/controllers/system-metadata.controller.ts',
  systemMetadataService: 'src/services/system-metadata.service.ts',
  systemMetadataRepository: 'src/repositories/system-metadata.repository.ts',
  metadataService: 'src/services/metadata.service.ts',
  metadataRepository: 'src/repositories/metadata.repository.ts',
  assetService: 'src/services/asset.service.ts',
  assetRepository: 'src/repositories/asset.repository.ts',
  storageService: 'src/services/storage.service.ts',
  storageRepository: 'src/repositories/storage.repository.ts',
  moveRepository: 'src/repositories/move.repository.ts',
  serviceRegistry: 'src/services/index.ts',
  repositoryRegistry: 'src/repositories/index.ts',
  appRepository: 'src/repositories/app.repository.ts',
  date: 'src/utils/date.ts',
};
const groups: [string, GroupKind, string, Omit<FileFact, 'id'>][] = [
  [paths.systemMetadataController, 'module', 'system-metadata', file(paths.systemMetadataController, 'controller', { routes: ['system-metadata'] })],
  [paths.systemMetadataService, 'module', 'system-metadata', file(paths.systemMetadataService, 'service')],
  [paths.systemMetadataRepository, 'module', 'system-metadata', file(paths.systemMetadataRepository, 'repository', { tables: { reads: ['system_metadata'], writes: ['system_metadata'] } })],
  [paths.metadataService, 'platform', 'metadata', file(paths.metadataService, 'service')],
  [paths.metadataRepository, 'platform', 'metadata', file(paths.metadataRepository, 'repository')],
  [paths.assetService, 'module', 'asset', file(paths.assetService, 'service')],
  [paths.assetRepository, 'module', 'asset', file(paths.assetRepository, 'repository', { tables: { reads: ['asset'], writes: ['asset'] } })],
  [paths.storageService, 'platform', 'storage', file(paths.storageService, 'service')],
  [paths.storageRepository, 'platform', 'storage', file(paths.storageRepository, 'repository')],
  [paths.moveRepository, 'platform', 'move', file(paths.moveRepository, 'repository', { tables: { reads: ['move_history'], writes: ['move_history'] } })],
  [paths.serviceRegistry, 'platform', 'registry', file(paths.serviceRegistry, 'registry')],
  [paths.repositoryRegistry, 'platform', 'registry', file(paths.repositoryRegistry, 'registry')],
  [paths.appRepository, 'shared', 'shared', file(paths.appRepository, 'repository')],
  [paths.date, 'shared', 'shared', file(paths.date, 'util')],
];
const sorted = [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1));
const facts: Facts = {
  packageRoot: 'server', moduleRoot: 'src', sha: 'test', pins: [],
  files: sorted.map(([, , , fact], index) => ({ ...fact, id: index + 1 })),
  edges: [
    edge(paths.systemMetadataController, paths.systemMetadataService), edge(paths.systemMetadataService, paths.systemMetadataRepository),
    // EXIF extraction: uses its own repository and the asset feature's, never system-metadata's.
    edge(paths.metadataService, paths.metadataRepository), edge(paths.metadataService, paths.assetRepository), edge(paths.metadataService, paths.date),
    edge(paths.assetService, paths.assetRepository), edge(paths.assetService, paths.date), edge(paths.systemMetadataService, paths.date),
    edge(paths.storageService, paths.storageRepository), edge(paths.storageService, paths.moveRepository),
    edge(paths.serviceRegistry, paths.systemMetadataService), edge(paths.serviceRegistry, paths.metadataService),
    edge(paths.repositoryRegistry, paths.systemMetadataRepository), edge(paths.repositoryRegistry, paths.appRepository),
    edge(paths.storageService, paths.appRepository), edge(paths.assetService, paths.appRepository),
  ].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1)),
};
const draft: Draft = {
  assignment: new Map(sorted.map(([path, , name]) => [path, name])),
  confidence: new Map(sorted.map(([path]) => [path, 'seed'])),
  contested: [],
};
const plan: Plan = { placements: sorted.map(([path, kind, name]): Placement => ({ path, kind, name, confidence: 'seed', contested: false, source: 'draft' })) };
const critique = (change: Partial<Critique>): Critique => ({ review: 'review', groups: [], moves: [], ...change });
const outcome = (change: Partial<Critique>) => applyCritique(facts, draft, plan, critique(change)).suggestions
  .map((suggestion) => [suggestion.summary, suggestion.accepted, suggestion.reason ?? suggestion.evidence ?? '']);

describe('the critic gate', () => {
  it('starts from a plan whose warnings are the ones the S5 critic acted on', () => {
    expect(validatePlan(facts, draft, plan).issues.map((issue) => `${issue.code} ${issue.group}`)).toEqual([
      'impure-shared shared/shared',
      'one-file-platform platform/move',
      'platform-feature platform/move',
    ]);
  });

  it('rejects a merge on a shared word alone: metadata into system-metadata', () => {
    expect(outcome({ groups: [{ group: 'platform/metadata', name: 'system-metadata', kind: 'module' }] })).toEqual([
      ['group platform/metadata → module/system-metadata', false, 'a merge without evidence: no edge between the files of platform/metadata and module/system-metadata, no table or route both use'],
    ]);
  });

  it('treats moving a group\'s last file as merging the group: it needs evidence too', () => {
    expect(outcome({ moves: [{ file: 'repositories/move.repository.ts', to: 'system-metadata', kind: 'module', rationale: 'history is metadata' }] })).toEqual([
      ['move src/repositories/move.repository.ts → module/system-metadata', false, 'a merge without evidence: no edge between the files of platform/move and module/system-metadata, no table or route both use'],
    ]);
    expect(outcome({ moves: [{ file: 'repositories/move.repository.ts', to: 'storage', kind: 'platform', rationale: 'storage moves files' }] })).toEqual([
      ['move src/repositories/move.repository.ts → platform/storage', true, '1 edge'],
    ]);
  });

  it('keeps a merge that an edge, a table or a route supports, and records the evidence', () => {
    expect(outcome({ groups: [{ group: 'platform/metadata', name: 'asset', kind: 'module' }] })).toEqual([
      ['group platform/metadata → module/asset', true, '1 edge'],
    ]);
    const sharingTable = { ...facts, files: facts.files.map((fact) => (fact.path === paths.metadataRepository ? { ...fact, tables: { reads: ['system_metadata'], writes: [] } } : fact)) };
    const { suggestions } = applyCritique(sharingTable, draft, plan, critique({ groups: [{ group: 'platform/metadata', name: 'system-metadata', kind: 'module' }] }));
    expect(suggestions.map((suggestion) => [suggestion.accepted, suggestion.evidence])).toEqual([[true, 'tables system_metadata']]);
  });

  it('rejects trading one warning for another in a group: platform/move → module/move-history', () => {
    expect(outcome({ groups: [{ group: 'platform/move', name: 'move-history', kind: 'module' }] })).toEqual([
      ['group platform/move → module/move-history', false, 'adds a warning (singleton-group: module/move-history holds one file)'],
    ]);
  });

  it('keeps a rename that carries its warnings along and adds none', () => {
    expect(outcome({ groups: [{ group: 'platform/move', name: 'move-history', kind: 'platform' }] })).toEqual([
      ['group platform/move → platform/move-history', true, ''],
    ]);
  });

  it('rejects moving a non-registry file into a registry group, even when it clears an impure-shared warning: registry wiring is no evidence', () => {
    expect(outcome({ moves: [{ file: 'repositories/app.repository.ts', to: 'registry', kind: 'platform', rationale: 'impure, so composition root' }] })).toEqual([
      ['move src/repositories/app.repository.ts → platform/registry', false,
        'a move without evidence: no edge between src/repositories/app.repository.ts and the files of platform/registry, no table or route both use'],
    ]);
  });

  it('keeps a move that clears a warning without adding one', () => {
    expect(outcome({ moves: [{ file: 'repositories/app.repository.ts', to: 'storage', kind: 'platform', rationale: 'storage plumbing' }] })).toEqual([
      ['move src/repositories/app.repository.ts → platform/storage', true, '1 edge'],
    ]);
  });

  it('takes no evidence from a hub table: one that more than three groups use links no two of them', () => {
    const readers = new Set([paths.systemMetadataRepository, paths.metadataRepository, paths.storageRepository, paths.moveRepository, paths.assetRepository]);
    const hub = { ...facts, files: facts.files.map((fact) => (readers.has(fact.path) ? { ...fact, tables: { reads: [...fact.tables.reads, 'asset'], writes: fact.tables.writes } } : fact)) };
    const reasons = (change: Partial<Critique>) => applyCritique(hub, draft, plan, critique(change)).suggestions.map((suggestion) => [suggestion.accepted, suggestion.reason ?? suggestion.evidence]);
    expect(reasons({ groups: [{ group: 'platform/move', name: 'system-metadata', kind: 'module' }] })).toEqual([
      [false, 'a merge without evidence: no edge between the files of platform/move and module/system-metadata, no table or route both use'],
    ]);
    expect(reasons({ moves: [{ file: 'repositories/metadata.repository.ts', to: 'system-metadata', kind: 'module', rationale: 'both read assets' }] })).toEqual([
      [false, 'a move without evidence: no edge between src/repositories/metadata.repository.ts and the files of module/system-metadata, no table or route both use'],
    ]);
  });

  it('needs evidence for every move into an existing group, not only for a group\'s last file', () => {
    expect(outcome({ moves: [{ file: 'services/system-metadata.service.ts', to: 'asset', kind: 'module', rationale: 'assets carry metadata' }] })).toEqual([
      ['move src/services/system-metadata.service.ts → module/asset', false,
        'a move without evidence: no edge between src/services/system-metadata.service.ts and the files of module/asset, no table or route both use'],
    ]);
  });

  it('rejects splitting a registry off into a platform group of its own, and lets one join the composition root', () => {
    expect(outcome({ moves: [{ file: 'services/index.ts', to: 'bootstrap', kind: 'platform', rationale: 'service wiring' }] })).toEqual([
      ['move src/services/index.ts → platform/bootstrap', false,
        'adds a warning (registry-outside-root: src/services/index.ts is a registry outside platform/registry, the composition root)'],
    ]);
    const astray = { placements: plan.placements.map((placement) => (placement.path === paths.serviceRegistry ? { ...placement, name: 'bootstrap' } : placement)) };
    expect(applyCritique(facts, draft, astray, critique({ moves: [{ file: 'services/index.ts', to: 'registry', kind: 'platform', rationale: 'back with the others' }] })).suggestions
      .map((suggestion) => [suggestion.summary, suggestion.accepted, suggestion.evidence])).toEqual([
      ['move src/services/index.ts → platform/registry', true, 'registries join the composition root'],
    ]);
  });
});

describe('the critic gate over K reviews', () => {
  const outcomes = (...changes: Partial<Critique>[]) => applyCritiques(facts, draft, plan, changes.map(critique)).suggestions
    .map((suggestion) => [suggestion.sample, suggestion.summary, suggestion.accepted, suggestion.reason ?? suggestion.evidence ?? '']);

  it('applies the reviews in order, numbers their suggestions, and never lets a later one override a kept one', () => {
    expect(outcomes(
      { moves: [{ file: 'repositories/app.repository.ts', to: 'storage', kind: 'platform', rationale: 'storage plumbing' }] },
      { moves: [{ file: 'repositories/app.repository.ts', to: 'asset', kind: 'module', rationale: 'asset uses it' }] },
      { groups: [{ group: 'platform/metadata', name: 'asset', kind: 'module' }] },
    )).toEqual([
      [1, 'move src/repositories/app.repository.ts → platform/storage', true, '1 edge'],
      [2, 'move src/repositories/app.repository.ts → module/asset', false, 'already changed by a kept suggestion of review 1'],
      [3, 'group platform/metadata → module/asset', true, '1 edge'],
    ]);
  });

  it('drops a later review\'s repeat of a kept suggestion silently, and still gates what an earlier review refused', () => {
    expect(outcomes(
      { groups: [{ group: 'platform/metadata', name: 'asset', kind: 'module' }, { group: 'platform/move', name: 'move-history', kind: 'module' }] },
      { groups: [{ group: 'platform/metadata', name: 'asset', kind: 'module' }, { group: 'platform/move', name: 'move-history', kind: 'module' }] },
    )).toEqual([
      [1, 'group platform/metadata → module/asset', true, '1 edge'],
      [1, 'group platform/move → module/move-history', false, 'adds a warning (singleton-group: module/move-history holds one file)'],
      [2, 'group platform/move → module/move-history', false, 'adds a warning (singleton-group: module/move-history holds one file)'],
    ]);
  });

  it('reads a group key written with a plural kind (modules/x) as the group it names', () => {
    expect(outcomes({ groups: [{ group: 'platforms/metadata', name: 'asset', kind: 'module' }] })).toEqual([
      [undefined, 'group platform/metadata → module/asset', true, '1 edge'],
    ]);
  });

  it('is applyCritique for a single review: no review numbers', () => {
    const single = { groups: [{ group: 'platform/metadata', name: 'asset', kind: 'module' as const }] };
    expect(applyCritiques(facts, draft, plan, [critique(single)])).toEqual(applyCritique(facts, draft, plan, critique(single)));
    expect(applyCritiques(facts, draft, plan, [critique(single)]).suggestions[0]!.sample).toBeUndefined();
  });
});

describe('addedIssues', () => {
  const warning = (code: Issue['code'], group: string, detail = `${code} in ${group}`): Issue => ({ severity: 'warning', code, group, detail });

  it('counts per severity, code and group, so a swap adds one and a total stays blind to it', () => {
    const before = [warning('platform-feature', 'platform/move')];
    const after = [warning('singleton-group', 'module/move-history')];
    expect(addedIssues(before, after)).toEqual(after);
    expect(addedIssues(before, [warning('platform-feature', 'platform/move', 'reworded')])).toEqual([]);
  });

  it('names the new issue of a grown key, and counts a renamed group\'s issues under its new name', () => {
    const before = [warning('impure-shared', 'shared/shared', 'a')];
    expect(addedIssues(before, [warning('impure-shared', 'shared/shared', 'b'), warning('impure-shared', 'shared/shared', 'a')])).toEqual([warning('impure-shared', 'shared/shared', 'b')]);
    const renamed = { from: 'module/x', to: 'module/y' };
    expect(addedIssues([warning('singleton-group', 'module/x')], [warning('singleton-group', 'module/y')], renamed)).toEqual([]);
    expect(addedIssues([warning('singleton-group', 'module/x')], [warning('singleton-group', 'module/y')])).toHaveLength(1);
  });
});

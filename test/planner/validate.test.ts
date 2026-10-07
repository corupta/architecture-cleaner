// The planner's deterministic validator: TurboMQ (ARCADE port), cycles, disagreements, the vocabulary and name rules,
// checkEdit's drops and repairs, applyEdit, validatePlan's issues and rankCandidates.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { planMetrics, stronglyConnectedComponents } from '../../src/planner/metrics.js';
import { turboMq, turboMqClusterFactors } from '../../src/planner/metrics-turbo-mq.js';
import type { Confidence, Draft, Edge, Facts, FileFact, GroupKind, Placement, Plan, PlanEdit, Validation } from '../../src/planner/types.js';
import { applyEdit, canonicalGroup, checkEdit, checkName, rankCandidates, validatePlan, vocabularyOf } from '../../src/planner/validate.js';

function fileFact(id: number, filePath: string, extra: Partial<FileFact> = {}): FileFact {
  const role = path.posix.basename(filePath).split('.').slice(-2, -1)[0] ?? 'other';
  return { path: filePath, id, role, loc: 10, exports: [], primaryExport: null, tables: { reads: [], writes: [] }, routes: [], tests: [], ...extra };
}

const edge = (from: string, to: string, weight = 1): Edge => ({ from, to, weight, typeOnly: weight < 1, kinds: ['import'], symbols: [] });

function factsOf(paths: (string | [string, Partial<FileFact>])[], edges: Edge[] = [], pins: string[] = []): Facts {
  const files = paths.map((entry) => (typeof entry === 'string' ? [entry, {}] as const : entry)).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([filePath, extra], index) => fileFact(index + 1, filePath, extra));
  return { packageRoot: '', moduleRoot: 'src', sha: 'test', files, edges, pins: pins.map((pin) => ({ path: pin, reason: 'entrypoint', detail: '' })) };
}

function draftOf(labels: Record<string, string>, confidence: Record<string, Confidence> = {}): Draft {
  const assignment = new Map(Object.entries(labels));
  const confidences = new Map([...assignment.keys()].map((file) => [file, confidence[file] ?? 'seed']));
  return { assignment, confidence: confidences, contested: [...confidences].filter(([, value]) => value !== 'seed' && value !== 'propagated-strong').map(([file]) => file).sort() };
}

const place = (filePath: string, kind: GroupKind, name: string): Placement => ({ path: filePath, kind, name, confidence: 'seed', contested: false, source: 'draft' });

// A small type-sliced backend: album and asset features, an asset-media sub-feature, a registry and a date helper.
const files = {
  albumController: 'src/controllers/album.controller.ts',
  albumService: 'src/services/album.service.ts',
  albumRepository: 'src/repositories/album.repository.ts',
  assetService: 'src/services/asset.service.ts',
  assetRepository: 'src/repositories/asset.repository.ts',
  assetMediaService: 'src/services/asset-media.service.ts',
  registry: 'src/repositories/index.ts',
  date: 'src/utils/date.ts',
};
const sample = factsOf([
  [files.albumController, { routes: ['albums'], exports: ['AlbumController'] }],
  files.albumService,
  [files.albumRepository, { tables: { reads: ['album_user'], writes: ['album'] } }],
  files.assetService,
  files.assetRepository,
  files.assetMediaService,
  [files.registry, { role: 'registry' }],
  files.date,
], [
  edge(files.albumController, files.albumService),
  edge(files.albumService, files.albumRepository),
  edge(files.albumService, files.date),
  edge(files.assetService, files.assetRepository),
  edge(files.assetMediaService, files.assetService),
  edge(files.assetMediaService, files.assetRepository),
  edge(files.assetService, files.assetMediaService, 0.5),
  edge(files.registry, files.albumRepository),
  edge(files.registry, files.assetRepository),
], ['src/main.ts']);
const sampleDraft = draftOf({
  [files.albumController]: 'album', [files.albumService]: 'album', [files.albumRepository]: 'album',
  [files.assetService]: 'asset', [files.assetRepository]: 'asset', [files.assetMediaService]: 'asset-media',
  [files.registry]: 'registry', [files.date]: 'shared',
}, { [files.assetMediaService]: 'propagated-weak', [files.date]: 'isolated' });
// Largest first, then by label (edit.ts draftGroupIds).
const sampleIds = new Map([['album', 'G1'], ['asset', 'G2'], ['asset-media', 'G3'], ['registry', 'G4'], ['shared', 'G5']]);
const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe('TurboMQ (ARCADE port)', () => {
  // X = {a, b}, Y = {c, d}: μ_X = 2 (a→b, b→a), μ_Y = 2 (c→d, d→c), one cross edge a→c. The repeated a→b, the
  // self-loop and the edge to a file outside the partition are dropped; weights are ignored.
  const partition = new Map([['a', 'X'], ['b', 'X'], ['c', 'Y'], ['d', 'Y']]);
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'a', to: 'b' }, { from: 'a', to: 'a' }, { from: 'a', to: 'c' },
    { from: 'c', to: 'd' }, { from: 'd', to: 'c' }, { from: 'd', to: 'outside' }];

  it('computes CF = 2μ/(2μ+ε) per cluster', () => {
    expect([...turboMqClusterFactors(partition, edges)]).toEqual([['X', 0.8], ['Y', 0.8]]);
    expect(turboMq(partition, edges)).toEqual({ sum: 1.6, mean: 0.8 });
  });

  it('gives a cluster without internal edges CF 0 and counts it in the mean', () => {
    const withLoner = new Map([...partition, ['z', 'Z']]);
    const factors = turboMqClusterFactors(withLoner, [...edges, { from: 'z', to: 'a' }]);
    expect(factors.get('X')).toBeCloseTo(4 / 6);
    expect(factors.get('Z')).toBe(0);
    const { sum, mean } = turboMq(withLoner, [...edges, { from: 'z', to: 'a' }]);
    expect(sum).toBeCloseTo(4 / 6 + 0.8);
    expect(mean).toBeCloseTo((4 / 6 + 0.8) / 3);
    expect(turboMq(new Map(), [])).toEqual({ sum: 0, mean: 0 });
  });

  const spikeModule = path.join(os.homedir(), 'ac-work/spike-gates/spike/g1/metrics/turbo-mq.mjs');
  it.skipIf(!fs.existsSync(spikeModule))('matches the spike on the same input', async () => {
    const spike = (await import(pathToFileURL(spikeModule).href)) as {
      turboMqClusterFactors: (partition: Map<string, string>, edges: unknown[]) => Map<string, number>;
    };
    const withLoner = new Map([...partition, ['z', 'Z'], ['e', 'Y']]);
    const moreEdges = [...edges, { from: 'z', to: 'a' }, { from: 'e', to: 'c' }, { from: 'b', to: 'e' }];
    const ours = turboMqClusterFactors(withLoner, moreEdges);
    const theirs = spike.turboMqClusterFactors(withLoner, moreEdges);
    expect([...ours].sort()).toEqual([...theirs].sort());
  });
});

describe('graph metrics', () => {
  it('finds strongly connected groups with Tarjan', () => {
    const adjacency = new Map([['a', new Set(['b'])], ['b', new Set(['a', 'c'])], ['c', new Set<string>()], ['d', new Set(['e'])], ['e', new Set(['f'])], ['f', new Set(['d'])]]);
    const components = stronglyConnectedComponents(['a', 'b', 'c', 'd', 'e', 'f'], adjacency).map((component) => component.sort());
    expect(components.filter((component) => component.length > 1).sort()).toEqual([['a', 'b'], ['d', 'e', 'f']]);
    expect(components.filter((component) => component.length === 1)).toEqual([['c']]);
  });

  it('reports cycles, cross-edge ratio and disagreements over the planned groups', () => {
    const facts = factsOf(['src/a1.ts', 'src/a2.ts', 'src/b1.ts', 'src/b2.ts', 'src/c1.ts'], [
      edge('src/a1.ts', 'src/a2.ts', 0.5),
      edge('src/a1.ts', 'src/b1.ts'),
      edge('src/a1.ts', 'src/b1.ts'),
      edge('src/b2.ts', 'src/a1.ts'),
      edge('src/b1.ts', 'src/b2.ts'),
      edge('src/c1.ts', 'src/b1.ts'),
    ]);
    const placements = [place('src/a1.ts', 'module', 'a'), place('src/a2.ts', 'module', 'a'), place('src/b1.ts', 'module', 'b'),
      place('src/b2.ts', 'module', 'b'), place('src/c1.ts', 'shared', 'c')];
    const draft = draftOf({ 'src/a1.ts': 'a', 'src/a2.ts': 'a', 'src/b1.ts': 'b', 'src/b2.ts': 'a', 'src/c1.ts': 'c' });
    const metrics = planMetrics(facts, draft, placements);
    expect(metrics.cycles).toEqual([['module/a', 'module/b']]);
    expect(metrics.groupsInCycles).toBe(2);
    // 5 unique edges (the repeated a1→b1 counts once), 3 cross the group line.
    expect(metrics.crossEdgeRatio).toBe(0.6);
    // a1: own a 0.5, b 2 → pulled to b with 2/2.5. b1 and b2 stay: their own group outweighs the rest.
    expect(metrics.disagreements).toEqual([{ path: 'src/a1.ts', group: 'module/a', pulledTo: 'module/b', share: 0.8, ownShare: 0.2 },
      { path: 'src/c1.ts', group: 'shared/c', pulledTo: 'module/b', share: 1, ownShare: 0 }].sort((x, y) => y.share - x.share));
    expect(metrics).toMatchObject({ files: 5, groups: 3, modules: 2, sharedOrPlatformFiles: 1, singletonGroups: ['shared/c'], movedFromDraft: 1 });
    // CF: a = 2/(2+2), b = 2/(2+3), c = 0.
    expect(metrics.turboMqSum).toBe(0.9);
    expect(metrics.turboMqMean).toBe(0.3);
  });
});

describe('vocabulary and names', () => {
  const facts = factsOf([
    ['src/services/album-user.service.ts', { exports: ['AlbumUserRepository', 'IMMICH_SERVER_START'], tables: { reads: ['shared_links'], writes: ['activities'] }, routes: ['admin/users'] }],
    'src/utils/mediaHelpers.ts',
  ], [], ['src/schema/tables/categories.table.ts', 'src/types/global.d.ts']);
  const vocabulary = vocabularyOf(facts);

  it("collects the repo's own words as spelled", () => {
    for (const token of ['src', 'services', 'service', 'album', 'user', 'users', 'repository', 'immich', 'server', 'start', 'shared', 'links',
      'activities', 'admin', 'utils', 'media', 'helpers', 'schema', 'tables', 'table', 'categories', 'types', 'global']) expect(vocabulary).toContain(token);
    for (const guess of ['link', 'activity', 'category']) expect(vocabulary).not.toContain(guess);
    expect(vocabulary).not.toContain('d');
    expect(vocabulary).not.toContain('ts');
    expect([...vocabulary]).toEqual([...vocabulary].sort());
  });

  it('rejects names that are not bare kebab case', () => {
    for (const name of ['Album', 'modules/album', 'album_user', 'album--user', '-album', '2fa', 'album user', '']) {
      expect(codes(checkName(name, 'module', vocabulary))).toEqual(['bad-name']);
    }
    expect(checkName('album-user', 'module', vocabulary)).toEqual([]);
  });

  it('bans junk drawers and type words as modules, and junk drawers everywhere', () => {
    for (const name of ['common', 'core', 'utils', 'helper', 'shared', 'platform', 'app', 'api', 'main', 'index', 'src', 'controllers', 'service',
      'repositories', 'dto', 'entities', 'types', 'interface', 'modules', 'middleware', 'commands', 'libs']) {
      expect(codes(checkName(name, 'module', vocabulary))).toEqual(['banned-name']);
    }
    expect(codes(checkName('core', 'platform', vocabulary))).toEqual(['banned-name']);
    expect(codes(checkName('platform', 'platform', vocabulary))).toEqual(['banned-name']);
  });

  it('bans a junk or type word anywhere in a name, and the layout and generic words only as the whole name', () => {
    // Every word is the repo's own, so only the ban can fire.
    const everyWord = new Set(['album', 'api', 'app', 'base', 'common', 'controller', 'currency', 'database', 'dto', 'helper', 'key', 'link',
      'logging', 'manager', 'middleware', 'misc', 'repository', 'service', 'shared', 'src', 'user', 'util']);
    for (const name of ['common-util', 'shared-util', 'base-service', 'user-controller', 'album-dto', 'service-helper', 'src-util', 'user-services']) {
      expect(codes(checkName(name, 'module', everyWord)), name).toEqual(['banned-name']);
    }
    for (const name of ['app-repository', 'misc-util', 'database-repository', 'logging-middleware']) {
      expect(codes(checkName(name, 'platform', everyWord)), name).toEqual(['banned-name']);
    }
    expect(checkName('app-repository', 'platform', everyWord)[0]!.detail).toBe('"app-repository" contains "repository": a junk drawer or a type word, not a platform concept');
    for (const name of ['shared-link', 'api-key', 'app-user', 'base-currency', 'link-manager']) expect(checkName(name, 'module', everyWord), name).toEqual([]);
    expect(checkName('database', 'platform', everyWord)).toEqual([]);
  });

  it('singularises a name only against words the repo spells, so a guessed singular is foreign', () => {
    const words = vocabularyOf(factsOf([
      'src/app/redis-cache/redis-cache.service.ts',
      'src/helper/redis.helper.ts',
      'src/plugins/slack/events/task-status-changed.ts',
      ['src/services/album.service.ts', { routes: ['albums'] }],
    ]));
    for (const word of ['redis', 'status', 'album', 'albums']) expect(words).toContain(word);
    for (const guess of ['redi', 'statu']) expect(words).not.toContain(guess);
    const [issue] = checkName('redi-cache', 'module', words);
    expect(issue).toMatchObject({ code: 'foreign-name', detail: '"redi-cache" uses words not in the repo\'s vocabulary: redi' });
    expect(codes(checkName('task-statu', 'module', words))).toEqual(['foreign-name']);
    for (const name of ['redis-cache', 'redis', 'task-status', 'album', 'albums']) expect(checkName(name, 'module', words), name).toEqual([]);
  });

  it('knows one shared group: shared/ is flat', () => {
    expect(checkName('shared', 'shared', vocabulary)).toEqual([]);
    expect(codes(checkName('type', 'shared', vocabulary))).toEqual(['bad-name']);
    expect(canonicalGroup('date', 'shared')).toEqual({ name: 'shared', kind: 'shared' });
    expect(canonicalGroup('date', 'platform')).toEqual({ name: 'date', kind: 'platform' });
  });

  it('rejects module words the repo never uses; shared/platform may also use the plumbing list', () => {
    const [issue] = checkName('photo-album', 'module', vocabulary);
    expect(issue).toMatchObject({ severity: 'error', code: 'foreign-name', group: 'module/photo-album' });
    expect(issue!.detail).toContain('photo');
    expect(checkName('albums', 'module', vocabulary)).toEqual([]);
    expect(checkName('categories', 'module', vocabulary)).toEqual([]);
    expect(codes(checkName('logger', 'module', vocabulary))).toEqual(['foreign-name']);
    expect(checkName('logger', 'platform', vocabulary)).toEqual([]);
    expect(checkName('database-metrics', 'platform', vocabulary)).toEqual([]);
    expect(checkName('media', 'platform', vocabulary)).toEqual([]);
    expect(codes(checkName('infra', 'platform', vocabulary))).toEqual(['foreign-name']);
  });
});

describe('checkEdit', () => {
  it('drops unknown and repeated group entries, strips prefixes and keeps unnamed groups under their draft label', () => {
    const edit: PlanEdit = { groups: [
      { draft: 'G1', name: ' Modules/Album ', kind: 'module' },
      { draft: 'G2', name: 'asset', kind: 'module' },
      { draft: 'G2', name: 'album', kind: 'module' },
      { draft: 'G9', name: 'repository', kind: 'module' },
    ], moves: [] };
    const { accepted, issues } = checkEdit(sample, sampleDraft, edit, sampleIds);
    expect(accepted.groups).toEqual([
      { draft: 'G1', name: 'album', kind: 'module' },
      { draft: 'G2', name: 'asset', kind: 'module' },
      { draft: 'G3', name: 'asset-media', kind: 'module' },
      { draft: 'G4', name: 'registry', kind: 'platform' },
      { draft: 'G5', name: 'shared', kind: 'shared' },
    ]);
    expect(issues.map((issue) => [issue.severity, issue.code, issue.group])).toEqual([
      ['warning', 'duplicate-draft-group', 'G2'],
      ['warning', 'missing-draft-group', 'G3'], ['warning', 'missing-draft-group', 'G4'], ['warning', 'missing-draft-group', 'G5'],
      ['warning', 'unknown-draft-group', 'G9'],
    ]);
  });

  it('drops entries with bad, banned or foreign names and keeps the draft label', () => {
    const edit: PlanEdit = { groups: [
      { draft: 'G1', name: 'core', kind: 'module' },
      { draft: 'G2', name: 'photo', kind: 'module' },
      { draft: 'G3', name: 'Asset Media', kind: 'module' },
      { draft: 'G4', name: 'registry', kind: 'platform' },
      { draft: 'G5', name: 'date', kind: 'shared' },
    ], moves: [] };
    const { accepted, issues } = checkEdit(sample, sampleDraft, edit, sampleIds);
    expect(accepted.groups.map((group) => `${group.kind}/${group.name}`)).toEqual(['module/album', 'module/asset', 'module/asset-media', 'platform/registry', 'shared/shared']);
    expect(issues.map((issue) => [issue.severity, issue.code])).toEqual([['error', 'bad-name'], ['error', 'banned-name'], ['error', 'foreign-name']]);
    expect(issues[1]!.detail).toContain('G1 ("album") entry dropped, kept as module/album');
  });

  it('drops moves of unknown files, repeated moves and moves to bad names', () => {
    const edit: PlanEdit = { groups: [], moves: [
      { file: 'services/nope.service.ts', to: 'album', kind: 'module', rationale: 'no such file' },
      { file: 'services/asset-media.service.ts', to: 'modules/asset', kind: 'module', rationale: 'part of asset' },
      { file: files.assetMediaService, to: 'album', kind: 'module', rationale: 'second thoughts' },
      { file: files.date, to: 'helpers', kind: 'platform', rationale: 'junk' },
      { file: files.albumService, to: 'photo', kind: 'module', rationale: 'invented' },
    ] };
    const { accepted, issues } = checkEdit(sample, sampleDraft, edit, sampleIds);
    expect(accepted.moves).toEqual([{ file: files.assetMediaService, to: 'asset', kind: 'module', rationale: 'part of asset' }]);
    expect(issues.filter((issue) => issue.code !== 'missing-draft-group').map((issue) => [issue.code, issue.file])).toEqual([
      ['banned-name', files.date], ['foreign-name', files.albumService], ['duplicate-move', files.assetMediaService], ['unknown-file', undefined],
    ]);
  });

  it('refuses to move a pinned file, named by its package or displayed path', () => {
    const facts = { ...sample, pins: [...sample.pins, { path: files.date, reason: 'location-sensitive' as const, detail: '__dirname' }] };
    for (const named of [files.date, 'utils/date.ts']) {
      const { accepted, issues } = checkEdit(facts, sampleDraft, { groups: [], moves: [{ file: named, to: 'album', kind: 'module', rationale: '' }] }, sampleIds);
      expect(accepted.moves).toEqual([]);
      expect(issues[0]).toMatchObject({ severity: 'error', code: 'pinned-file', file: files.date });
    }
  });

  it('gives each name one kind: the first group entry in draft-id order, else the first move', () => {
    const edit: PlanEdit = { groups: [
      { draft: 'G3', name: 'asset', kind: 'module' },
      { draft: 'G2', name: 'asset', kind: 'platform' },
      { draft: 'G1', name: 'album', kind: 'module' },
    ], moves: [
      { file: files.date, to: 'date', kind: 'platform', rationale: 'plumbing' },
      { file: files.albumService, to: 'date', kind: 'module', rationale: 'wrong kind' },
      { file: files.registry, to: 'album', kind: 'platform', rationale: 'wrong kind' },
    ] };
    const { accepted, issues } = checkEdit(sample, sampleDraft, edit, sampleIds);
    expect(accepted.groups.slice(0, 3)).toEqual([
      { draft: 'G1', name: 'album', kind: 'module' },
      { draft: 'G2', name: 'asset', kind: 'platform' },
      { draft: 'G3', name: 'asset', kind: 'platform' },
    ]);
    expect(accepted.moves.map((move) => [move.file, move.to, move.kind])).toEqual([
      [files.registry, 'album', 'module'], [files.albumService, 'date', 'platform'], [files.date, 'date', 'platform'],
    ]);
    expect(issues.filter((issue) => issue.code === 'kind-conflict').map((issue) => [issue.severity, issue.group, issue.file])).toEqual([
      ['error', 'module/asset', undefined], ['error', 'module/date', files.albumService], ['error', 'platform/album', files.registry],
    ]);
  });
});

describe('applyEdit', () => {
  it('merges draft groups with equal names, applies moves on top and keeps the draft label of unnamed groups', () => {
    const edit: PlanEdit = { groups: [
      { draft: 'G1', name: 'album', kind: 'module' },
      { draft: 'G2', name: 'asset', kind: 'module' },
      { draft: 'G3', name: 'asset', kind: 'module' },
    ], moves: [
      { file: files.date, to: 'album', kind: 'module', rationale: 'only album uses it' },
      { file: files.albumController, to: 'album', kind: 'module', rationale: 'stays' },
    ] };
    const { accepted } = checkEdit(sample, sampleDraft, edit, sampleIds);
    const plan = applyEdit(sample, sampleDraft, accepted, sampleIds);
    expect(plan.placements.map((placement) => [placement.path, `${placement.kind}/${placement.name}`, placement.source, placement.contested])).toEqual([
      [files.albumController, 'module/album', 'draft', false],
      [files.albumRepository, 'module/album', 'draft', false],
      [files.assetRepository, 'module/asset', 'draft', false],
      [files.registry, 'platform/registry', 'draft', false],
      [files.albumService, 'module/album', 'draft', false],
      [files.assetMediaService, 'module/asset', 'draft', true],
      [files.assetService, 'module/asset', 'draft', false],
      [files.date, 'module/album', 'planner', true],
    ]);
    expect(plan.placements.find((placement) => placement.path === files.date)).toMatchObject({ confidence: 'isolated', rationale: 'only album uses it' });
  });

  it('turns an empty edit into the draft, labels as names', () => {
    const plan = applyEdit(sample, sampleDraft, { groups: [], moves: [] }, sampleIds);
    expect(new Set(plan.placements.map((placement) => `${placement.kind}/${placement.name}`))).toEqual(
      new Set(['module/album', 'module/asset', 'module/asset-media', 'platform/registry', 'shared/shared']));
    expect(plan.placements.every((placement) => placement.source === 'draft')).toBe(true);
  });
});

describe('validatePlan', () => {
  const draftPlan = applyEdit(sample, sampleDraft, { groups: [], moves: [] }, sampleIds);

  it('flags sub-features and singletons in the bare draft', () => {
    const validation = validatePlan(sample, sampleDraft, draftPlan);
    expect(validation.valid).toBe(true);
    expect(validation.issues.map((issue) => [issue.severity, issue.code, issue.group])).toEqual([
      ['warning', 'singleton-group', 'module/asset-media'],
      ['warning', 'sub-feature', 'module/asset-media'],
    ]);
    expect(validation.issues.at(-1)!.detail).toBe('module/asset-media extends module/asset: 3 edges between them (2 module/asset-media → module/asset, 1 back)');
    expect(validation.metrics.movedFromDraft).toBe(0);
  });

  it('warns about registries outside platform, not about basename collisions, and counts files moved from the draft', () => {
    const facts = factsOf([...sample.files.map((file): [string, Partial<FileFact>] => [file.path, { role: file.role }]), 'src/legacy/album.service.ts'], sample.edges);
    const draft = draftOf({ ...Object.fromEntries(sampleDraft.assignment), 'src/legacy/album.service.ts': 'album' });
    const plan: Plan = { placements: [...draftPlan.placements.map((placement) => (placement.path === files.registry || placement.path === files.date
      ? { ...placement, kind: 'module' as const, name: 'album' } : placement.name === 'asset-media' ? { ...placement, name: 'asset' } : placement)),
      place('src/legacy/album.service.ts', 'module', 'album')] };
    const validation = validatePlan(facts, draft, plan);
    expect(validation.valid).toBe(true);
    expect(validation.issues.map((issue) => [issue.code, issue.group, issue.file])).toEqual([
      ['registry-outside-platform', 'module/album', files.registry],
    ]);
    expect(validation.metrics.movedFromDraft).toBe(3);
    expect(validation.metrics.groups).toBe(2);
  });

  it('reports missing, duplicate, pinned and unknown placements and kind conflicts', () => {
    const plan: Plan = { placements: [
      ...draftPlan.placements.filter((placement) => placement.path !== files.albumService && placement.name !== 'shared'),
      place(files.date, 'module', 'asset'),
      place(files.albumController, 'module', 'asset'),
      place('src/main.ts', 'module', 'album'),
      place('src/ghost.ts', 'module', 'album'),
      place(files.assetRepository, 'shared', 'asset'),
    ] };
    const validation = validatePlan(sample, sampleDraft, plan);
    expect(validation.valid).toBe(false);
    expect(validation.issues.filter((issue) => issue.severity === 'error').map((issue) => [issue.code, issue.file ?? issue.group])).toEqual([
      ['duplicate-file', files.albumController],
      ['duplicate-file', files.assetRepository],
      ['missing-file', files.albumService],
      ['pinned-file', 'src/main.ts'],
      ['unknown-file', 'src/ghost.ts'],
    ]);
    const conflict = validatePlan(sample, sampleDraft, { placements: draftPlan.placements.map((placement) =>
      placement.path === files.assetService ? { ...placement, kind: 'shared' as const } : placement) });
    expect(conflict.issues.find((issue) => issue.code === 'kind-conflict')).toMatchObject({ severity: 'error', group: 'shared/asset', detail: '"asset" is also module/asset' });
  });
});

describe('rankCandidates', () => {
  const validation = (valid: boolean, errors: number, turboMqSum: number, groupsInCycles: number): Validation => ({
    valid,
    issues: Array.from({ length: errors }, () => ({ severity: 'error' as const, code: 'foreign-name' as const, detail: '' })),
    metrics: { files: 0, groups: 0, modules: 0, sharedOrPlatformFiles: 0, singletonGroups: [], crossEdgeRatio: 0, turboMqSum, turboMqMean: 0, cycles: [],
      groupsInCycles, disagreements: [], movedFromDraft: 0 },
  });

  it('orders valid first, then fewer errors, higher TurboMQ, fewer groups in cycles, label', () => {
    const candidates = [
      { label: 'invalid-two-errors', validation: validation(false, 2, 9, 0) },
      { label: 'invalid-one-error', validation: validation(false, 1, 1, 0) },
      { label: 'valid-low', validation: validation(true, 0, 3, 0) },
      { label: 'valid-high-cyclic', validation: validation(true, 0, 5, 4) },
      { label: 'valid-high-b', validation: validation(true, 0, 5, 2) },
      { label: 'valid-high-a', validation: validation(true, 0, 5, 2) },
    ];
    expect(rankCandidates(candidates).map((candidate) => candidate.label)).toEqual([
      'valid-high-a', 'valid-high-b', 'valid-high-cyclic', 'valid-low', 'invalid-one-error', 'invalid-two-errors',
    ]);
    expect(candidates[0]!.label).toBe('invalid-two-errors');
  });
});

// Optional: G1's immich plans, re-scored. Needs the spike's artifacts in ~/ac-work/g1 (never committed here).
const g1Directory = path.join(os.homedir(), 'ac-work/g1');
const g1Present = fs.existsSync(path.join(g1Directory, 'immich.graph.json')) && fs.existsSync(path.join(g1Directory, 'immich-plan.v1.json'));
describe.skipIf(!g1Present)('immich G1 plans (sanity)', () => {
  it('reproduces the spike validator metrics', () => {
    interface GraphFile { id: string; role: string; loc: number; isTest: boolean; isBarrel: boolean; exports: string[]; primaryExport: string | null; tables: FileFact['tables'] }
    const graph = JSON.parse(fs.readFileSync(path.join(g1Directory, 'immich.graph.json'), 'utf8')) as { files: GraphFile[]; edges: { from: string; to: string; typeOnly: boolean }[] };
    const run = JSON.parse(fs.readFileSync(path.join(g1Directory, 'immich-plan.v1.json'), 'utf8')) as {
      pinned: string[];
      candidates: { label: string; turboMqSum: number; plan: { groups: { name: string; kind: GroupKind; files: number[] }[] };
        evaluation: { crossGroupEdgeRatio: number; groupCycles: string[][]; graphDisagreements: { share: number }[]; singletonGroups: string[] } }[];
    };
    const pinned = new Set(run.pinned);
    const paths = graph.files.filter((file) => file.id.startsWith('src/') && !file.isTest && !file.isBarrel && !pinned.has(file.id)
      && !/^src\/(schema|workers|bin|emails)\/|^src\/main\.ts$/.test(file.id)).map((file) => file.id).sort();
    const fileById = new Map(graph.files.map((file) => [file.id, file]));
    const movable = new Set(paths);
    const facts: Facts = {
      packageRoot: 'server', moduleRoot: 'src', sha: 'g1',
      files: paths.map((filePath, index) => fileFact(index + 1, filePath, { role: fileById.get(filePath)!.role, exports: fileById.get(filePath)!.exports })),
      edges: graph.edges.filter((graphEdge) => movable.has(graphEdge.from) && movable.has(graphEdge.to) && graphEdge.from !== graphEdge.to)
        .map((graphEdge) => edge(graphEdge.from, graphEdge.to, graphEdge.typeOnly ? 0.5 : 1)),
      pins: run.pinned.map((pin) => ({ path: pin, reason: 'location-sensitive', detail: '' })),
    };
    expect(paths.length).toBe(269);
    for (const candidate of run.candidates) {
      const placements = candidate.plan.groups.flatMap((group) => group.files.map((id) =>
        place(paths[id - 1]!, group.kind, group.name.replace(/^(modules?|shared|platform)\//, ''))));
      const draft = draftOf(Object.fromEntries(placements.map((placement) => [placement.path, placement.name])));
      const { metrics } = validatePlan(facts, draft, { placements });
      expect(Number(metrics.turboMqSum.toFixed(2))).toBe(candidate.turboMqSum);
      expect(Number(metrics.crossEdgeRatio.toFixed(3))).toBe(candidate.evaluation.crossGroupEdgeRatio);
      expect(metrics.cycles).toEqual(candidate.evaluation.groupCycles.map((cycle) => [...cycle].sort()).sort((a, b) => (a[0]! < b[0]! ? -1 : 1)));
      expect(metrics.disagreements.map((disagreement) => disagreement.share)).toEqual(candidate.evaluation.graphDisagreements.map((disagreement) => disagreement.share));
      expect(metrics.singletonGroups).toEqual([...candidate.evaluation.singletonGroups].sort());
    }
  });
});

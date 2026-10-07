// Seeds draft: anchors, prefix merging, the three review rules, propagation and confidence on small synthetic facts,
// plus parity with the G1 spike's seedsWithPropagation on the immich view (golden recorded from the spike).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nameTokens, seedDraft, stemTokens } from '../../src/planner/seeds.js';
import type { Edge, Facts, FileFact } from '../../src/planner/types.js';

const allRulesOff = { audienceQualifiers: false, genericAnchors: false, registries: false };

function factsOf(files: [string, string][], edges: [string, string, number?][] = []): Facts {
  const sorted = [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    packageRoot: '',
    moduleRoot: 'src',
    sha: 'test',
    files: sorted.map(([filePath, role], index): FileFact => ({
      path: filePath, id: index + 1, role, loc: 1, exports: [], primaryExport: null, tables: { reads: [], writes: [] }, routes: [], tests: [],
    })),
    edges: edges.map(([from, to, weight = 1]): Edge => ({ from, to, weight, typeOnly: weight < 1, kinds: ['import'], symbols: [] })),
    pins: [],
  };
}

const labelsOf = (facts: Facts, options = {}) => Object.fromEntries(seedDraft(facts, options).assignment);
const confidenceOf = (facts: Facts, options = {}) => Object.fromEntries(seedDraft(facts, options).confidence);

describe('name tokens', () => {
  it('splits camel case and separators, singularizes, and drops role words', () => {
    expect(nameTokens('TeamCollectionsService')).toEqual(['team', 'collection']);
    expect(nameTokens('shared-link.helpers')).toEqual(['shared', 'link']);
    expect(stemTokens('src/services/api-keys.service.ts')).toEqual(['api', 'key']);
    expect(stemTokens('src/utils/index.ts')).toEqual([]);
  });
});

describe('anchors and prefix merging', () => {
  it('seeds entity stems and joins every file to the longest anchor it contains', () => {
    const facts = factsOf([
      ['src/services/album.service.ts', 'service'],
      ['src/repositories/album-user.repository.ts', 'repository'],
      ['src/controllers/album.controller.ts', 'controller'],
      ['src/controllers/album-user.controller.ts', 'controller'],
      ['src/dtos/album-response.dto.ts', 'dto'],
    ]);
    expect(labelsOf(facts)).toEqual({
      'src/controllers/album-user.controller.ts': 'album-user',
      'src/controllers/album.controller.ts': 'album',
      'src/dtos/album-response.dto.ts': 'album',
      'src/repositories/album-user.repository.ts': 'album-user',
      'src/services/album.service.ts': 'album',
    });
    expect(new Set(Object.values(confidenceOf(facts)))).toEqual(new Set(['seed']));
  });

  it('makes a token sequence shared by three stems an anchor even without an entity file', () => {
    const facts = factsOf([
      ['src/controllers/asset-media.controller.ts', 'controller'],
      ['src/dtos/asset-media.dto.ts', 'dto'],
      ['src/dtos/asset-media-response.dto.ts', 'dto'],
    ]);
    expect(new Set(Object.values(labelsOf(facts)))).toEqual(new Set(['asset-media']));
  });
});

describe('rule (a): audience qualifiers', () => {
  const facts = factsOf([
    ['src/services/auth.service.ts', 'service'],
    ['src/services/auth-admin.service.ts', 'service'],
    ['src/controllers/auth-admin.controller.ts', 'controller'],
    ['src/controllers/config-public.controller.ts', 'controller'],
    ['src/services/config.service.ts', 'service'],
    ['src/services/admin.service.ts', 'service'],
  ]);

  it('joins admin/public variants to their feature, keeping a name that is only a qualifier', () => {
    expect(labelsOf(facts)).toMatchObject({
      'src/services/auth-admin.service.ts': 'auth',
      'src/controllers/auth-admin.controller.ts': 'auth',
      'src/controllers/config-public.controller.ts': 'config',
      'src/services/admin.service.ts': 'admin',
    });
  });

  it('keeps the qualified stem as its own anchor when off', () => {
    expect(labelsOf(facts, { audienceQualifiers: false })).toMatchObject({
      'src/services/auth-admin.service.ts': 'auth-admin',
      'src/controllers/auth-admin.controller.ts': 'auth-admin',
    });
  });
});

describe('rule (b): generic names never anchor', () => {
  const facts = factsOf([
    ['src/app.module.ts', 'module'],
    ['src/services/api.service.ts', 'service'],
    ['src/services/album.service.ts', 'service'],
    ['src/services/server.service.ts', 'service'],
    ['src/services/shared-link.service.ts', 'service'],
  ], [['src/app.module.ts', 'src/services/album.service.ts'], ['src/services/api.service.ts', 'src/services/server.service.ts']]);

  it('sends app/api files to propagation and keeps real anchors that contain a generic word', () => {
    const draft = seedDraft(facts);
    expect(Object.fromEntries(draft.assignment)).toEqual({
      'src/app.module.ts': 'album',
      'src/services/album.service.ts': 'album',
      'src/services/api.service.ts': 'server',
      'src/services/server.service.ts': 'server',
      'src/services/shared-link.service.ts': 'shared-link',
    });
    expect(draft.confidence.get('src/app.module.ts')).toBe('propagated-strong');
  });

  it('seeds app and api when off', () => {
    expect(labelsOf(facts, { genericAnchors: false })).toMatchObject({ 'src/app.module.ts': 'app', 'src/services/api.service.ts': 'api' });
  });
});

describe('rule (c): registries', () => {
  const services = ['album', 'user', 'tag'].map((name): [string, string] => [`src/services/${name}.service.ts`, 'service']);
  const facts = factsOf([...services, ['src/services/index.ts', 'registry'], ['src/utils/wiring.ts', 'util']], [
    ...services.map(([service]): [string, string] => ['src/services/index.ts', service]),
    ['src/utils/wiring.ts', 'src/services/index.ts', 1],
    ['src/utils/wiring.ts', 'src/services/index.ts', 1],
    ['src/utils/wiring.ts', 'src/services/tag.service.ts', 0.5],
  ]);

  it('labels a registry `registry` as a seed, and the registry never votes', () => {
    const draft = seedDraft(facts);
    expect(draft.assignment.get('src/services/index.ts')).toBe('registry');
    expect(draft.confidence.get('src/services/index.ts')).toBe('seed');
    expect(draft.assignment.get('src/utils/wiring.ts')).toBe('tag');
    expect(draft.confidence.get('src/utils/wiring.ts')).toBe('propagated-strong');
  });

  it('treats a registry like any file when off: a heavy importer drags it into one feature', () => {
    const draft = seedDraft(facts, { registries: false });
    expect(draft.assignment.get('src/services/index.ts')).toBe('tag');
    expect(draft.confidence.get('src/services/index.ts')).toBe('propagated-weak');
  });
});

describe('propagation and confidence', () => {
  const facts = factsOf([
    ['src/services/album.service.ts', 'service'],
    ['src/services/user.service.ts', 'service'],
    ['src/services/tag.service.ts', 'service'],
    ['src/utils/strong.ts', 'util'],
    ['src/utils/weak.ts', 'util'],
    ['src/utils/spread.ts', 'util'],
    ['src/utils/lonely-thing.ts', 'util'],
    ['src/utils/index.ts', 'util'],
  ], [
    ['src/utils/strong.ts', 'src/services/album.service.ts'],
    ['src/services/album.service.ts', 'src/utils/strong.ts', 0.5],
    ['src/utils/weak.ts', 'src/services/album.service.ts', 1],
    ['src/utils/weak.ts', 'src/services/user.service.ts', 0.5],
    ['src/utils/spread.ts', 'src/services/album.service.ts'],
    ['src/utils/spread.ts', 'src/services/user.service.ts'],
    ['src/utils/spread.ts', 'src/services/tag.service.ts'],
  ]);

  it('labels by weighted vote, marks a three-way spread shared, and leaves unconnected files isolated', () => {
    const draft = seedDraft(facts);
    expect(Object.fromEntries(draft.assignment)).toMatchObject({
      'src/utils/strong.ts': 'album',
      'src/utils/weak.ts': 'album',
      'src/utils/spread.ts': 'shared',
      'src/utils/lonely-thing.ts': 'lonely-thing',
      // No name tokens and no exports: a kebab label of the path, never the spike's `(empty)/…`.
      'src/utils/index.ts': 'src-utils-index',
    });
    expect(Object.fromEntries(draft.confidence)).toMatchObject({
      'src/utils/strong.ts': 'propagated-strong',
      'src/utils/weak.ts': 'propagated-weak',
      'src/utils/spread.ts': 'contested',
      'src/utils/lonely-thing.ts': 'isolated',
    });
    expect(draft.contested).toEqual(['src/utils/index.ts', 'src/utils/lonely-thing.ts', 'src/utils/spread.ts', 'src/utils/weak.ts']);
  });

  it('is deterministic regardless of edge order', () => {
    const reversed = { ...facts, edges: [...facts.edges].reverse() };
    expect(labelsOf(reversed)).toEqual(labelsOf(facts));
    expect(confidenceOf(reversed)).toEqual(confidenceOf(facts));
  });
});

// Parity: the spike's view of immich exactly as spike/g1/plan-real.mjs builds it (realEntities with the immich pins
// and location-sensitive files, buildView), adapted to Facts; with the three rules off the draft must match the golden.
const graphPath = path.join(os.homedir(), 'ac-work/g1/immich.graph.json');

interface SpikeGraph {
  files: { id: string; role: string; loc: number; isTest: boolean; isBarrel: boolean; exports: string[]; primaryExport: string | null; locationSensitive: boolean; tables: { reads: string[]; writes: string[] } }[];
  edges: { from: string; to: string; kinds: string[]; symbols: string[]; typeOnly: boolean }[];
}

describe.skipIf(!fs.existsSync(graphPath))('parity with the G1 spike on immich', () => {
  it('gives the spike assignment and confidence with rules (a)(b)(c) off', () => {
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as SpikeGraph;
    const golden = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'golden/immich-g1-seeds.json'), 'utf8')) as {
      assignment: Record<string, string>; confidence: Record<string, string>; contested: string[];
    };
    const pins = [/^src\/schema\//, /^src\/workers\//, /^src\/bin\//, /^src\/emails\//, /^src\/main\.ts$/];
    const locationSensitive = new Set(graph.files.filter((file) => file.locationSensitive && !file.isTest).map((file) => file.id));
    const entities = graph.files.filter((file) => file.id.startsWith('src/') && !file.isTest && !file.isBarrel
      && !pins.some((pattern) => pattern.test(file.id)) && !locationSensitive.has(file.id));
    const keys = new Set(entities.map((file) => file.id));
    const facts: Facts = {
      packageRoot: 'server',
      moduleRoot: 'src',
      sha: 'spike',
      files: entities.map((file, index) => ({
        path: file.id, id: index + 1, role: file.role, loc: file.loc, exports: file.exports, primaryExport: file.primaryExport,
        tables: file.tables, routes: [], tests: [],
      })),
      edges: graph.edges.filter((edge) => keys.has(edge.from) && keys.has(edge.to) && edge.from !== edge.to).map((edge) => ({
        from: edge.from, to: edge.to, weight: edge.typeOnly ? 0.5 : 1, typeOnly: edge.typeOnly, kinds: edge.kinds as Edge['kinds'], symbols: edge.symbols,
      })),
      pins: [],
    };
    const draft = seedDraft(facts, allRulesOff);
    expect(Object.fromEntries(draft.assignment)).toEqual(golden.assignment);
    expect(Object.fromEntries(draft.confidence)).toEqual(golden.confidence);
    expect(draft.contested).toEqual(golden.contested);
  });
});

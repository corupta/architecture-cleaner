// The G1 spike's ground truth and type classification, unchanged.
import { describe, expect, it } from 'vitest';
import { featureOf, kebab, technicalType, typeFolderOf } from '../../src/scramble/classify.js';

const none = { decorators: new Set<string>(), router: false, typeOnlyExports: false };

describe('featureOf', () => {
  const manifest = { depth: { orchestration: 2 }, shared: ['types'] };
  it.each([
    ['main.ts', { truth: 'root', kind: 'root', inner: ['main.ts'] }],
    ['types/user.ts', { truth: 'shared:types', kind: 'shared', inner: ['user.ts'] }],
    ['team/team.service.ts', { truth: 'team', kind: 'feature', inner: ['team.service.ts'] }],
    ['orchestration/sort/sort.service.ts', { truth: 'orchestration/sort', kind: 'feature', inner: ['sort.service.ts'] }],
    ['orchestration/index.ts', { truth: 'orchestration', kind: 'feature', inner: ['index.ts'] }],
  ])('%s', (file, expected) => expect(featureOf(manifest, file)).toEqual(expected));
});

describe('technicalType', () => {
  it('reads the suffix first, the nearest type folder next, the AST last', () => {
    expect(technicalType('team.service.ts', ['team.service.ts'], none)).toEqual({ type: 'service', via: 'suffix' });
    expect(technicalType('create.ts', ['controllers', 'create.ts'], none)).toEqual({ type: 'controller', via: 'folder' });
    expect(technicalType('x.ts', ['dto', 'nested', 'x.ts'], none)).toEqual({ type: 'dto', via: 'folder' });
    expect(technicalType('index.ts', ['index.ts'], { ...none, decorators: new Set(['Injectable']) })).toEqual({ type: 'service', via: 'ast' });
    expect(technicalType('index.ts', ['index.ts'], { ...none, decorators: new Set(['Controller', 'Injectable']) })).toEqual({ type: 'controller', via: 'ast' });
    expect(technicalType('index.ts', ['index.ts'], { ...none, router: true })).toEqual({ type: 'route', via: 'ast' });
    expect(technicalType('shapes.ts', ['shapes.ts'], { ...none, typeOnlyExports: true })).toEqual({ type: 'types', via: 'ast' });
    expect(technicalType('helper.ts', ['helper.ts'], none)).toEqual({ type: 'util', via: 'ast' });
  });

  it('skips non-type suffixes', () => expect(technicalType('a.spec-helper.ts', ['a.spec-helper.ts'], none).via).toBe('ast'));
});

describe('names', () => {
  it('pluralizes like the spike (modules for Nest modules: Variant A)', () => {
    expect(['module', 'entity', 'util', 'types', 'args', 'service'].map(typeFolderOf)).toEqual(['modules', 'entities', 'utils', 'types', 'args', 'services']);
  });
  it('kebab-cases symbols', () => expect(kebab('GQLTeamCollectionService')).toBe('gql-team-collection-service'));
});

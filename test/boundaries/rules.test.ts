import { describe, expect, test } from 'vitest';
import { antiVacuityProbes, importLine, judgeProbes, probeFiles } from '../../src/boundaries/anti-vacuity.js';
import { folderGraph } from '../../src/boundaries/folder-graph.js';
import { dagOrder } from '../../src/boundaries/order.js';
import { persistenceOf } from '../../src/boundaries/persistence.js';
import { allowedImports, boundaryRules, configText, escapeRegExp, layoutPatterns, type BoundaryRule } from '../../src/boundaries/rules.js';
import { analysisOf } from './analysis.js';

// album ⇄ user (album → user is heavier, so user → album is the back-edge), album → asset, a registry, a platform
// file importing a module, a controller importing a table, and an adapter repository.
const files = {
  'src/modules/album/album.controller.ts': ['src/modules/album/album.service.ts', 'src/schema/tables/album.table.ts', 'src/platform/logging/logging.repository.ts'],
  'src/modules/album/album.service.ts': ['src/modules/album/album.repository.ts', 'src/modules/user/user.dto.ts', 'src/modules/asset/asset.dto.ts'],
  'src/modules/album/album.dto.ts': ['src/modules/user/user.dto.ts'],
  'src/modules/album/album.repository.ts': [{ specifier: 'kysely' }],
  'src/modules/user/user.dto.ts': ['src/modules/album/album.dto.ts'],
  'src/modules/user/user.service.ts': [],
  'src/modules/asset/asset.dto.ts': [],
  'src/modules/asset/asset.helper.ts': [],
  'src/platform/logging/logging.repository.ts': [],
  'src/platform/storage/storage.core.ts': ['src/modules/asset/asset.dto.ts'],
  'src/platform/registry/services.ts': ['src/modules/album/album.service.ts', 'src/modules/user/user.service.ts'],
  'src/shared/date.ts': [],
  'src/schema/tables/album.table.ts': [],
};
const layout = { packageRoot: '', moduleRoot: 'src' };

function setUp(tree: Record<string, (string | { specifier: string })[]> = files) {
  const analysis = analysisOf(tree);
  const graph = folderGraph(analysis, layout);
  const moduleEdges = graph.edges.filter((edge) => edge.from.startsWith('module/') && edge.to.startsWith('module/'));
  const order = dagOrder(graph.modules, moduleEdges.map((edge) => ({ from: edge.from, to: edge.to, weight: edge.files })));
  const persistence = persistenceOf(analysis, layout);
  const rules = boundaryRules({ graph, order, persistence });
  return { graph, order, persistence, rules, existing: new Set(Object.keys(tree)) };
}

const ruleNamed = (rules: BoundaryRule[], name: string) => rules.find((rule) => rule.name === name)!;
const matches = (pattern: string | string[] | undefined, file: string) => [pattern ?? []].flat().some((source) => new RegExp(source).test(file));

describe('the rules', () => {
  const { graph, order, rules, persistence } = setUp();

  test('the module DAG allow-list is today\'s forward edges', () => {
    expect(order).toEqual(['module/album', 'module/user', 'module/asset']);
    expect(allowedImports(graph, order)).toEqual(new Map([['module/album', ['module/user', 'module/asset']], ['module/asset', []], ['module/user', []]]));
    const user = ruleNamed(rules, 'module-dag/user');
    expect(matches(user.from.path, 'src/modules/user/user.dto.ts')).toBe(true);
    expect(matches(user.to.path, 'src/modules/album/album.dto.ts') && !matches(user.to.pathNot, 'src/modules/album/album.dto.ts')).toBe(true);
    expect(matches(user.to.pathNot, 'src/modules/user/user.service.ts')).toBe(true);
    const album = ruleNamed(rules, 'module-dag/album');
    expect(matches(album.to.pathNot, 'src/modules/asset/asset.dto.ts')).toBe(true);
    expect(matches(album.to.pathNot, 'src/modules/new-module/x.ts')).toBe(false);
    expect(user.comment).toContain('back-edges (album)');
  });

  test('public files by exact path; the composition root and tests import anything', () => {
    const asset = ruleNamed(rules, 'module-public/asset');
    expect(matches(asset.to.pathNot, 'src/modules/asset/asset.dto.ts')).toBe(true);
    expect(matches(asset.to.pathNot, 'src/modules/asset/asset.helper.ts')).toBe(false);
    expect(matches(asset.to.pathNot, 'src/modules/asset/assetXdto.ts')).toBe(false);
    expect(matches(asset.from.pathNot, 'src/modules/asset/asset.service.ts')).toBe(true);
    expect(matches(asset.from.pathNot, 'src/platform/registry/services.ts')).toBe(true);
    expect(matches(asset.from.pathNot, 'src/modules/album/album.service.spec.ts')).toBe(true);
    expect(matches(asset.from.pathNot, 'src/modules/album/album.service.ts')).toBe(false);
    // user.service is imported by the registry only: private.
    expect(graph.publicFiles['module/user']).toEqual(['src/modules/user/user.dto.ts']);
    expect(matches(ruleNamed(rules, 'platform-not-to-modules').from.pathNot, 'src/platform/registry/services.ts')).toBe(true);
    expect(matches(ruleNamed(rules, 'platform-not-to-modules').from.pathNot, 'src/platform/storage/storage.core.ts')).toBe(false);
  });

  test('controllers, persistence and adapters', () => {
    const rule = ruleNamed(rules, 'controller-not-to-persistence');
    expect(matches(rule.from.path, 'src/modules/album/album.controller.ts')).toBe(true);
    expect(matches(rule.from.pathNot, 'src/modules/album/album.controller.spec.ts')).toBe(true);
    expect(matches(rule.from.path, 'src/modules/album/.controller.ts')).toBe(false);
    expect(persistence.adapters).toEqual(['src/platform/logging/logging.repository.ts']);
    for (const file of ['src/schema/tables/album.table.ts', 'src/modules/album/album.repository.ts', 'src/modules/user/user.repository.ts']) {
      expect(matches(rule.to.path, file) && !matches(rule.to.pathNot, file), file).toBe(true);
    }
    expect(matches(rule.to.pathNot, 'src/platform/logging/logging.repository.ts')).toBe(true);
    expect(matches(rule.to.pathNot, '../../node_modules/kysely/dist/schema/x.js')).toBe(true);
  });

  test('the folder of a cycle rule captures the module, the platform concern or shared', () => {
    const folder = new RegExp(layoutPatterns('src').folder);
    expect(folder.exec('src/modules/album/sub/x.ts')?.[1]).toBe('src/modules/album');
    expect(folder.exec('src/platform/logging/logger.ts')?.[1]).toBe('src/platform/logging');
    expect(folder.exec('src/shared/date.ts')?.[1]).toBe('src/shared');
    expect(folder.exec('src/schema/tables/album.table.ts')).toBeNull();
    expect(ruleNamed(rules, 'no-cycle-leaving-a-folder').to).toEqual({ circular: true, via: { pathNot: '^$1/' } });
  });

  test('module names are escaped', () => {
    expect(layoutPatterns('src').module('module/a.b')).toBe('^src/modules/a\\.b/');
    expect(escapeRegExp('src/x+y(1).ts')).toBe('src/x\\+y\\(1\\)\\.ts');
  });

  test('the config is 2-space JSON with a trailing newline, every rule an error with a reason', () => {
    const text = configText(rules, { tsConfig: 'tsconfig.json' });
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.split('\n')[1]).toBe('  "forbidden": [');
    const config = JSON.parse(text);
    expect(config.options).toEqual({ doNotFollow: { path: '(^|/)node_modules/' }, tsPreCompilationDeps: true, tsConfig: { fileName: 'tsconfig.json' } });
    expect(config.forbidden.map((rule: { name: string }) => rule.name)).toEqual([
      'shared-is-a-leaf', 'platform-not-to-modules', 'controller-not-to-persistence', 'no-cycle-leaving-a-folder',
      'module-dag/album', 'module-dag/asset', 'module-dag/user', 'module-public/album', 'module-public/asset', 'module-public/user',
    ]);
    for (const rule of config.forbidden) {
      expect(rule.severity).toBe('error');
      expect(rule.comment.length).toBeGreaterThan(20);
    }
    expect(JSON.parse(configText(rules, { tsConfig: null })).options.tsConfig).toBeUndefined();
  });

  test('without a composition root nothing is exempt', () => {
    const { rules: bare } = setUp(Object.fromEntries(Object.entries(files).filter(([file]) => !file.includes('registry'))));
    expect(ruleNamed(bare, 'platform-not-to-modules').from.pathNot).toHaveLength(1);
    expect(ruleNamed(bare, 'platform-not-to-modules').comment).not.toContain('composition root');
  });
});

describe('anti-vacuity probes', () => {
  test('one new file per rule, each importing what breaks only that rule', () => {
    const { graph, order, persistence, rules, existing } = setUp();
    const probes = antiVacuityProbes({ graph, rules, order, persistence, existing });
    expect(probes.map((probe) => probe.rule)).toEqual(rules.map((rule) => rule.name));
    const edgeOf = (rule: string) => probes.find((probe) => probe.rule === rule)!.edge;
    expect(edgeOf('shared-is-a-leaf')).toEqual({ from: 'src/shared/boundary-probe.ts', to: 'src/platform/logging/logging.repository.ts' });
    // Not into the composition root (exempt): the first other platform folder.
    expect(edgeOf('platform-not-to-modules')).toEqual({ from: 'src/platform/logging/boundary-probe.ts', to: 'src/modules/album/album.dto.ts' });
    expect(edgeOf('controller-not-to-persistence')).toEqual({ from: 'src/modules/album/boundary-probe.controller.ts', to: 'src/modules/album/album.repository.ts' });
    expect(edgeOf('no-cycle-leaving-a-folder')).toEqual({ from: 'src/platform/logging/boundary-probe-cycle.ts', to: 'src/boundary-probe/cycle.ts' });
    // user's list is empty and album comes before it: a back-edge; asset's list is empty, nothing before it is
    // allowed, so the first module in the order with a public file.
    expect(edgeOf('module-dag/user')).toEqual({ from: 'src/modules/user/boundary-probe-dag.ts', to: 'src/modules/album/album.dto.ts' });
    expect(edgeOf('module-dag/asset')).toEqual({ from: 'src/modules/asset/boundary-probe-dag.ts', to: 'src/modules/album/album.dto.ts' });
    // album may import user and asset, and nothing else exists: a new module.
    expect(edgeOf('module-dag/album')).toEqual({ from: 'src/modules/album/boundary-probe-dag.ts', to: 'src/modules/boundary-probe/boundary-probe.ts' });
    expect(edgeOf('module-public/asset')).toEqual({ from: 'src/boundary-probe/public-asset.ts', to: 'src/modules/asset/asset.helper.ts' });
    const files = probeFiles(probes);
    expect(files.get('src/modules/boundary-probe/boundary-probe.ts')).toBe('export {};\n');
    expect(files.get('src/boundary-probe/cycle.ts')).toContain("import '../platform/logging/boundary-probe-cycle.ts';");
    expect([...files.keys()].filter((file) => existing.has(file))).toEqual([]);
  });

  test('synthetic folders and files when the tree has none that fit', () => {
    const tree = { 'src/modules/solo/solo.service.ts': [], 'src/platform/registry/index.ts': ['src/modules/solo/solo.service.ts'], 'src/boundary-probe/keep.ts': [] };
    const { graph, order, persistence, rules, existing } = setUp(tree);
    const probes = antiVacuityProbes({ graph, rules, order, persistence, existing });
    const edgeOf = (rule: string) => probes.find((probe) => probe.rule === rule)!.edge;
    expect(edgeOf('platform-not-to-modules')).toEqual({ from: 'src/platform/boundary-probe/boundary-probe.ts', to: 'src/modules/boundary-probe/boundary-probe.ts' });
    expect(edgeOf('shared-is-a-leaf')).toEqual({ from: 'src/shared/boundary-probe.ts', to: 'src/boundary-probe-2/shared-target.ts' });
    expect(edgeOf('controller-not-to-persistence')).toEqual({ from: 'src/boundary-probe-2/boundary-probe.controller.ts', to: 'src/boundary-probe-2/boundary-probe.repository.ts' });
    expect(edgeOf('module-public/solo')).toEqual({ from: 'src/boundary-probe-2/public-solo.ts', to: 'src/modules/solo/solo.service.ts' });
  });

  test('a rule fires on its own import; other rules on that import and violations nobody asked for are reported', () => {
    const probes = [
      { rule: 'a', files: new Map(), edge: { from: 'x.ts', to: 'y.ts' }, description: 'x imports y' },
      { rule: 'b', files: new Map(), edge: { from: 'p.ts', to: 'q.ts' }, description: 'p imports q' },
    ];
    const violation = (name: string, from: string, to: string) => ({ from, to, rule: { name, severity: 'error' } });
    const { entries, unexpected } = judgeProbes(probes, [violation('a', 'x.ts', 'y.ts'), violation('c', 'x.ts', 'y.ts'), violation('b', 'p.ts', 'other.ts')]);
    expect(entries).toEqual([
      { rule: 'a', fired: true, detail: 'x imports y: x.ts -> y.ts; also broke c' },
      { rule: 'b', fired: false, detail: 'p imports q: p.ts -> q.ts did not fire' },
    ]);
    expect(unexpected.map((entry) => entry.rule.name)).toEqual(['c', 'b']);
  });

  test('imports name the file by its relative path', () => {
    expect(importLine('src/shared/a.ts', 'src/modules/b/c.ts')).toBe("import '../modules/b/c.ts';\n");
    expect(importLine('src/a.ts', 'src/b.ts')).toBe("import './b.ts';\n");
  });
});

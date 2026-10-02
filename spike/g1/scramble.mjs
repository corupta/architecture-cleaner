// Virtual scramble (G1): apply the flatten pathMap (research 03b §4) to graph node names, without
// touching the repo. Ground truth = the original feature folder. NestJS *.module.ts use Variant A.
import path from 'node:path';
import crypto from 'node:crypto';

export const manifests = {
  'mikro-orm-realworld': {
    repo: 'mikro-orm-realworld', packageRoot: '.', moduleRoot: 'src',
    shared: ['shared'], exclude: [/^src\/migrations\//, /^src\/seeders\//, /^src\/entities\.generated\.ts$/],
  },
  hoppscotch: {
    repo: 'hoppscotch', packageRoot: 'packages/hoppscotch-backend', moduleRoot: 'src',
    depth: { orchestration: 2 },
    shared: ['types', 'guards', 'interceptors', 'decorators', 'plugins'],
    exclude: [/^src\/generated\//],
  },
  kaneo: {
    repo: 'kaneo', packageRoot: 'apps/api', moduleRoot: 'src',
    depth: { plugins: 2 },
    shared: ['utils', 'config'],
    exclude: [/^src\/migrations\//],
  },
};

const sTypes = ['controller', 'service', 'module', 'resolver', 'model', 'entity', 'dto', 'args', 'input', 'guard', 'strategy', 'decorator',
  'interceptor', 'filter', 'pipe', 'middleware', 'repository', 'gateway', 'processor', 'mapper', 'schema', 'interface', 'enum', 'constants',
  'config', 'handler', 'command', 'query', 'event', 'subscriber', 'validator', 'mock'];
const typeFolders = { dto: 'dto', dtos: 'dto', entities: 'entity', guards: 'guard', strategies: 'strategy', controllers: 'controller',
  services: 'service', repositories: 'repository', mappers: 'mapper', events: 'event', handlers: 'handler', decorators: 'decorator',
  interceptors: 'interceptor', resolvers: 'resolver', models: 'model', middlewares: 'middleware', middleware: 'middleware', pipes: 'pipe',
  filters: 'filter', schemas: 'schema', interfaces: 'interface', commands: 'command', queries: 'query', validators: 'validator', utils: 'util',
  helpers: 'util', types: 'types', routes: 'route', webhooks: 'handler' };
const plural = { entity: 'entities', strategy: 'strategies', repository: 'repositories', query: 'queries', args: 'args', constants: 'constants',
  config: 'config', types: 'types', util: 'utils', middleware: 'middlewares', mock: 'mocks' };
const pluralOf = (type) => plural[type] ?? `${type}s`;
const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();

function featureOf(manifest, relativeToRoot) {
  const segments = relativeToRoot.split('/');
  if (segments.length === 1) return { label: 'root', kind: 'root', inner: segments };
  const top = segments[0];
  if (manifest.shared.includes(top)) return { label: `shared:${top}`, kind: 'shared', inner: segments.slice(1) };
  const depth = Math.min(manifest.depth?.[top] ?? 1, segments.length - 1);
  return { label: segments.slice(0, depth).join('/'), kind: 'feature', inner: segments.slice(depth) };
}

function technicalType(file, inner) {
  const base = path.posix.basename(file.id).replace(/\.(ts|tsx|mts|cts)$/, '');
  const parts = base.split('.');
  for (let index = parts.length - 1; index >= 1; index--) if (sTypes.includes(parts[index].toLowerCase())) return { type: parts[index].toLowerCase(), via: 'suffix' };
  for (const folder of inner.slice(0, -1).reverse()) if (typeFolders[folder]) return { type: typeFolders[folder], via: 'folder' };
  const decorators = new Set(file.decorators);
  if (decorators.has('Controller')) return { type: 'controller', via: 'ast' };
  if (decorators.has('Resolver')) return { type: 'resolver', via: 'ast' };
  if (decorators.has('Module')) return { type: 'module', via: 'ast' };
  if (decorators.has('Entity')) return { type: 'entity', via: 'ast' };
  if (decorators.has('Injectable')) return { type: 'service', via: 'ast' };
  if (file.hints?.router) return { type: 'route', via: 'ast' };
  if (file.typeOnlyExports) return { type: 'types', via: 'ast' };
  return { type: 'util', via: 'ast' };
}

// Returns { manifest, entities: [{ id, scrambledPath, gt, gtKind, type, typeVia, leaky }], excluded: [...] }.
export function scramble(graph, manifest, { nameMode = 'default' } = {}) {
  const rootPrefix = `${manifest.moduleRoot}/`;
  const entities = [];
  const excluded = [];
  for (const file of graph.files) {
    const reason = !file.id.startsWith(rootPrefix) ? 'outside-module-root' : file.isTest ? 'test' : file.isBarrel ? 'barrel'
      : manifest.exclude?.some((pattern) => pattern.test(file.id)) ? 'excluded-by-manifest' : null;
    if (reason) {
      excluded.push({ id: file.id, reason });
      continue;
    }
    const feature = featureOf(manifest, file.id.slice(rootPrefix.length));
    const { type, via } = technicalType(file, feature.inner);
    let target;
    if (feature.kind !== 'feature') {
      target = file.id;
    } else {
      const qualifiers = feature.inner.slice(0, -1).filter((segment) => !typeFolders[segment]);
      const folder = type === 'module' ? 'modules' : pluralOf(type);
      target = [manifest.moduleRoot, folder, ...qualifiers, path.posix.basename(file.id)].join('/');
    }
    entities.push({ id: file.id, file, scrambledPath: target, gt: feature.label, gtKind: feature.kind, type, typeVia: via, leaky: false });
  }

  // S5 collisions: rename from the primary exported symbol, else prefix the module token (flagged leaky).
  const byTarget = new Map();
  for (const entity of entities) byTarget.set(entity.scrambledPath, [...(byTarget.get(entity.scrambledPath) ?? []), entity]);
  for (const group of byTarget.values()) {
    if (group.length < 2) continue;
    for (const entity of group) {
      if (entity.gtKind !== 'feature') continue;
      const directory = path.posix.dirname(entity.scrambledPath);
      const symbol = entity.file.primaryExport && entity.file.primaryExport !== 'default' ? entity.file.primaryExport : null;
      const suffix = entity.type === 'util' || entity.type === 'types' || entity.type === 'route' ? '' : `.${entity.type}`;
      const roleWord = new RegExp(`-?${entity.type}$`, 'i');
      const stem = symbol ? kebab(symbol).replace(roleWord, '') : null;
      entity.scrambledPath = stem ? `${directory}/${stem}${suffix}.ts` : `${directory}/${entity.gt.replace(/\//g, '-')}.${path.posix.basename(entity.id)}`;
      if (!stem) entity.leaky = true;
    }
  }
  const seen = new Map();
  for (const entity of entities) {
    const count = seen.get(entity.scrambledPath) ?? 0;
    seen.set(entity.scrambledPath, count + 1);
    if (count > 0) {
      entity.scrambledPath = entity.scrambledPath.replace(/\.ts$/, `-${count + 1}.ts`);
      entity.leaky = true;
    }
  }

  if (nameMode === 'H1') {
    for (const entity of entities) {
      if (entity.gtKind !== 'feature') continue;
      const hash = crypto.createHash('sha256').update(entity.id).digest('hex').slice(0, 4);
      const suffix = entity.type === 'util' || entity.type === 'types' || entity.type === 'route' ? '' : `.${entity.type}`;
      entity.scrambledPath = `${path.posix.dirname(entity.scrambledPath)}/${entity.type[0]}-${hash}${suffix}.ts`;
    }
  }
  return { manifest, nameMode, entities: entities.map(({ file, ...rest }) => rest), excluded };
}

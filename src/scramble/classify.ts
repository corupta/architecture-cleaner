// Ground truth and technical type of a file (plan §7 "Scramble procedure", ported from the G1 spike's scramble.mjs with
// its vocabulary unchanged, so G1's numbers stay comparable): the feature is the folder under the module root (the
// manifest's depth for nested ones); the type comes from the file-name suffix, else the nearest type folder, else the
// AST (Nest decorators, a router, type-only exports).
import type { ScrambleEntity, ScrambleManifest } from './types.js';

const suffixTypes = new Set(['controller', 'service', 'module', 'resolver', 'model', 'entity', 'dto', 'args', 'input', 'guard', 'strategy',
  'decorator', 'interceptor', 'filter', 'pipe', 'middleware', 'repository', 'gateway', 'processor', 'mapper', 'schema', 'interface', 'enum',
  'constants', 'config', 'handler', 'command', 'query', 'event', 'subscriber', 'validator', 'mock']);

/** Type folders a feature may already have inside it (`auth/strategies/`): they name the type, not a sub-feature. */
export const typeFolders: Readonly<Record<string, string>> = {
  dto: 'dto', dtos: 'dto', entities: 'entity', guards: 'guard', strategies: 'strategy', controllers: 'controller', services: 'service',
  repositories: 'repository', mappers: 'mapper', events: 'event', handlers: 'handler', decorators: 'decorator', interceptors: 'interceptor',
  resolvers: 'resolver', models: 'model', middlewares: 'middleware', middleware: 'middleware', pipes: 'pipe', filters: 'filter',
  schemas: 'schema', interfaces: 'interface', commands: 'command', queries: 'query', validators: 'validator', utils: 'util', helpers: 'util',
  types: 'types', routes: 'route', webhooks: 'handler',
};

const plurals: Readonly<Record<string, string>> = {
  entity: 'entities', strategy: 'strategies', repository: 'repositories', query: 'queries', args: 'args', constants: 'constants',
  config: 'config', types: 'types', util: 'utils', middleware: 'middlewares', mock: 'mocks',
};

/** The type folder a file of this type lands in; Nest modules go to `modules/` (Variant A). */
export const typeFolderOf = (type: string) => plurals[type] ?? `${type}s`;

/** Types whose files carry no role suffix of their own (`helper.ts` in `utils/`), so a rename adds none. */
export const unsuffixedTypes = new Set(['util', 'types', 'route']);

/** `TeamCollectionService` → `team-collection-service`. */
export const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();

export interface Feature {
  truth: string;
  kind: ScrambleEntity['truthKind'];
  /** Path segments below the feature folder (the file name last). */
  inner: string[];
}

/** The ground truth of a module-root-relative path: its feature folder, `shared:<folder>` or `root`. */
export function featureOf(manifest: Pick<ScrambleManifest, 'depth' | 'shared'>, relativeToRoot: string): Feature {
  const segments = relativeToRoot.split('/');
  if (segments.length === 1) return { truth: 'root', kind: 'root', inner: segments };
  const top = segments[0]!;
  if (manifest.shared.includes(top)) return { truth: `shared:${top}`, kind: 'shared', inner: segments.slice(1) };
  const depth = Math.min(manifest.depth?.[top] ?? 1, segments.length - 1);
  return { truth: segments.slice(0, depth).join('/'), kind: 'feature', inner: segments.slice(depth) };
}

/** What the AST says about a file, for the files whose name and folder say nothing. */
export interface SyntaxHints {
  decorators: ReadonlySet<string>;
  router: boolean;
  /** Every export is a type (interfaces, type aliases). */
  typeOnlyExports: boolean;
}

export function technicalType(fileName: string, inner: readonly string[], hints: SyntaxHints): { type: string; via: ScrambleEntity['typeVia'] } {
  const parts = fileName.replace(/\.(ts|tsx|mts|cts)$/, '').split('.');
  for (let index = parts.length - 1; index >= 1; index--) {
    const word = parts[index]!.toLowerCase();
    if (suffixTypes.has(word)) return { type: word, via: 'suffix' };
  }
  for (const folder of inner.slice(0, -1).toReversed()) {
    const type = typeFolders[folder];
    if (type) return { type, via: 'folder' };
  }
  const decorated = [['Controller', 'controller'], ['Resolver', 'resolver'], ['Module', 'module'], ['Entity', 'entity'], ['Injectable', 'service']]
    .find(([decorator]) => hints.decorators.has(decorator!));
  if (decorated) return { type: decorated[1]!, via: 'ast' };
  if (hints.router) return { type: 'route', via: 'ast' };
  if (hints.typeOnlyExports) return { type: 'types', via: 'ast' };
  return { type: 'util', via: 'ast' };
}

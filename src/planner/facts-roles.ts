// File roles and test detection for the planner facts (ported from the G1 spike analyzer): the role word in the
// file name wins (`album.service.ts` → service), else the nearest type folder (`controllers/` → controller).
import path from 'node:path';

export const sourceExtension = /\.(ts|tsx|mts|cts)$/;
export const declarationExtension = /\.d\.(ts|mts|cts)$/;
export const testPattern = /(\.|\/)(spec|test|e2e-spec)\.(ts|tsx|mts|cts)$|(^|\/)(__tests__|__mocks__|test|tests|e2e)\//;
/**
 * Test support named as such (`*.service.mock.ts`, `mcp.test-utils.ts`, `fixtures/`): code, not a test, but part of
 * the oracle with the tests that import it, so it is pinned (plan §2.4).
 */
export const testSupportPattern = /(^|[./_-])(mocks?|stubs?|fakes?|fixtures?|test[-_]?(utils?|helpers?))\.(ts|tsx|mts|cts)$|(^|\/)(__fixtures__|fixtures|mocks|stubs|testing|test-utils|test-helpers)\//i;
/** `album.service.spec.ts` → `album.service`; null for files that aren't named as a test. */
export const testedStem = (fileName: string) => /^(.*)\.(spec|test|e2e-spec)\.(ts|tsx|mts|cts)$/.exec(fileName)?.[1] ?? null;

/** Role words a file name can end in (`album.service.ts`); R3's vocabulary starts from these. */
export const roleWords = new Set([
  'controller', 'service', 'module', 'resolver', 'model', 'entity', 'dto', 'args', 'input', 'guard', 'strategy',
  'decorator', 'interceptor', 'filter', 'pipe', 'middleware', 'repository', 'gateway', 'processor', 'mapper',
  'schema', 'interface', 'enum', 'constants', 'config', 'handler', 'command', 'query', 'event', 'subscriber',
  'validator', 'mock', 'helper', 'util', 'utils', 'types', 'type', 'seeder', 'migration', 'table', 'repo', 'dao', 'job', 'worker',
]);
const typeFolderRoles = new Map(Object.entries({
  controllers: 'controller', services: 'service', repositories: 'repository', dtos: 'dto', dto: 'dto', entities: 'entity',
  models: 'model', guards: 'guard', strategies: 'strategy', decorators: 'decorator', interceptors: 'interceptor',
  middlewares: 'middleware', middleware: 'middleware', utils: 'util', helpers: 'helper', types: 'types', interfaces: 'interface',
  commands: 'command', queries: 'query', events: 'event', handlers: 'handler', mappers: 'mapper', resolvers: 'resolver',
  schemas: 'schema', schema: 'schema', routes: 'route', routers: 'route', pipes: 'pipe', filters: 'filter', validators: 'validator',
  migrations: 'migration', tables: 'table', workers: 'worker', jobs: 'job', config: 'config',
}));

export function roleOf(relativePath: string): string {
  const parts = path.posix.basename(relativePath).replace(sourceExtension, '').split('.');
  for (let index = parts.length - 1; index >= 1; index--) {
    const word = parts[index]!.toLowerCase();
    if (word === 'spec' || word === 'test' || word === 'e2e-spec' || word === 'd') continue;
    if (roleWords.has(word)) return word;
  }
  for (const folder of path.posix.dirname(relativePath).split('/').reverse()) {
    const role = typeFolderRoles.get(folder);
    if (role) return role;
  }
  return 'other';
}

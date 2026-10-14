// The Nest compiler plugins that key on file names (@nestjs/swagger, @nestjs/graphql): renaming a file into or out of
// their suffixes (`.dto.ts`, `.controller.ts`, `.input.ts`) changes the code they emit. Read wherever a build can load
// them: nest-cli.json or .nest-cli.json at a project root, a config `nest build|start -c` names, and any tracked file
// that names the transformer itself (ts-jest astTransformers, a webpack or ts-patch config). Options that can't be
// read make the suffixes unknown: then any rename under that config can change what the plugin transforms.
import path from 'node:path';
import { stripBom } from './analyze.js';
import type { RepoFs } from './repo-fs.js';

export interface NestPlugin {
  /** Repo-relative directory whose files the plugin compiles ('' for the whole repository). */
  scope: string;
  /** Where it is configured. */
  config: string;
  plugin: string;
  option: string;
  /** File-name suffixes it transforms; null when its options can't be read. */
  suffixes: string[] | null;
}

const defaults: Record<string, Record<string, string[]>> = {
  swagger: { dtoFileNameSuffix: ['.dto.ts', '.entity.ts'], controllerFileNameSuffix: ['.controller.ts'] },
  graphql: { typeFileNameSuffix: ['.input.ts', '.args.ts', '.entity.ts', '.model.ts'] },
};
const pluginName = /^@nestjs\/(swagger|graphql)(\/plugin)?$/;
const transformerMention = /@nestjs\/(swagger|graphql)\/plugin\b/g;
const suffixOption = /\b(dto|controller|type)FileNameSuffix\b/;
const mentionCandidate = /\.(json|[cm]?[jt]s|ya?ml)$/;
const notConfiguration = /(^|\/)(docs?|documentation)\/|\.(md|mdx|markdown|txt|rst|adoc)$|(^|\/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json)$/i;

const directoryOf = (file: string) => path.posix.dirname(file).replace(/^\.$/, '');

/** The suffixes a plugin entry of a Nest CLI config transforms. */
function cliPlugins(config: string, scope: string, text: string): NestPlugin[] {
  let json: { compilerOptions?: { plugins?: unknown[] }; projects?: Record<string, { compilerOptions?: { plugins?: unknown[] } }> };
  try {
    json = JSON.parse(stripBom(text));
  } catch {
    return [{ scope, config, plugin: 'Nest CLI config', option: 'compilerOptions.plugins (invalid JSON)', suffixes: null }];
  }
  const plugins = [json?.compilerOptions?.plugins ?? [], ...Object.values(json?.projects ?? {}).map((project) => project?.compilerOptions?.plugins ?? [])].flat();
  const results: NestPlugin[] = [];
  for (const plugin of plugins) {
    const name = typeof plugin === 'string' ? plugin : (plugin as { name?: unknown })?.name;
    const family = typeof name === 'string' ? pluginName.exec(name)?.[1] : undefined;
    if (!family) continue;
    const options = (typeof plugin === 'object' && plugin !== null ? (plugin as { options?: Record<string, unknown> }).options : undefined) ?? {};
    for (const [option, fallback] of Object.entries(defaults[family]!)) {
      const value = options[option];
      const suffixes = value === undefined ? fallback : [value].flat().every((entry) => typeof entry === 'string') ? [value].flat() as string[] : null;
      results.push({ scope, config, plugin: name as string, option, suffixes });
    }
  }
  return results;
}

/** Every Nest compiler plugin a build in the repository can run, with the directory it applies to. */
export function nestPlugins(repo: RepoFs): NestPlugin[] {
  const tracked = repo.tracked().filter((file) => !file.split('/').includes('node_modules'));
  const results: NestPlugin[] = [];
  const packages = new Set(tracked.filter((file) => /(^|\/)package\.json$/.test(file)).map(directoryOf));
  const packageOf = (directory: string): string => {
    for (let current = directory; current; current = directoryOf(current)) if (packages.has(current)) return current;
    return '';
  };
  for (const config of tracked.filter((file) => /(^|\/)\.?nest-cli\.json$/.test(file))) results.push(...cliPlugins(config, directoryOf(config), repo.read(config) ?? ''));
  for (const manifest of tracked.filter((file) => /(^|\/)package\.json$/.test(file))) {
    const text = repo.read(manifest) ?? '';
    for (const match of text.matchAll(/\bnest\s+(?:build|start)\b[^\n"&|;]*?\s(?:-c|--config)(?:\s+|=)(['"]?)([^\s'"&|;]+)\1/g)) {
      const scope = directoryOf(manifest);
      const config = path.posix.normalize(path.posix.join(scope, match[2]!));
      const named = config.startsWith('..') ? undefined : repo.read(config);
      results.push(...(named === undefined
        ? [{ scope, config, plugin: `nest -c ${match[2]}`, option: 'plugins', suffixes: null }]
        : cliPlugins(config, scope, named)));
    }
  }
  for (const file of tracked.filter((candidate) => mentionCandidate.test(candidate) && !notConfiguration.test(candidate) && !/(^|\/)\.?nest-cli\.json$/.test(candidate))) {
    const text = repo.read(file);
    if (!text?.includes('@nestjs/')) continue;
    const families = new Set([...text.matchAll(transformerMention)].map((match) => match[1]!));
    for (const family of families) {
      for (const [option, fallback] of Object.entries(defaults[family]!)) {
        results.push({ scope: packageOf(directoryOf(file)), config: file, plugin: `@nestjs/${family}/plugin`, option, suffixes: suffixOption.test(text) ? null : fallback });
      }
    }
  }
  return results;
}

/** How a move changes what a plugin transforms: `start` or `stop`, `change` when its suffixes are unknown, or null. */
export function pluginChange(plugin: NestPlugin, from: string, to: string): 'start' | 'stop' | 'change' | null {
  const inScope = (file: string) => plugin.scope === '' || file.startsWith(`${plugin.scope}/`);
  if (plugin.suffixes === null) {
    return (inScope(from) || inScope(to)) && (inScope(from) !== inScope(to) || path.posix.basename(from) !== path.posix.basename(to)) ? 'change' : null;
  }
  const transforms = (file: string) => inScope(file) && plugin.suffixes!.some((suffix) => path.posix.basename(file).endsWith(suffix));
  return transforms(from) === transforms(to) ? null : transforms(to) ? 'start' : 'stop';
}

/** A decline or violation detail for a plugin change. */
export function describePluginChange(plugin: NestPlugin, change: 'start' | 'stop' | 'change'): string {
  if (change === 'change') return `${plugin.config}: ${plugin.plugin} ${plugin.option} can't be read, so it may transform it differently`;
  return `${plugin.config}: ${plugin.plugin} ${plugin.option} [${plugin.suffixes!.join(', ')}] would ${change} transforming it`;
}

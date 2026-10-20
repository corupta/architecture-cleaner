// The target's own prettier: resolved from the environment's node_modules for a file's package, as `npx prettier`
// run in that package would find it, and used with the file's own config (resolveConfig, .editorconfig included, as
// the CLI does) and its package's ignore files. The config is read in a checkout whose node_modules are the
// environment's, so a shared config resolves from the config file's directory as prettier resolves it; the plugins
// it names by a bare name are resolved here, from the file's package directory: prettier would load them from its
// working directory, which is the tool's, not the target's.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** What the re-wrap uses of prettier 2 and 3 (prettier 2's format is synchronous; awaiting covers both). */
export interface Prettier {
  version: string;
  format(source: string, options: Record<string, unknown>): string | Promise<string>;
  resolveConfig(file: string, options: { editorconfig: boolean }): Promise<Record<string, unknown> | null>;
  /** prettier 3 takes a list of ignore files, prettier 2 one; without its config, no plugin is loaded. */
  getFileInfo(file: string, options: { ignorePath: string | string[]; resolveConfig: false }): Promise<{ ignored: boolean }>;
}

const loaded = new Map<string, Promise<Prettier | null>>();

/** The prettier `environment/<packageDirectory>` resolves, or null when it has none. */
export function prettierFor(environment: string, packageDirectory: string): Promise<Prettier | null> {
  const anchor = path.join(path.resolve(environment), packageDirectory, 'package.json');
  let resolved: string;
  try {
    resolved = createRequire(anchor).resolve('prettier');
  } catch {
    return Promise.resolve(null);
  }
  let module = loaded.get(resolved);
  if (!module) {
    module = import(pathToFileURL(resolved).href).then((namespace: { default?: Prettier } & Partial<Prettier>) => (namespace.format ? namespace as Prettier : namespace.default ?? null));
    loaded.set(resolved, module);
  }
  return module;
}

/**
 * A config's plugins as prettier run in `<checkout>/<packageDirectory>` loads them: a bare name is a file there by
 * that name, else the package node resolves from there; paths, URLs and plugin objects stay as they are. Throws when
 * a name resolves to nothing.
 */
export function pluginsFrom(checkout: string, packageDirectory: string, plugins: readonly unknown[]): unknown[] {
  const directory = path.join(checkout, packageDirectory);
  return plugins.map((plugin) => {
    if (typeof plugin !== 'string' || path.isAbsolute(plugin) || URL.canParse(plugin)) return plugin;
    const file = path.resolve(directory, plugin);
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
    try {
      return createRequire(path.join(directory, 'noop.js')).resolve(plugin);
    } catch {
      throw new Error(`the plugin ${JSON.stringify(plugin)} can't be resolved from ${packageDirectory || 'the repository root'}`);
    }
  });
}

/** The options prettier formats `file` (in `checkout`) with: its config, its plugins resolved (pluginsFrom). */
export async function optionsFor(prettier: Prettier, checkout: string, file: string, packageDirectory: string): Promise<Record<string, unknown>> {
  const absolute = path.join(checkout, file);
  const config = await prettier.resolveConfig(absolute, { editorconfig: true });
  const plugins = Array.isArray(config?.plugins) ? { plugins: pluginsFrom(checkout, packageDirectory, config.plugins) } : {};
  return { ...config, ...plugins, filepath: absolute };
}

/** A declaration formatted alone with the file's options, without the line break prettier ends a file with. */
export async function formatDeclaration(prettier: Prettier, text: string, options: Record<string, unknown>): Promise<string> {
  return (await prettier.format(text, options)).replace(/\r?\n$/, '');
}

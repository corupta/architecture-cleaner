// The target's own prettier: resolved from the environment's node_modules for a file's package, as `npx prettier`
// run in that package would find it, and used with the file's own config (resolveConfig, .editorconfig included, as
// the CLI does) and its package's ignore files.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** What the re-wrap uses of prettier 2 and 3 (prettier 2's format is synchronous; awaiting covers both). */
export interface Prettier {
  version: string;
  format(source: string, options: Record<string, unknown>): string | Promise<string>;
  resolveConfig(file: string, options: { editorconfig: boolean }): Promise<Record<string, unknown> | null>;
  /** prettier 3 takes a list of ignore files, prettier 2 one. */
  getFileInfo(file: string, options: { ignorePath: string | string[] }): Promise<{ ignored: boolean }>;
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

/** A declaration formatted alone with the file's options, without the line break prettier ends a file with. */
export async function formatDeclaration(prettier: Prettier, text: string, options: Record<string, unknown>): Promise<string> {
  return (await prettier.format(text, options)).replace(/\r?\n$/, '');
}

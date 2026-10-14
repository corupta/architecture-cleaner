// K1's one exception to "nothing added" (S6 contract C3): a boundary-rule tool's config added at the package root,
// from a closed list, when it is proven inert: nothing that builds, tests, ships or runs the package can load it.
// - no tsconfig program includes it (asked of TypeScript's own config parsing);
// - no analyzed reference site resolves to it (an import, require or mock of the JSON);
// - no published package packs it (`npm pack` of every enclosing package that isn't private);
// - no tracked file outside documentation and ignore files names it or matches it with a glob (runner, coverage and
//   tool configs, code that globs, scripts that pass it by path) outside comments; a CI file's directory globs
//   (`server/**`) decide which jobs a change triggers, a residual risk every certificate lists, and are noted;
// - no tracked file runs the tool, which would load it by convention.
import path from 'node:path';
import { stripBom } from '../analyzer/analyze.js';
import { loadScopes } from '../analyzer/tsconfig-scopes.js';
import { packageManifests, packageScope } from './ignore-files.js';
import { category, headTextFiles, isDocumentation, type Naming, namingsOf } from './old-path-scan.js';
import type { CertifyContext } from './types.js';

/** Config basenames that may be added, with the commands of the tool that reads them. */
const toolConfigs: ReadonlyMap<string, { tool: string; commands: RegExp }> = new Map([
  ['.dependency-cruiser.json', { tool: 'dependency-cruiser', commands: /\b(depcruise|dependency-cruiser)\b/ }],
  ['.dependency-cruiser-known-violations.json', { tool: 'dependency-cruiser', commands: /\b(depcruise|dependency-cruiser)\b/ }],
]);

// Lockfiles list packages, never run them.
const lockfiles = new Set(['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb']);

export const isToolConfigName = (file: string) => toolConfigs.has(path.posix.basename(file));

export interface ToolConfigCheck {
  /** Why the config isn't proven inert; null when it is. */
  problem: string | null;
  /** CI path filters that match it (they trigger jobs, they load nothing). */
  ciFilters: string[];
}

/** Whether an added tool config is inert. Only call it for names on the closed list. */
export function checkToolConfig(context: CertifyContext, file: string, added: readonly string[]): ToolConfigCheck {
  const problem = (reason: string): ToolConfigCheck => ({ problem: reason, ciFilters: [] });
  const { head, options } = context;
  const { tool, commands } = toolConfigs.get(path.posix.basename(file))!;
  const directory = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file);
  const mode = head.entries.get(file)?.mode;
  if (mode !== '100644') return problem(`mode ${mode}, not a regular file`);
  if (directory !== options.packageRoot) return problem(`not at the package root ${options.packageRoot || '(the repo root)'}/`);
  for (const [config, program] of loadScopes(context.fs.head).programs) if (program.files.has(file)) return problem(`in the program of ${config}`);
  for (const analyzed of context.analyses().head.files.values()) {
    const site = analyzed.sites.find((candidate) => candidate.resolution.type === 'file' && candidate.resolution.path === file);
    if (site) return problem(`loaded by ${analyzed.path} ('${site.specifier}')`);
  }
  for (const manifest of packageManifests(head)) {
    let isPrivate: boolean;
    try {
      isPrivate = (JSON.parse(stripBom(head.text(manifest) ?? '')) as { private?: unknown } | null)?.private === true;
    } catch {
      isPrivate = true; // npm can't pack, let alone publish, an unparsable manifest
    }
    if (!isPrivate && packageScope(head, manifest).status([file])[0] === 'packed by npm') return problem(`packed by npm with ${manifest}`);
  }
  const others = headTextFiles(context).filter((candidate) => !added.includes(candidate) && !/(^|\/)tsconfig[^/]*\.json$/.test(candidate));
  const namings = namingsOf(context, file, others);
  const isCiFilter = (naming: Naming) => naming.glob && category(naming.file) === 'CI';
  const naming = namings.find((candidate) => !isCiFilter(candidate));
  if (naming) return problem(`${naming.glob ? 'matched by the glob' : 'named as'} '${naming.token}' in ${naming.file} (line ${naming.line})`);
  for (const candidate of others) {
    if (lockfiles.has(path.posix.basename(candidate))) continue;
    const text = head.text(candidate) ?? '';
    const match = commands.exec(text);
    if (match && !isDocumentation(candidate)) return problem(`${candidate} (line ${text.slice(0, match.index).split('\n').length}) runs ${tool}, which loads it by convention`);
  }
  return { problem: null, ciFilters: namings.filter(isCiFilter).map((filter) => `'${filter.token}' in ${filter.file} (line ${filter.line})`) };
}

// Pin detection for the planner facts (plan §2.4, "when in doubt, pin"): entrypoints from package.json and
// nest-cli.json, paths named in package.json scripts, schema/migration and worker/bin directories, and the rule that
// picks one primary reason per pinned file.
import path from 'node:path';
import { stripBom } from '../analyzer/analyze.js';
import type { RepoFs } from '../analyzer/repo-fs.js';
import type { Pin, PinReason } from './types.js';

export interface PinCandidate {
  reason: PinReason;
  detail: string;
}

const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts'];
// Build output folders mapped back to the module root (`dist/main.js` → `src/main.ts`).
const outputDirectories = new Set(['dist', 'build', 'lib', 'out']);
const schemaDirectories = new Set(['migrations', 'migration', 'seeders', 'seeds', 'schema', 'schemas']);
const workerDirectories = new Set(['workers', 'worker', 'bin']);
const reasonOrder: PinReason[] = ['ambient-declaration', 'test', 'entrypoint', 'script-reference', 'migration-or-schema', 'worker-or-bin',
  'generated', 'location-sensitive', 'dynamic-reference', 'barrel', 'profile', 'outside-module-root'];

const packagePath = (packageRoot: string, file: string) => (packageRoot ? `${packageRoot}/${file}` : file);
/** `src` → `src/`; the package root itself ('') → ''. */
export const directoryPrefix = (directory: string) => (directory ? `${directory}/` : '');

function readJson(repo: RepoFs, file: string): Record<string, unknown> | null {
  const text = repo.read(file);
  if (text === undefined) return null;
  try {
    const value: unknown = JSON.parse(stripBom(text));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringLeaves);
  return [];
}

/** Package-relative paths a manifest path may stand for: itself, and its build output mapped back to the module root. */
function pathCandidates(target: string, moduleRoot: string): string[] {
  const normalized = path.posix.normalize(target).replace(/^\.\//, '').replace(/\/$/, '');
  if (normalized.startsWith('..') || normalized.startsWith('/') || normalized === '.') return [];
  const [first, ...rest] = normalized.split('/');
  return rest.length && outputDirectories.has(first!) ? [normalized, rest.join('/'), directoryPrefix(moduleRoot) + rest.join('/')] : [normalized];
}

/** Source files a manifest file reference names: exact, or with a .js/.d.ts extension swapped for a TS one, or its index. */
function sourceFilesNamed(target: string, moduleRoot: string, sources: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const candidate of pathCandidates(target, moduleRoot)) {
    const stem = candidate.replace(/\.d\.(ts|mts|cts)$|\.(js|mjs|cjs|jsx|ts|tsx|mts|cts)$/, '');
    for (const option of [candidate, ...sourceExtensions.map((extension) => stem + extension), ...sourceExtensions.map((extension) => `${stem}/index${extension}`)]) {
      if (sources.has(option)) found.add(option);
    }
  }
  return [...found].sort();
}

/**
 * Entrypoints: package.json `main`/`module`/`types`/`typings`/`bin`/`exports` targets and the nest-cli.json entry file
 * (`sourceRoot` + `entryFile`, default `main`), as package-relative source files under the module root.
 */
export function entrypointPins(repo: RepoFs, packageRoot: string, moduleRoot: string, sources: ReadonlySet<string>): Map<string, PinCandidate[]> {
  const pins = new Map<string, PinCandidate[]>();
  const add = (file: string, detail: string) => pins.set(file, [...(pins.get(file) ?? []), { reason: 'entrypoint', detail }]);
  const manifest = readJson(repo, packagePath(packageRoot, 'package.json'));
  for (const field of ['main', 'module', 'types', 'typings', 'bin', 'exports']) {
    for (const target of stringLeaves(manifest?.[field])) {
      if (target.includes('*')) continue;
      for (const file of sourceFilesNamed(target, moduleRoot, sources)) add(file, `package.json ${field} → ${target}`);
    }
  }
  const nest = readJson(repo, packagePath(packageRoot, 'nest-cli.json'));
  if (nest) {
    const projects = nest.projects && typeof nest.projects === 'object' ? Object.values(nest.projects as Record<string, unknown>) : [];
    for (const project of [nest, ...projects]) {
      if (!project || typeof project !== 'object') continue;
      const { sourceRoot, entryFile } = project as { sourceRoot?: unknown; entryFile?: unknown };
      const entry = `${typeof sourceRoot === 'string' ? sourceRoot : 'src'}/${typeof entryFile === 'string' ? entryFile : 'main'}`;
      for (const file of sourceFilesNamed(entry, moduleRoot, sources)) add(file, `nest-cli.json entry ${entry}`);
    }
  }
  return pins;
}

/**
 * Files and directories named in package.json scripts (`email dev --dir src/emails` pins `src/emails/**`). Globs and
 * the module root itself (`eslint src`) name everything and pin nothing.
 */
export function scriptPins(repo: RepoFs, packageRoot: string, moduleRoot: string, sources: ReadonlySet<string>): Map<string, PinCandidate[]> {
  const pins = new Map<string, PinCandidate[]>();
  const add = (file: string, detail: string) => pins.set(file, [...(pins.get(file) ?? []), { reason: 'script-reference', detail }]);
  const scripts = readJson(repo, packagePath(packageRoot, 'package.json'))?.scripts;
  if (!scripts || typeof scripts !== 'object') return pins;
  const sorted = [...sources].sort();
  for (const [name, command] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof command !== 'string') continue;
    for (const raw of command.split(/[\s=]+/)) {
      const token = raw.replace(/^['"`]+|['"`;,)]+$/g, '');
      if (!token || /[*?{}[\]$]/.test(token)) continue;
      for (const file of sourceFilesNamed(token, moduleRoot, sources)) add(file, `scripts.${name} runs ${token}`);
      for (const directory of pathCandidates(token, moduleRoot)) {
        if (!directory.startsWith(directoryPrefix(moduleRoot))) continue;
        for (const file of sorted) if (file.startsWith(`${directory}/`)) add(file, `scripts.${name} names ${directory}/`);
      }
    }
  }
  return pins;
}

/** Schema/migration and worker/bin directories between the module root and the file (the outermost of each kind). */
export function directoryPins(file: string, moduleRoot: string): PinCandidate[] {
  const segments = file.slice(directoryPrefix(moduleRoot).length).split('/').slice(0, -1);
  const pins: PinCandidate[] = [];
  for (const [reason, names] of [['migration-or-schema', schemaDirectories], ['worker-or-bin', workerDirectories]] as const) {
    const index = segments.findIndex((segment) => names.has(segment));
    if (index >= 0) pins.push({ reason, detail: `under ${directoryPrefix(moduleRoot)}${segments.slice(0, index + 1).join('/')}/` });
  }
  return pins;
}

/** One pin per file: the first reason in `reasonOrder` leads; the other reasons are listed in the detail. */
export function choosePin(file: string, candidates: PinCandidate[]): Pin {
  const details = new Map<PinReason, string[]>();
  for (const candidate of candidates) {
    const list = details.get(candidate.reason) ?? [];
    if (!list.includes(candidate.detail)) list.push(candidate.detail);
    details.set(candidate.reason, list);
  }
  const reasons = reasonOrder.filter((reason) => details.has(reason));
  const [primary, ...others] = reasons;
  const detail = details.get(primary!)!.join('; ');
  return { path: file, reason: primary!, detail: others.length ? `${detail} (also ${others.join(', ')})` : detail };
}

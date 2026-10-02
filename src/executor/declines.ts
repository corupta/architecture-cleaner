// Reasons to refuse a whole step before touching anything (test/fixtures/README.md, "Declines").
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { moduleFormat } from '../analyzer/analyze.js';
import { overlayRepoFs, type RepoFs, toAbsolute } from '../analyzer/repo-fs.js';
import { loadScopes } from '../analyzer/tsconfig-scopes.js';
import type { Analysis } from '../analyzer/types.js';

export type DeclineCode =
  | 'unknown-source' | 'case-only-rename' | 'destination-exists' | 'ignored-destination' | 'location-sensitive'
  | 'dynamic-reference' | 'config-reference' | 'module-format-change' | 'compile-context-change' | 'alias-escape' | 'unsupported-literal';

export interface Decline {
  code: DeclineCode;
  file: string;
  detail: string;
}

const configPattern = /(^|\/)(package\.json|tsconfig[^/]*\.json|jest\.config\.[cm]?[jt]s|jest\.config\.json|(vitest|vite)\.config\.[cm]?[jt]s|nest-cli\.json)$/;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function ignoredPaths(repo: RepoFs, paths: string[]): Set<string> {
  if (paths.length === 0) return new Set();
  try {
    const output = execFileSync('git', ['-C', repo.root, 'check-ignore', '--no-index', '--stdin'], { input: paths.join('\n'), encoding: 'utf8' });
    return new Set(output.split('\n').filter(Boolean));
  } catch (error) {
    // exit status 1 means "none ignored"
    if ((error as { status?: number }).status === 1) return new Set();
    throw error;
  }
}

export function findDeclines(repo: RepoFs, analysis: Analysis, moves: ReadonlyMap<string, string>, requested: ReadonlyMap<string, string>): Decline[] {
  const declines: Decline[] = [];
  const tracked = new Set(repo.tracked());
  const destinations = new Map<string, string>();
  for (const [from, to] of moves) {
    if (requested.has(from) && !tracked.has(from)) declines.push({ code: 'unknown-source', file: from, detail: 'not a tracked file' });
    const caseOnly = from !== to && from.toLowerCase() === to.toLowerCase();
    if (caseOnly) declines.push({ code: 'case-only-rename', file: from, detail: `${from} -> ${to}` });
    // On a case-insensitive filesystem the destination of a case-only rename "exists": it is the source itself.
    const occupied = !caseOnly && (tracked.has(to) || repo.fileExists(toAbsolute(repo, to))) && !moves.has(to);
    if (occupied || destinations.has(to)) declines.push({ code: 'destination-exists', file: from, detail: to });
    destinations.set(to, from);
  }
  for (const ignored of ignoredPaths(repo, [...moves.values()])) declines.push({ code: 'ignored-destination', file: destinations.get(ignored) ?? ignored, detail: ignored });

  for (const from of moves.keys()) {
    for (const hazard of analysis.files.get(from)?.hazards ?? []) {
      declines.push({ code: hazard.kind === 'location-sensitive' ? 'location-sensitive' : 'dynamic-reference', file: from, detail: hazard.detail });
    }
  }

  // MVP: never edit configs; refuse the step when one names a moved file (repo- or config-relative, with or without extension).
  for (const config of repo.tracked().filter((file) => configPattern.test(file) && !file.includes('node_modules/'))) {
    const text = repo.read(config) ?? '';
    const configDirectory = path.posix.dirname(config);
    for (const from of moves.keys()) {
      const variants = new Set([from, path.posix.relative(configDirectory, from)]);
      for (const variant of [...variants]) variants.add(variant.replace(/\.[cm]?[jt]sx?$/, ''));
      const hit = [...variants].find((variant) => new RegExp(`(?<![\\w.-])(\\./)?${escapeRegex(variant)}(\\.[cm]?[jt]sx?)?(?![\\w/.-])`).test(text));
      if (hit) declines.push({ code: 'config-reference', file: from, detail: `${config} mentions ${hit}` });
    }
  }

  const after = overlayRepoFs(repo, moves, new Map());
  const scopesBefore = loadScopes(repo);
  const scopesAfter = loadScopes(after);
  for (const [from, to] of moves) {
    if (!/\.[cm]?[jt]sx?$/.test(from)) continue;
    const before = moduleFormat(repo, from);
    const later = moduleFormat(after, to);
    if (before !== later) declines.push({ code: 'module-format-change', file: from, detail: `${before} -> ${later} at ${to}` });
    const programsBefore = scopesBefore(from).programs.join(',');
    const programsAfter = scopesAfter(to).programs.join(',');
    if (programsBefore !== programsAfter) declines.push({ code: 'compile-context-change', file: from, detail: `programs [${programsBefore}] -> [${programsAfter}]` });
  }
  return declines;
}

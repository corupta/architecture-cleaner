// Self-verification on the virtual post-move tree (plan §3.3 step 7): for every site in every file,
// after == map(before); unresolved stays unresolved with the same text; externals resolve to the same place;
// each moved file keeps its module format. Runs before anything is written.
import { analyzeRepo, isSourceFile } from '../analyzer/analyze.js';
import { overlayRepoFs, type RepoFs } from '../analyzer/repo-fs.js';
import type { RunnerConfig } from '../analyzer/runner-config.js';
import type { Analysis, Resolution } from '../analyzer/types.js';
import { mapPath } from './move-set.js';

export interface Violation {
  file: string;
  detail: string;
}

const describe = (resolution: Resolution) => (resolution.type === 'unresolved' ? 'unresolved' : `${resolution.type}:${resolution.path}`);

export function verifyMove(repo: RepoFs, before: Analysis, moves: ReadonlyMap<string, string>, newContents: ReadonlyMap<string, string>, runner: RunnerConfig): { after: Analysis; violations: Violation[] } {
  const afterFs = overlayRepoFs(repo, moves, newContents);
  const after = analyzeRepo(afterFs, { files: [...before.files.keys()].map((file) => mapPath(moves, file)).filter(isSourceFile), runner });
  const violations: Violation[] = [];
  for (const old of before.files.values()) {
    const newPath = mapPath(moves, old.path);
    const moved = after.files.get(newPath);
    if (!moved) {
      violations.push({ file: old.path, detail: `missing after the move at ${newPath}` });
      continue;
    }
    if (moved.format !== old.format) violations.push({ file: newPath, detail: `module format ${old.format} -> ${moved.format}` });
    if (moved.sites.length !== old.sites.length) {
      violations.push({ file: newPath, detail: `${old.sites.length} reference sites before, ${moved.sites.length} after` });
      continue;
    }
    old.sites.forEach((site, index) => {
      const later = moved.sites[index]!;
      const expected: Resolution = site.resolution.type === 'file' ? { ...site.resolution, path: mapPath(moves, site.resolution.path) } : site.resolution;
      const ok = later.kind === site.kind && (
        expected.type === 'unresolved' ? later.resolution.type === 'unresolved' && later.specifier === site.specifier
          : later.resolution.type === expected.type && later.resolution.path === expected.path);
      if (!ok) violations.push({ file: newPath, detail: `${site.kind} '${site.specifier}' -> '${later.specifier}': expected ${describe(expected)}, got ${describe(later.resolution)}` });
    });
  }
  return { after, violations };
}

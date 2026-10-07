// plan.yaml → steps: one pathMap per group, the input `ac move` consumes (plan §2.3). Module groups are R1 steps,
// platform groups and the one flat shared/ folder R2 steps. Basenames are kept; when files of one group share a
// basename, each keeps its old parent directory's name as a subfolder (registry/controllers/index.ts), except a file
// directly under the module root, so no step ever renames a file.
import path from 'node:path';
import type { PlanFile, PlanFileEntry } from './plan-file.js';
import type { GroupKind } from './types.js';
import { sharedGroupName } from './validate.js';

export interface Step {
  /** 1-based, in execution order. */
  index: number;
  rung: 'R1' | 'R2';
  group: string;
  /** Repo-relative old path → new path; files already at their destination are left out. */
  moves: Map<string, string>;
  /** Package-relative files placed in a subfolder to avoid a basename collision. */
  disambiguated: string[];
}

const folderOf: Record<GroupKind, string> = { module: 'modules', platform: 'platform', shared: 'shared' };

const repoPath = (packageRoot: string, packagePath: string) => (packageRoot ? `${packageRoot}/${packagePath}` : packagePath);

/** The shortest tail of `file`'s path, from `minimumDepth` segments up, that no earlier file of the group took. */
function freeRelativePath(file: string, taken: Set<string>, minimumDepth: number): string {
  const segments = file.split('/');
  for (let depth = minimumDepth; depth <= segments.length; depth++) {
    const candidate = segments.slice(-depth).join('/');
    if (!taken.has(candidate)) return candidate;
  }
  return file;
}

export function stepsOf(planFile: PlanFile): Step[] {
  const groups = [...planFile.groups].filter(([, entries]) => entries.length);
  // shared/ is flat (concept file names, plan §2.2): every shared group of a hand-edited plan lands in one step.
  const shared = groups.filter(([key]) => key.startsWith('shared/')).flatMap(([, entries]) => entries);
  const ordered: [string, PlanFileEntry[]][] = [
    ...groups.filter(([key]) => key.startsWith('module/')),
    ...groups.filter(([key]) => key.startsWith('platform/')),
    ...(shared.length ? [[`shared/${sharedGroupName}`, shared] as [string, PlanFileEntry[]]] : []),
  ];
  return ordered.map(([key, entries], index) => {
    const [kind, name] = key.split('/') as [GroupKind, string];
    const directory = kind === 'shared' ? path.posix.join(planFile.moduleRoot, folderOf.shared) : path.posix.join(planFile.moduleRoot, folderOf[kind], name);
    const taken = new Set<string>();
    const moves = new Map<string, string>();
    const disambiguated: string[] = [];
    const basenameCount = new Map<string, number>();
    for (const entry of entries) basenameCount.set(path.posix.basename(entry.path), (basenameCount.get(path.posix.basename(entry.path)) ?? 0) + 1);
    for (const entry of [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))) {
      const collides = basenameCount.get(path.posix.basename(entry.path))! > 1 && path.posix.dirname(entry.path) !== planFile.moduleRoot;
      const relative = freeRelativePath(entry.path, taken, collides ? 2 : 1);
      if (relative.includes('/')) disambiguated.push(entry.path);
      const subjectDirectory = path.posix.join(directory, path.posix.dirname(relative));
      for (const file of [entry.path, ...entry.tests]) {
        const destination = path.posix.join(subjectDirectory, path.posix.basename(file));
        taken.add(path.posix.relative(directory, destination));
        if (destination !== file) moves.set(repoPath(planFile.packageRoot, file), repoPath(planFile.packageRoot, destination));
      }
    }
    return { index: index + 1, rung: kind === 'module' ? 'R1' : 'R2', group: key, moves, disambiguated };
  });
}

/** The step file `ac move --map` reads (`moves`), with the step's identity alongside. */
export function stepJson(step: Step): string {
  return `${JSON.stringify({ step: step.index, rung: step.rung, group: step.group, moves: Object.fromEntries(step.moves) }, null, 1)}\n`;
}

export const stepFileName = (step: Step) => `${String(step.index).padStart(2, '0')}-${step.group.replace('/', '-')}.json`;

// plan.yaml → steps: one pathMap per group, the input `ac move` consumes (plan §2.3). Module groups are R1 steps,
// platform groups and the one flat shared/ folder R2 steps. Basenames are kept; when files of one group share a
// module stem regardless of case (index.ts and index.ts, X.ts and X.tsx, User.ts and user.ts), each keeps its old parent
// directory's name as a subfolder (registry/controllers/index.ts), except a file directly under the module root, so no
// step ever renames a file.
import path from 'node:path';
import type { PlanFile, PlanFileEntry } from './plan-file.js';
import type { GroupKind, Issue } from './types.js';
import { canonicalGroup, checkName, sharedGroupName } from './validate.js';

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

/**
 * Two paths clash when they differ only in case (one file on a case-insensitive file system, TS1149 for tsc) or only
 * in a TS/JS extension (`./x` resolves to x.ts over x.tsx, and tsc's include drops the .tsx).
 */
const clashKey = (file: string) => file.replace(/(\.d)?\.[cm]?[jt]sx?$/, '').toLowerCase();

/** The shortest tail of `file`'s path, from `minimumDepth` segments up, that clashes with nothing an earlier file of the group took. */
function freeRelativePath(file: string, taken: Set<string>, minimumDepth: number): string {
  const segments = file.split('/');
  for (let depth = minimumDepth; depth <= segments.length; depth++) {
    const candidate = segments.slice(-depth).join('/');
    if (!taken.has(clashKey(candidate))) return candidate;
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
    const stemOf = (entry: PlanFileEntry) => clashKey(path.posix.basename(entry.path));
    const stemCount = new Map<string, number>();
    for (const entry of entries) stemCount.set(stemOf(entry), (stemCount.get(stemOf(entry)) ?? 0) + 1);
    for (const entry of [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))) {
      const collides = stemCount.get(stemOf(entry))! > 1 && path.posix.dirname(entry.path) !== planFile.moduleRoot;
      const relative = freeRelativePath(entry.path, taken, collides ? 2 : 1);
      if (relative.includes('/')) disambiguated.push(entry.path);
      const subjectDirectory = path.posix.join(directory, path.posix.dirname(relative));
      for (const file of [entry.path, ...entry.tests]) {
        const destination = path.posix.join(subjectDirectory, path.posix.basename(file));
        taken.add(clashKey(path.posix.relative(directory, destination)));
        if (destination !== file) moves.set(repoPath(planFile.packageRoot, file), repoPath(planFile.packageRoot, destination));
      }
    }
    return { index: index + 1, rung: kind === 'module' ? 'R1' : 'R2', group: key, moves, disambiguated };
  });
}

/**
 * The group checks `ac steps` can run on a (hand-edited) plan.yaml without the repo: no bad or banned name, no name in
 * two kinds. Any shared/ key is the one flat shared group, as in stepsOf. Whether a name uses only the repo's words
 * (foreign-name) needs the repo's vocabulary, so only validatePlan checks that.
 */
export function checkGroupKeys(planFile: PlanFile): Issue[] {
  const issues: Issue[] = [];
  const keyOfName = new Map<string, string>();
  const keys = [...planFile.groups].filter(([, entries]) => entries.length).map(([key]) => key).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of keys) {
    const [kind, keyName] = key.split('/') as [GroupKind, string];
    const { name } = canonicalGroup(keyName, kind);
    issues.push(...checkName(name, kind, new Set()).filter((issue) => issue.code !== 'foreign-name'));
    const first = keyOfName.get(name);
    if (!first) keyOfName.set(name, key);
    else if (!first.startsWith(`${kind}/`)) issues.push({ severity: 'error', code: 'kind-conflict', group: key, detail: `"${name}" is also ${first}` });
  }
  return issues;
}

/** The step file `ac move --map` reads (`moves`), with the step's identity alongside. */
export function stepJson(step: Step): string {
  return `${JSON.stringify({ step: step.index, rung: step.rung, group: step.group, moves: Object.fromEntries(step.moves) }, null, 1)}\n`;
}

/** Indexes padded to the widest one (at least 2 digits), so `ls` and globs list the steps in execution order. */
export const stepFileName = (step: Step, stepCount: number) =>
  `${String(step.index).padStart(Math.max(2, String(stepCount).length), '0')}-${step.group.replace('/', '-')}.json`;

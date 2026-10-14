// The run's steps: plan.yaml groups (R1, R2) and R3's renames as step records, the moves left after pins, and which
// plan entries a failure names (plan §3.2 agent loop: replan a step by pinning the entries of its offending files).
import path from 'node:path';
import type { Analysis } from '../analyzer/types.js';
import { withCoMoves } from '../executor/move-set.js';
import type { RenameStep } from '../filename-normalization/index.js';
import type { PlanFile } from '../planner/plan-file.js';
import { stepsOf } from '../planner/steps.js';
import type { StepRecord } from './types.js';

const repoPath = (packageRoot: string, packagePath: string) => (packageRoot ? `${packageRoot}/${packagePath}` : packagePath);

function newStep(index: number, rung: StepRecord['rung'], group: string, moves: ReadonlyMap<string, string>, entries: string[][]): StepRecord {
  return { index, rung, group, moves: Object.fromEntries(moves), entries, status: 'pending', round: 1, attempts: [], durationMs: 0 };
}

/** R1 and R2 steps as `ac steps` computes them; each entry is a plan line's subject with its tests. */
export function planSteps(planFile: PlanFile): StepRecord[] {
  return stepsOf(planFile).map((step) => {
    const lines = step.group.startsWith('shared/')
      ? [...planFile.groups].filter(([key]) => key.startsWith('shared/')).flatMap(([, entries]) => entries)
      : planFile.groups.get(step.group) ?? [];
    const entries = lines.map((entry) => [entry.path, ...entry.tests].map((file) => repoPath(planFile.packageRoot, file)))
      .filter((files) => files.some((file) => step.moves.has(file)));
    return newStep(step.index, step.rung, step.group, step.moves, entries);
  });
}

/** A file and the files named after it in its folder (`userController.ts`, `userController.spec.ts`) rename together. */
const renameEntryKey = (file: string) => `${path.posix.dirname(file)}/${path.posix.basename(file).split('.')[0]}`;

/** R3 steps (contract C5), numbered from `firstIndex`. */
export function renameSteps(steps: readonly RenameStep[], firstIndex: number): StepRecord[] {
  return steps.map((step, offset) => {
    const entries = new Map<string, string[]>();
    for (const file of [...step.moves.keys()].sort()) entries.set(renameEntryKey(file), [...(entries.get(renameEntryKey(file)) ?? []), file]);
    return newStep(firstIndex + offset, 'R3', step.group, step.moves, [...entries.values()]);
  });
}

/** The step's requested moves minus every pinned file. */
export function effectiveMoves(step: StepRecord, pinned: ReadonlySet<string>): Map<string, string> {
  return new Map(Object.entries(step.moves).filter(([from]) => !pinned.has(from)));
}

/** Entries that still move something. */
const liveEntries = (step: StepRecord, effective: ReadonlyMap<string, string>) => step.entries.filter((files) => files.some((file) => effective.has(file)));

/** A file a failure names (at the step's parent), with what it says about it. */
export interface Offender {
  file?: string;
  detail: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text: string, file: string) => new RegExp(`(?<![\\w./-])${escapeRegExp(file)}(?![\\w/-])`).test(text);

/**
 * The entries a failure belongs to. Per offender: the entry that moves its file (or co-moves it: `__mocks__`,
 * snapshots, declaration pairs); else the entries whose files (old or new path) its detail names, e.g. the target an
 * importer's rewrite missed; else, for an importer, the entries of every moved file it references (`analysis` of the
 * parent, computed only then). Unattributed: offenders that name no file of the step.
 */
export function attributeOffenders(step: StepRecord, effective: ReadonlyMap<string, string>, offenders: readonly Offender[], tracked: ReadonlySet<string>,
  analysis: () => Analysis): { entries: string[][]; unattributed: string[] } {
  const live = liveEntries(step, effective);
  const moves = live.map((files) => withCoMoves(new Map(files.filter((file) => effective.has(file)).map((file) => [file, effective.get(file)!])), tracked));
  const hit = new Set<number>();
  const unattributed: string[] = [];
  for (const offender of offenders) {
    const owner = moves.findIndex((entry) => offender.file !== undefined && entry.has(offender.file));
    const named = moves.flatMap((entry, index) => ([...entry].some(([from, to]) => mentions(offender.detail, from) || mentions(offender.detail, to)) ? [index] : []));
    const targets = owner < 0 && !named.length && offender.file
      ? (analysis().files.get(offender.file)?.sites ?? []).flatMap((site) => (site.resolution.type === 'file' ? [site.resolution.path] : []))
      : [];
    const referenced = moves.flatMap((entry, index) => (targets.some((target) => entry.has(target)) ? [index] : []));
    const owners = owner >= 0 ? [owner] : named.length ? named : referenced;
    for (const index of owners) hit.add(index);
    if (!owners.length) unattributed.push(offender.file ?? offender.detail.split('\n')[0]!.slice(0, 120));
  }
  return { entries: [...hit].sort((a, b) => a - b).map((index) => live[index]!), unattributed: [...new Set(unattributed)] };
}

/** The deepest directory holding every path. */
export function commonDirectory(files: readonly string[]): string {
  if (!files.length) return '';
  let common = path.posix.dirname(files[0]!).split('/');
  for (const file of files.slice(1)) {
    const parts = path.posix.dirname(file).split('/');
    let shared = 0;
    while (shared < common.length && shared < parts.length && common[shared] === parts[shared]) shared++;
    common = common.slice(0, shared);
  }
  return common.join('/').replace(/^\.$/, '');
}

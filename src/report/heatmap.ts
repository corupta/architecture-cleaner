// The table-access heatmap (plan §4 "Outputs"): database tables × the groups the run left their files in, from the
// planner's facts at the base commit (plan/plan.json facts.files[].tables: Kysely/Prisma/Drizzle reads and writes)
// mapped through the run's plan.yaml placements. A file the run pinned stays where it was: its group is `pinned`.
// Tables written by files of several groups are the ones the findings log names (multi-writer-table).
import { compare } from '../boundaries/folder-graph.js';
import type { PlanFile } from '../planner/plan-file.js';
import type { FileFact } from '../planner/types.js';

export interface HeatmapCell {
  table: string;
  group: string;
  /** Files of the group that read the table, and that write it. */
  readers: number;
  writers: number;
}

export interface HeatmapTable {
  name: string;
  /** Groups whose files write it, and groups that only read it. */
  writerGroups: string[];
  readerGroups: string[];
  multiWriter: boolean;
}

export interface TableHeatmap {
  /** Ordered so that each table sits under the first group (in `groups` order) that writes it, else reads it. */
  tables: HeatmapTable[];
  /** Groups with at least one table access, in plan order (module/, platform/, shared/), then `pinned`, `unplaced`. */
  groups: string[];
  cells: HeatmapCell[];
}

export const pinnedGroup = 'pinned';
export const unplacedGroup = 'unplaced';

/** Package-relative path → the group its file ended in: the plan's group, `pinned` for files the run pinned. */
export function finalGroups(planFile: PlanFile, pinnedRepoPaths: readonly string[]): Map<string, string> {
  const prefix = planFile.packageRoot ? `${planFile.packageRoot}/` : '';
  const pinned = new Set(pinnedRepoPaths.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length)));
  const groupOf = new Map<string, string>();
  for (const [key, entries] of planFile.groups) {
    for (const entry of entries) for (const file of [entry.path, ...entry.tests]) groupOf.set(file, pinned.has(file) ? pinnedGroup : key);
  }
  return groupOf;
}

export function tableHeatmap(files: readonly Pick<FileFact, 'path' | 'tables'>[], groupOf: ReadonlyMap<string, string>, groupOrder: readonly string[]): TableHeatmap {
  const cells = new Map<string, HeatmapCell>();
  for (const file of files) {
    const group = groupOf.get(file.path) ?? unplacedGroup;
    const touch = (table: string, kind: 'readers' | 'writers') => {
      const key = `${table}\0${group}`;
      const cell = cells.get(key) ?? { table, group, readers: 0, writers: 0 };
      cell[kind]++;
      cells.set(key, cell);
    };
    for (const table of new Set(file.tables.reads)) touch(table, 'readers');
    for (const table of new Set(file.tables.writes)) touch(table, 'writers');
  }
  const rank = (group: string) => {
    const at = groupOrder.indexOf(group);
    return at >= 0 ? at : group === pinnedGroup ? groupOrder.length : groupOrder.length + 1;
  };
  const groups = [...new Set([...cells.values()].map((cell) => cell.group))].sort((left, right) => rank(left) - rank(right) || compare(left, right));
  const byTable = new Map<string, HeatmapCell[]>();
  for (const cell of cells.values()) byTable.set(cell.table, [...(byTable.get(cell.table) ?? []), cell]);
  const tables = [...byTable].map(([name, tableCells]): HeatmapTable & { anchor: number } => {
    const writerGroups = tableCells.filter((cell) => cell.writers).map((cell) => cell.group).sort((left, right) => rank(left) - rank(right) || compare(left, right));
    const readerGroups = tableCells.filter((cell) => !cell.writers).map((cell) => cell.group).sort((left, right) => rank(left) - rank(right) || compare(left, right));
    const anchor = groups.indexOf(writerGroups[0] ?? readerGroups[0]!);
    return { name, writerGroups, readerGroups, multiWriter: writerGroups.length > 1, anchor };
  }).sort((left, right) => left.anchor - right.anchor || compare(left.name, right.name))
    .map(({ anchor: _anchor, ...table }) => table);
  const sortedCells = [...cells.values()].sort((left, right) => compare(left.table, right.table) || rank(left.group) - rank(right.group) || compare(left.group, right.group));
  return { tables, groups, cells: sortedCells };
}

/** Plan order of the plan file's group keys (module/, platform/, shared/ as written). */
export const planGroupOrder = (planFile: PlanFile) => [...planFile.groups.keys()];

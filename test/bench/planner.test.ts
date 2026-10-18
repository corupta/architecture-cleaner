// The planner row against its draft: partitions compared by files, so a renamed or re-kinded group moves nothing.
import { describe, expect, it } from 'vitest';
import { partitionChange } from '../../src/bench/planner.js';

const assignment = (groups: Record<string, string[]>) => new Map(Object.entries(groups).flatMap(([group, files]) => files.map((file) => [file, group] as [string, string])));
const draft = assignment({ 'module/album': ['a1', 'a2', 'a3'], 'module/user': ['u1', 'u2'], 'module/tag': ['t1'] });

describe('partitionChange', () => {
  it('reads renamed and re-kinded groups as the draft partition (ghostfolio: every group made platform)', () => {
    const renamed = assignment({ 'platform/album': ['a1', 'a2', 'a3'], 'platform/people': ['u1', 'u2'], 'shared/tag': ['t1'] });
    expect(partitionChange(draft, renamed)).toEqual({ draftGroups: 3, samePartition: true, filesMoved: 0, groupsMerged: 0 });
  });

  it('a merge moves no file but changes the partition', () => {
    expect(partitionChange(draft, assignment({ 'module/album': ['a1', 'a2', 'a3', 't1'], 'module/user': ['u1', 'u2'] }))).toEqual({ draftGroups: 3, samePartition: false, filesMoved: 0, groupsMerged: 1 });
  });

  it('counts the files outside the plan group that holds most of their draft group', () => {
    const moved = assignment({ 'module/album': ['a1', 'a2'], 'module/user': ['u1', 'u2', 'a3'], 'module/tag': ['t1'] });
    expect(partitionChange(draft, moved)).toEqual({ draftGroups: 3, samePartition: false, filesMoved: 1, groupsMerged: 0 });
    // An even split: the image is the first plan group by key, the other half moved.
    expect(partitionChange(draft, assignment({ 'module/album': ['a1', 'a2', 'a3'], 'module/b': ['u1'], 'module/c': ['u2'], 'module/tag': ['t1'] })).filesMoved).toBe(1);
  });
});

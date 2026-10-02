// Every fixture: run the executor on a fresh git copy of before/ and compare with the hand-written expectation.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitRepoFs } from '../src/analyzer/repo-fs.js';
import { executeMove } from '../src/executor/execute.js';
import { diffTrees, gitStatus, listFixtures, materialize, typecheck } from './helpers.js';

describe.each(listFixtures())('fixture $name', (fixture) => {
  it('matches the expected outcome', () => {
    const root = materialize(path.join(fixture.directory, 'before'), fixture.name);
    const result = executeMove(gitRepoFs(root), fixture.moves);
    if (fixture.expected.outcome === 'declined') {
      expect(result.outcome, JSON.stringify(result.outcome === 'unverified' ? result.violations : '')).toBe('declined');
      if (result.outcome !== 'declined') return;
      expect([...new Set(result.declines.map((decline) => decline.code))].sort(), JSON.stringify(result.declines)).toEqual([...fixture.expected.reasons].sort());
      expect(gitStatus(root)).toBe('');
      return;
    }
    const detail = result.outcome === 'declined' ? result.declines : result.outcome === 'unverified' ? result.violations : '';
    expect(result.outcome, JSON.stringify(detail, null, 1)).toBe('applied');
    expect(diffTrees(root, path.join(fixture.directory, 'after'))).toEqual([]);
  });

  it.runIf(fixture.typecheck && fs.existsSync(path.join(fixture.directory, 'after')))('type-checks before and after', () => {
    expect(typecheck(path.join(fixture.directory, 'before'))).toEqual([]);
    expect(typecheck(path.join(fixture.directory, 'after'))).toEqual([]);
  });
});

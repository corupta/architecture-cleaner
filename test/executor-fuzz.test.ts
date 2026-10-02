// Random pathMaps over the fixture repos (plan §3.3 step 8). Every step must end applied or declined for a known
// reason, never "unverified" (that would mean planned edits our own verifier rejects), and every applied step must
// still type-check under the fixture's tsconfig: an oracle independent of our resolver.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitRepoFs } from '../src/analyzer/repo-fs.js';
import { executeMove } from '../src/executor/execute.js';
import { listFixtures, materialize, typecheck } from './helpers.js';

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const acceptableDeclines = new Set(['alias-escape', 'destination-exists', 'location-sensitive', 'dynamic-reference', 'config-reference', 'module-format-change', 'compile-context-change']);
const iterations = 12;
const fuzzed = listFixtures().filter((fixture) => fixture.expected.outcome === 'applied' && fixture.typecheck);

describe.each(fuzzed)('fuzz $name', (fixture) => {
  it(`survives ${iterations} random pathMaps`, () => {
    const random = mulberry32(fixture.name.length * 7919);
    const outcomes: Record<string, number> = {};
    for (let iteration = 0; iteration < iterations; iteration++) {
      const root = materialize(path.join(fixture.directory, 'before'), `${fixture.name}-fuzz${iteration}`);
      const repo = gitRepoFs(root);
      const candidates = repo.tracked().filter((file) => /\.(ts|tsx|mts|cts)$/.test(file) && !file.endsWith('.d.ts') && !file.includes('__mocks__/'));
      const directories = [...new Set(candidates.map((file) => path.posix.dirname(file)))];
      const moves = new Map<string, string>();
      const count = 1 + Math.floor(random() * Math.min(4, candidates.length));
      for (let pick = 0; pick < count; pick++) {
        const from = candidates[Math.floor(random() * candidates.length)]!;
        const base = random() < 0.5 ? directories[Math.floor(random() * directories.length)]! : `${directories[Math.floor(random() * directories.length)]!}/fuzz${iteration}/part${pick % 2}`;
        const to = path.posix.join(base, path.posix.basename(from));
        if (to !== from) moves.set(from, to);
      }
      if (moves.size === 0) continue;
      const result = executeMove(repo, moves);
      const key = result.outcome === 'declined' ? `declined:${[...new Set(result.declines.map((decline) => decline.code))].sort().join('+')}` : result.outcome;
      outcomes[key] = (outcomes[key] ?? 0) + 1;
      const label = `${fixture.name} #${iteration} ${JSON.stringify(Object.fromEntries(moves))}`;
      expect(result.outcome, `${label}: ${JSON.stringify(result.outcome === 'unverified' ? result.violations : '')}`).not.toBe('unverified');
      if (result.outcome === 'declined') {
        for (const decline of result.declines) expect(acceptableDeclines.has(decline.code), `${label}: ${JSON.stringify(decline)}`).toBe(true);
      } else {
        expect(typecheck(root), label).toEqual([]);
      }
    }
    console.log(`[fuzz ${fixture.name}] ${JSON.stringify(outcomes)}`);
    expect(outcomes.applied ?? 0).toBeGreaterThan(0);
  });
});

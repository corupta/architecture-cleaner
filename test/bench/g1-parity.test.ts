// The bench baselines on G1's own virtual hoppscotch inputs (default and H1 names, the spike's node order) reproduce
// the values G1 recorded (docs/gates.md: best deterministic 82.2 on both): every baseline's MoJoFM, ARI, c2c_cvg and
// hard-file MoJoFM, and Louvain's MoJoFM for every resolution and seed. The fixture is described in its `source`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { baselinePartitions, louvainPartitions } from '../../src/bench/baselines.js';
import { truthScores, type GroundTruth } from '../../src/bench/score.js';
import type { Facts } from '../../src/planner/types.js';

interface G1Values {
  rows: Record<string, { mojoFm: number; ari: number; c2cCvg: number; mojoFmHard: number }>;
  louvain: Record<string, number[]>;
}

interface Fixture {
  source: string;
  moduleRoot: string;
  /** [default key, H1 key, type, primary export, exports], in the spike's node order. */
  nodes: [string, string, string, string | null, string[]][];
  edges: [string, string, number][];
  truth: Record<string, string>;
  featureKeys: string[];
  hardKeys: string[];
  g1: { default: G1Values; H1: G1Values };
}

const fixture = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'g1-hoppscotch.json.gz'))).toString('utf8')) as Fixture;

/** G1's name for each bench method. */
const g1Names: Record<string, string> = {
  'B0 type folders': 'B0 type-folders',
  'name-token (full stem)': 'name-token (full stem)',
  'name-token (anchored)': 'name-token (anchored)',
  'export-token (anchored)': 'export-token (anchored)',
  'seeds draft (export names)': 'seeds + LP (export names)',
  'seeds draft (file names)': 'seeds + LP (file names)',
};

for (const variant of ['default', 'H1'] as const) {
  const keyOf = new Map(fixture.nodes.map(([key, h1Key]) => [key, variant === 'H1' ? h1Key : key]));
  const facts: Facts = {
    packageRoot: 'packages/hoppscotch-backend',
    moduleRoot: fixture.moduleRoot,
    sha: 'g1',
    files: fixture.nodes.map(([key, , type, primaryExport, exports], index) => ({
      path: keyOf.get(key)!, id: index + 1, role: type, loc: 1, exports, primaryExport, tables: { reads: [], writes: [] }, routes: [], tests: [],
    })),
    edges: fixture.edges.map(([from, to, weight]) => ({ from: keyOf.get(from)!, to: keyOf.get(to)!, weight, typeOnly: weight < 1, kinds: ['import'], symbols: [] })),
    pins: [],
  };
  const groundTruth: GroundTruth = {
    truth: new Map(Object.entries(fixture.truth).map(([key, label]) => [keyOf.get(key)!, label])),
    featureFiles: fixture.featureKeys.map((key) => keyOf.get(key)!),
    hardFiles: fixture.hardKeys.map((key) => keyOf.get(key)!),
  };
  const recorded = fixture.g1[variant];

  describe(`G1 parity: hoppscotch ${variant} (${groundTruth.featureFiles.length} feature files, ${groundTruth.hardFiles.length} hard)`, () => {
    it('reproduces every deterministic baseline G1 recorded', () => {
      for (const partition of baselinePartitions(facts)) {
        const expected = recorded.rows[g1Names[partition.method]!]!;
        const { mojoFm, ari, c2cCvg, mojoFmHard } = truthScores(partition.assignment, groundTruth);
        expect({ mojoFm, ari, c2cCvg, mojoFmHard }, partition.method).toEqual(expected);
      }
    });

    it("reproduces Louvain's MoJoFM for every resolution and seed (the spike's node order)", () => {
      for (const [resolution, partitions] of louvainPartitions(facts)) {
        expect(partitions.map((assignment) => truthScores(assignment, groundTruth).mojoFm), `r=${resolution}`).toEqual(recorded.louvain[String(resolution)]);
      }
    });
  });
}

it('keeps G1\'s best deterministic hoppscotch value, 82.19 (seeds + LP from export names), on both variants', () => {
  expect(fixture.g1.default.rows['seeds + LP (export names)']!.mojoFm).toBe(82.19);
  expect(fixture.g1.H1.rows['seeds + LP (export names)']!.mojoFm).toBe(82.19);
});

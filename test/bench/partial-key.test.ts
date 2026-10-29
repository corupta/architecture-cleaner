// A real entry's partial answer key: reading the RSF (comments, blank lines, a bad line, a path labeled twice), the
// scored, hard and unknown files over the facts, the Louvain mean, and the sentence summary.md and compare say.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { keyMean, keyScore, partialGroundTruthOf, partialKeyScope, readPartialKey } from '../../src/bench/partial-key.js';
import type { BenchPartialKey } from '../../src/bench/types.js';
import type { Facts } from '../../src/planner/types.js';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-partial-key-'));
afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));
const write = (name: string, text: string) => {
  const file = path.join(temporary, name);
  fs.writeFileSync(file, text);
  return file;
};

const factsAt = (paths: string[]): Facts => ({
  packageRoot: 'server', moduleRoot: 'src', sha: 'test', edges: [], pins: [],
  files: [...paths].sort().map((file, index) => ({ path: file, id: index + 1, role: 'service', loc: 1, exports: [], primaryExport: null, tables: { reads: [], writes: [] }, routes: [], tests: [] })),
});

describe('reading a partial key', () => {
  it('reads `contain <feature> <path>` lines in file order, skipping blank lines and comments, with the bytes\' sha256', () => {
    const file = write('key.rsf', '# immich 2024\ncontain album src/services/album.service.ts\n\n  contain album   src/dtos/album.dto.ts  \ncontain asset src/dtos/exif.dto.ts\n');
    const { labels, sha256 } = readPartialKey(file);
    expect([...labels]).toEqual([['src/services/album.service.ts', 'album'], ['src/dtos/album.dto.ts', 'album'], ['src/dtos/exif.dto.ts', 'asset']]);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a line that is no containment, a path labeled twice, an empty key and a missing file', () => {
    expect(() => readPartialKey(write('bad.rsf', 'contain album a.ts\nalbum b.ts\n'))).toThrow('bad.rsf:2: not a `contain <feature> <path>` line: album b.ts');
    expect(() => readPartialKey(write('three.rsf', 'contain album a.ts extra\n'))).toThrow('three.rsf:1: not a `contain <feature> <path>` line');
    expect(() => readPartialKey(write('twice.rsf', 'contain album a.ts\ncontain user a.ts\n'))).toThrow('twice.rsf:2: a.ts is labeled twice');
    expect(() => readPartialKey(write('empty.rsf', '# nothing\n\n'))).toThrow('empty.rsf: labels no file');
    expect(() => readPartialKey(path.join(temporary, 'nowhere.rsf'))).toThrow('nowhere.rsf not found');
  });
});

describe('the key over the facts', () => {
  const labels = new Map([
    ['src/services/album.service.ts', 'album'], ['src/dtos/album.dto.ts', 'album'], ['src/dtos/exif.dto.ts', 'asset'], ['src/services/asset.service.ts', 'asset'],
    ['src/cores/user.core.ts', 'user'], ['src/services/download.service.ts', 'asset'],
  ]);
  const facts = factsAt(['src/services/album.service.ts', 'src/dtos/album.dto.ts', 'src/dtos/exif.dto.ts', 'src/services/asset.service.ts', 'src/services/download.service.ts', 'src/main.ts']);
  const groundTruth = partialGroundTruthOf(labels, facts);

  it('scores the labeled movable files, judges hard files by the anchored name token, and reports the rest', () => {
    expect(groundTruth.featureFiles).toEqual(['src/dtos/album.dto.ts', 'src/dtos/exif.dto.ts', 'src/services/album.service.ts', 'src/services/asset.service.ts', 'src/services/download.service.ts']);
    // exif and download don't name asset: the scrambles' definition of hard.
    expect(groundTruth.hardFiles).toEqual(['src/dtos/exif.dto.ts', 'src/services/download.service.ts']);
    expect(groundTruth.notMovable).toEqual([{ path: 'src/cores/user.core.ts', feature: 'user' }]);
  });

  it('refuses a key that labels no movable file', () => {
    expect(() => partialGroundTruthOf(new Map([['server/src/services/album.service.ts', 'album']]), facts))
      .toThrow('the partial key labels none of the 6 movable files: its paths must be package-relative, as the facts name them (src/dtos/album.dto.ts)');
  });

  it('scores a method over the scored files only, and keeps its groups for them', () => {
    const byFolder = new Map(facts.files.map((file) => [file.path, file.path.split('/')[1]!]));
    const score = keyScore('B0 type folders', byFolder, groundTruth);
    expect(score.assignment).toEqual({
      'src/dtos/album.dto.ts': 'dtos', 'src/dtos/exif.dto.ts': 'dtos', 'src/services/album.service.ts': 'services', 'src/services/asset.service.ts': 'services', 'src/services/download.service.ts': 'services',
    });
    const perfect = keyScore('perfect', new Map([...byFolder].map(([file]) => [file, labels.get(file) ?? 'other'])), groundTruth);
    expect(perfect).toMatchObject({ mojoFm: 100, ari: 1, c2cCvg: 1, clusterCountRatio: 1, mojoFmHard: 100 });
    expect(keyMean('mean', [score, perfect])).toEqual({
      method: 'mean', mojoFm: Number(((score.mojoFm + 100) / 2).toFixed(2)), ari: Number(((score.ari + 1) / 2).toFixed(3)), c2cCvg: Number(((score.c2cCvg + 1) / 2).toFixed(3)),
      clusterCountRatio: Number(((score.clusterCountRatio + 1) / 2).toFixed(2)), mojoFmHard: Number(((score.mojoFmHard! + 100) / 2).toFixed(2)),
    });
  });
});

describe('what a key covers, in words', () => {
  const key = { file: 'bench/ground-truth/immich-2024.rsf', source: "immich's 2024 domain layer", scoredFiles: 44, features: 22, hardFiles: ['a', 'b', 'c'] } as BenchPartialKey;
  it('names who labeled the files, how many of the movable files they are, and that the scrambles\' keys are complete', () => {
    expect(partialKeyScope(key, 269)).toBe("computed over the files immich's 2024 domain layer labels (44 of 269 movable files, 22 features, 3 hard), unlike the scrambles' complete keys");
    expect(partialKeyScope({ ...key, source: null, features: 1 }, 269)).toBe("computed over the files the key bench/ground-truth/immich-2024.rsf labels (44 of 269 movable files, 1 feature, 3 hard), unlike the scrambles' complete keys");
  });
});

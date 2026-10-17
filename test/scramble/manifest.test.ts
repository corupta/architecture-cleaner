// Scramble manifests are ground truth: read strictly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScrambleManifest, readScrambleManifest } from '../../src/scramble/manifest.js';

const valid = { name: 'kaneo', sha: 'b80818fe2e93', packageRoot: './apps/api/', moduleRoot: 'src', depth: { plugins: 2 }, shared: ['utils'], exclude: ['^src/migrations/'] };

describe('scramble manifests', () => {
  it('normalizes the package and module roots', () => {
    expect(parseScrambleManifest(valid, 'x.json')).toEqual({ ...valid, packageRoot: 'apps/api' });
    expect(parseScrambleManifest({ ...valid, packageRoot: '.', depth: undefined }, 'x.json')).toMatchObject({ packageRoot: '' });
  });

  it.each([
    [{ ...valid, extra: 1 }, 'unknown fields extra'],
    [{ ...valid, name: 'a/b' }, 'name must be a path segment'],
    [{ ...valid, sha: 'main' }, 'sha must be a commit id'],
    [{ ...valid, moduleRoot: '.' }, 'moduleRoot must name a directory'],
    [{ ...valid, shared: 'utils' }, 'shared must be an array'],
    [{ ...valid, exclude: ['(unclosed'] }, 'is not a regular expression'],
    [{ ...valid, depth: { plugins: 0 } }, 'depth.plugins must be a whole number from 1'],
  ])('rejects %j', (value, message) => {
    expect(() => parseScrambleManifest(value, 'x.json')).toThrow(message);
  });

  it('reads every committed manifest', () => {
    const directory = path.join(import.meta.dirname, '../../bench/scramble');
    const names = fs.readdirSync(directory).filter((file) => file.endsWith('.json')).sort();
    expect(names).toEqual(['ghostfolio.json', 'hoppscotch.json', 'kaneo.json']);
    for (const name of names) expect(readScrambleManifest(path.join(directory, name)).name).toBe(name.replace(/\.json$/, ''));
  });

  it('names the file in errors', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-manifest-')), 'broken.json');
    fs.writeFileSync(file, '{');
    expect(() => readScrambleManifest(file)).toThrow(`scramble manifest ${file}`);
  });
});

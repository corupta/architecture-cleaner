// Scramble manifests (bench/scramble/<name>.json): which package is flattened, from which commit, and what its feature
// folders are. Read strictly: a manifest is benchmark ground truth, so a typo must fail loudly, not score silently.
import fs from 'node:fs';
import type { ScrambleManifest } from './types.js';

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const normalizeDirectory = (directory: string) => directory.replace(/^\.\/?/, '').replace(/\/+$/, '');

export function parseScrambleManifest(value: unknown, source: string): ScrambleManifest {
  const fail = (detail: string): never => {
    throw new Error(`scramble manifest ${source}: ${detail}`);
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('not a JSON object');
  const manifest = value as Record<string, unknown>;
  const known = new Set(['name', 'sha', 'packageRoot', 'moduleRoot', 'depth', 'shared', 'exclude']);
  const unknown = Object.keys(manifest).filter((key) => !known.has(key) && !key.startsWith('$'));
  if (unknown.length) fail(`unknown fields ${unknown.join(', ')}`);
  const { name, sha, packageRoot, moduleRoot, depth, shared, exclude } = manifest;
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name)) fail('name must be a path segment ([A-Za-z0-9._-])');
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(sha)) fail('sha must be a commit id (7 to 40 hex digits)');
  if (typeof packageRoot !== 'string') fail('packageRoot must be a string (\'\' for the repo root)');
  if (typeof moduleRoot !== 'string' || !normalizeDirectory(moduleRoot)) fail('moduleRoot must name a directory under the package');
  if (!isStringArray(shared)) fail('shared must be an array of folder names');
  if (!isStringArray(exclude)) fail('exclude must be an array of regular expression sources');
  for (const pattern of exclude as string[]) {
    try {
      new RegExp(pattern);
    } catch {
      fail(`exclude pattern ${JSON.stringify(pattern)} is not a regular expression`);
    }
  }
  if (depth !== undefined) {
    if (!depth || typeof depth !== 'object' || Array.isArray(depth)) fail('depth must map a top folder to a segment count');
    for (const [folder, count] of Object.entries(depth as Record<string, unknown>)) {
      if (!Number.isInteger(count) || (count as number) < 1) fail(`depth.${folder} must be a whole number from 1`);
    }
  }
  return {
    name: name as string,
    sha: sha as string,
    packageRoot: normalizeDirectory(packageRoot as string),
    moduleRoot: normalizeDirectory(moduleRoot as string),
    ...(depth ? { depth: depth as Record<string, number> } : {}),
    shared: shared as string[],
    exclude: exclude as string[],
  };
}

export function readScrambleManifest(file: string): ScrambleManifest {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`scramble manifest ${file}: ${(error as Error).message}`);
  }
  return parseScrambleManifest(value, file);
}

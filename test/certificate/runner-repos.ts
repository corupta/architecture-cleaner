// Base/head repos certified against an installed test runner: the environment is a directory whose node_modules
// links to a real install (this package's vitest, or a target's jest/mocha under ~/ac-targets when present).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { certify } from '../../src/certificate/certify.js';
import type { Profile } from '../../src/certificate/profile.js';
import type { Certificate, CheckId, CheckResult } from '../../src/certificate/types.js';
import { treeOf, twoCommits } from './two-commit-repo.js';

export type Files = Record<string, string>;

export const localNodeModules = path.resolve(import.meta.dirname, '../../node_modules');
export const targetsDirectory = path.join(os.homedir(), 'ac-targets');
/** jest 30 with ts-jest (pnpm), from the G3 mcphub clone. */
export const jestNodeModules = path.join(targetsDirectory, 'g3/mcphub/node_modules');
/** mocha 11 with tsx (npm), from the openhab-cloud clone. */
export const mochaNodeModules = path.join(targetsDirectory, 'openhab-cloud/node_modules');
export const installed = (nodeModules: string, runner: string) => fs.existsSync(path.join(nodeModules, runner, 'package.json'));

/** A fixture tree (before/, after/): fixtures hold no symlinks. */
export const filesOf = (directory: string): Files => treeOf(directory) as Files;

/** Commits `base` then `head`, and certifies the pair with `only` the given checks; `nodeModules` is linked in untracked. */
export async function certifyFiles(base: Files, head: Files, options: { only: CheckId[]; nodeModules?: string; profile?: Profile }): Promise<Certificate> {
  const { nodeModules } = options;
  const repo = twoCommits(base, head, {}, nodeModules ? (root) => fs.symlinkSync(nodeModules, path.join(root, 'node_modules')) : undefined);
  try {
    return await certify({
      repo: repo.root, base: repo.base, head: repo.head, packageRoot: '', environment: repo.root, profile: options.profile ?? null, oracles: false,
      only: options.only, workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ac-runner-work-')), keep: false,
    });
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true });
  }
}

export const checkOf = (certificate: Certificate, id: CheckId): CheckResult => certificate.checks.find((check) => check.id === id)!;

/** Files with some paths renamed and some texts replaced (`edits`: path in the result → [from, to] replacements). */
export function variant(files: Files, moves: Record<string, string>, edits: Record<string, [string, string][]> = {}): Files {
  const result: Files = {};
  for (const [file, text] of Object.entries(files)) result[moves[file] ?? file] = text;
  for (const [file, replacements] of Object.entries(edits)) {
    let text = result[file];
    if (text === undefined) throw new Error(`variant: no ${file}`);
    for (const [from, to] of replacements) {
      if (!text.includes(from)) throw new Error(`variant: '${from}' not in ${file}`);
      text = text.replace(from, to);
    }
    result[file] = text;
  }
  return result;
}

/** A vitest 5 repo (this package's install): an alias, two same-basename modules, a manual mock, one test file. */
export const vitestRepo: Files = {
  'package.json': JSON.stringify({ name: 'runner-fixture', private: true, type: 'module', scripts: { test: 'vitest run' } }),
  'vitest.config.mjs': "import path from 'node:path';\n\nexport default {\n  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },\n  test: { include: ['src/**/*.test.ts'] },\n};\n",
  'src/lib/clock.ts': 'export const now = () => 1;\n',
  'src/legacy/clock.ts': 'export const now = () => 2;\n',
  'src/services/gateway.ts': "export const charge = () => 'real';\n",
  'src/services/__mocks__/gateway.ts': "export const charge = () => 'mocked';\n",
  'src/services/billing.ts': "import { now } from '../lib/clock.js';\nimport { charge } from '@/services/gateway';\n\nexport const bill = () => [now(), charge()];\n",
  'src/services/billing.test.ts': [
    "import { describe, expect, it, vi } from 'vitest';",
    "import { bill } from './billing.js';",
    '',
    "vi.mock('./gateway.js');",
    "vi.mock('./virtual-only.js', () => ({ value: 1 }));",
    '',
    "describe('billing', () => {",
    "  it('bills', () => expect(bill()).toEqual([1, 'mocked']));",
    "  it.todo('refunds');",
    '});',
    '',
  ].join('\n'),
};

/** The billing feature moved to src/modules/billing/ with every specifier that needed it rewritten. */
export const vitestRepoMoved = variant(vitestRepo, {
  'src/services/billing.ts': 'src/modules/billing/billing.ts',
  'src/services/billing.test.ts': 'src/modules/billing/billing.test.ts',
}, {
  'src/modules/billing/billing.ts': [["'../lib/clock.js'", "'../../lib/clock.js'"]],
  'src/modules/billing/billing.test.ts': [["vi.mock('./gateway.js')", "vi.mock('../../services/gateway.js')"]],
});

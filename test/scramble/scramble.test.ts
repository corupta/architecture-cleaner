// `ac scramble` end to end on a small feature-modular repo: the layout applied by the executor, declines left in place,
// the reproducible commit, leakage, the output files and the scramble's own certificate.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scrambleRepo } from '../../src/scramble/index.js';
import type { ScrambleManifest } from '../../src/scramble/types.js';
import { repoFrom } from '../executor/repo.js';

const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

const tree = {
  'package.json': JSON.stringify({ name: 'api', private: true }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', baseUrl: './', strict: true, types: [], ignoreDeprecations: '6.0' }, include: ['src'] }),
  'src/main.ts': "import { TeamService } from './team/team.service';\nimport { UserService } from 'src/user/user.service';\nexport const services = [TeamService, UserService];\n",
  'src/utils.ts': 'export const clean = (text: string) => text.trim();\n',
  'src/types/id.ts': 'export type Id = string;\n',
  'src/team/team.service.ts': "import type { Id } from '../types/id';\nimport { clean } from 'src/utils';\nexport class TeamService { name(id: Id) { return clean(id); } }\n",
  'src/team/team.service.spec.ts': "import { TeamService } from './team.service';\nexport const subject = TeamService;\n",
  'src/team/helper.ts': "import { clean } from 'src/utils';\nexport const teamLabel = (name: string) => clean(name);\n",
  'src/team/index.ts': "export * from './team.service';\n",
  'src/team/e2e.spec.ts': "import { teamLabel } from './helper';\nexport const label = teamLabel;\n",
  'src/user/user.service.ts': "import { teamLabel } from '../team/helper';\nexport class UserService { label = teamLabel; }\n",
  'src/user/helper.ts': 'export const userLabel = (name: string) => name;\n',
  'src/user/templates.ts': "import path from 'node:path';\nexport const templates = path.join(__dirname, 'templates');\n",
  'src/user/avatar.png.txt': 'not code\n',
  // Identical twins: the certifier pairs them by path alone, so the scramble must move them the way it reads them.
  'src/team/labels.ts': "export const isSystemLabel = (name: string) => name.startsWith('system:');\n",
  'src/user/labels.ts': "export const isSystemLabel = (name: string) => name.startsWith('system:');\n",
  'src/team/team-labels.ts': "import { isSystemLabel } from './labels';\nexport const teamLabels = isSystemLabel;\n",
  'src/user/user-labels.ts': "import { isSystemLabel } from './labels';\nexport const userLabels = isSystemLabel;\n",
};

const manifest = (sha: string): ScrambleManifest => ({ name: 'demo', sha, packageRoot: '', moduleRoot: 'src', shared: ['types'], exclude: [] });

function scrambleFixture() {
  const root = repoFrom(tree);
  return { root, sha: git(root, 'rev-parse', 'HEAD'), out: fs.mkdtempSync(path.join(os.tmpdir(), 'ac-scramble-out-')) };
}

describe('scrambleRepo', () => {
  it('flattens features into type folders with the executor and records truth, declines and leakage', async () => {
    const { root, sha, out } = scrambleFixture();
    const messages: string[] = [];
    const result = await scrambleRepo({ repo: root, manifest: manifest(sha), variant: 'default', out, certify: false, log: (message) => messages.push(message) });
    expect(Object.fromEntries(result.entities.map((entity) => [entity.original, [entity.scrambled, entity.truth, entity.type]]))).toEqual({
      'src/main.ts': ['src/main.ts', 'root', 'util'],
      'src/team/helper.ts': ['src/util/team-label.ts', 'team', 'util'],
      // The layout named them in path order (team: is-system-label.ts); the certifier's tie-break reads them the other way.
      'src/team/labels.ts': ['src/util/is-system-label-2.ts', 'team', 'util'],
      'src/team/team-labels.ts': ['src/util/team-labels.ts', 'team', 'util'],
      'src/team/team.service.ts': ['src/services/team.service.ts', 'team', 'service'],
      'src/types/id.ts': ['src/types/id.ts', 'shared:types', 'types'],
      'src/user/helper.ts': ['src/util/user-label.ts', 'user', 'util'],
      'src/user/labels.ts': ['src/util/is-system-label.ts', 'user', 'util'],
      'src/user/user-labels.ts': ['src/util/user-labels.ts', 'user', 'util'],
      'src/user/templates.ts': ['src/user/templates.ts', 'user', 'util'],
      'src/user/user.service.ts': ['src/services/user.service.ts', 'user', 'service'],
      'src/utils.ts': ['src/utils.ts', 'root', 'util'],
    });
    expect(messages).toContain("the certifier's pathMap inference pairs 2 interchangeable files differently: taking its pairing");
    expect(result.declined).toEqual([{ path: 'src/user/templates.ts', code: 'location-sensitive', detail: 'src/user/templates.ts: __dirname' }]);
    expect(result.leakage).toEqual([
      { path: 'src/team/e2e.spec.ts', reason: 'test with no co-located subject' },
      { path: 'src/team/index.ts', reason: 'barrel (re-exports only)' },
      { path: 'src/user/avatar.png.txt', reason: 'not a TypeScript source file' },
      { path: 'src/user/templates.ts', reason: 'declined by the executor (location-sensitive)' },
    ]);
    expect(git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ac-scramble/demo');
    expect(git(root, 'log', '-1', '--format=%an <%ae> %cI')).toBe(`ac scramble <ac-scramble@architecture-cleaner.invalid> ${git(root, 'log', '-1', '--format=%cI', sha)}`);
    expect(fs.readFileSync(path.join(root, 'src/services/team.service.spec.ts'), 'utf8')).toContain("from './team.service'");
    expect(fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')).toContain("from './services/team.service'");
    expect(fs.readFileSync(path.join(root, 'src/team/index.ts'), 'utf8')).toBe("export * from '../services/team.service';\n");
    expect(JSON.parse(fs.readFileSync(path.join(out, 'scramble.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(result)));
    expect(JSON.parse(fs.readFileSync(path.join(out, 'pathmap.json'), 'utf8')).moves['src/team/team.service.spec.ts']).toBe('src/services/team.service.spec.ts');
    expect(result.certificate).toBeNull();
  });

  it('is reproducible: the same scramble of the same base is the same commit', async () => {
    const { root, sha, out } = scrambleFixture();
    const first = await scrambleRepo({ repo: root, manifest: manifest(sha), variant: 'H1', out, branch: 'first', certify: false });
    git(root, 'checkout', '-q', '--detach', sha);
    const second = await scrambleRepo({ repo: root, manifest: manifest(sha), variant: 'H1', out, branch: 'second', certify: false });
    expect(second.commit).toBe(first.commit);
    expect(second.entities).toEqual(first.entities);
  });

  it('H1 renames every moving feature file opaquely, and the scramble certifies PASS on its own certificate', async () => {
    const { root, sha, out } = scrambleFixture();
    const result = await scrambleRepo({ repo: root, manifest: manifest(sha), variant: 'H1', out, certify: true });
    const moved = result.entities.filter((entity) => entity.scrambled !== entity.original);
    expect(moved.map((entity) => entity.scrambled).every((file) => /^src\/(services|util)\/[su]-[0-9a-f]{4,}(\.service)?\.ts$/.test(file))).toBe(true);
    expect(result.branch).toBe('ac-scramble/demo-H1');
    expect(result.certificate).toMatchObject({ verdict: 'pass', scope: 'static', failing: [] });
    expect(fs.readFileSync(path.join(out, 'certificate.txt'), 'utf8')).toContain('verdict: PASS');
    expect(git(root, 'log', '-1', '--format=%B')).toContain(`Ac-Certificate-Digest: ${result.certificate!.digest}`);
    expect(git(root, 'rev-parse', 'HEAD^{tree}')).toBe(result.tree);
  }, 120_000);

  it('refuses a checkout that is not at the manifest commit, or a branch that exists', async () => {
    const { root, sha, out } = scrambleFixture();
    await expect(scrambleRepo({ repo: root, manifest: manifest('0000000'), variant: 'default', out, certify: false })).rejects.toThrow();
    git(root, 'branch', 'ac-scramble/demo');
    await expect(scrambleRepo({ repo: root, manifest: manifest(sha), variant: 'default', out, certify: false })).rejects.toThrow('already exists');
  });
});

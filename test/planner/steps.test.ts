// plan.yaml → steps: collisions TS or a case-insensitive file system would see, step file names that list in
// execution order, the group checks `ac steps` runs without the repo, and no step files for an invalid plan.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { gitRepoFs } from '../../src/analyzer/repo-fs.js';
import { createGateway } from '../../src/gateway/gateway.js';
import { defaultEditSettings } from '../../src/planner/edit.js';
import { planOutputs } from '../../src/planner/outputs.js';
import type { PlanFile, PlanFileEntry } from '../../src/planner/plan-file.js';
import { planRepo } from '../../src/planner/plan.js';
import { checkGroupKeys, stepFileName, stepsOf } from '../../src/planner/steps.js';

const planFileWith = (groups: Record<string, (string | PlanFileEntry)[]>): PlanFile => ({
  packageRoot: '',
  moduleRoot: 'src',
  sha: 'test',
  groups: new Map(Object.entries(groups).map(([key, entries]) => [key, entries.map((entry) => (typeof entry === 'string' ? { path: entry, tests: [] } : entry))])),
  pinned: [],
});

const destinations = (step: { moves: Map<string, string> }) => [...step.moves.values()];

describe('step collisions', () => {
  it('keeps the old parent folder for basenames that differ only in case (User.ts, user.ts)', () => {
    const [step] = stepsOf(planFileWith({ 'module/user': ['src/models/User.ts', 'src/routes/user.ts', 'src/services/user.service.ts'] }));
    expect(Object.fromEntries(step!.moves)).toEqual({
      'src/models/User.ts': 'src/modules/user/models/User.ts',
      'src/routes/user.ts': 'src/modules/user/routes/user.ts',
      'src/services/user.service.ts': 'src/modules/user/user.service.ts',
    });
    expect(step!.disambiguated).toEqual(['src/models/User.ts', 'src/routes/user.ts']);
  });

  it('keeps the old parent folder for the same stem in .ts and .tsx (Dokploy), and their tests follow', () => {
    const [step] = stepsOf(planFileWith({
      'module/invoice': [
        { path: 'src/services/invoice.ts', tests: ['src/services/invoice.spec.ts'] },
        { path: 'src/views/invoice.tsx', tests: ['src/views/invoice.spec.ts'] },
      ],
    }));
    expect(Object.fromEntries(step!.moves)).toEqual({
      'src/services/invoice.ts': 'src/modules/invoice/services/invoice.ts',
      'src/services/invoice.spec.ts': 'src/modules/invoice/services/invoice.spec.ts',
      'src/views/invoice.tsx': 'src/modules/invoice/views/invoice.tsx',
      'src/views/invoice.spec.ts': 'src/modules/invoice/views/invoice.spec.ts',
    });
    expect(new Set(destinations(step!)).size).toBe(step!.moves.size);
  });

  it('treats a .d.ts and a .js of the same stem as clashing too, and a case-only folder clash goes one level up', () => {
    const [step] = stepsOf(planFileWith({ 'platform/http': ['src/a/Models/http.ts', 'src/b/models/http.d.ts', 'src/http.js'] }));
    expect(destinations(step!)).toEqual(['src/platform/http/Models/http.ts', 'src/platform/http/b/models/http.d.ts', 'src/platform/http/http.js']);
  });

  it('leaves names that only share a prefix at depth 1', () => {
    const [step] = stepsOf(planFileWith({ 'module/album': ['src/controllers/album.controller.ts', 'src/services/album.service.ts', 'src/views/album.tsx'] }));
    expect(step!.disambiguated).toEqual([]);
  });
});

describe('step file names', () => {
  const steps = stepsOf(planFileWith(Object.fromEntries(Array.from({ length: 105 }, (_, index) => [`module/feature-${index}`, [`src/f${index}/feature-${index}.ts`]]))));

  it('pad to the widest index, so a listing of 100+ steps is in execution order', () => {
    const names = steps.map((step) => stepFileName(step, steps.length));
    expect(names[0]).toBe('001-module-feature-0.json');
    expect(names[104]).toBe('105-module-feature-104.json');
    expect([...names].sort()).toEqual(names);
  });

  it('keep two digits below 100 steps', () => {
    expect(stepFileName(steps[8]!, 63)).toBe('09-module-feature-8.json');
  });
});

describe('ac steps group checks', () => {
  it('rejects banned module and platform names and one name in two kinds', () => {
    const issues = checkGroupKeys(planFileWith({
      'module/album': ['src/album.ts'],
      'module/interfaces': ['src/interfaces/shape.interface.ts'],
      'module/utils': ['src/utils/date.ts'],
      'platform/middleware': ['src/middleware/auth.ts'],
      'platform/album': ['src/album/album.module.ts'],
    }));
    expect(issues.map((issue) => [issue.code, issue.group])).toEqual([
      ['banned-name', 'module/interfaces'],
      ['banned-name', 'module/utils'],
      ['kind-conflict', 'platform/album'],
      ['banned-name', 'platform/middleware'],
    ]);
  });

  it('accepts names it cannot check without the repo, any shared/ key (one flat shared group) and emptied groups', () => {
    expect(checkGroupKeys(planFileWith({
      'module/zeppelin': ['src/zeppelin.ts'],
      'platform/flux-capacitor': ['src/flux.ts'],
      'shared/strings': ['src/utils/strings.ts'],
      'shared/shared': ['src/utils/dates.ts'],
      'module/utils': [],
    }))).toEqual([]);
  });
});

describe('ac plan outputs', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-steps-'));
  afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const repoRoot = path.join(temporary, 'repo');
  const sources: Record<string, string> = {
    'package.json': '{ "name": "fixture", "type": "module" }\n',
    'tsconfig.json': '{ "compilerOptions": { "module": "nodenext", "strict": true }, "include": ["src"] }\n',
    'src/controllers/album.controller.ts': "import { AlbumService } from '../services/album.service.js';\nexport class AlbumController {\n  constructor(readonly albums: AlbumService) {}\n}\n",
    'src/services/album.service.ts': 'export class AlbumService {}\n',
  };
  for (const [file, text] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, file), text);
  }
  const git = (...args: string[]) => execFileSync('git', ['-C', repoRoot, '-c', 'user.name=fixture', '-c', 'user.email=fixture@ac.invalid', ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  // No samples and no critic: the seeds draft is the plan and the gateway is never called.
  const gateway = createGateway({ runId: 'replay', mode: 'replay', cassettePath: path.join(temporary, 'none.jsonl'), ledgerPath: path.join(temporary, 'ledger.jsonl') });
  const settings = { edit: { ...defaultEditSettings, samples: 0 }, critic: null };
  const run = await planRepo(gitRepoFs(repoRoot), gateway, { packageRoot: '', moduleRoot: 'src', pins: [], ...settings });

  it('writes step files for a valid plan', () => {
    expect(run.validation.valid).toBe(true);
    expect([...planOutputs(run, { name: 'fixture' }, settings).keys()]).toEqual(['plan.yaml', 'plan.md', 'plan.json', 'candidates/seeds-draft.yaml', 'steps/01-module-album.json']);
  });

  it('writes no step files for an invalid plan, only the plan to fix', () => {
    const invalid = { ...run, validation: { ...run.validation, valid: false } };
    expect([...planOutputs(invalid, { name: 'fixture' }, settings).keys()]).toEqual(['plan.yaml', 'plan.md', 'plan.json', 'candidates/seeds-draft.yaml']);
  });
});

// The mutation harness: operators build the intended one-mutation trees on a fixture, the harness commits them in
// a scratch repo, certifies each in-process and records which checks killed it (and diffs for survivors).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReferenceSite } from '../../src/analyzer/types.js';
import { coverageSubject } from '../../src/mutation/coverage-subject.js';
import { moveWithImporters, respell, type TreeEdits } from '../../src/mutation/edits.js';
import { certify } from '../../src/certificate/certify.js';
import { commitEdits, effectiveKills, fixtureSubjects, loadHuntCases, materializePair, normalizedViolation, runHarness, stagesOf } from '../../src/mutation/harness.js';
import { type Candidate, operators } from '../../src/mutation/operators.js';
import { openSubject, type Subject } from '../../src/mutation/subject.js';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-mutation-test-'));
afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

const operator = (id: string) => operators.find((candidate) => candidate.id === id)!;
const open = (fixture: string) => openSubject(fixtureSubjects(undefined, [fixture])[0]!, path.join(workDir, fixture));
const built = (candidates: Candidate[]) => candidates.map((candidate) => ({ candidate, edits: candidate.build() })).filter((entry): entry is { candidate: Candidate; edits: TreeEdits } => entry.edits !== null);
const text = (edits: TreeEdits, file: string) => edits.get(file)?.bytes.toString('utf8');
const site = (specifier: string, kind: ReferenceSite['kind'] = 'import'): ReferenceSite => ({ kind, specifier, start: 0, end: 0, typeOnly: false });

/** A known-good result built from two literal trees (for operators no fixture exercises). */
function treeSubject(name: string, before: Record<string, string>, after: Record<string, string>): Subject {
  const root = path.join(workDir, 'trees', name);
  for (const [side, tree] of [['before', before], ['after', after]] as const) {
    for (const [file, content] of Object.entries(tree)) {
      fs.mkdirSync(path.dirname(path.join(root, side, file)), { recursive: true });
      fs.writeFileSync(path.join(root, side, file), content);
    }
  }
  return openSubject({
    name, target: 'unit', packageRoot: '', profile: null,
    prepare: (directory) => materializePair(path.join(directory, 'repo'), path.join(root, 'before'), path.join(root, 'after')),
  }, path.join(workDir, name));
}

/** Certifies one mutant of `subject` (committed on top of its base) with some checks. */
async function certifyMutant(subject: Subject, edits: TreeEdits, only: ('K1' | 'K2' | 'K3a')[]) {
  const commit = commitEdits(subject.repo, subject.head, subject.base, edits, 'mutant');
  const certificate = await certify({
    repo: subject.repo, base: subject.base, head: commit, packageRoot: '', environment: subject.environment, profile: null, oracles: false, only,
    workDir: fs.mkdtempSync(path.join(workDir, 'certify-')), keep: false,
  });
  return Object.fromEntries(certificate.checks.map((check) => [check.id, check.status]));
}

describe('respell keeps the form class', () => {
  it('relative stays relative, the ending style stays', () => {
    expect(respell(site('./user.service'), 'src/app.ts', 'src/user.service.ts', 'src/modules/user/user.service.ts')).toBe('./modules/user/user.service');
    expect(respell(site('../services/user.service.js'), 'src/a/b.ts', 'src/services/user.service.ts', 'src/modules/user.service.ts')).toBe('../modules/user.service.js');
    expect(respell(site('./users'), 'src/app.ts', 'src/users/index.ts', 'src/modules/users/index.ts')).toBe('./modules/users');
    expect(respell(site('./data.json'), 'src/app.ts', 'src/data.json', 'src/x/data.json')).toBe('./x/data.json');
  });
  it('an alias keeps its prefix and needs the target under its root', () => {
    expect(respell(site('@app/users/user.service'), 'src/app.ts', 'src/users/user.service.ts', 'src/modules/user/user.service.ts')).toBe('@app/modules/user/user.service');
    expect(respell(site('src/modules/album/album.service.js'), 'server/src/app.ts', 'server/src/modules/album/album.service.ts', 'server/src/x/album.service.ts')).toBe('src/x/album.service.js');
    expect(respell(site('@app/users/user.service'), 'src/app.ts', 'src/users/user.service.ts', 'lib/user.service.ts')).toBeNull();
  });
  it('a bare triple-slash path stays bare while the target is a sibling', () => {
    expect(respell(site('globals.d.ts', 'triple-slash'), 'src/x/app.ts', 'src/globals.d.ts', 'src/x/globals.d.ts')).toBe('globals.d.ts');
  });
});

describe('operators on the jest-mocks fixture', () => {
  let subject: Subject;
  beforeAll(() => {
    subject = open('jest-mocks');
  });

  it('M6 leaves the co-moved manual mock at its base path', () => {
    const [mutant] = built(operator('M6').candidates(subject));
    expect([...mutant!.edits.keys()].sort()).toEqual(['src/modules/user/__mocks__/user.repository.ts', 'src/services/__mocks__/user.repository.ts']);
    expect(mutant!.edits.get('src/modules/user/__mocks__/user.repository.ts')).toBeNull();
    expect(mutant!.edits.get('src/services/__mocks__/user.repository.ts')!.bytes.equals(subject.baseTree.bytes('src/services/__mocks__/user.repository.ts')!)).toBe(true);
  });

  it('M7 leaves the co-moved snapshot at its base path', () => {
    const [mutant] = built(operator('M7').candidates(subject));
    expect(mutant!.edits.get('src/modules/user/__snapshots__/user.service.test.ts.snap')).toBeNull();
    expect(mutant!.edits.has('src/services/__snapshots__/user.service.test.ts.snap')).toBe(true);
  });

  it('M3 reverts exactly one rewritten jest.mock specifier', () => {
    const mutants = built(operator('M3').candidates(subject));
    const clock = mutants.find(({ candidate }) => candidate.description.includes("'../../lib/clock'"))!;
    const file = 'src/modules/user/user.service.test.ts';
    expect([...clock.edits.keys()]).toEqual([file]);
    expect(text(clock.edits, file)).toBe(subject.headTree.text(file)!.replace("jest.mock('../../lib/clock'", "jest.mock('../lib/clock'"));
  });

  it('M10 swaps two adjacent imports and keeps every line', () => {
    const [mutant] = built(operator('M10').candidates(subject));
    const [file] = [...mutant!.edits.keys()];
    const before = subject.headTree.text(file!)!;
    const after = text(mutant!.edits, file!)!;
    expect(after).not.toBe(before);
    expect(after.split('\n').sort()).toEqual(before.split('\n').sort());
  });

  it('M12 toggles `type` on one import declaration', () => {
    for (const { edits } of built(operator('M12').candidates(subject))) {
      const [file] = [...edits.keys()];
      const delta = text(edits, file!)!.length - subject.headTree.text(file!)!.length;
      expect(Math.abs(delta)).toBeGreaterThanOrEqual(5);
    }
  });

  it('M24 changes a mode and nothing else', () => {
    const [mutant] = built(operator('M24').candidates(subject));
    const [file, content] = [...mutant!.edits][0]!;
    expect(content!.mode).toBe('100755');
    expect(content!.bytes.equals(subject.headTree.bytes(file)!)).toBe(true);
  });

  it('M29 adds a second manual mock with an existing basename, never inside __mocks__ itself', () => {
    const mutants = built(operator('M29').candidates(subject));
    expect(mutants.length).toBeGreaterThan(0);
    for (const { edits } of mutants) {
      const [file] = [...edits.keys()];
      expect(file).toMatch(/\/__mocks__\/[^/]+$/);
      expect(file).not.toMatch(/__mocks__\/__mocks__/);
      expect(subject.headTree.entries.has(file!)).toBe(false);
    }
  });

  it('M30 edits the alias target in exactly one config', () => {
    const variants = built(operator('M30').candidates(subject)).map(({ candidate, edits }) => [candidate.variant, [...edits.keys()]]);
    expect(variants).toEqual(expect.arrayContaining([['tsconfig-paths', ['tsconfig.json']], ['jest-moduleNameMapper', ['jest.config.js']]]));
  });
});

describe('M33: boundary-rule configs that are not proven inert', () => {
  it('adds the config off the package root, executable or as a symlink: K1 kills each, and accepts the inert one', async () => {
    const subject = open('paths-alias');
    const mutants = built(operator('M33').candidates(subject));
    expect([...new Set(mutants.map(({ candidate }) => candidate.variant))]).toEqual(['off-root', 'executable', 'symlink']);
    for (const { edits } of mutants) expect(await certifyMutant(subject, edits, ['K1'])).toEqual({ K1: 'fail' });
    const inert: TreeEdits = new Map([['.dependency-cruiser.json', { bytes: Buffer.from('{}\n'), mode: '100644' }]]);
    expect(await certifyMutant(subject, inert, ['K1'])).toEqual({ K1: 'pass' });
  });
});

describe('operators that move files', () => {
  it('moveWithImporters respells importers in their own form and the moved file\'s relative specifiers', () => {
    const subject = open('paths-alias');
    const edits = moveWithImporters(subject, 'src/shared/strings.ts', 'src/shared/relocated/strings.ts')!;
    expect(edits.get('src/shared/strings.ts')).toBeNull();
    expect(edits.has('src/shared/relocated/strings.ts')).toBe(true);
    const importers = (subject.importers.get('src/shared/strings.ts') ?? []).map((reference) => reference.file).filter((file) => file !== 'src/shared/strings.ts');
    expect(importers.length).toBeGreaterThan(0);
    for (const importer of importers) {
      const rewritten = text(edits, importer)!;
      const original = subject.headTree.text(importer)!;
      expect(rewritten).not.toBe(original);
      for (const reference of subject.importers.get('src/shared/strings.ts')!.filter((entry) => entry.file === importer)) {
        const isAlias = !reference.site.specifier.startsWith('.');
        expect(rewritten).toContain(isAlias ? reference.site.specifier.replace(/strings$/, 'relocated/strings') : 'relocated/strings');
      }
    }
  });

  it('M17 moves a file out of its tsconfig program (cjs-relative: src/ -> tests/)', () => {
    const subject = open('cjs-relative');
    const mutants = built(operator('M17').candidates(subject));
    expect(mutants.length).toBeGreaterThan(0);
    expect(mutants.every(({ candidate }) => candidate.variant === 'tsconfig-scope')).toBe(true);
  });
});

describe('operators on the paths-alias fixture (aliases, directory imports)', () => {
  let subject: Subject;
  beforeAll(() => {
    subject = open('paths-alias');
  });

  it('M13 and M19 also respell alias specifiers, keeping the alias prefix', () => {
    const extension = built(operator('M13').candidates(subject)).filter(({ candidate }) => candidate.variant === 'alias-add-extension');
    expect(extension.length).toBeGreaterThan(0);
    for (const { edits } of extension) {
      const [file] = [...edits.keys()];
      const added = text(edits, file!)!.length - subject.headTree.text(file!)!.length;
      expect(added).toBe(3);
      expect(text(edits, file!)).toMatch(/["'](@\w+|src)\/[^"']+\.js["']/);
    }
    const cased = built(operator('M19').candidates(subject)).filter(({ candidate }) => candidate.variant === 'alias');
    expect(cased.length).toBeGreaterThan(0);
  });

  it('M27 shadows a directory import by an added file, and by moving another file there (K1 passes, K3a kills)', async () => {
    const candidates = operator('M27').candidates(subject);
    const added = built(candidates).find(({ candidate }) => candidate.variant === 'file-beside-directory')!;
    expect([...added.edits.keys()]).toEqual(['src/modules/user.ts']);
    const moved = built(candidates).find(({ candidate }) => candidate.variant === 'moved-into-shadow' && candidate.key.endsWith('->src/modules/user.ts'))!;
    const [donor] = moved.candidate.key.split('->');
    expect(moved.edits.get(donor!)).toBeNull();
    expect(moved.edits.has('src/modules/user.ts')).toBe(true);
    const statuses = await certifyMutant(subject, moved.edits, ['K1', 'K3a']);
    expect(statuses).toEqual({ K1: 'pass', K3a: 'fail' });
  });
});

describe('M28 on a baseUrl repo that imports a package', () => {
  it('moves a file to <baseUrl>/<package>.ts, which TypeScript then resolves the package import to', async () => {
    const tsconfig = JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', baseUrl: '.', strict: true, ignoreDeprecations: '6.0' }, include: ['src'] });
    const subject = treeSubject('baseurl-package', {
      'tsconfig.json': tsconfig,
      'src/app.ts': "import { chunk } from 'lodash-es';\nimport { util } from './old/util';\nexport const app = [chunk, util];\n",
      'src/old/util.ts': 'export const util = 1;\n',
    }, {
      'tsconfig.json': tsconfig,
      'src/app.ts': "import { chunk } from 'lodash-es';\nimport { util } from './modules/util';\nexport const app = [chunk, util];\n",
      'src/modules/util.ts': 'export const util = 1;\n',
    });
    const mutants = built(operator('M28').candidates(subject));
    expect(mutants.map(({ candidate }) => candidate.key)).toEqual(expect.arrayContaining(['src/modules/util.ts->lodash-es.ts']));
    const mutant = mutants.find(({ candidate }) => candidate.key === 'src/modules/util.ts->lodash-es.ts')!;
    expect(text(mutant.edits, 'src/app.ts')).toContain("from '../lodash-es'");
    const statuses = await certifyMutant(subject, mutant.edits, ['K1', 'K3a']);
    expect(statuses).toEqual({ K1: 'pass', K3a: 'fail' });
  });
});

describe('the synthetic coverage subject', () => {
  let subject: Subject;
  beforeAll(() => {
    subject = openSubject(coverageSubject(), path.join(workDir, 'synthetic'));
  });

  it('gives the operators no fixture exercises an instance each', () => {
    const keys = (id: string) => built(operator(id).candidates(subject)).map(({ candidate }) => candidate.key);
    expect(keys('M4')).toEqual(['src/server.test.ts#1']);
    expect(keys('M14')).toEqual(['src/templates/render.ts']);
    expect(keys('M18')).toEqual(['src/legacy/format.d.ts']);
    expect(keys('M21')).toEqual(expect.arrayContaining(['Dockerfile:src/server.ts', 'package.json:src/server.ts']));
    expect(keys('M28')).toEqual(expect.arrayContaining(['src/modules/user/user.service.ts->events.ts']));
  });

  it('M4 reverts the virtual mock rewrite only', () => {
    const [mutant] = built(operator('M4').candidates(subject));
    expect(text(mutant!.edits, 'src/server.test.ts')).toBe(subject.headTree.text('src/server.test.ts')!.replace("'./modules/user/user.service'", "'./services/user.service'"));
  });

  it('M18 moves the declaration and leaves its implementation', () => {
    const [mutant] = built(operator('M18').candidates(subject));
    expect(mutant!.edits.get('src/legacy/format.d.ts')).toBeNull();
    expect(mutant!.edits.has('src/legacy/relocated/format.d.ts')).toBe(true);
    expect(mutant!.edits.has('src/legacy/format.js')).toBe(false);
    expect(text(mutant!.edits, 'src/server.ts')).toContain("from './legacy/relocated/format'");
  });
});

describe('the harness', () => {
  it('commits mutants with plumbing and records kills, survivors and their diffs', async () => {
    const result = await runHarness({
      subjects: fixtureSubjects(undefined, ['jest-mocks']),
      hunt: [],
      operators: ['M2', 'M6', 'M10', 'M24'],
      cap: 1,
      checks: ['K1', 'K2'],
      staged: false,
      workDir: path.join(workDir, 'harness'),
      quiet: true,
      log: () => {},
    });
    expect(result.controls.map((control) => control.verdict)).toEqual(['pass']);
    const byOperator = new Map(result.mutants.map((mutant) => [mutant.operator, mutant]));
    expect(byOperator.get('M6')!.killedBy).toContain('K1');
    expect(byOperator.get('M24')!.killedBy).toEqual(['K1']);
    expect(byOperator.get('M10')!.survived).toBe(false);
    // Without K3 a dropped importer rewrite is a pure-span change: it survives K1/K2 and is logged with its diff.
    const dropped = byOperator.get('M2')!;
    expect(dropped.survived).toBe(true);
    expect(dropped.effectivelySurvived).toBe(true);
    expect(dropped.diff).toMatch(/^-.*\n\+/m);
    const repo = dropped.repo;
    expect(execFileSync('git', ['-C', repo, 'rev-parse', `${dropped.commit}^`], { encoding: 'utf8' }).trim()).toBe(result.controls[0]!.base);
  });

  it('staged: runner checks run only on mutants the tree-only checks leave alive', async () => {
    expect(stagesOf(['K0', 'K1', 'K2', 'K3a', 'K3b', 'K3c', 'K4', 'K6', 'K7'], true)).toEqual([['K0', 'K1', 'K2', 'K3a', 'K4', 'K7'], ['K3b', 'K3c', 'K6']]);
    expect(stagesOf(['K1', 'K2'], true)).toEqual([['K1', 'K2']]);
    const result = await runHarness({
      subjects: fixtureSubjects(undefined, ['paths-alias']),
      hunt: [],
      operators: ['M2', 'M24'],
      cap: 1,
      checks: ['K1', 'K6'],
      staged: true,
      workDir: path.join(workDir, 'staged'),
      quiet: true,
      log: () => {},
    });
    expect(result.controls[0]!.statuses).toEqual({ K1: 'pass', K6: 'skip' });
    const byOperator = new Map(result.mutants.map((mutant) => [mutant.operator, mutant]));
    expect(byOperator.get('M24')!.checksRun).toEqual(['K1']);
    expect(byOperator.get('M2')!.checksRun).toEqual(['K1', 'K6']);
    expect(byOperator.get('M2')!.effectivelySurvived).toBe(true);
  });

  it('with a tree cache shared by control and mutants, records the kills it records without one', async () => {
    const run = (name: string, cacheDir?: string) => runHarness({
      subjects: fixtureSubjects(undefined, ['vitest-mocks']),
      hunt: [],
      operators: ['M20', 'M24'],
      cap: 1,
      checks: ['K1', 'K6'],
      staged: false,
      workDir: path.join(workDir, name),
      quiet: true,
      ...(cacheDir ? { cacheDir } : {}),
      log: () => {},
    });
    const outcomes = (result: Awaited<ReturnType<typeof run>>) => result.mutants.map((mutant) => [mutant.id, mutant.statuses, mutant.effectiveKilledBy]);
    const cacheDir = path.join(workDir, 'tree-cache');
    const uncached = await run('uncached');
    const cached = await run('cached', cacheDir);
    expect(cached.controls.map((control) => control.verdict)).toEqual(['pass']);
    expect(outcomes(cached)).toEqual(outcomes(uncached));
    expect(cached.mutants.some((mutant) => mutant.effectiveKilledBy.includes('K6'))).toBe(true);
    // One inventory per distinct tree: the base (shared by every certification), the good head and each mutant.
    expect(fs.readdirSync(path.join(cacheDir, 'K6-inventory'))).toHaveLength(2 + new Set(cached.mutants.map((mutant) => mutant.commit)).size);
  });

  it('compares violations without scratch directories and commit ids', () => {
    const commit = 'a'.repeat(40);
    expect(normalizedViolation({ file: 'x.ts', detail: `at /w/certify/m1/worktree-head/x.ts in ${commit} (${commit.slice(0, 9)}), /w/repos/r/y.ts\nstack` },
      { workDir: '/w/certify/m1', repo: '/w/repos/r', commits: [commit] })).toBe('x.ts: at <work>/worktree-head/x.ts in <commit> (<commit>), <repo>/y.ts');
  });

  it('discounts a kill only when the same violations already reject the control', () => {
    const control = new Map([['K4' as const, new Set(['docs/a.md: old path'])]]);
    expect(effectiveKills(['K1', 'K4'], new Map([['K1', new Set(['x'])], ['K4', new Set(['docs/a.md: old path'])]]), control)).toEqual(['K1']);
    expect(effectiveKills(['K4'], new Map([['K4', new Set(['docs/a.md: old path', 'src/b.ts: __dirname'])]]), control)).toEqual(['K4']);
  });

  it('commitEdits writes deletions, additions and modes into a new tree without touching the checkout', () => {
    const fixture = path.join(workDir, 'plumbing');
    fs.mkdirSync(path.join(fixture, 'before'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'before', 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(fixture, 'before', 'b.ts'), 'export const b = 2;\n');
    const commits = materializePair(path.join(fixture, 'repo'), path.join(fixture, 'before'), path.join(fixture, 'before'));
    const edits: TreeEdits = new Map([['a.ts', null], ['c/d.ts', { bytes: Buffer.from('x'), mode: '100755' }]]);
    const mutant = commitEdits(commits.repo, commits.head, commits.base, edits, 'mutant');
    const tree = execFileSync('git', ['-C', commits.repo, 'ls-tree', '-r', mutant], { encoding: 'utf8' });
    expect(tree).toMatch(/^100644 blob \w+\tb\.ts$/m);
    expect(tree).toMatch(/^100755 blob \w+\tc\/d\.ts$/m);
    expect(tree).not.toMatch(/\ta\.ts$/m);
    expect(fs.existsSync(path.join(commits.repo, 'a.ts'))).toBe(true);
    expect(execFileSync('git', ['-C', commits.repo, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('');
  });

  it('loads applicable hunt cases and restores stored node_modules names', () => {
    const corpus = path.join(workDir, 'corpus');
    const write = (file: string, content: string) => {
      fs.mkdirSync(path.dirname(path.join(corpus, file)), { recursive: true });
      fs.writeFileSync(path.join(corpus, file), content);
    };
    write('X1/case.json', JSON.stringify({ id: 'X1', title: 'bad move', applicable: true, expectedChecks: [{ check: 'K1', reason: 'r' }] }));
    write('X1/before/src/a.ts', 'export {};\n');
    write('X1/before/_node_modules/pkg/index.js', 'module.exports = 1;\n');
    write('X1/after/src/b.ts', 'export {};\n');
    write('X1/after/_node_modules/pkg/index.js', 'module.exports = 1;\n');
    write('X2/case.json', JSON.stringify({ id: 'X2', title: 'a crash', applicable: false }));
    write('X2/before/src/a.ts', 'export {};\n');
    const cases = loadHuntCases(corpus);
    expect(cases.map((huntCase) => [huntCase.id, huntCase.expectedChecks])).toEqual([['X1', ['K1']]]);
    const commits = materializePair(path.join(workDir, 'hunt-repo'), path.join(cases[0]!.directory, 'before'), path.join(cases[0]!.directory, 'after'), { force: true });
    expect(execFileSync('git', ['-C', commits.repo, 'ls-tree', '-r', '--name-only', commits.base], { encoding: 'utf8' }).split('\n')).toContain('node_modules/pkg/index.js');
  });
});

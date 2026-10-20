// Hermetic certificates: the certifier certifies only in a directory with no node_modules and no package.json on its
// real path or above it, since TypeScript and Node look both up from every tree it materializes there. A fixture repo
// is certified in a hermetic work dir, then below planted node_modules/@types/planted and node_modules/planted-pkg
// (the package a moved file imports): refused before anything is written, through a symlink too, while the hermetic
// certificate's digest stays what it was. With the refusal bypassed, the planted directories do change the
// certificate: the refusal guards something real. `ac run`, the baseline and the mutation harness refuse up front.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runBaseline } from '../../src/certificate/baseline.js';
import { certify } from '../../src/certificate/certify.js';
import { hermeticProblem, lookupEntriesOnPath, nodeModulesAbove, NotHermeticError, realDirectory, requireHermetic } from '../../src/certificate/hermetic.js';
import type { Certificate, CheckId } from '../../src/certificate/types.js';
import { runHarness } from '../../src/mutation/harness.js';
import { resumeRun, startRun } from '../../src/orchestrator/run.js';
import type { RungId } from '../../src/orchestrator/types.js';
import { fixtureRepo, planYaml, profileOf } from '../orchestrator/fixture.js';
import { twoCommits } from './two-commit-repo.js';

/** When on, the certifier's refusal is skipped: what a certificate below the planted directories would have been. */
const bypass = vi.hoisted(() => ({ on: false }));
vi.mock('../../src/certificate/hermetic.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/certificate/hermetic.js')>();
  return { ...actual, requireHermetic: (directory: string, role: string, remedy: string) => (bypass.on ? actual.realDirectory(directory) : actual.requireHermetic(directory, role, remedy)) };
});

const scratches: string[] = [];
afterAll(() => {
  for (const directory of scratches) fs.rmSync(directory, { recursive: true, force: true });
});
const scratch = (label: string) => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ac-hermetic-${label}-`)));
  scratches.push(directory);
  return directory;
};
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

describe('a hermetic directory', () => {
  it('has no node_modules and no package.json on its real path or above it; the nearest is named first', () => {
    const root = scratch('lookup');
    fs.mkdirSync(path.join(root, 'outer', 'node_modules'), { recursive: true });
    write(path.join(root, 'outer', 'inner', 'package.json'), '{}\n');
    fs.mkdirSync(path.join(root, 'clean'));
    expect(lookupEntriesOnPath(path.join(root, 'outer', 'inner', 'work', 'not-yet'))).toEqual([path.join(root, 'outer', 'inner', 'package.json'), path.join(root, 'outer', 'node_modules')]);
    // The directory's own entries count: the trees certified in it are below them too.
    expect(lookupEntriesOnPath(path.join(root, 'outer'))).toEqual([path.join(root, 'outer', 'node_modules')]);
    expect(hermeticProblem(path.join(root, 'clean', 'work'), 'the work dir', 'x')).toBeNull();
    expect(requireHermetic(path.join(root, 'clean', 'work'), 'the work dir', 'x')).toBe(path.join(root, 'clean', 'work'));
    expect(hermeticProblem(path.join(root, 'outer', 'inner', 'work'), 'the work dir', 'Pick another.')).toBe(`the work dir ${path.join(root, 'outer', 'inner', 'work')} is not hermetic: `
      + `${path.join(root, 'outer', 'inner', 'package.json')} and ${path.join(root, 'outer', 'node_modules')} are on its path, and TypeScript and Node look node_modules and package.json up `
      + 'from every tree certified there, so the certificate would depend on them. Pick another.');
  });

  it('is judged by its real path: a symlink can\'t bring an ancestor in, or hide one', () => {
    const root = scratch('links');
    fs.mkdirSync(path.join(root, 'tool', 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tool', 'work'));
    fs.mkdirSync(path.join(root, 'clean'));
    fs.symlinkSync(path.join(root, 'tool', 'work'), path.join(root, 'clean', 'into-tool'));
    fs.symlinkSync(path.join(root, 'clean'), path.join(root, 'tool', 'out'));
    expect(realDirectory(path.join(root, 'clean', 'into-tool', 'a', 'b'))).toBe(path.join(root, 'tool', 'work', 'a', 'b'));
    expect(lookupEntriesOnPath(path.join(root, 'clean', 'into-tool', 'a'))).toEqual([path.join(root, 'tool', 'node_modules')]);
    expect(() => requireHermetic(path.join(root, 'clean', 'into-tool', 'a'), 'the work dir', 'x')).toThrow(NotHermeticError);
    // Below the tool by its link's path, outside it by its real path.
    expect(requireHermetic(path.join(root, 'tool', 'out', 'work'), 'the work dir', 'x')).toBe(path.join(root, 'clean', 'work'));
  });

  it('is not asked of an environment checkout: only the node_modules above it are reported', () => {
    const root = scratch('environment');
    fs.mkdirSync(path.join(root, 'home', 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'home', 'immich', 'node_modules'), { recursive: true });
    write(path.join(root, 'home', 'immich', 'package.json'), '{}\n');
    write(path.join(root, 'home', 'package.json'), '{}\n');
    expect(nodeModulesAbove(path.join(root, 'home', 'immich'))).toEqual([path.join(root, 'home', 'node_modules')]);
  });
});

describe('certifying below planted node_modules', () => {
  /** A moved service that imports a package the environment lacks, under a tsconfig whose automatic @types lookup walks up. */
  const base = {
    'package.json': '{ "name": "hermetic-fixture", "private": true, "type": "module" }\n',
    'tsconfig.json': '{ "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext", "strict": true, "noEmit": true }, "include": ["src"] }\n',
    'src/services/greeter.ts': "import { shout } from 'planted-pkg';\nexport const greet = (name: string) => shout(name);\n",
    'src/main.ts': "import { greet } from './services/greeter.js';\nexport const main = () => greet('world');\n",
  };
  const head = {
    'package.json': base['package.json'],
    'tsconfig.json': base['tsconfig.json'],
    'src/modules/greeter/greeter.ts': base['src/services/greeter.ts'],
    'src/main.ts': "import { greet } from './modules/greeter/greeter.js';\nexport const main = () => greet('world');\n",
  };
  const staticChecks: CheckId[] = ['K0', 'K1', 'K2', 'K3a', 'K3b', 'K3c', 'K4', 'K6', 'K7'];

  /** `<root>/node_modules/@types/planted` and `<root>/node_modules/planted-pkg`, the way a tool's own install would hold them. */
  function plant(root: string) {
    write(path.join(root, 'node_modules', '@types', 'planted', 'package.json'), '{ "name": "@types/planted", "version": "1.0.0", "types": "index.d.ts" }\n');
    write(path.join(root, 'node_modules', '@types', 'planted', 'index.d.ts'), 'declare const planted: string;\n');
    write(path.join(root, 'node_modules', 'planted-pkg', 'package.json'), '{ "name": "planted-pkg", "version": "1.0.0", "type": "module", "exports": { ".": { "types": "./index.d.ts", "default": "./index.js" } } }\n');
    write(path.join(root, 'node_modules', 'planted-pkg', 'index.js'), 'export const shout = (text) => text.toUpperCase();\n');
    write(path.join(root, 'node_modules', 'planted-pkg', 'index.d.ts'), 'export declare const shout: (text: string) => string;\n');
    write(path.join(root, 'package.json'), '{ "name": "a-tool", "private": true, "type": "module" }\n');
  }

  const repo = twoCommits(base, head);
  scratches.push(repo.root);
  const certifyIn = (workDir: string): Promise<Certificate> => certify({
    repo: repo.root, base: repo.base, head: repo.head, packageRoot: '', environment: repo.root, profile: null, oracles: false, only: staticChecks, workDir, keep: false,
  });

  it('refuses before any check runs, names what it found, and leaves the hermetic certificate\'s digest unchanged', async () => {
    const hermetic = await certifyIn(path.join(scratch('first'), 'work'));
    expect(hermetic.verdict).toBe('pass');

    const tool = scratch('tool');
    plant(tool);
    const below = path.join(tool, 'work');
    await expect(certifyIn(below)).rejects.toThrow(`the work dir ${below} is not hermetic: ${path.join(tool, 'node_modules')} and ${path.join(tool, 'package.json')} are on its path`);
    expect(fs.existsSync(below)).toBe(false);
    // A work dir that is a link into the planted tree is refused by its real path.
    const elsewhere = scratch('link');
    fs.mkdirSync(below);
    fs.symlinkSync(below, path.join(elsewhere, 'work'));
    await expect(certifyIn(path.join(elsewhere, 'work', 'certify'))).rejects.toThrow(`the work dir ${path.join(below, 'certify')} is not hermetic`);
    expect(fs.readdirSync(below)).toEqual([]);

    const again = await certifyIn(path.join(scratch('again'), 'work'));
    expect(again.digest).toBe(hermetic.digest);
    // The certificate names the work dir by its real path, and the digest leaves it out.
    const linked = scratch('linked');
    fs.symlinkSync(scratch('target'), path.join(linked, 'work'));
    const throughLink = await certifyIn(path.join(linked, 'work', 'certify'));
    expect(throughLink.workDir).toBe(path.join(fs.realpathSync(path.join(linked, 'work')), 'certify'));
    expect(throughLink.digest).toBe(hermetic.digest);

    // Without the refusal, the planted directories reach the certificate: TypeScript's automatic @types lookup finds
    // @types/planted (K3a), and Node resolves the moved file's import of planted-pkg (K3c).
    bypass.on = true;
    let unguarded: Certificate;
    try {
      unguarded = await certifyIn(path.join(tool, 'unguarded'));
    } finally {
      bypass.on = false;
    }
    expect(unguarded.digest).not.toBe(hermetic.digest);
    const metric = (certificate: Certificate, id: CheckId, name: string) => certificate.checks.find((check) => check.id === id)!.metrics[name];
    expect([metric(hermetic, 'K3a', 'typeDirectives'), metric(unguarded, 'K3a', 'typeDirectives')]).toEqual([0, 1]);
    expect([metric(hermetic, 'K3c', 'unresolvedInBase'), metric(unguarded, 'K3c', 'unresolvedInBase')]).toEqual([3, 1]);
  }, 120_000);
});

describe('the callers refuse up front', () => {
  const nonHermetic = () => {
    const root = scratch('callers');
    fs.mkdirSync(path.join(root, 'node_modules'));
    return root;
  };

  it('`ac run`: a run directory below a node_modules, before the branch or the run directory is made; --resume too', async () => {
    const fixture = fixtureRepo();
    scratches.push(fixture.scratch);
    const root = nonHermetic();
    const runDirectory = path.join(root, 'run');
    const options = {
      repo: fixture.repo, environment: fixture.repo, profile: profileOf(), plan: { text: planYaml(fixture.base), source: 'fixture/plan.yaml', files: new Map<string, string>(), recordedCostUsd: null },
      cost: { budgetRun: null, mode: null, llmUsd: 0 }, runDirectory, branch: 'ac/hermetic', rungs: ['R0', 'R1'] as RungId[], maxSteps: null, jobs: 1, injectFault: null, log: () => {},
    };
    await expect(startRun(options)).rejects.toThrow(`the run directory ${runDirectory} is not hermetic: ${path.join(root, 'node_modules')} is on its path`);
    expect(fs.existsSync(runDirectory)).toBe(false);
    await expect(startRun(options)).rejects.toThrow('Pick an --out with neither on its path.');
    await expect(resumeRun({ runDirectory, maxSteps: null, log: () => {} })).rejects.toThrow('Move the run directory where neither is on its path, and resume it there.');
  });

  it('the baseline and the mutation harness', async () => {
    const root = nonHermetic();
    await expect(runBaseline({ repo: root, commit: 'HEAD', packageRoot: '', environment: root, profile: profileOf([]), runs: 1, workDir: path.join(root, 'baseline') }))
      .rejects.toThrow(`the baseline's work dir ${path.join(root, 'baseline')} is not hermetic`);
    await expect(runHarness({ subjects: [], hunt: [], cap: 1, checks: ['K0'], staged: true, workDir: path.join(root, 'mutation'), quiet: true, log: () => {} }))
      .rejects.toThrow(NotHermeticError);
    expect(fs.readdirSync(root)).toEqual(['node_modules']);
  });
});

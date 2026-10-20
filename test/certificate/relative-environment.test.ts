// H1: the environment checkout spelled as a relative path. The shadow root links `<dir>/node_modules` to the checkout's,
// and a relative link target resolves against the link's own directory, not the cwd: unresolved, `ac certify .` linked
// node_modules to itself (K0 and K3a crashed with ELOOP), and `ac certify ../repo` linked nothing that exists (K3a ran
// without the installed packages while the certificate said they were linked). The certificate must not depend on how
// the path was spelled.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { certify } from '../../src/certificate/certify.js';
import { createEnvironment } from '../../src/certificate/commit-fs.js';
import { readCommitTree } from '../../src/certificate/git-tree.js';
import type { Certificate, CheckId } from '../../src/certificate/types.js';
import { twoCommits } from './two-commit-repo.js';

const scratches: string[] = [];
afterAll(() => {
  for (const directory of scratches) fs.rmSync(directory, { recursive: true, force: true });
});
const scratch = () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-relative-environment-')));
  scratches.push(directory);
  return directory;
};

/** A moved service importing a package installed (untracked) in the checkout, which also holds an @types package. */
const base = {
  'package.json': '{ "name": "relative-environment", "private": true, "type": "module" }\n',
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
const installed = {
  'node_modules/@types/planted/package.json': '{ "name": "@types/planted", "version": "1.0.0", "types": "index.d.ts" }\n',
  'node_modules/@types/planted/index.d.ts': 'declare const planted: string;\n',
  'node_modules/planted-pkg/package.json': '{ "name": "planted-pkg", "version": "1.0.0", "type": "module", "exports": { ".": { "types": "./index.d.ts", "default": "./index.js" } } }\n',
  'node_modules/planted-pkg/index.js': 'export const shout = (text) => text.toUpperCase();\n',
  'node_modules/planted-pkg/index.d.ts': 'export declare const shout: (text: string) => string;\n',
};
const staticChecks: CheckId[] = ['K0', 'K1', 'K2', 'K3a', 'K3b', 'K3c', 'K4', 'K6', 'K7'];
const metric = (certificate: Certificate, id: CheckId, name: string) => certificate.checks.find((check) => check.id === id)!.metrics[name];

describe('a relative environment checkout', () => {
  const repo = twoCommits(base, head, installed);
  scratches.push(repo.root);
  const certifyFrom = (repository: string, environment: string) => certify({
    repo: repository, base: repo.base, head: repo.head, packageRoot: '', environment, profile: null, oracles: false, only: staticChecks, workDir: path.join(scratch(), 'work'), keep: false,
  });

  it('is linked by its absolute path: the shadow root reaches the installed packages', () => {
    const shadowRoot = path.join(scratch(), 'shadow');
    const environment = createEnvironment(path.relative(process.cwd(), repo.root), [readCommitTree(repo.root, repo.base)], shadowRoot);
    expect(environment.checkout).toBe(repo.root);
    expect(environment.linked).toEqual(['']);
    expect(fs.readlinkSync(path.join(shadowRoot, 'node_modules'))).toBe(path.join(repo.root, 'node_modules'));
    expect(fs.existsSync(path.join(shadowRoot, 'node_modules', 'planted-pkg', 'index.d.ts'))).toBe(true);
  });

  it('gives the certificate an absolute path gives: relative repo, relative --env, and `.` from inside the checkout', async () => {
    const absolute = await certifyFrom(repo.root, repo.root);
    expect(absolute.verdict).toBe('pass');
    expect(metric(absolute, 'K3a', 'typeDirectives')).toBe(1);

    const relative = path.relative(process.cwd(), repo.root);
    const relativeRepo = await certifyFrom(relative, relative);
    expect(relativeRepo.environment).toEqual(absolute.environment);
    expect(relativeRepo.digest).toBe(absolute.digest);
    expect((await certifyFrom(repo.root, relative)).digest).toBe(absolute.digest);

    const cwd = process.cwd();
    process.chdir(repo.root);
    let here: Certificate;
    try {
      here = await certifyFrom('.', '.');
    } finally {
      process.chdir(cwd);
    }
    expect(here.checks.filter((check) => check.status === 'error').map((check) => check.summary)).toEqual([]);
    expect(here.digest).toBe(absolute.digest);
  }, 120_000);
});

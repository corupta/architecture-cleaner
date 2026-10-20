// R2: the re-wrap loads what a prettier config names from where prettier run in the file's package would: plugins by
// a bare name from that package's directory (prettier 3 resolves them from its working directory, never the tool's),
// a shared config from the config file's directory, in a checkout whose node_modules are the environment's (the
// rung's checkout has none). A plugin or shared config the environment lacks skips the file with the reason.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { pluginsFrom } from '../../src/rewrap/prettier.js';
import { planRewrap } from '../../src/rewrap/rewrap.js';
import { type Tree, twoCommits } from '../certificate/two-commit-repo.js';

const scratches: string[] = [];
afterAll(() => {
  for (const directory of scratches) fs.rmSync(directory, { recursive: true, force: true });
});
const scratch = (prefix: string) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratches.push(directory);
  return directory;
};

/** A CommonJS package that appends to `loads` beside it whenever it is loaded. */
const loggingPackage = (name: string, exported: string) => ({
  [`${name}/package.json`]: `${JSON.stringify({ name, main: 'index.js' })}\n`,
  [`${name}/index.js`]: `require('node:fs').appendFileSync(require('node:path').join(__dirname, 'loads'), '1');\nmodule.exports = ${exported};\n`,
});

/** An environment: this package's prettier in its root node_modules, and `packages` by node_modules directory. */
function environment(packages: Record<string, Record<string, string>> = {}): string {
  const directory = scratch('ac-rewrap-env-');
  fs.mkdirSync(path.join(directory, 'node_modules'));
  fs.symlinkSync(path.resolve('node_modules/prettier'), path.join(directory, 'node_modules', 'prettier'));
  for (const [modules, files] of Object.entries(packages)) {
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(directory, modules, file)), { recursive: true });
      fs.writeFileSync(path.join(directory, modules, file), text);
    }
  }
  return directory;
}

const letters = 'export const alpha = 1;\nexport const beta = 2;\nexport const gamma = 3;\n';
const short = "import { alpha, beta, gamma } from './letters';\n";
const moved = "import { alpha, beta, gamma } from './modules/letters/letters';\n";
const wrapped = "import {\n  alpha,\n  beta,\n  gamma,\n} from './modules/letters/letters';\n";
const use = 'export const all = [alpha, beta, gamma];\n';
const options = { singleQuote: true, trailingComma: 'all', printWidth: 60, semi: true };

/** The moves under `directory` ('' for the root), with `config` beside them: the repo's own checkout, no node_modules. */
function repoOf(directory: string, config: Tree) {
  const at = (file: string) => (directory ? `${directory}/${file}` : file);
  const both = { 'package.json': '{ "name": "root" }\n', ...Object.fromEntries(Object.entries(config).map(([file, text]) => [at(file), text])) };
  const repo = twoCommits({ ...both, [at('src/all.ts')]: `${short}${use}`, [at('src/letters.ts')]: letters }, { ...both, [at('src/all.ts')]: `${moved}${use}`, [at('src/modules/letters/letters.ts')]: letters });
  scratches.push(repo.root);
  return repo;
}

const plan = (repo: ReturnType<typeof repoOf>, environmentDirectory: string) =>
  planRewrap({ repo: repo.root, base: repo.base, head: repo.head, checkout: repo.root, environment: environmentDirectory, packageRoot: '' });

describe('the re-wrap\'s prettier config, as prettier run in the file\'s package reads it', () => {
  it('loads a plugin the config names from the file\'s package directory in the environment, whatever the working directory', async () => {
    const repo = repoOf('server', { 'package.json': '{ "name": "server" }\n', '.prettierrc': `${JSON.stringify({ ...options, plugins: ['prettier-plugin-fake'] })}\n` });
    const installed = environment({ 'server/node_modules': loggingPackage('prettier-plugin-fake', '{ languages: [] }') });
    const result = await plan(repo, installed);
    expect(result.skips).toEqual([]);
    expect(result.files).toEqual(new Map([['server/src/all.ts', `${wrapped}${use}`]]));
    expect(fs.existsSync(path.join(installed, 'server/node_modules/prettier-plugin-fake/loads'))).toBe(true);
  });

  it('reads a shared config package.json names from the environment\'s packages, though the checkout has no node_modules', async () => {
    const repo = repoOf('', { 'package.json': '{ "name": "root", "prettier": "fake-prettier-config" }\n' });
    const installed = environment({ node_modules: loggingPackage('fake-prettier-config', JSON.stringify(options)) });
    const result = await plan(repo, installed);
    expect(result.skips).toEqual([]);
    expect(result.files).toEqual(new Map([['src/all.ts', `${wrapped}${use}`]]));
    expect(fs.existsSync(path.join(installed, 'node_modules/fake-prettier-config/loads'))).toBe(true);
    // Read in a temporary worktree of head with the environment's node_modules linked, removed afterwards.
    expect(execFileSync('git', ['-C', repo.root, 'worktree', 'list'], { encoding: 'utf8' }).trim().split('\n')).toHaveLength(1);
  });

  it('skips the file, with the reason, when the environment lacks a plugin or the shared config its config names', async () => {
    const plugin = await plan(repoOf('', { '.prettierrc': `${JSON.stringify({ ...options, plugins: ['prettier-plugin-missing'] })}\n` }), environment());
    expect(plugin.files.size).toBe(0);
    expect(plugin.skips).toEqual([{ file: 'src/all.ts', reason: 'its prettier config can\'t be loaded: the plugin "prettier-plugin-missing" can\'t be resolved from the repository root' }]);
    const shared = await plan(repoOf('', { 'package.json': '{ "name": "root", "prettier": "missing-prettier-config" }\n' }), environment());
    expect(shared.files.size).toBe(0);
    expect(shared.skips).toEqual([{ file: 'src/all.ts', reason: expect.stringMatching(/^its prettier config can't be loaded: Cannot find (package|module) 'missing-prettier-config'/) }]);
    expect(shared.skips[0]!.reason).not.toContain(os.tmpdir());
  });
});

describe('pluginsFrom', () => {
  it('resolves a bare name as prettier\'s working directory would: a file there by that name, else a package; leaves paths and objects', () => {
    const directory = environment({ node_modules: loggingPackage('prettier-plugin-fake', '{}') });
    fs.writeFileSync(path.join(directory, 'local-plugin.mjs'), 'export const languages = [];\n');
    const object = { languages: [] };
    expect(pluginsFrom(directory, '', ['prettier-plugin-fake', 'local-plugin.mjs', '/elsewhere/plugin.mjs', 'file:///elsewhere/plugin.mjs', object])).toEqual([
      path.join(fs.realpathSync(directory), 'node_modules/prettier-plugin-fake/index.js'), path.join(directory, 'local-plugin.mjs'), '/elsewhere/plugin.mjs', 'file:///elsewhere/plugin.mjs', object,
    ]);
    expect(() => pluginsFrom(directory, '', ['prettier-plugin-missing'])).toThrow('the plugin "prettier-plugin-missing" can\'t be resolved from the repository root');
    fs.mkdirSync(path.join(directory, 'server'));
    expect(pluginsFrom(directory, 'server', ['prettier-plugin-fake'])).toEqual([path.join(fs.realpathSync(directory), 'node_modules/prettier-plugin-fake/index.js')]);
    expect(() => pluginsFrom(directory, 'server', ['prettier-plugin-missing'])).toThrow('the plugin "prettier-plugin-missing" can\'t be resolved from server');
  });
});

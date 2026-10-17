// Which runtimes load a package and which alias layer each applies, read from the committed tree.
import { describe, expect, it } from 'vitest';
import type { CommitTree } from '../../src/certificate/git-tree.js';
import { detectRuntimes, shellCommands } from '../../src/certificate/runtime-mechanism.js';
import { spanViews } from '../../src/certificate/spans.js';

function treeOf(files: Record<string, string>): CommitTree {
  const entries = new Map(Object.keys(files).map((file) => [file, { path: file, mode: '100644', oid: file }]));
  const directories = new Set(['']);
  for (const file of Object.keys(files)) for (let slash = file.lastIndexOf('/'); slash > 0; slash = file.lastIndexOf('/', slash - 1)) directories.add(file.slice(0, slash));
  return { commit: 'fake', tree: 'fake', entries, directories, bytes: (file) => (files[file] === undefined ? undefined : Buffer.from(files[file]!)), text: (file) => files[file], prefetch() {} };
}
function detect(files: Record<string, string>, packageRoot = '') {
  const tree = treeOf(files);
  const detection = detectRuntimes(tree, packageRoot, spanViews(tree));
  return { ids: detection.runtimes.map((runtime) => runtime.id), runtimes: detection.runtimes, unsupported: detection.unsupported.map((entry) => entry.mechanism), subpathImports: detection.subpathImports };
}
const manifest = (fields: object) => JSON.stringify({ name: 'target', version: '1.0.0', ...fields });

describe('runtime mechanism detection', () => {
  it('splits shell lines into commands and keeps quoted arguments whole', () => {
    expect(shellCommands(`cross-env A=1 node -r tsconfig-paths/register dist/main.js && concurrently "pnpm a" 'pnpm b'; echo x|cat`)).toEqual([
      ['cross-env', 'A=1', 'node', '-r', 'tsconfig-paths/register', 'dist/main.js'],
      ['concurrently', 'pnpm a', 'pnpm b'],
      ['echo', 'x'],
      ['cat'],
    ]);
  });

  it('finds the Nest CLI build (immich): nest start, nest build and the start script that runs dist/main.js', () => {
    const { ids, runtimes, unsupported } = detect({
      'server/package.json': manifest({ type: 'module', scripts: { build: 'nest build', start: 'pnpm run start:dev', 'start:dev': 'nest start --watch --', test: 'vitest --config test/vitest.config.mjs' } }),
      'server/nest-cli.json': JSON.stringify({ sourceRoot: 'src', compilerOptions: { deleteOutDir: false } }),
      'server/tsconfig.json': '{}',
      'server/tsconfig.build.json': '{ "extends": "./tsconfig.json" }',
      'server/bin/start.sh': '#!/usr/bin/env bash\nexec node --no-warnings "${SERVER_HOME}/dist/main.js" "$@"\n',
      'web/package.json': manifest({ scripts: { start: 'node build/index.js' } }),
    }, 'server');
    expect(ids).toEqual(['nest-cli/emit']);
    expect(runtimes[0]).toMatchObject({ loader: 'node', loads: 'emit', build: 'nest-cli', tsconfig: 'tsconfig.build.json' });
    expect(runtimes[0]!.evidence).toContain('server/bin/start.sh: exec node --no-warnings "${SERVER_HOME}/dist/main.js" "$@"');
    expect(unsupported).toEqual([]);
  });

  it('finds tsx for the start script and plain Node for the Docker entry (openhab-cloud); test runners are not runtimes', () => {
    const { ids } = detect({
      'package.json': manifest({ scripts: { start: 'tsx src/app.ts', build: 'tsc', test: 'mocha --require tsx tests/mocha/unit/**/*.ts --recursive' } }),
      'Dockerfile': 'FROM node:22\nRUN npm run build\nCMD ["./run-app.sh"]\n',
      'run-app.sh': '#!/bin/sh -e\nexec node dist/app.js\n',
    });
    expect(ids).toEqual(['node/emit', 'tsx/source']);
  });

  it("follows script references and ignores commands after `cd` into another package (mcphub's frontend)", () => {
    const { ids, unsupported } = detect({
      'package.json': manifest({ type: 'module', scripts: {
        build: 'pnpm backend:build && pnpm frontend:build', 'backend:build': 'tsc', 'frontend:build': 'cd frontend && vite build',
        start: 'node dist/index.js', cli: 'tsx src/cli/main.ts', dev: 'concurrently "pnpm backend:dev" "pnpm frontend:dev"', 'backend:dev': 'node scripts/dev-backend.js', 'frontend:dev': 'cd frontend && vite',
        'frontend:typecheck': 'tsc --noEmit -p frontend/tsconfig.json', test: 'jest',
      } }),
    });
    expect(ids).toEqual(['node/emit', 'tsx/source']);
    expect(unsupported).toEqual([]);
  });

  it('records the tsconfig-paths and ts-node layers and the program tsc builds', () => {
    expect(detect({ 'package.json': manifest({ scripts: { dev: 'ts-node -r tsconfig-paths/register src/main.ts', build: 'tsc -p tsconfig.build.json', start: 'node -r tsconfig-paths/register dist/main.js' } }) }).runtimes
      .map(({ id, tsconfig }) => [id, tsconfig])).toEqual([['node/emit+tsconfig-paths', 'tsconfig.build.json'], ['ts-node/source+tsconfig-paths', 'tsconfig.json']]);
    expect(detect({ 'package.json': manifest({ scripts: { dev: 'nodemon --exec "ts-node" src/main.ts' } }), 'tsconfig.json': JSON.stringify({ 'ts-node': { require: ['tsconfig-paths/register'] } }) }).ids)
      .toEqual(['ts-node/source+tsconfig-paths']);
    expect(detect({ 'package.json': manifest({ scripts: { start: 'node --import tsx src/main.ts' } }) }).ids).toEqual(['tsx/source']);
    expect(detect({ 'package.json': manifest({ scripts: { start: 'node -C development --env-file .env dist/main.js' } }) }).runtimes.map(({ id, conditions }) => [id, conditions]))
      .toEqual([['node/emit[development]', ['development']]]);
  });

  it('finds module-alias registered in code with _moduleAliases, and a Dockerfile exec-form CMD', () => {
    const { ids } = detect({
      'package.json': manifest({ dependencies: { 'module-alias': '^2' }, _moduleAliases: { '@app': 'src' } }),
      'Dockerfile': 'FROM node\nCMD ["node", "dist/main.js"]\n',
      'src/main.ts': "import 'module-alias/register';\nimport { x } from '@app/x';\nexport const main = x;\n",
    });
    expect(ids).toEqual(['node/emit+module-alias']);
  });

  it('reads the environment a launch inherits: NODE_OPTIONS flags, NODE_PATH, through npm scripts, export and Dockerfile ENV', () => {
    const scripts = (start: string) => detect({ 'package.json': manifest({ scripts: { build: 'tsc', start, serve: 'NODE_PATH=dist npm start' } }) });
    expect(scripts('node dist/main.js').runtimes.map(({ id, nodePath }) => [id, nodePath])).toEqual([['node/emit', []], ['node/emit{NODE_PATH=dist}', ['dist']]]);
    expect(scripts('cross-env NODE_OPTIONS="-r tsconfig-paths/register --conditions=development" node dist/main.js').ids)
      .toEqual(['node/emit+tsconfig-paths[development]', 'node/emit+tsconfig-paths[development]{NODE_PATH=dist}']);
    expect(detect({ 'package.json': manifest({}), 'bin/start.sh': '#!/bin/sh\nexport NODE_PATH=./dist/\nexec node dist/main.js\n' }).ids).toEqual(['node/emit{NODE_PATH=dist}']);
    expect(detect({ 'package.json': manifest({}), Dockerfile: 'FROM node\nENV NODE_OPTIONS --conditions=production\nCMD ["node", "dist/main.js"]\n' }).ids).toEqual(['node/emit[production]']);
    expect(detect({ 'package.json': manifest({}), Dockerfile: 'FROM node\nENV NODE_PATH=/app/dist\nCMD ["node", "dist/main.js"]\n' }))
      .toMatchObject({ ids: ['node/emit'], unsupported: ['NODE_PATH with an absolute or computed directory'] });
    expect(detect({ 'package.json': manifest({ scripts: { start: 'TS_NODE_PROJECT=tsconfig.app.json ts-node -r tsconfig-paths/register src/main.ts' } }) }).unsupported)
      .toEqual(['TS_NODE_PROJECT (the runtime reads another tsconfig or baseUrl)']);
  });

  it('reads the tracked env files node --env-file and dotenv-cli load; the inherited environment wins', () => {
    const files = { '.env.production': 'NODE_PATH=dist\nexport NODE_OPTIONS="--conditions=production"\n', '.env': '# local\nNODE_PATH=build\n' };
    expect(detect({ ...files, 'package.json': manifest({ scripts: { start: 'node --env-file=.env.production dist/main.js' } }) }).ids).toEqual(['node/emit[production]{NODE_PATH=dist}']);
    expect(detect({ ...files, 'package.json': manifest({ scripts: { start: 'NODE_PATH=lib node --env-file .env.production dist/main.js' } }) }).ids).toEqual(['node/emit[production]{NODE_PATH=lib}']);
    expect(detect({ ...files, 'package.json': manifest({ scripts: { start: 'dotenv -- node dist/main.js', prod: 'dotenv -e .env.production -v NODE_OPTIONS= -- node dist/main.js' } }) }).ids)
      .toEqual(['node/emit{NODE_PATH=build}', 'node/emit{NODE_PATH=dist}']);
  });

  it("reads a pm2 ecosystem file's apps: script, interpreter, node_args and every env block", () => {
    const ecosystem = "module.exports = {\n  apps: [\n    { name: 'api', script: 'dist/main.js', node_args: '-r tsconfig-paths/register', env: { NODE_ENV: 'production' }, env_staging: { NODE_PATH: 'dist' } },\n    { name: 'worker', script: 'src/worker.ts', interpreter: 'tsx' },\n  ],\n};\n";
    expect(detect({ 'package.json': manifest({ scripts: { start: 'pm2-runtime start ecosystem.config.js --env staging' } }), 'ecosystem.config.js': ecosystem }).ids)
      .toEqual(['node/emit+tsconfig-paths', 'node/emit+tsconfig-paths{NODE_PATH=dist}', 'tsx/source']);
    expect(detect({ 'package.json': manifest({ scripts: { start: 'pm2 start ecosystem.config.js' } }), 'ecosystem.config.js': "module.exports = { apps: [{ script: 'dist/main.js', env: { NODE_PATH: process.env.NODE_PATH } }] };\n" }).unsupported)
      .toEqual(['pm2 ecosystem file that is not a literal apps list']);
  });

  it('lists the mechanisms it does not model', () => {
    expect(detect({ 'package.json': manifest({ scripts: { build: 'tsc && tsc-alias', start: 'node dist/main.js' } }) }).unsupported).toEqual(['tsc-alias']);
    expect(detect({ 'package.json': manifest({ scripts: { build: 'webpack --mode production', start: 'node dist/main.js' } }) })).toMatchObject({ ids: [], unsupported: ['bundler or transpiler (webpack)', 'Node on a bundle (webpack)'] });
    expect(detect({ 'package.json': manifest({ scripts: { build: 'nest build' } }), 'nest-cli.json': JSON.stringify({ compilerOptions: { builder: 'swc' } }) }).unsupported).toEqual(['Nest CLI swc builder']);
    expect(detect({ 'package.json': manifest({ scripts: { start: 'node --loader ts-node/esm src/main.ts' } }) }).unsupported).toEqual(['ts-node ESM loader']);
    expect(detect({ 'package.json': manifest({}), 'src/main.ts': "import { register } from 'tsconfig-paths';\nregister({ baseUrl: '.', paths: {} });\n" }).unsupported).toEqual(['programmatic tsconfig-paths registration']);
  });

  it("treats node running a test runner's CLI as that runner (hoppscotch's test:debug), not as a runtime", () => {
    const scripts = {
      build: 'nest build', start: 'nest start', 'start:prod': 'node dist/main',
      'test:debug': 'node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInBand',
      'test:cli': 'node ./node_modules/jest/bin/jest.js', 'test:mocha': 'NODE_OPTIONS="-r ts-node/register" node node_modules/mocha/bin/_mocha', 'test:vitest': 'node node_modules/.bin/vitest run',
    };
    expect(detect({ 'package.json': manifest({ scripts }), 'nest-cli.json': '{}', 'tsconfig.json': '{}' })).toMatchObject({ ids: ['nest-cli/emit'], unsupported: [] });
    // The same layers in front of the app's own entry are a runtime.
    expect(detect({ 'package.json': manifest({ scripts: { ...scripts, 'start:prod': 'node -r tsconfig-paths/register -r ts-node/register dist/main' } }), 'nest-cli.json': '{}', 'tsconfig.json': '{}' }).ids)
      .toEqual(['nest-cli/emit', 'nest-cli/emit+tsconfig-paths']);
    expect(detect({ 'package.json': manifest({ scripts: { start: 'node node_modules/my-server/bin/serve.js' } }) }).ids).toEqual(['node/emit']);
  });

  const kaneoViteConfig = [
    'import { defineConfig } from "vite-plus";', '', 'export default defineConfig({', '  run: {', '    tasks: {',
    '      compile: {', '        command: "esbuild src/index.ts --bundle --platform=node --outdir=dist --format=esm --packages=external",',
    '        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],', '        cache: { input: [{ auto: true }, ".env*"], output: ["dist/**"] },', '      },',
    '      "check:types": { command: "tsc --noEmit -p tsconfig.json" },', '      "test:run": "vp test run --config vitest.config.ts",', '    },', '  },', '});', '',
  ].join('\n');
  const kaneo = (fields: object = {}, config = kaneoViteConfig) => ({
    'apps/api/package.json': manifest({
      type: 'module', main: './dist/index.js', scripts: { dev: 'tsx watch src/index.ts', build: 'vp run compile', typecheck: 'vp run check:types', test: 'vp run test:run', 'test:watch': 'vp test' }, ...fields,
    }),
    'apps/api/vite.config.ts': config,
    'apps/api/Dockerfile': 'FROM node:24 AS runtime\nWORKDIR /app/apps/api\nCMD ["node", "--enable-source-maps", "dist/index.js"]\n',
  });

  it("reads vite-plus tasks (kaneo): node on the esbuild bundle `vp run compile` builds is a launch it doesn't model, never Node on tsc's output", () => {
    const { ids, runtimes, unsupported } = detect(kaneo(), 'apps/api');
    expect(ids).toEqual(['tsx/source']);
    expect(unsupported).toEqual(['bundler or transpiler (esbuild)', 'Node on a bundle (esbuild)']);
    const tree = treeOf(kaneo());
    const launch = detectRuntimes(tree, 'apps/api', spanViews(tree)).unsupported.find((entry) => entry.launch)!;
    expect(launch.evidence).toBe('apps/api/Dockerfile: CMD ["node", "--enable-source-maps", "dist/index.js"]; built by package.json scripts.build: vp run compile -> apps/api/vite.config.ts run.tasks.compile: esbuild src/index.ts --bundle --platform=node --outdir=dist --format=esm --packages=external');
    expect(runtimes[0]!.evidence).toEqual(['package.json scripts.dev: tsx watch src/index.ts']);
  });

  it('still models Node on what tsc builds: a transpiler, esbuild without --bundle, or a bundle written elsewhere next to a tsc build', () => {
    const start = { start: 'node dist/main.js' };
    expect(detect({ 'package.json': manifest({ scripts: { ...start, build: 'swc src -d dist' } }) })).toMatchObject({ ids: ['node/emit'], unsupported: ['bundler or transpiler (swc)'] });
    expect(detect({ 'package.json': manifest({ scripts: { ...start, build: 'esbuild src/*.ts --outdir=dist' } }) })).toMatchObject({ ids: ['node/emit'], unsupported: ['bundler or transpiler (esbuild)'] });
    expect(detect({ 'package.json': manifest({ scripts: { ...start, build: 'tsc && esbuild src/worker.ts --bundle --outfile=public/worker.js' } }) }))
      .toMatchObject({ ids: ['node/emit'], unsupported: ['bundler or transpiler (esbuild)'] });
    // A committed script runs as committed, whatever a frontend bundler next to it builds.
    expect(detect({ 'package.json': manifest({ scripts: { start: 'node server.js', 'build:client': 'webpack --config client.config.js' } }), 'server.js': "require('./lib/app');\n" }))
      .toMatchObject({ ids: ['node/emit'], unsupported: ['bundler or transpiler (webpack)'] });
    // The bundle's own output holds the launched file: a tsc build next to it doesn't make Node run tsc's output.
    expect(detect({ 'package.json': manifest({ scripts: { ...start, build: 'tsc --outDir build && esbuild src/main.ts --bundle --outfile=dist/main.js' } }) }))
      .toMatchObject({ ids: [], unsupported: ['bundler or transpiler (esbuild)', 'Node on a bundle (esbuild)'] });
  });

  it('follows the other vite-plus commands: vp build bundles, vp test is a runner, a script wins over a task, other packages are skipped', () => {
    const vite = (scripts: Record<string, string>, config = kaneoViteConfig) => detect({ 'package.json': manifest({ scripts }), 'vite.config.ts': config });
    expect(vite({ build: 'vp build', start: 'node dist/main.js' })).toMatchObject({ ids: [], unsupported: ['bundler or transpiler (vp build)', 'Node on a bundle (vp build)'] });
    expect(vite({ test: 'vp test', start: 'vpr serve', serve: 'node dist/main.js', compile: 'tsc' })).toMatchObject({ ids: ['node/emit'], unsupported: [] });
    expect(vite({ build: 'vp run compile', compile: 'tsc', start: 'vp node dist/main.js' })).toMatchObject({ ids: ['node/emit'], unsupported: [] });
    expect(vite({ build: 'vp run -r compile', start: 'node dist/main.js' })).toMatchObject({ ids: ['node/emit'], unsupported: [] });
    expect(vite({ build: 'vp run compile', start: 'node dist/main.js' }, 'export default defineConfig(() => ({ run: { tasks: {} } }));\n'))
      .toMatchObject({ ids: ['node/emit'], unsupported: ['vite-plus task in a vite.config that is not a literal'] });
    expect(vite({ build: 'vp run compile', start: 'node dist/main.js' }, 'export default { run: { tasks: { compile: { command: ["tsc", "esbuild src/main.ts --bundle --outdir=dist"], cwd: "." } } } };\n'))
      .toMatchObject({ ids: [], unsupported: ['bundler or transpiler (esbuild)', 'Node on a bundle (esbuild)'] });
    expect(vite({ build: 'vp run compile', start: 'node dist/main.js' }, 'export default { run: { tasks: { compile: { command: "esbuild src/main.ts --bundle --outdir=dist", cwd: "../web" } } } };\n'))
      .toMatchObject({ ids: ['node/emit'], unsupported: [] });
  });

  it("treats a bundled library's consumers and Nest's webpack builder the same way", () => {
    expect(detect({ 'package.json': manifest({ main: 'dist/index.js', scripts: { build: 'tsup src/index.ts' } }) })).toMatchObject({ ids: [], unsupported: ['bundler or transpiler (tsup)', 'Node on a bundle (tsup)'] });
    expect(detect({ 'package.json': manifest({ scripts: { build: 'nest build', start: 'nest start' } }), 'nest-cli.json': JSON.stringify({ compilerOptions: { webpack: true } }) }))
      .toMatchObject({ ids: [], unsupported: ['Nest CLI webpack builder', 'Nest CLI webpack builder', 'Node on a bundle (Nest CLI webpack)'] });
  });

  it('models a library as plain Node on its emitted JavaScript, and notes subpath imports', () => {
    const { ids, runtimes, subpathImports } = detect({ 'package.json': manifest({ main: 'dist/index.js', imports: { '#lib/*': './dist/lib/*.js' } }) });
    expect(ids).toEqual(['node/emit']);
    expect(runtimes[0]!.evidence).toEqual(['package.json main: consumers load the emitted JavaScript']);
    expect(subpathImports).toBe(true);
  });

  it('assumes plain Node on the emitted JavaScript when nothing in the tree launches the package', () => {
    const { runtimes } = detect({ 'package.json': manifest({ scripts: { test: 'jest', typecheck: 'tsc --noEmit' } }) });
    expect(runtimes).toEqual([expect.objectContaining({ id: 'node/emit (assumed)', loader: 'node', loads: 'emit', hooks: [], assumed: true, tsconfig: 'tsconfig.json' })]);
    expect(detect({ 'tsconfig.json': '{}', 'src/a.ts': 'export const a = 1;\n' }).ids).toEqual(['node/emit (assumed)']);
    expect(detect({ 'package.json': manifest({ scripts: { build: 'webpack' } }) })).toMatchObject({ ids: ['node/emit (assumed)'], unsupported: ['bundler or transpiler (webpack)'] });
    const tree = treeOf({ 'tsconfig.json': '{ "compilerOptions": { "noEmit": true } }' });
    expect(detectRuntimes(tree, '', spanViews(tree), (tsconfig) => tsconfig !== 'tsconfig.json').runtimes.map(({ id, loads }) => [id, loads]))
      .toEqual([['node/emit (assumed)', 'emit'], ['node/source (assumed)', 'source']]);
  });
});

// A small known-good result written for operator coverage: the sites no fixture or real target has, so every
// operator gets at least one instance. A virtual jest.mock of a moved module (M4), a __dirname user (M14), a
// .d.ts/.js pair (M18), an entry point named by package.json and a Dockerfile (M21), a package import under baseUrl
// (M28). One move, src/services/user.service.ts → src/modules/user/user.service.ts, with its two importers rewritten.
import fs from 'node:fs';
import path from 'node:path';
import { materializePair, runnerNodeModules } from './harness.js';
import type { SubjectSpec } from './subject.js';

const shared: Record<string, string> = {
  'package.json': `${JSON.stringify({ name: 'mutation-coverage', private: true, main: 'dist/server.js', scripts: { start: 'node dist/server.js', test: 'jest' } }, null, 2)}\n`,
  Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY dist ./dist\nCMD ["node", "dist/server.js"]\n',
  'jest.config.js': "module.exports = {\n  preset: 'ts-jest',\n  testEnvironment: 'node',\n  roots: ['<rootDir>/src'],\n};\n",
  'tsconfig.json': `${JSON.stringify({
    compilerOptions: { target: 'es2022', module: 'commonjs', moduleResolution: 'node', baseUrl: '.', rootDir: 'src', outDir: 'dist', types: [], strict: true },
    include: ['src', 'types'],
  }, null, 2)}\n`,
  'types/globals.d.ts': [
    'declare const __dirname: string;',
    'declare const jest: { mock(path: string, factory?: () => unknown, options?: { virtual?: boolean }): void };',
    'declare function describe(name: string, body: () => void): void;',
    'declare function it(name: string, body: () => void): void;',
    'declare function expect(actual: unknown): { toBe(expected: unknown): void };',
    "declare module 'events' { export class EventEmitter { emit(name: string): boolean } }",
    '',
  ].join('\n'),
  'src/templates/render.ts': "export const templateDirectory = __dirname + '/views';\n\nexport function render(name: string): string {\n  return `${templateDirectory}/${name}.html`;\n}\n",
  'src/legacy/format.js': "exports.format = function format(text) {\n  return text.trim();\n};\n",
  'src/legacy/format.d.ts': 'export declare function format(text: string): string;\n',
};

const service = "export function greet(name: string): string {\n  return `hello ${name}`;\n}\n";
const server = (servicePath: string) => [
  "import { EventEmitter } from 'events';",
  `import { greet } from '${servicePath}';`,
  "import { render } from './templates/render';",
  "import { format } from './legacy/format';",
  '',
  'export const events = new EventEmitter();',
  '',
  'export function start(name: string): string {',
  "  events.emit('start');",
  "  return format(greet(name)) + render('index');",
  '}',
  '',
].join('\n');
const serverTest = (servicePath: string) => [
  "import { start } from './server';",
  '',
  `jest.mock('${servicePath}', () => ({ greet: () => 'mocked' }), { virtual: true });`,
  '',
  "describe('start', () => {",
  "  it('greets through the mock', () => {",
  "    expect(start('a').startsWith('mocked')).toBe(true);",
  '  });',
  '});',
  '',
].join('\n');

export const coverageTrees: Record<'before' | 'after', Record<string, string>> = {
  before: { ...shared, 'src/services/user.service.ts': service, 'src/server.ts': server('./services/user.service'), 'src/server.test.ts': serverTest('./services/user.service') },
  after: { ...shared, 'src/modules/user/user.service.ts': service, 'src/server.ts': server('./modules/user/user.service'), 'src/server.test.ts': serverTest('./modules/user/user.service') },
};

function writeTree(directory: string, tree: Record<string, string>): void {
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [file, content] of Object.entries(tree)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
  }
}

export function coverageSubject(): SubjectSpec {
  return {
    name: 'synthetic:coverage',
    target: 'synthetic',
    packageRoot: '',
    profile: null,
    prepare(workDir) {
      const trees = path.join(workDir, 'trees', 'coverage');
      writeTree(path.join(trees, 'before'), coverageTrees.before);
      writeTree(path.join(trees, 'after'), coverageTrees.after);
      const nodeModules = runnerNodeModules('jest');
      return materializePair(path.join(workDir, 'repos', 'synthetic-coverage'), path.join(trees, 'before'), path.join(trees, 'after'), nodeModules ? { nodeModules } : {});
    },
  };
}

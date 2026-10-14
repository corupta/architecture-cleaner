// Stand-ins for a target's own tools (a typecheck, a test runner, an artifact producer) as node scripts tracked in a
// tiny repo, with the oracle specs that run them and a base tree with its pure move.
import type { OracleSpec } from '../../src/certificate/profile.js';
import type { Tree } from './two-commit-repo.js';

// A typecheck stand-in: every src file containing 'ERROR' yields a tsc-format diagnostic; exits 2 if any.
export const checker = `import fs from 'node:fs';
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(directory + '/' + entry.name) : [directory + '/' + entry.name]);
const errors = walk('src').filter((file) => fs.readFileSync(file, 'utf8').includes('ERROR'));
for (const file of errors) console.log(file + "(1,1): error TS9999: '" + file.replace(/\\.ts$/, '') + "' says ERROR.");
process.exit(errors.length ? 2 : 0);
`;

// A test-runner stand-in writing a jest-shaped report: each tests/**/*.cases.json lists [title, status] pairs; one
// with a sibling <file>.broken fails to load. A status { head: [...], base: [...] } is a flaky case: the nth run in a
// worktree of that side (head: the certifier's worktree-head) gets the nth status (the last one after that), counted
// in $FLAKY_STATE.
export const runner = `import fs from 'node:fs';
import path from 'node:path';
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(directory + '/' + entry.name) : [directory + '/' + entry.name]);
const side = process.cwd().includes('worktree-head') ? 'head' : 'base';
const statusOf = (file, title, status) => {
  if (typeof status === 'string') return status;
  const counter = path.join(process.env.FLAKY_STATE, side + '-' + encodeURIComponent(file + '#' + title));
  const run = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
  fs.writeFileSync(counter, String(run + 1));
  return status[side][Math.min(run, status[side].length - 1)];
};
const testResults = walk('tests').filter((file) => file.endsWith('.cases.json')).map((file) => {
  const text = fs.readFileSync(file, 'utf8');
  if (fs.existsSync(file + '.broken')) return { name: path.resolve(file), status: 'failed', message: 'SyntaxError', assertionResults: [] };
  const cases = JSON.parse(text).map(([title, status]) => [title, statusOf(file, title, status)]);
  return { name: path.resolve(file), status: cases.some(([, status]) => status === 'failed') ? 'failed' : 'passed', message: '',
    assertionResults: cases.map(([title, status]) => ({ ancestorTitles: ['suite'], title, fullName: 'suite ' + title, status })) };
});
const failed = testResults.some((result) => result.status === 'failed');
fs.writeFileSync(process.argv[2], JSON.stringify({ success: !failed, snapshot: { added: 0, filesAdded: 0, updated: 0, unchecked: 0 }, testResults }));
process.exit(failed ? 1 : 0);
`;

// An artifact producer: writes the sorted list of exported names to <out>.
export const producer = `import fs from 'node:fs';
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(directory + '/' + entry.name) : [directory + '/' + entry.name]);
const names = walk(process.argv[3]).flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/export const (\\w+)/g)].map((match) => match[1])).sort();
fs.mkdirSync(process.argv[2].replace(/\\/[^/]*$/, ''), { recursive: true });
fs.writeFileSync(process.argv[2], names.join('\\n') + '\\n');
`;

export const typecheck: OracleSpec = { name: 'typecheck', kind: 'exit-zero', cwd: '', command: ['node', 'tools/check.mjs'], diagnostics: 'tsc' };
export const unit: OracleSpec = { name: 'unit', kind: 'tests', format: 'jest', cwd: '', command: ['node', 'tools/run-tests.mjs', '{artifacts}/report.json'], report: '{artifacts}/report.json' };
export const spec: OracleSpec = {
  name: 'spec', kind: 'artifact-identical', cwd: '{scratch}/run', command: ['node', '{worktree}/tools/produce.mjs', '{scratch}/out/names.txt', '{worktree}/src'],
  artifact: '{scratch}/out/names.txt', reference: 'names.txt',
};

export const tools = { 'tools/check.mjs': checker, 'tools/run-tests.mjs': runner, 'tools/produce.mjs': producer };
export const before: Tree = {
  ...tools,
  'src/old/user.ts': 'export const user = 1;\n',
  'src/main.ts': "import { user } from './old/user';\nexport const main = user;\n",
  'tests/old/user.cases.json': '[["one", "passed"], ["one", "passed"], ["two", "skipped"]]',
  'names.txt': 'main\nuser\n',
};
export const moved: Tree = {
  ...tools,
  'src/users/user.ts': 'export const user = 1;\n',
  'src/main.ts': "import { user } from './users/user';\nexport const main = user;\n",
  'tests/users/user.cases.json': '[["one", "passed"], ["one", "passed"], ["two", "skipped"]]',
  'names.txt': 'main\nuser\n',
};

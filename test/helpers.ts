// Test helpers: fixture repos as real git repos in temp dirs, byte-exact tree comparison, TS 6 typecheck.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { withLegacyShim } from '../src/analyzer/tsconfig-scopes.js';

export const fixturesDirectory = path.join(import.meta.dirname, 'fixtures');

export interface Fixture {
  name: string;
  directory: string;
  description: string;
  typecheck: boolean;
  moves: Map<string, string>;
  expected: { outcome: 'applied' } | { outcome: 'declined'; reasons: string[] };
}

export function listFixtures(): Fixture[] {
  return fs.readdirSync(fixturesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(fixturesDirectory, entry.name, 'fixture.json')))
    .map((entry) => {
      const directory = path.join(fixturesDirectory, entry.name);
      const read = (file: string) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      const meta = read('fixture.json');
      return {
        name: entry.name,
        directory,
        description: meta.description,
        typecheck: Boolean(meta.typecheck),
        moves: new Map(Object.entries(read('pathmap.json').moves as Record<string, string>)),
        expected: read('expected.json'),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Copies a tree into a fresh temp git repo with everything committed. */
export function materialize(tree: string, label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ac-${label}-`));
  fs.cpSync(tree, root, { recursive: true });
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixtures@ac.invalid');
  git(root, 'config', 'user.name', 'fixtures');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  return root;
}

export function listTree(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else files.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  };
  walk(root);
  return files.sort();
}

/** Differences between two trees: missing, extra, and byte-different files. */
export function diffTrees(actual: string, expected: string): string[] {
  const actualFiles = listTree(actual);
  const expectedFiles = listTree(expected);
  const problems: string[] = [];
  for (const file of expectedFiles) if (!actualFiles.includes(file)) problems.push(`missing ${file}`);
  for (const file of actualFiles) if (!expectedFiles.includes(file)) problems.push(`unexpected ${file}`);
  for (const file of expectedFiles.filter((file) => actualFiles.includes(file))) {
    const a = fs.readFileSync(path.join(actual, file));
    const b = fs.readFileSync(path.join(expected, file));
    if (!a.equals(b)) problems.push(`content ${file}: got ${JSON.stringify(a.toString('utf8').slice(0, 2000))}`);
  }
  return problems;
}

/** Diagnostics of the tree's root tsconfig.json under TS 6.0.3 (legacy shim, no @types). */
export function typecheck(root: string): string[] {
  const configPath = path.join(root, 'tsconfig.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  if (!parsed) return ['tsconfig.json did not parse'];
  const options = { ...withLegacyShim(parsed.options), types: parsed.options.types ?? [] };
  const program = ts.createProgram({ rootNames: parsed.fileNames, options });
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const where = diagnostic.file ? `${path.relative(root, diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}` : '';
    return `${where} TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
  });
}

export function gitStatus(root: string): string {
  return git(root, 'status', '--porcelain');
}

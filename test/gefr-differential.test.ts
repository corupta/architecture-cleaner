// Differential oracle (plan §3.3 step 8): apply TypeScript's own getEditsForFileRename for each move, in sequence,
// then check that every site GEFR is meant to handle resolves where ours does: to map(before). Sites GEFR doesn't
// handle by design (research 04a §2 rows 5b, 8, 10-bare, 11, 18) are reported, not asserted.
//
// TS 6.0.3 defect found here: a relative module augmentation (`declare module './u' {…}`) anywhere in the program
// makes getEditsForFileRename return no edits at all, even for unrelated moves. Files with such augmentations are
// therefore kept out of GEFR's program, and their own sites are reported instead of asserted.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { analyzeRepo } from '../src/analyzer/analyze.js';
import { gitRepoFs } from '../src/analyzer/repo-fs.js';
import { withLegacyShim } from '../src/analyzer/tsconfig-scopes.js';
import type { ResolvedSite } from '../src/analyzer/types.js';
import { executeMove } from '../src/executor/execute.js';
import { mapPath } from '../src/executor/move-set.js';
import { listFixtures, listTree, materialize } from './helpers.js';

const gefrKinds = new Set<ResolvedSite['kind']>(['import', 'export', 'import-equals', 'dynamic-import', 'typeof-import']);
const isTypeScript = (file: string) => /\.(ts|tsx|mts|cts)$/.test(file);

function gefrMove(root: string, moves: ReadonlyMap<string, string>, excluded: ReadonlySet<string>): void {
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  const options = { ...withLegacyShim(parsed?.options ?? {}), types: [] };
  const texts = new Map<string, { text: string; version: number }>();
  for (const file of listTree(root).filter((file) => isTypeScript(file) && !excluded.has(file))) {
    texts.set(path.join(root, file), { text: fs.readFileSync(path.join(root, file), 'utf8'), version: 0 });
  }
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...texts.keys()],
    getScriptVersion: (fileName) => String(texts.get(fileName)?.version ?? 0),
    getScriptSnapshot: (fileName) => {
      const text = texts.get(fileName)?.text ?? (fs.existsSync(fileName) ? fs.readFileSync(fileName, 'utf8') : undefined);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    fileExists: (fileName) => texts.has(fileName) || (fs.existsSync(fileName) && !moves.has(path.relative(root, fileName))),
    readFile: (fileName) => texts.get(fileName)?.text ?? (fs.existsSync(fileName) ? fs.readFileSync(fileName, 'utf8') : undefined),
    directoryExists: (directoryName) => [...texts.keys()].some((fileName) => fileName.startsWith(`${directoryName}/`)) || fs.existsSync(directoryName),
    getDirectories: (directoryName) => (fs.existsSync(directoryName) ? fs.readdirSync(directoryName, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : []),
  };
  const service = ts.createLanguageService(host);
  for (const [from, to] of moves) {
    const oldName = path.join(root, from);
    const newName = path.join(root, to);
    if (isTypeScript(from)) {
      for (const change of service.getEditsForFileRename(oldName, newName, {}, {})) {
        if (!texts.has(change.fileName)) continue; // never apply TS's tsconfig edits (plan §3.3 step 6)
        const entry = texts.get(change.fileName)!;
        let text = entry.text;
        for (const textChange of [...change.textChanges].sort((a, b) => b.span.start - a.span.start)) {
          text = text.slice(0, textChange.span.start) + textChange.newText + text.slice(textChange.span.start + textChange.span.length);
        }
        texts.set(change.fileName, { text, version: entry.version + 1 });
      }
      const moved = texts.get(oldName);
      if (moved) {
        texts.delete(oldName);
        texts.set(newName, { text: moved.text, version: moved.version + 1 });
      }
    }
    fs.mkdirSync(path.dirname(newName), { recursive: true });
    fs.renameSync(oldName, newName);
  }
  for (const [fileName, { text }] of texts) fs.writeFileSync(fileName, text, 'utf8');
}

const applied = listFixtures().filter((fixture) => fixture.expected.outcome === 'applied');

describe.each(applied)('GEFR differential on $name', (fixture) => {
  it('reaches the same targets on every site kind GEFR handles', () => {
    const ours = materialize(path.join(fixture.directory, 'before'), `${fixture.name}-ours`);
    const result = executeMove(gitRepoFs(ours), fixture.moves);
    expect(result.outcome).toBe('applied');
    if (result.outcome !== 'applied') return;

    const theirs = materialize(path.join(fixture.directory, 'before'), `${fixture.name}-gefr`);
    const augmenting = new Set([...result.before.files.values()].filter((file) => file.sites.some((site) => site.kind === 'declare-module')).map((file) => file.path));
    gefrMove(theirs, result.moves, augmenting);
    const gefr = analyzeRepo(materializedFs(theirs));

    const disagreements: string[] = [];
    const outOfScope: string[] = [];
    const formDifferences: string[] = [];
    for (const file of result.before.files.values()) {
      const newPath = mapPath(result.moves, file.path);
      const ourFile = result.after.files.get(newPath)!;
      const gefrFile = gefr.files.get(newPath);
      file.sites.forEach((site, index) => {
        if (site.resolution.type !== 'file') return;
        const expected = mapPath(result.moves, site.resolution.path);
        const gefrSite = gefrFile?.sites[index];
        const reached = gefrSite?.resolution.type === 'file' && gefrSite.resolution.path === expected;
        const ourSite = ourFile.sites[index]!;
        const gefrHandles = gefrKinds.has(site.kind) && site.resolution.via === 'typescript' && !augmenting.has(file.path);
        if (!reached) (gefrHandles ? disagreements : outOfScope).push(`${newPath} ${site.kind} '${site.specifier}' -> GEFR '${gefrSite?.specifier}'`);
        else if (gefrSite && gefrSite.specifier !== ourSite.specifier) formDifferences.push(`${newPath} ${site.kind}: ours '${ourSite.specifier}', GEFR '${gefrSite.specifier}'`);
      });
    }
    if (outOfScope.length || formDifferences.length) {
      console.log(`[${fixture.name}] GEFR misses outside its scope: ${outOfScope.length}; same target, different text: ${formDifferences.length}; kept out of GEFR's program (augmentations): ${[...augmenting].join(', ') || 'none'}\n  ${[...outOfScope, ...formDifferences].join('\n  ')}`);
    }
    expect(disagreements).toEqual([]);
  });
});

/** The working tree as the analyzer's file list: GEFR moved files with fs.rename, so git's index is stale. */
function materializedFs(root: string) {
  const files = listTree(root);
  return { ...gitRepoFs(root), tracked: () => files };
}

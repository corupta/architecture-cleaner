// G3 static measurement of an agent's restructure branch against its base (plan §6 "Measure").
//   node g3/measure-diff.mjs <checkout> <base> <end> <packageRoot> > diff-metrics.json
// Classifies every changed line in renamed and modified TS files as specifier-only (old and new lines are both
// module-reference lines that are equal once string literals are blanked) or not.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import ts from 'typescript';
import { analyze } from '../g1/analyzer.mjs';

const [checkout, base, end, packageRoot = '.'] = process.argv.slice(2);
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
const isSource = (file) => /\.(ts|tsx|mts|cts)$/.test(file) && !file.endsWith('.d.ts');
const isTest = (file) => /(\.|\/)(spec|test|e2e-spec)\.(ts|tsx|mts|cts)$|(^|\/)(__tests__|test|tests)\//.test(file);
const referenceLine = /^\s*(import\b|export\b.*\bfrom\b|}\s*from\b|.*\brequire\(|.*\b(jest|vi)\.(mock|doMock|unmock|requireActual|importActual|importMock)\(|.*\bimport\()/;
const blankStrings = (line) => line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""').trim();

function classifyHunks(diffText) {
  let specifierOnly = 0;
  let other = 0;
  const otherSamples = [];
  for (const hunk of diffText.split(/^@@.*@@.*$/m).slice(1)) {
    const removed = [];
    const added = [];
    for (const line of hunk.split('\n')) {
      if (line.startsWith('-') && !line.startsWith('---')) removed.push(line.slice(1));
      else if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1));
    }
    const paired = Math.min(removed.length, added.length);
    let hunkOther = 0;
    for (let index = 0; index < paired; index++) {
      const before = removed[index];
      const after = added[index];
      if (referenceLine.test(before) && referenceLine.test(after) && blankStrings(before) === blankStrings(after)) specifierOnly += 2;
      else hunkOther += 2;
    }
    hunkOther += removed.length - paired + (added.length - paired);
    other += hunkOther;
    if (hunkOther && otherSamples.length < 400) otherSamples.push({ removed: removed.slice(0, 12), added: added.slice(0, 12) });
  }
  return { specifierOnly, other, otherSamples };
}

function isBarrelSource(text) {
  const sourceFile = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  return sourceFile.statements.length > 0 && sourceFile.statements.every((statement) => ts.isExportDeclaration(statement));
}

const scope = packageRoot === '.' ? [] : ['--', packageRoot];
const nameStatus = git('diff', '--name-status', '-M50%', `${base}..${end}`, ...scope).trim().split('\n').filter(Boolean).map((line) => line.split('\t'));
const counts = { added: 0, deleted: 0, renamed: 0, modified: 0, other: 0 };
const renamed = [];
const modified = [];
const added = [];
const deleted = [];
for (const [status, first, second] of nameStatus) {
  if (status.startsWith('R')) {
    counts.renamed++;
    renamed.push({ from: first, to: second, similarity: Number(status.slice(1)) });
  } else if (status === 'A') {
    counts.added++;
    added.push(first);
  } else if (status === 'D') {
    counts.deleted++;
    deleted.push(first);
  } else if (status === 'M') {
    counts.modified++;
    modified.push(first);
  } else counts.other++;
}

const movedSource = renamed.filter((entry) => isSource(entry.to));
let movedLines = 0;
const moved = { specifierOnly: 0, other: 0, filesWithOtherEdits: 0, samples: [] };
for (const entry of movedSource) {
  movedLines += git('show', `${base}:${entry.from}`).split('\n').length;
  const diffText = git('diff', '-U0', `${base}:${entry.from}`, `${end}:${entry.to}`);
  const result = classifyHunks(diffText);
  moved.specifierOnly += result.specifierOnly;
  moved.other += result.other;
  if (result.other) {
    moved.filesWithOtherEdits++;
    moved.samples.push({ file: entry.to, from: entry.from, otherLines: result.other, hunks: result.otherSamples.slice(0, 6) });
  }
}
const modifiedSource = modified.filter(isSource);
const edited = { specifierOnly: 0, other: 0, filesWithOtherEdits: 0, samples: [] };
for (const file of modifiedSource) {
  const result = classifyHunks(git('diff', '-U0', `${base}..${end}`, '--', file));
  edited.specifierOnly += result.specifierOnly;
  edited.other += result.other;
  if (result.other) {
    edited.filesWithOtherEdits++;
    edited.samples.push({ file, otherLines: result.other, hunks: result.otherSamples.slice(0, 6) });
  }
}
const addedSource = added.filter(isSource);
const newBarrels = addedSource.filter((file) => isBarrelSource(git('show', `${end}:${file}`)));
const testFilesAt = (ref) => git('ls-tree', '-r', '--name-only', ref, ...scope).split('\n').filter((file) => isSource(file) && isTest(file)).length;
const snapshotsAdded = added.filter((file) => file.endsWith('.snap')).length;

// Stale internal specifiers: analyze the end tree in a temporary worktree, compare with the base tree.
const worktree = path.join(checkout, '..', `.measure-${path.basename(checkout)}-${end.replace(/[^\w]/g, '').slice(0, 12)}`);
let staleSites = null;
try {
  execFileSync('git', ['-C', checkout, 'worktree', 'add', '-f', '--detach', worktree, end], { stdio: 'ignore' });
  // node_modules are not in the worktree; link the checkout's so package-typed resolution behaves the same.
  for (const directory of new Set(['.', packageRoot])) {
    try {
      execFileSync('ln', ['-s', path.join(checkout, directory, 'node_modules'), path.join(worktree, directory, 'node_modules')]);
    } catch {
      // no node_modules at that level
    }
  }
  const endGraph = analyze({ repoDir: worktree, packageRoot });
  execFileSync('git', ['-C', checkout, 'worktree', 'add', '-f', '--detach', `${worktree}-base`, base], { stdio: 'ignore' });
  for (const directory of new Set(['.', packageRoot])) {
    try {
      execFileSync('ln', ['-s', path.join(checkout, directory, 'node_modules'), path.join(`${worktree}-base`, directory, 'node_modules')]);
    } catch {
      // no node_modules at that level
    }
  }
  const baseGraph = analyze({ repoDir: `${worktree}-base`, packageRoot });
  const key = (site) => `${site.kind}\0${site.specifier}`;
  const baseKeys = new Set(baseGraph.unresolvedSites.map(key));
  const fresh = endGraph.unresolvedSites.filter((site) => !baseKeys.has(key(site)));
  staleSites = {
    base: baseGraph.unresolvedSites.length,
    end: endGraph.unresolvedSites.length,
    new: fresh.length,
    newByKind: fresh.reduce((byKind, site) => ({ ...byKind, [site.kind]: (byKind[site.kind] ?? 0) + 1 }), {}),
    newSample: fresh.slice(0, 40),
    endEdges: endGraph.edges.length,
    baseEdges: baseGraph.edges.length,
  };
} finally {
  for (const directory of [worktree, `${worktree}-base`]) {
    try {
      execFileSync('git', ['-C', checkout, 'worktree', 'remove', '--force', directory], { stdio: 'ignore' });
    } catch {
      // already gone
    }
  }
}

const result = {
  checkout, base, end, packageRoot,
  counts,
  sourceFiles: { renamed: movedSource.length, modified: modifiedSource.length, added: addedSource.length, deleted: deleted.filter(isSource).length },
  newBarrels,
  addedSourceFiles: addedSource,
  deletedSourceFiles: deleted.filter(isSource),
  testFiles: { base: testFilesAt(base), end: testFilesAt(end) },
  snapshotsAdded,
  movedFiles: { lines: movedLines, specifierOnlyLines: moved.specifierOnly, nonSpecifierLines: moved.other, nonSpecifierShare: movedLines ? +(moved.other / movedLines).toFixed(4) : 0, filesWithNonSpecifierEdits: moved.filesWithOtherEdits },
  modifiedFiles: { specifierOnlyLines: edited.specifierOnly, nonSpecifierLines: edited.other, filesWithNonSpecifierEdits: edited.filesWithOtherEdits },
  staleSites,
  samples: { moved: moved.samples, modified: edited.samples },
};
process.stdout.write(JSON.stringify(result, null, 1));

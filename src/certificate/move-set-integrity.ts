// K1 move-set integrity (plan §3.4): the inferred pathMap is total and injective (nothing added, nothing
// deleted), no case-only renames or new case collisions, git modes equal, symlinks unaffected, co-move bundles
// complete (`__mocks__`, `__snapshots__`, declaration pairs, source maps), ignore-file match status unchanged.
import path from 'node:path';
import type { CommitTree } from './git-tree.js';
import { ignoreKinds, ignoredPaths } from './ignore-files.js';
import type { PathMap } from './path-map.js';
import { type Check, type CertifyContext, type Finding, result, type Violation } from './types.js';

const title = 'Move-set integrity';
// Ignore files that decide what ships (git, npm pack, docker build context) block; tool ignores are findings.
const blockingIgnores = new Set(['.gitignore', '.npmignore', '.dockerignore']);

// A declaration file and its implementation are one module (TS reads one, Node loads the other).
const declarationPairs: [RegExp, string][] = [[/\.d\.ts$/, '.js'], [/\.d\.ts$/, '.jsx'], [/\.d\.mts$/, '.mjs'], [/\.d\.cts$/, '.cjs'],
  [/\.js$/, '.d.ts'], [/\.jsx$/, '.d.ts'], [/\.mjs$/, '.d.mts'], [/\.cjs$/, '.d.cts']];

const extensionPattern = /(\.d)?\.[^./]+$/;
const stemOf = (file: string) => path.posix.basename(file).replace(extensionPattern, '');
const extensionOf = (file: string) => extensionPattern.exec(path.posix.basename(file))?.[0] ?? '';

function bundleViolations(base: CommitTree, pathMap: PathMap): Violation[] {
  const violations: Violation[] = [];
  const filesIn = new Map<string, string[]>();
  for (const file of base.entries.keys()) {
    const directory = path.posix.dirname(file);
    filesIn.set(directory, [...(filesIn.get(directory) ?? []), file]);
  }
  const expect = (member: string, expected: string, owner: string, relation: string) => {
    const actual = pathMap.map(member);
    if (actual !== expected) violations.push({ file: member, detail: `${relation} of ${owner} should be at ${expected}, is at ${actual}` });
  };
  const mockOf = (file: string) => /^(?:(.*)\/)?__mocks__\/([^/]+)$/.exec(file);
  for (const [from, to] of pathMap.moves) {
    const fromDirectory = path.posix.dirname(from);
    const toDirectory = path.posix.dirname(to);
    // Manual mocks: Jest looks next to the module (`__mocks__/<basename>`) and by name (haste mock map).
    if (!mockOf(from)) {
      for (const mock of filesIn.get(path.posix.join(fromDirectory, '__mocks__')) ?? []) {
        if (stemOf(mock) === stemOf(from)) expect(mock, path.posix.join(toDirectory, '__mocks__', stemOf(to) + extensionOf(mock)), from, 'manual mock');
      }
    }
    const snapshot = path.posix.join(fromDirectory, '__snapshots__', `${path.posix.basename(from)}.snap`);
    if (base.entries.has(snapshot)) expect(snapshot, path.posix.join(toDirectory, '__snapshots__', `${path.posix.basename(to)}.snap`), from, 'snapshot');
    for (const [pattern, suffix] of declarationPairs) {
      if (!pattern.test(from) || !pattern.test(to)) continue;
      const partner = from.replace(pattern, suffix);
      if (base.entries.has(partner)) expect(partner, to.replace(pattern, suffix), from, 'declaration pair');
    }
    if (base.entries.has(`${from}.map`)) expect(`${from}.map`, `${to}.map`, from, 'source map');
  }
  // The other direction: a bundle member that moved must have moved with its owner.
  for (const [from, to] of pathMap.moves) {
    const mock = mockOf(from);
    if (mock) {
      const ownerDirectory = mock[1] ?? '.';
      const owners = (filesIn.get(ownerDirectory) ?? []).filter((file) => stemOf(file) === stemOf(mock[2]!));
      const expectedAt = (owner: string) => path.posix.join(path.posix.dirname(pathMap.map(owner)), '__mocks__', stemOf(pathMap.map(owner)) + extensionOf(from));
      if (owners.length === 0) violations.push({ file: from, detail: `moved to ${to}, but it mocks no module next to it (a node_modules or root mock: pinned)` });
      else if (!owners.some((owner) => expectedAt(owner) === to)) {
        violations.push({ file: from, detail: `moved to ${to} without its module ${owners.join(', ')} (now at ${owners.map((owner) => pathMap.map(owner)).join(', ')})` });
      }
    }
    const snapshot = /^(?:(.*)\/)?__snapshots__\/([^/]+)\.snap$/.exec(from);
    if (snapshot) {
      const owner = path.posix.join(snapshot[1] ?? '', snapshot[2]!);
      const expected = path.posix.join(path.posix.dirname(pathMap.map(owner)), '__snapshots__', `${path.posix.basename(pathMap.map(owner))}.snap`);
      if (!base.entries.has(owner)) violations.push({ file: from, detail: `snapshot moved to ${to}, but its test ${owner} doesn't exist` });
      else if (expected !== to) violations.push({ file: from, detail: `snapshot moved to ${to}, but its test ${owner} is at ${pathMap.map(owner)}` });
    }
  }
  return dedupe(violations);
}

const dedupe = (violations: Violation[]) => [...new Map(violations.map((violation) => [`${violation.file}\0${violation.detail}`, violation])).values()];

function symlinkViolations(base: CommitTree, head: CommitTree, pathMap: PathMap): Violation[] {
  const violations: Violation[] = [];
  const movedDirectories = new Set<string>();
  for (const from of pathMap.moves.keys()) for (let directory = path.posix.dirname(from); directory !== '.'; directory = path.posix.dirname(directory)) movedDirectories.add(directory);
  for (const [file, entry] of base.entries) {
    if (entry.mode !== '120000') continue;
    const to = pathMap.map(file);
    const link = base.text(file) ?? '';
    if (to !== file) violations.push({ file, detail: `tracked symlink moved to ${to} (its target '${link}' is resolved from its own directory)` });
    if (head.entries.has(to) && head.text(to) !== link) violations.push({ file, detail: `symlink target changed: '${link}' -> '${head.text(to)}'` });
    if (path.posix.isAbsolute(link)) continue;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), link));
    if (pathMap.moves.has(target)) violations.push({ file, detail: `points at ${target}, which moved to ${pathMap.map(target)}` });
    else if ([...pathMap.moves.keys()].some((from) => from.startsWith(`${target}/`))) violations.push({ file, detail: `points at directory ${target}, whose files moved` });
  }
  return violations;
}

export function checkMoveSet(context: CertifyContext): { violations: Violation[]; findings: Finding[]; metrics: Record<string, number> } {
  const { base, head, pathMap } = context;
  const violations: Violation[] = [];
  const findings: Finding[] = [];
  for (const file of pathMap.deleted) violations.push({ file, detail: 'deleted: no file in head has its content (modulo specifiers)' });
  for (const added of pathMap.added) violations.push({ file: added.path, detail: added.copyOf ? `added: a copy of ${added.copyOf}, which still exists` : 'added: no file in base has its content (modulo specifiers)' });
  for (const [from, to] of pathMap.moves) {
    if (from.toLowerCase() === to.toLowerCase()) violations.push({ file: from, detail: `case-only rename to ${to}` });
    // .ts -> .tsx changes how the file parses; .ts -> .mts changes its module format and emitted name.
    if (extensionOf(from) !== extensionOf(to)) violations.push({ file: from, detail: `extension changes: ${extensionOf(from)} -> ${extensionOf(to)} at ${to}` });
    const baseMode = base.entries.get(from)!.mode;
    const headMode = head.entries.get(to)!.mode;
    if (baseMode !== headMode) violations.push({ file: from, detail: `mode ${baseMode} -> ${headMode} at ${to}` });
  }
  for (const [file, to] of pathMap.forward) {
    if (file !== to) continue;
    const baseMode = base.entries.get(file)!.mode;
    const headMode = head.entries.get(file)!.mode;
    if (baseMode !== headMode) violations.push({ file, detail: `mode ${baseMode} -> ${headMode}` });
  }
  const collisions = (tree: CommitTree) => {
    const byLower = new Map<string, string[]>();
    for (const file of tree.entries.keys()) byLower.set(file.toLowerCase(), [...(byLower.get(file.toLowerCase()) ?? []), file]);
    return new Map([...byLower].filter(([, files]) => files.length > 1));
  };
  const baseCollisions = collisions(base);
  for (const [lower, files] of collisions(head)) {
    if (!baseCollisions.has(lower)) violations.push({ file: files[0], detail: `paths that differ only in case: ${files.join(', ')}` });
  }
  violations.push(...symlinkViolations(base, head, pathMap));
  violations.push(...bundleViolations(base, pathMap));

  const moved = [...pathMap.moves];
  for (const kind of ignoreKinds) {
    const scratch = path.join(context.options.workDir, 'ignore', kind);
    const before = ignoredPaths(base, kind, moved.map(([from]) => from), path.join(scratch, 'base'));
    const after = ignoredPaths(head, kind, moved.map(([, to]) => to), path.join(scratch, 'head'));
    for (const [from, to] of moved) {
      if (before.has(from) === after.has(to)) continue;
      const detail = `${kind} status changes: ${before.has(from) ? 'ignored' : 'not ignored'} -> ${after.has(to) ? 'ignored' : 'not ignored'} at ${to}`;
      if (blockingIgnores.has(kind)) violations.push({ file: from, detail });
      else findings.push({ kind: 'tool-ignore-status', file: from, detail });
    }
  }
  if (pathMap.ambiguous.length) findings.push({ kind: 'ambiguous-match', detail: `${pathMap.ambiguous.length} groups of identical files were paired by name and path similarity` });
  const editedInPlace = [...pathMap.forward].filter(([from, to]) => from === to && base.entries.get(from)!.oid !== head.entries.get(to)!.oid).length;
  return {
    violations,
    findings,
    metrics: { moves: pathMap.moves.size, unchanged: pathMap.forward.size - pathMap.moves.size - editedInPlace, editedInPlace, deleted: pathMap.deleted.length, added: pathMap.added.length, copies: pathMap.added.filter((added) => added.copyOf).length },
  };
}

export const moveSetIntegrity: Check = {
  id: 'K1',
  title,
  run(context) {
    const { violations, findings, metrics } = checkMoveSet(context);
    const summary = violations.length
      ? `${violations.length} violations (${metrics.added} added, ${metrics.deleted} deleted, ${metrics.copies} copies)`
      : `${metrics.moves} moves, ${metrics.editedInPlace} files edited in place, nothing added or deleted`;
    return result('K1', title, { summary, violations, findings, metrics });
  },
};

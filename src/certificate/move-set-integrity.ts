// K1 move-set integrity (plan §3.4): the inferred pathMap is total and injective (nothing added, nothing
// deleted), no case-only renames or new case collisions, git modes equal, symlinks unaffected, co-move bundles
// complete (`__mocks__`, `__snapshots__`, declaration pairs, source maps), every file's status unchanged under the
// ignore files, Docker build contexts and npm `files` lists that decide what ships. The one addition allowed is a
// boundary-rule tool's config at the package root that is proven inert (tool-configs.ts).
import path from 'node:path';
import type { CommitTree } from './git-tree.js';
import { pathScopes } from './ignore-files.js';
import { checkToolConfig, isToolConfigName } from './tool-configs.js';
import type { PathMap } from './path-map.js';
import { type Check, type CertifyContext, type Finding, result, type Violation } from './types.js';

const title = 'Move-set integrity';

// A declaration file and its implementation are one module (TS reads one, Node loads the other).
const declarationPairs: [RegExp, string][] = [[/\.d\.ts$/, '.js'], [/\.d\.ts$/, '.jsx'], [/\.d\.mts$/, '.mjs'], [/\.d\.cts$/, '.cjs'],
  [/\.js$/, '.d.ts'], [/\.jsx$/, '.d.ts'], [/\.mjs$/, '.d.mts'], [/\.cjs$/, '.d.cts']];

const extensionPattern = /(\.d)?\.[^./]+$/;
const stemOf = (file: string) => path.posix.basename(file).replace(extensionPattern, '');
const extensionOf = (file: string) => extensionPattern.exec(path.posix.basename(file))?.[0] ?? '';

function bundleViolations(base: CommitTree, head: CommitTree, pathMap: PathMap): Violation[] {
  const violations: Violation[] = [];
  const filesIn = new Map<string, string[]>();
  for (const file of base.entries.keys()) {
    const directory = path.posix.dirname(file);
    filesIn.set(directory, [...(filesIn.get(directory) ?? []), file]);
  }
  const headFilesIn = new Map<string, string[]>();
  for (const to of pathMap.moves.values()) headFilesIn.set(path.posix.join(path.posix.dirname(to), '__mocks__'), []);
  for (const to of pathMap.moves.values()) headFilesIn.set(path.posix.join(path.posix.dirname(to), '__snapshots__'), []);
  for (const file of head.entries.keys()) headFilesIn.get(path.posix.dirname(file))?.push(file);
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
    // Arriving next to a mock or snapshot that isn't its own: Jest now picks that one up for the moved file.
    if (!mockOf(from)) {
      for (const mock of headFilesIn.get(path.posix.join(toDirectory, '__mocks__')) ?? []) {
        const origin = pathMap.inverse.get(mock);
        const own = origin !== undefined && path.posix.dirname(origin) === path.posix.join(fromDirectory, '__mocks__') && stemOf(origin) === stemOf(from);
        if (stemOf(mock) === stemOf(to) && !own) violations.push({ file: from, detail: `moved to ${to}, next to manual mock ${mock}${origin && origin !== mock ? ` (was ${origin})` : ''}, which isn't its own` });
      }
    }
    const arrivedSnapshot = path.posix.join(toDirectory, '__snapshots__', `${path.posix.basename(to)}.snap`);
    const snapshotOrigin = pathMap.inverse.get(arrivedSnapshot);
    if (head.entries.has(arrivedSnapshot) && snapshotOrigin !== snapshot) violations.push({ file: from, detail: `moved to ${to}, next to snapshot ${arrivedSnapshot}${snapshotOrigin && snapshotOrigin !== arrivedSnapshot ? ` (was ${snapshotOrigin})` : ''}, which isn't its own` });
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

// Runner configs (any Jest, Vitest or Vite config, package.json `jest`) that place snapshots with code of their own.
const runnerConfigName = /^((jest|vitest|vite)([.-][^/]*)?\.(json|[cm]?[jt]s)|package\.json)$/;
const customSnapshotPlacement = /\b(snapshotResolver|resolveSnapshotPath)\b/;
const snapshotMatcher = /\b(toMatchSnapshot|toThrowErrorMatchingSnapshot)\b/;

/**
 * A custom snapshot resolver decides where a test's snapshot file lives by running code, so where a moved test's
 * snapshot must go can't be computed here; a test that lost its snapshot writes a new one and passes (outside --ci).
 */
function snapshotResolverViolations(base: CommitTree, pathMap: PathMap): Violation[] {
  const configs = [...base.entries.keys()].filter((file) => runnerConfigName.test(path.posix.basename(file)) && !file.split('/').includes('node_modules')
    && customSnapshotPlacement.test(base.text(file) ?? ''));
  if (configs.length === 0) return [];
  return [...pathMap.moves].filter(([from]) => snapshotMatcher.test(base.text(from) ?? ''))
    .map(([from, to]) => ({ file: from, detail: `moved to ${to}, and its snapshots are placed by the custom resolver in ${configs.join(', ')}: their co-move can't be checked statically` }));
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
  const toolConfigs = pathMap.added.map((added) => added.path).filter(isToolConfigName);
  let inertAdditions = 0;
  for (const added of pathMap.added) {
    const tool = toolConfigs.includes(added.path) ? checkToolConfig(context, added.path, toolConfigs) : undefined;
    if (tool && tool.problem === null) {
      inertAdditions++;
      const filters = tool.ciFilters.length ? `; CI path filters match it, so it triggers their jobs: ${tool.ciFilters.slice(0, 3).join(', ')}${tool.ciFilters.length > 3 ? ', …' : ''}` : '';
      findings.push({ kind: 'tool-config-added', file: added.path, detail: `added at the package root and proven inert: in no tsconfig program, loaded by no reference, packed by no published package, named or globbed by no other file, and the tool runs nowhere${filters}` });
      continue;
    }
    const detail = added.copyOf ? `added: a copy of ${added.copyOf}, which still exists` : 'added: no file in base has its content (modulo specifiers)';
    violations.push({ file: added.path, detail: tool ? `${detail}; a tool config, but not proven inert: ${tool.problem}` : detail });
  }
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
  violations.push(...bundleViolations(base, head, pathMap));
  violations.push(...snapshotResolverViolations(base, pathMap));

  // Every file, not only moved ones: a moved rule file (a nested .npmignore) changes what its old and new directories ship.
  const pairs = [...pathMap.forward];
  const scratch = path.join(context.options.workDir, 'scopes');
  const scopesBefore = new Map(pathScopes(base, path.join(scratch, 'base')).map((scope) => [scope.id, scope]));
  const scopesAfter = new Map(pathScopes(head, path.join(scratch, 'head')).map((scope) => [scope.id, scope]));
  for (const id of new Set([...scopesBefore.keys(), ...scopesAfter.keys()])) {
    const scope = (scopesBefore.get(id) ?? scopesAfter.get(id))!;
    const before = scopesBefore.get(id)?.status(pairs.map(([from]) => from)) ?? pairs.map(() => scope.neutral);
    const after = scopesAfter.get(id)?.status(pairs.map(([, to]) => to)) ?? pairs.map(() => scope.neutral);
    pairs.forEach(([from, to], index) => {
      if (before[index] === after[index]) return;
      const detail = `${id} status changes: ${before[index]} -> ${after[index]}${from === to ? '' : ` at ${to}`}`;
      if (scope.blocking) violations.push({ file: from, detail });
      else findings.push({ kind: 'tool-ignore-status', file: from, detail });
    });
  }
  // Identical files paired by a tie-break: each pairing names the destinations it could have had instead.
  for (const group of pathMap.ambiguous) {
    for (const source of group.sources) {
      const chosen = pathMap.forward.get(source);
      const alternatives = group.destinations.filter((destination) => destination !== chosen);
      const listed = alternatives.length > 5 ? `${alternatives.slice(0, 5).join(', ')}, … ${alternatives.length - 5} more` : alternatives.join(', ');
      findings.push({ kind: 'ambiguous-match', file: source, detail: `${chosen ? `paired with ${chosen}` : 'left unpaired'} among ${group.destinations.length} identical candidates (by where its directory's other files went, then name and path similarity); the alternatives were ${listed || 'none'}` });
    }
  }
  const editedInPlace = [...pathMap.forward].filter(([from, to]) => from === to && base.entries.get(from)!.oid !== head.entries.get(to)!.oid).length;
  return {
    violations,
    findings,
    metrics: { moves: pathMap.moves.size, unchanged: pathMap.forward.size - pathMap.moves.size - editedInPlace, editedInPlace, deleted: pathMap.deleted.length, added: pathMap.added.length, copies: pathMap.added.filter((added) => added.copyOf).length, inertAdditions },
  };
}

export const moveSetIntegrity: Check = {
  id: 'K1',
  title,
  run(context) {
    const { violations, findings, metrics } = checkMoveSet(context);
    const summary = violations.length
      ? `${violations.length} violations (${metrics.added} added, ${metrics.deleted} deleted, ${metrics.copies} copies)`
      : `${metrics.moves} moves, ${metrics.editedInPlace} files edited in place, ${metrics.inertAdditions ? `${metrics.inertAdditions} inert tool configs added, nothing else` : 'nothing'} added or deleted`;
    return result('K1', title, { summary, violations, findings, metrics });
  },
};

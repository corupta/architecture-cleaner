// K0 envelope (plan §2.5, §3.4): the support-envelope declines the analyzer can see, evaluated over the package
// root on both commits. Outside the envelope the other checks' model doesn't hold (04b A3, A5, A9, A13), so the
// diff gets no certificate. The runtime alias mechanism is K3c's.
import path from 'node:path';
import ts from 'typescript';
import { isShebangScript, isSourceFile, stripBom } from '../analyzer/analyze.js';
import { scriptKindOf } from '../analyzer/reference-sites.js';
import { loadRunnerConfig } from '../analyzer/runner-config.js';
import type { CommitTree } from './git-tree.js';
import { type Check, type CertifyContext, result, type Side, type Violation } from './types.js';

const title = 'Envelope';
const tsSource = /\.(ts|tsx|mts|cts)$/;
const jsSource = /\.(js|jsx|mjs|cjs)$/;
const declaration = /\.d\.[cm]?ts$/;
// jest.config.js, jest.e2e.config.ts, jest-e2e.json (Nest), ...: any file Jest could be pointed at with --config.
const jestConfigName = /^jest([.-][^/]*)?\.(json|[cm]?[jt]s)$/;
const automockCall = /\bjest\s*\.\s*(enableAutomock|autoMockOn)\s*\(/;
// JSON the analyzer reads as configuration.
const manifestName = /^(package|[tj]sconfig[^/]*)\.json$/;
// Script runners that run TypeScript or JavaScript from a shebang line (the analyzer reads node, tsx, ts-node, bun, deno).
const scriptRunner = /\b(tsx|ts-node|bun|deno|esno|esr|jiti|zx)\b/;

const directoryOf = (file: string) => (path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file));
const within = (file: string, directory: string) => directory === '' || file === directory || file.startsWith(`${directory}/`);
const stemOf = (file: string) => path.posix.basename(file).replace(/\.[^.]+$/, '');

/** The repo path a tracked symlink names (followed through tracked symlinks), or null when it leaves the repository. */
function symlinkTarget(tree: CommitTree, link: string): string | null {
  let current = link;
  for (let depth = 0; depth < 8; depth++) {
    const text = tree.text(current) ?? '';
    if (path.posix.isAbsolute(text)) return null;
    const target = path.posix.normalize(path.posix.join(directoryOf(current), text)).replace(/\/$/, '');
    if (target === '..' || target.startsWith('../')) return null;
    const normalized = target === '.' ? '' : target;
    if (tree.entries.get(normalized)?.mode !== '120000') return normalized;
    current = normalized;
  }
  return null;
}

/** `automock` settings other than `false` in a Jest config: JSON (also package.json `jest` and its projects) or a JS/TS file. */
function automockSettings(file: string, text: string): string[] {
  if (file.endsWith('.json')) {
    let json: unknown;
    try {
      json = JSON.parse(stripBom(text));
    } catch {
      return [];
    }
    const settings: string[] = [];
    const visit = (config: unknown, where: string) => {
      if (!config || typeof config !== 'object') return;
      const { automock, projects } = config as { automock?: unknown; projects?: unknown };
      if (automock !== undefined && automock !== false) settings.push(`automock: ${JSON.stringify(automock)}${where}`);
      if (Array.isArray(projects)) for (const project of projects) visit(project, ' (in projects)');
    };
    visit(path.posix.basename(file) === 'package.json' ? (json as { jest?: unknown } | null)?.jest : json, '');
    return settings;
  }
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const settings: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === 'automock'
      && node.initializer.kind !== ts.SyntaxKind.FalseKeyword) settings.push(`automock: ${node.initializer.getText(sourceFile).slice(0, 80)}`);
    else if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'automock') settings.push('automock (shorthand, not a literal)');
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return settings;
}

/** `jest.enableAutomock()` / `jest.autoMockOn()` calls (automock switched on from code, e.g. a setup file). */
function automockCalls(file: string, text: string): string[] {
  if (!automockCall.test(text)) return [];
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const calls: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && /^jest\.(enableAutomock|autoMockOn)$/.test(node.expression.getText(sourceFile).replace(/\s/g, ''))) calls.push(`${node.expression.getText(sourceFile)}()`);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

/**
 * Where an unreadable runner config can reach. Its own directory and below (the analyzer's model), widened to its
 * whole package (nearest package.json) when that package has the runner installed: an unreadable config may set
 * any root. A vite.config.ts in a package without vitest configures a bundler, not tests.
 */
function governedScope(context: CertifyContext, side: Side, config: string): string {
  const tree = side === 'base' ? context.base : context.head;
  const fs = context.fs[side];
  const runner = /(^|\/)(vite|vitest)\.config\.[^/]+$/.test(config) ? 'vitest' : 'jest';
  let owner = directoryOf(config);
  while (owner !== '' && !tree.entries.has(`${owner}/package.json`)) owner = directoryOf(owner);
  for (let directory = directoryOf(config); ; directory = directoryOf(directory)) {
    if (fs.directoryExists(path.join(fs.root, directory, 'node_modules', runner))) return owner;
    if (directory === '') return directoryOf(config);
  }
}

export function checkEnvelope(context: CertifyContext): { violations: Violation[]; metrics: Record<string, number> } {
  const { pathMap, options } = context;
  const root = options.packageRoot;
  const trees: Record<Side, CommitTree> = { base: context.base, head: context.head };
  const found = new Map<string, { file?: string; detail: string; sides: Set<Side> }>();
  const add = (side: Side, file: string | undefined, detail: string) => {
    const key = `${file}\0${detail}`;
    const entry = found.get(key) ?? { ...(file ? { file } : {}), detail, sides: new Set<Side>() };
    entry.sides.add(side);
    found.set(key, entry);
  };
  const metrics: Record<string, number> = { moves: pathMap.moves.size };
  const moved = [...pathMap.moves];
  // Every place a moved file sits: its source in base, its destination in head.
  const locations = moved.flatMap(([from, to]) => [{ file: from, side: 'base' as Side, move: `${from} -> ${to}` }, { file: to, side: 'head' as Side, move: `${from} -> ${to}` }]);
  const movedDirectories = new Set(locations.map((location) => directoryOf(location.file)));
  const analyses = context.analyses();
  // Files a runner config governs here: moved files, and every file whose mock reaches a moved file.
  const governed = new Set(locations.map((location) => location.file));
  for (const side of ['base', 'head'] as const) {
    for (const file of analyses[side].files.values()) {
      const mocksMoved = file.sites.some((site) => site.kind === 'mock' && site.resolution.type === 'file'
        && pathMap.moves.has(side === 'base' ? site.resolution.path : (pathMap.inverse.get(site.resolution.path) ?? '')));
      if (mocksMoved) governed.add(file.path);
    }
  }

  for (const side of ['base', 'head'] as const) {
    const tree = trees[side];
    const files = [...tree.entries.keys()].filter((file) => within(file, root) && !file.split('/').includes('node_modules'));
    const typescript = files.filter((file) => tsSource.test(file) && !declaration.test(file)).length;
    const javascript = files.filter((file) => jsSource.test(file)).length;
    metrics[`${side}TypeScriptFiles`] = typescript;
    metrics[`${side}JavaScriptFiles`] = javascript;
    if (javascript > typescript) add(side, root || undefined, `non-TS majority: ${javascript} JavaScript vs ${typescript} TypeScript source files under ${root || 'the repo root'}`);

    // TypeScript decodes a UTF-16 file by its byte order mark; the analyzer reads UTF-8, so every site in it is invisible
    // (K3 can't see its imports reach a moved file). Anywhere in the tree: K3 covers every file, not only the package.
    for (const [file, entry] of tree.entries) {
      if (entry.mode === '160000' || entry.mode === '120000' || !(isSourceFile(file) || (manifestName.test(path.posix.basename(file)) && !file.split('/').includes('node_modules')))) continue;
      const bytes = tree.bytes(file);
      if (bytes && bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) add(side, file, 'encoded as UTF-16: TypeScript reads it, the certifier reads UTF-8 and sees none of its references');
    }

    // Jest configs that can govern the package: inside it, or in a directory above it.
    const configs = [...tree.entries.keys()].filter((file) => !file.split('/').includes('node_modules') && (within(file, root) || within(root, directoryOf(file)))
      && (jestConfigName.test(path.posix.basename(file)) || path.posix.basename(file) === 'package.json'));
    for (const config of configs) {
      const text = tree.text(config) ?? '';
      if (path.posix.basename(config) === 'package.json') {
        let scripts: Record<string, unknown> = {};
        try {
          scripts = (JSON.parse(stripBom(text)) as { scripts?: Record<string, unknown> } | null)?.scripts ?? {};
        } catch {
          // An unparsable manifest has no scripts to read; Node and npm reject it on their own.
        }
        for (const [name, script] of Object.entries(scripts)) if (typeof script === 'string' && /--automock\b/.test(script)) add(side, config, `script '${name}' runs Jest with --automock`);
      }
      for (const setting of automockSettings(config, text)) add(side, config, `Jest ${setting}: with automock, whether a module is mocked depends on how it is reached`);
    }
    for (const file of files.filter((candidate) => tsSource.test(candidate) || jsSource.test(candidate))) {
      for (const call of automockCalls(file, tree.text(file) ?? '')) add(side, file, `${call} switches Jest automock on`);
    }

    // An extensionless script run by a runtime the analyzer doesn't read (`#!/usr/bin/env zx`, jiti, esno): its imports
    // (an alias to a moved file) are invisible to K2 and K3.
    for (const [file, entry] of tree.entries) {
      if (entry.mode === '160000' || entry.mode === '120000' || path.posix.basename(file).includes('.') || file.split('/').includes('node_modules')) continue;
      const text = tree.text(file) ?? '';
      const shebang = /^#![^\n]*/.exec(text)?.[0];
      if (shebang && scriptRunner.test(shebang) && !isShebangScript(file, text) && /\bimport\b|\brequire\s*\(/.test(text)) add(side, file, `script run by '${shebang.slice(2).trim()}', which the analyzer doesn't read: its imports are invisible to K2 and K3`);
    }

    // A compiler config that extends a file outside the repository takes options (paths, baseUrl, module) the
    // certifier can't read: it would resolve every site without them (an alias it can't see stays "unresolved").
    for (const file of [...tree.entries.keys()].filter((candidate) => /^[tj]sconfig[^/]*\.json$/.test(path.posix.basename(candidate)) && !candidate.split('/').includes('node_modules'))) {
      const extended = ts.parseConfigFileTextToJson(file, tree.text(file) ?? '').config?.extends as unknown;
      for (const entry of (Array.isArray(extended) ? extended : [extended]).filter((value): value is string => typeof value === 'string')) {
        const target = path.posix.normalize(path.posix.join(directoryOf(file), entry));
        if (path.posix.isAbsolute(entry) || (/^\.\.?(\/|$)/.test(entry) && (target === '..' || target.startsWith('../')))) add(side, file, `extends ${entry}, outside the repository: options the certifier can't read`);
      }
    }

    // Symlinks beside a moved file, or pointing at one or at a directory that holds one (the analyzer reads a tracked
    // symlink as its target's text, one level deep, and never follows a symlinked directory; Node does both).
    for (const [file, entry] of tree.entries) {
      if (entry.mode !== '120000') continue;
      if (movedDirectories.has(directoryOf(file))) add(side, file, `tracked symlink in ${directoryOf(file) || 'the repo root'}, which holds a moved file`);
      const target = symlinkTarget(tree, file);
      const reached = target === null ? undefined : locations.find((location) => location.side === side && within(location.file, target));
      if (target !== null && reached) add(side, file, `tracked symlink to ${target || 'the repo root'}, which holds moved file ${reached.file}`);
    }

    for (const entry of loadRunnerConfig(context.fs[side]).unreadable) {
      const scope = governedScope(context, side, entry.config);
      const affected = [...governed].sort().find((file) => within(file, scope));
      if (affected) add(side, entry.config, `test runner config can't be read statically (${entry.reason}) and governs ${affected}`);
    }

    for (const location of locations) {
      const { file } = location;
      if (!within(file, root)) {
        add(side, file, `moved file outside the package root ${root}/ (${location.move}): the envelope, runner and oracles cover ${root}/ only`);
        continue;
      }
      for (let directory = directoryOf(file); directory !== root && within(directory, root); directory = directoryOf(directory)) {
        const manifest = directory === '' ? 'package.json' : `${directory}/package.json`;
        const text = tree.text(manifest);
        if (text === undefined) continue;
        let fields: { type?: unknown; imports?: unknown } = {};
        try {
          fields = (JSON.parse(stripBom(text)) ?? {}) as typeof fields;
        } catch {
          add(side, manifest, `nested package.json over moved file ${file} is not valid JSON`);
          continue;
        }
        const set = (['type', 'imports'] as const).filter((key) => fields[key] !== undefined);
        if (set.length) add(side, manifest, `nested package.json sets ${set.join(' and ')} over ${directory}/, which holds moved file ${file}`);
      }
    }
  }

  // Same-stem pairs of the other family next to a moved file, where it sits in that commit.
  for (const side of ['base', 'head'] as const) {
    const byDirectory = new Map<string, string[]>();
    for (const file of trees[side].entries.keys()) {
      if (!movedDirectories.has(directoryOf(file))) continue;
      if (!byDirectory.has(directoryOf(file))) byDirectory.set(directoryOf(file), []);
      byDirectory.get(directoryOf(file))!.push(file);
    }
    for (const { file } of locations.filter((location) => location.side === side)) {
      if (declaration.test(file)) continue;
      const family = tsSource.test(file) ? jsSource : jsSource.test(file) ? tsSource : null;
      if (!family) continue;
      for (const sibling of byDirectory.get(directoryOf(file)) ?? []) {
        if (family.test(sibling) && !declaration.test(sibling) && stemOf(sibling) === stemOf(file)) add(side, file, `same-stem pair with ${sibling}: TypeScript reads one, Node and Jest may load the other`);
      }
    }
  }
  // The certifier reads every node_modules path from the environment, never from the commits.
  for (const [file, entry] of context.base.entries) {
    if (!file.split('/').includes('node_modules')) continue;
    const to = pathMap.forward.get(file);
    const change = to === undefined ? 'deleted' : to !== file ? `moved to ${to}` : context.head.entries.get(to)!.oid !== entry.oid || context.head.entries.get(to)!.mode !== entry.mode ? 'edited' : null;
    if (change) for (const side of ['base', 'head'] as const) add(side, file, `tracked file under node_modules changes (${change}): the certifier reads node_modules from the environment, not the commits`);
  }
  for (const file of context.head.entries.keys()) {
    const from = pathMap.inverse.get(file);
    if (!file.split('/').includes('node_modules') || (from !== undefined && from.split('/').includes('node_modules'))) continue;
    const change = from === undefined ? 'added' : `moved from ${from}`;
    for (const side of ['base', 'head'] as const) add(side, file, `tracked file under node_modules changes (${change}): the certifier reads node_modules from the environment, not the commits`);
  }
  if (options.profile?.runner?.args?.includes('--automock')) for (const side of ['base', 'head'] as const) add(side, undefined, `profile ${options.profile.name} runs the test runner with --automock`);
  const violations = [...found.values()].map(({ file, detail, sides }) => ({ ...(file ? { file } : {}), detail: sides.size === 2 ? detail : `${detail} (${[...sides][0]})` }));
  return { violations, metrics };
}

export const envelope: Check = {
  id: 'K0',
  title,
  run(context) {
    const { violations, metrics } = checkEnvelope(context);
    const root = context.options.packageRoot || 'the repo root';
    const summary = violations.length
      ? `${violations.length} envelope violations under ${root}`
      : `inside the envelope: ${metrics.headTypeScriptFiles} TypeScript vs ${metrics.headJavaScriptFiles} JavaScript sources under ${root}; no automock, nested package scope, symlink, same-stem pair or unreadable runner config around ${metrics.moves} moved files`;
    return result('K0', title, { summary, violations, metrics });
  },
};

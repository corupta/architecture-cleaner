// Mutation operators from research 04b §E3: M1–M30 without the rename rung (M31/M32) and the loader/emit operators
// M15, M16, M22, whose killers K5/K7 are outside the MVP. Each takes a known-good result and proposes instances; an
// instance builds a head tree that differs from the good head by exactly one mutation, which the certifier must
// reject without K8.
import path from 'node:path';
import ts from 'typescript';
import { scriptKindOf } from '../analyzer/reference-sites.js';
import { nearestConfig } from '../analyzer/runner-config.js';
import type { ResolvedSite, SiteKind } from '../analyzer/types.js';
import { ignoredPaths } from '../certificate/ignore-files.js';
import {
  bundleMembers, editFile, editSpans, endingOf, headMode, headText, isFileRelative, isRelativeSpecifier, moveWithImporters,
  rawOf, respell, splitExtension, type Ending, type TreeEdits,
} from './edits.js';
import type { RewrittenSite, SiteReference, Subject } from './subject.js';

export interface Candidate {
  /** Sub-kind of the operator (M25: the site kind); capping is per operator and variant. */
  variant?: string;
  /** Stable identity of the instance, hashed to pick capped instances deterministically. */
  key: string;
  description: string;
  /** The mutant's edits to the good head; null when this instance turns out not to apply. */
  build(): TreeEdits | null;
}

export interface Operator {
  id: string;
  title: string;
  /** The checks research 04b names as the killer. */
  expectedKillers: string;
  candidates(subject: Subject): Candidate[];
}

const posix = path.posix;
const prefer = <T>(primary: T[], fallback: () => T[]): T[] => (primary.length ? primary : fallback());
const quote = (text: string) => `'${text}'`;
const isTracked = (subject: Subject, file: string) => subject.headTree.entries.has(file);
const inPackage = (subject: Subject, file: string) => !subject.packageRoot || file.startsWith(`${subject.packageRoot}/`);
const isRepoSource = (file: string) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file) && !file.split('/').includes('node_modules');
const isDeclaration = (file: string) => /\.d\.[mc]?ts$/.test(file);

/** Every site of the head analysis, in file order. */
function headSites(subject: Subject): SiteReference[] {
  const sites: SiteReference[] = [];
  for (const [file, analyzed] of [...subject.analyses.head.files].sort(([a], [b]) => a.localeCompare(b))) {
    analyzed.sites.forEach((site, index) => sites.push({ file, index, site }));
  }
  return sites;
}

const resolvedFile = (site: ResolvedSite) => (site.resolution.type === 'file' ? site.resolution.path : null);
const siteKey = (reference: SiteReference) => `${reference.file}#${reference.index}`;
const replaceSite = (subject: Subject, reference: SiteReference, text: string) =>
  editSpans(subject, reference.file, [{ start: reference.site.start, end: reference.site.end, text }]);

/** Puts back the base text of one rewritten specifier. */
function revert(subject: Subject, rewritten: RewrittenSite): Candidate {
  return {
    key: siteKey(rewritten),
    description: `${rewritten.file}: ${rewritten.site.kind}${rewritten.site.callee ? ` (${rewritten.site.callee})` : ''} specifier ${quote(rewritten.headRaw)} left as in base, ${quote(rewritten.baseRaw)}`,
    build: () => replaceSite(subject, rewritten, rewritten.baseRaw),
  };
}

const mockCallees = new Set(['jest.mock', 'jest.doMock', 'jest.unmock', 'jest.dontMock', 'vi.mock', 'vi.doMock', 'vi.unmock', 'vi.doUnmock']);
const actualCallees = new Set(['jest.requireActual', 'jest.requireMock', 'jest.createMockFromModule', 'vi.importActual', 'vi.importMock']);

function parse(subject: Subject, file: string): { text: string; source: ts.SourceFile } | null {
  const text = headText(subject, file);
  if (text === undefined || !subject.views.head(file)?.source) return null;
  return { text, source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file)) };
}

/** Head files the result touched, falling back to every analyzed head file. */
function touchedSources(subject: Subject): string[] {
  return prefer(subject.touched.filter((file) => subject.analyses.head.files.has(file)), () => [...subject.analyses.head.files.keys()].sort());
}

const isCoMoveArtifact = (file: string) => /(^|\/)(__mocks__|__snapshots__)\//.test(file);
/** Tool configs (`vitest.config.ts`, `.eslintrc.js`) are never moved by a module step. */
const isToolConfig = (file: string) => /(^|\/)([^/]+\.config\.[^/]+|\.[^/]+)$/.test(file);
const relocated = (file: string) => posix.join(posix.dirname(file), 'relocated', posix.basename(file));

/** Location-sensitive code: the file's own path leaks into behavior (process.cwd() doesn't depend on the file). */
const locationHazards = (subject: Subject, file: string) =>
  (subject.analyses.head.files.get(file)?.hazards ?? []).filter((hazard) => hazard.kind === 'location-sensitive' && hazard.detail !== 'process.cwd()');

const movable = (subject: Subject, file: string) => bundleMembers(subject, file).length === 0 && locationHazards(subject, file).length === 0;

/** The alias spelling (tsconfig `paths`, else `baseUrl`) that reaches `target` from `importer` with `ending`. */
function aliasFor(subject: Subject, importer: string, target: string, ending: Ending): string | null {
  const options = subject.headScopes(importer).options;
  const root = subject.headFs.root;
  const repoRelative = (absolute: string) => posix.relative(root, absolute.split(path.sep).join('/'));
  const key = ending.kind === 'exact' ? target : ending.kind === 'directory' ? posix.dirname(target) : splitExtension(target)[0];
  const suffix = ending.kind === 'mapped' ? ending.extension : '';
  const pathsBase = (options.pathsBasePath as string | undefined) ?? options.baseUrl;
  if (options.paths && pathsBase) {
    for (const [pattern, substitutions] of Object.entries(options.paths)) {
      const star = pattern.indexOf('*');
      if (star === -1) continue;
      for (const substitution of substitutions) {
        const mapped = repoRelative(path.resolve(pathsBase, substitution));
        const substitutionStar = mapped.indexOf('*');
        if (substitutionStar === -1) continue;
        const head = mapped.slice(0, substitutionStar);
        const tail = mapped.slice(substitutionStar + 1);
        if (key.length < head.length + tail.length || !key.startsWith(head) || !key.endsWith(tail)) continue;
        return pattern.slice(0, star) + key.slice(head.length, key.length - tail.length) + pattern.slice(star + 1) + suffix;
      }
    }
  }
  if (options.baseUrl) {
    const relative = posix.relative(repoRelative(options.baseUrl), key);
    if (relative && !relative.startsWith('..')) return relative + suffix;
  }
  return null;
}

/** Whether a runner collects `file` as a test, from the profile's runner spec or the configs in the head; null without a runner. */
function testSetOf(subject: Subject): { inSet(file: string): boolean; roots: string[] } | null {
  const runner = subject.profile?.runner;
  const relativeTo = (directory: string, file: string) => (directory ? posix.relative(directory, file) : file);
  const staticPrefix = (glob: string) => glob.split('/').filter((_, index, all) => all.slice(0, index + 1).every((segment) => !/[*?[{(!]/.test(segment))).join('/');
  if (runner?.kind === 'mocha') {
    const valueFlags = new Set(['--require', '-r', '--config', '--file', '--ignore', '--extension', '--reporter', '-R', '--timeout', '--ui', '-u']);
    const globs = (runner.args ?? []).filter((argument, index, all) => !argument.startsWith('-') && !valueFlags.has(all[index - 1] ?? ''));
    return {
      inSet: (file) => globs.some((glob) => posix.matchesGlob(relativeTo(runner.cwd, file), glob)),
      roots: globs.map((glob) => posix.join(runner.cwd, staticPrefix(glob))),
    };
  }
  const vitestDefault = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];
  const jestDefault = ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'];
  const vitest = runner?.kind === 'vitest' ? subject.headRunner.vitest.find((config) => !runner.config || config.config === runner.config)
    : !runner ? subject.headRunner.vitest[0] : undefined;
  if (vitest) {
    // A config that sets `test.root` to its package (immich: root = serverRoot) reads `include` from the runner cwd.
    const cwd = runner?.cwd ?? vitest.directory;
    const rebase = (pattern: string) => (vitest.directory !== cwd && pattern.startsWith(`${vitest.directory}/`) ? posix.join(cwd, pattern.slice(vitest.directory.length + 1)) : pattern);
    const include = vitest.scope.include.length ? vitest.scope.include.map(rebase) : vitestDefault.map((pattern) => posix.join(cwd, pattern));
    const exclude = vitest.scope.exclude.map(rebase);
    const matches = (file: string, patterns: string[]) => patterns.some((pattern) => posix.matchesGlob(file, pattern));
    return { inSet: (file) => matches(file, include) && !matches(file, exclude) && !file.split('/').includes('node_modules'), roots: include.map(staticPrefix) };
  }
  const manifest = subject.headTree.text('package.json') ?? '';
  if (!subject.headRunner.jest.length && !/"test"\s*:\s*"jest\b/.test(manifest)) return null;
  return {
    inSet(file) {
      const jest = nearestConfig(subject.headRunner.jest, file);
      if (!jest) return jestDefault.some((pattern) => posix.matchesGlob(file, pattern)) && !file.split('/').includes('node_modules');
      const { roots, include, exclude, excludePatterns } = jest.scope;
      if (!roots.some((root) => root === '' || file.startsWith(`${root}/`))) return false;
      const patterns = include.length ? include : jestDefault;
      return patterns.some((pattern) => posix.matchesGlob(file, pattern)) && !exclude.some((pattern) => posix.matchesGlob(file, pattern))
        && !excludePatterns.some((pattern) => pattern.test(`/${file}`)) && !file.split('/').includes('node_modules');
    },
    roots: subject.headRunner.jest.flatMap((config) => config.scope.roots),
  };
}

/** Infrastructure and config files whose path strings name source files (docs are K4 findings, not kills). */
const infraPattern = /(^|\/)(Dockerfile[^/]*|Procfile|Makefile|[^/]+\.(json|ya?ml|sh|toml|ini|cfg|conf)|\.env[^/]*)$/;
const lockfilePattern = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json)$/;

export const operators: Operator[] = [
  {
    id: 'M1',
    title: 'Retarget a specifier to a same-basename file',
    expectedKillers: 'K3',
    candidates(subject) {
      const byBasename = new Map<string, string[]>();
      for (const file of [...subject.headTree.entries.keys()].sort()) {
        if (!isRepoSource(file) || isCoMoveArtifact(file)) continue;
        byBasename.set(posix.basename(file), [...(byBasename.get(posix.basename(file)) ?? []), file]);
      }
      const instances = (sites: SiteReference[]) => sites.flatMap((reference) => {
        const target = resolvedFile(reference.site);
        if (!target) return [];
        return (byBasename.get(posix.basename(target)) ?? []).filter((other) => other !== target).slice(0, 2).map((other) => ({
          key: `${siteKey(reference)}->${other}`,
          description: `${reference.file}: ${quote(reference.site.specifier)} (${target}) retargeted to same-basename ${other}`,
          build() {
            const specifier = respell(reference.site, reference.file, target, other);
            return specifier === null || rawOf(subject, reference.file, reference.index) !== reference.site.specifier ? null : replaceSite(subject, reference, specifier);
          },
        }));
      });
      return prefer(instances(subject.rewritten), () => instances(headSites(subject)));
    },
  },
  {
    id: 'M2',
    title: 'Drop one importer rewrite',
    expectedKillers: 'K3',
    candidates: (subject) => subject.rewritten.filter((site) => site.site.kind === 'import').map((site) => revert(subject, site)),
  },
  {
    id: 'M3',
    title: 'Drop a jest.mock/vi.mock rewrite (non-virtual)',
    expectedKillers: 'K3',
    candidates: (subject) => subject.rewritten.filter((site) => site.site.kind === 'mock' && mockCallees.has(site.site.callee ?? '') && !site.site.virtual).map((site) => revert(subject, site)),
  },
  {
    id: 'M4',
    title: 'Drop a virtual mock rewrite',
    expectedKillers: 'K3',
    candidates: (subject) => subject.rewritten.filter((site) => site.site.kind === 'mock' && site.site.virtual).map((site) => revert(subject, site)),
  },
  {
    id: 'M5',
    title: 'Drop a requireActual/importActual rewrite',
    expectedKillers: 'K3',
    candidates: (subject) => subject.rewritten.filter((site) => site.site.kind === 'mock' && actualCallees.has(site.site.callee ?? '')).map((site) => revert(subject, site)),
  },
  {
    id: 'M6',
    title: 'Move a module, leave its __mocks__ file behind',
    expectedKillers: 'K1, K6',
    candidates: (subject) => [...subject.pathMap.moves].filter(([from]) => /(^|\/)__mocks__\//.test(from)).map(([from, to]) => ({
      key: from,
      description: `manual mock ${from} left in place (its module moved; the result had it at ${to})`,
      build: () => new Map([[to, null], [from, { bytes: subject.baseTree.bytes(from)!, mode: subject.baseTree.entries.get(from)!.mode }]]),
    })),
  },
  {
    id: 'M7',
    title: 'Move a test, leave its __snapshots__ file behind',
    expectedKillers: 'K1, K6',
    candidates: (subject) => [...subject.pathMap.moves].filter(([from]) => /(^|\/)__snapshots__\/[^/]+\.snap$/.test(from)).map(([from, to]) => ({
      key: from,
      description: `snapshot ${from} left in place (its test moved; the result had it at ${to})`,
      build: () => new Map([[to, null], [from, { bytes: subject.baseTree.bytes(from)!, mode: subject.baseTree.entries.get(from)!.mode }]]),
    })),
  },
  {
    id: 'M8',
    title: "Swap two files' contents",
    expectedKillers: 'K2, K3',
    candidates(subject) {
      const byDirectory = new Map<string, string[]>();
      for (const file of [...subject.importers.keys()].sort()) {
        if (!isRepoSource(file) || !isTracked(subject, file)) continue;
        byDirectory.set(posix.dirname(file), [...(byDirectory.get(posix.dirname(file)) ?? []), file]);
      }
      const pairs: [string, string][] = [];
      for (const files of byDirectory.values()) {
        for (let index = 0; index + 1 < files.length; index++) {
          const [a, b] = [files[index]!, files[index + 1]!];
          const entryA = subject.headTree.entries.get(a)!;
          const entryB = subject.headTree.entries.get(b)!;
          if (splitExtension(a)[1] === splitExtension(b)[1] && entryA.oid !== entryB.oid && entryA.mode === entryB.mode) pairs.push([a, b]);
        }
      }
      const touched = new Set(subject.touched);
      return prefer(pairs.filter(([a, b]) => touched.has(a) || touched.has(b)), () => pairs).map(([a, b]) => ({
        key: `${a}<->${b}`,
        description: `contents of ${a} and ${b} swapped (both imported)`,
        build: () => new Map([[a, { bytes: subject.headTree.bytes(b)!, mode: headMode(subject, a) }], [b, { bytes: subject.headTree.bytes(a)!, mode: headMode(subject, b) }]]),
      }));
    },
  },
  {
    id: 'M9',
    title: 'Add a barrel and route an importer through it',
    expectedKillers: 'K1, K2, K3',
    candidates(subject) {
      const withIndex = new Set([...subject.headTree.entries.keys()].filter((file) => /^index\.[^/]+$/.test(posix.basename(file))).map((file) => posix.dirname(file)));
      const instances = (sites: SiteReference[]) => sites.flatMap((reference) => {
        const target = resolvedFile(reference.site);
        if (!target || !['import', 'export'].includes(reference.site.kind) || !/\.(ts|tsx|js|jsx)$/.test(target) || isDeclaration(target)) return [];
        const directory = posix.dirname(target);
        if (directory === posix.dirname(reference.file) || withIndex.has(directory)) return [];
        const barrel = posix.join(directory, /\.(ts|tsx)$/.test(target) ? 'index.ts' : 'index.js');
        return [{
          key: siteKey(reference),
          description: `${reference.file}: ${quote(reference.site.specifier)} routed through a new barrel ${barrel} (export * from ${posix.basename(target)})`,
          build(): TreeEdits | null {
            const ending = endingOf(reference.site.specifier, target);
            const specifier = respell(reference.site, reference.file, target, barrel);
            if (!ending || specifier === null) return null;
            const reexport = ending.kind === 'exact' ? posix.basename(target) : splitExtension(posix.basename(target))[0] + (ending.kind === 'mapped' ? ending.extension : '');
            const edits = replaceSite(subject, reference, specifier);
            edits?.set(barrel, { bytes: Buffer.from(`export * from './${reexport}';\n`), mode: '100644' });
            return edits;
          },
        }];
      });
      return prefer(instances(subject.rewritten), () => instances(headSites(subject)));
    },
  },
  {
    id: 'M10',
    title: 'Reorder two imports',
    expectedKillers: 'K2',
    candidates(subject) {
      return touchedSources(subject).flatMap((file) => {
        const parsed = parse(subject, file);
        if (!parsed) return [];
        const statements = parsed.source.statements;
        const instances: Candidate[] = [];
        for (let index = 0; index + 1 < statements.length; index++) {
          const [first, second] = [statements[index]!, statements[index + 1]!];
          if (!ts.isImportDeclaration(first) || !ts.isImportDeclaration(second)) continue;
          const firstText = parsed.text.slice(first.getStart(parsed.source), first.getEnd());
          const secondText = parsed.text.slice(second.getStart(parsed.source), second.getEnd());
          if (firstText === secondText) continue;
          instances.push({
            key: `${file}#${index}`,
            description: `${file}: imports of ${first.moduleSpecifier.getText(parsed.source)} and ${second.moduleSpecifier.getText(parsed.source)} swapped`,
            build: () => editSpans(subject, file, [
              { start: first.getStart(parsed.source), end: first.getEnd(), text: secondText },
              { start: second.getStart(parsed.source), end: second.getEnd(), text: firstText },
            ]),
          });
        }
        return instances;
      });
    },
  },
  {
    id: 'M11',
    title: 'Relative specifier rewritten to a tsconfig alias (same file)',
    expectedKillers: 'K3 (form class, runtime resolver)',
    candidates(subject) {
      const instances = (sites: SiteReference[]) => sites.flatMap((reference) => {
        const target = resolvedFile(reference.site);
        if (!target || !isRelativeSpecifier(reference.site.specifier) || ['mock', 'triple-slash', 'url-reference'].includes(reference.site.kind)) return [];
        const ending = endingOf(reference.site.specifier, target);
        const alias = ending && aliasFor(subject, reference.file, target, ending);
        if (!alias || alias === reference.site.specifier) return [];
        return [{
          key: siteKey(reference),
          description: `${reference.file}: ${quote(reference.site.specifier)} -> alias ${quote(alias)} (same file ${target})`,
          build: () => replaceSite(subject, reference, alias),
        }];
      });
      return prefer(instances(subject.rewritten), () => instances(headSites(subject).filter((reference) => subject.touched.includes(reference.file))));
    },
  },
  {
    id: 'M12',
    title: 'Toggle import <-> import type',
    expectedKillers: 'K2',
    candidates(subject) {
      return touchedSources(subject).flatMap((file) => {
        const parsed = parse(subject, file);
        if (!parsed) return [];
        return parsed.source.statements.flatMap((statement, index): Candidate[] => {
          if (!ts.isImportDeclaration(statement) || !statement.importClause) return [];
          const start = statement.getStart(parsed.source);
          const text = parsed.text.slice(start, statement.getEnd());
          const toValue = /^import(\s+)type\s+/.exec(text);
          const toType = !statement.importClause.isTypeOnly && /^import(\s+)(?=\{)/.exec(text);
          const match = toValue ?? toType;
          if (!match) return [];
          const replacement = toValue ? `import${match[1]}` : `import${match[1]}type `;
          return [{
            variant: toValue ? 'type-to-value' : 'value-to-type',
            key: `${file}#${index}`,
            description: `${file}: ${text.split('\n')[0]!.slice(0, 80)} ${toValue ? 'loses' : 'gains'} \`type\``,
            build: () => editSpans(subject, file, [{ start, end: start + match[0].length, text: replacement }]),
          }];
        });
      });
    },
  },
  {
    id: 'M13',
    title: 'Change the extension style of a specifier',
    expectedKillers: 'K3 (form class)',
    candidates(subject) {
      const instances = (sites: SiteReference[]) => sites.flatMap((reference): Candidate[] => {
        const target = resolvedFile(reference.site);
        if (!target || !isRepoSource(target) || ['triple-slash', 'url-reference'].includes(reference.site.kind) || !/\.(ts|tsx|mts|cts|js|jsx)$/.test(target)) return [];
        const ending = endingOf(reference.site.specifier, target);
        let specifier: string | null = null;
        if (ending?.kind === 'mapped') specifier = reference.site.specifier.slice(0, -ending.extension.length);
        else if (ending?.kind === 'bare' && !/\.[mc]ts$/.test(target)) specifier = `${reference.site.specifier}.js`;
        if (specifier === null) return [];
        const changed = specifier;
        return [{
          variant: `${isRelativeSpecifier(reference.site.specifier) ? 'relative' : 'alias'}-${ending!.kind === 'mapped' ? 'drop-extension' : 'add-extension'}`,
          key: siteKey(reference),
          description: `${reference.file}: ${quote(reference.site.specifier)} -> ${quote(changed)} (same file ${target})`,
          build: () => replaceSite(subject, reference, changed),
        }];
      });
      return prefer(instances(subject.rewritten), () => instances(headSites(subject).filter((reference) => subject.touched.includes(reference.file))));
    },
  },
  {
    id: 'M14',
    title: 'Move a __dirname / import.meta user (importers rewritten correctly)',
    expectedKillers: 'K4',
    candidates(subject) {
      return [...subject.analyses.head.files.keys()].sort().filter((file) => subject.pathMap.inverse.get(file) === file && inPackage(subject, file) && !isToolConfig(file)
        && locationHazards(subject, file).length && bundleMembers(subject, file).length === 0).map((file) => ({
        key: file,
        description: `${file} (uses ${[...new Set(locationHazards(subject, file).map((hazard) => hazard.detail))].join(', ')}) moved to ${relocated(file)}, importers rewritten`,
        build: () => moveWithImporters(subject, file, relocated(file)),
      }));
    },
  },
  {
    id: 'M17',
    title: 'Move a file into a different tsconfig scope or module format',
    expectedKillers: 'K0, K5 (fingerprint)',
    candidates(subject) {
      // The compile context of a file: the tsconfig programs that include it and its module format (plan §3.4 K5).
      const contextOf = (file: string) => ({ programs: subject.headScopes(file).programs.join(' + ') || 'no program', format: subject.analyses.head.files.get(file)!.format });
      // Destinations: directories holding files of the same extension (a source folder, not a static-asset folder).
      const byDirectory = new Map<string, { directory: string; programs: string; format: string }>();
      for (const file of [...subject.analyses.head.files.keys()].sort()) {
        const key = `${posix.dirname(file)}\0${splitExtension(file)[1]}`;
        if (!byDirectory.has(key) && inPackage(subject, file) && !isToolConfig(file) && !isCoMoveArtifact(file)) byDirectory.set(key, { directory: posix.dirname(file), ...contextOf(file) });
      }
      return touchedSources(subject).filter((file) => inPackage(subject, file) && movable(subject, file) && !isToolConfig(file)).flatMap((file) => {
        const own = contextOf(file);
        const extension = splitExtension(file)[1];
        return [...byDirectory].filter(([key, context]) => key.endsWith(`\0${extension}`) && (context.programs !== own.programs || context.format !== own.format)).slice(0, 2).map(([, { directory, ...context }]) => {
          const to = posix.join(directory, posix.basename(file));
          return {
            variant: context.format !== own.format ? 'module-format' : 'tsconfig-scope',
            key: `${file}->${directory}`,
            description: `${file} (${own.format}, ${own.programs}) moved to ${to} (${context.format}, ${context.programs}), importers rewritten`,
            build: () => moveWithImporters(subject, file, to),
          };
        });
      });
    },
  },
  {
    id: 'M18',
    title: 'Move a .d.ts without its .js',
    expectedKillers: 'K1 (bundle), K3 (runtime)',
    candidates(subject) {
      return [...subject.headTree.entries.keys()].sort().filter((file) => /\.d\.ts$/.test(file) && isTracked(subject, file.replace(/\.d\.ts$/, '.js'))).map((file) => ({
        key: file,
        description: `${file} moved to ${relocated(file)} without ${file.replace(/\.d\.ts$/, '.js')}, importers rewritten to the declaration`,
        build: () => moveWithImporters(subject, file, relocated(file)),
      }));
    },
  },
  {
    id: 'M19',
    title: 'Case-mismatched specifier',
    expectedKillers: 'K3',
    candidates(subject) {
      const instances = (sites: SiteReference[]) => sites.flatMap((reference): Candidate[] => {
        const target = resolvedFile(reference.site);
        if (!target || !isRepoSource(target) || !(isFileRelative(reference.site) || endingOf(reference.site.specifier, target))) return [];
        const specifier = reference.site.specifier;
        const slash = specifier.lastIndexOf('/');
        const letter = specifier.slice(slash + 1).search(/[a-zA-Z]/);
        if (letter === -1) return [];
        const position = slash + 1 + letter;
        const char = specifier[position]!;
        const flipped = specifier.slice(0, position) + (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()) + specifier.slice(position + 1);
        return [{
          variant: isFileRelative(reference.site) ? 'relative' : 'alias',
          key: siteKey(reference),
          description: `${reference.file}: ${quote(specifier)} -> ${quote(flipped)} (case differs from ${target})`,
          build: () => replaceSite(subject, reference, flipped),
        }];
      });
      return prefer(instances(subject.rewritten), () => instances(headSites(subject).filter((reference) => subject.touched.includes(reference.file))));
    },
  },
  {
    id: 'M20',
    title: "Move a test out of the runner's test set",
    expectedKillers: 'K6',
    candidates(subject) {
      const tests = testSetOf(subject);
      if (!tests) return [];
      return [...subject.headTree.entries.keys()].sort().filter((file) => isRepoSource(file) && tests.inSet(file) && !subject.importers.has(file) && movable(subject, file)).flatMap((file) => {
        const renamed = posix.join(posix.dirname(file), posix.basename(file).replace(/\.(spec|test)\./, '-$1.'));
        const outOfRoot = tests.roots.filter((root) => root && file.startsWith(`${root}/`)).map((root) => posix.join(posix.dirname(root), posix.basename(file)));
        const destinations: [string, string][] = [['rename-out-of-pattern', renamed], ...outOfRoot.slice(0, 1).map((to): [string, string] => ['move-out-of-root', to])];
        return destinations.filter(([, to]) => to !== file && !tests.inSet(to) && !isTracked(subject, to)).map(([variant, to]) => ({
          variant,
          key: `${file}->${to}`,
          description: `test ${file} moved to ${to}, outside the runner's test set`,
          build: () => moveWithImporters(subject, file, to),
        }));
      });
    },
  },
  {
    id: 'M21',
    title: 'Leave an infrastructure/config path stale',
    expectedKillers: 'K4 (old-path scan), K7',
    candidates(subject) {
      const sources = new Map<string, string>();
      const root = subject.headFs.root;
      for (const file of subject.analyses.head.files.keys()) {
        if (isDeclaration(file) || !movable(subject, file) || !inPackage(subject, file)) continue;
        const forms = [file, splitExtension(file)[0]];
        const options = subject.headScopes(file).options;
        if (options.outDir && options.rootDir && /\.[mc]?tsx?$/.test(file)) {
          const rootDir = posix.relative(root, options.rootDir.split(path.sep).join('/'));
          const outDir = posix.relative(root, options.outDir.split(path.sep).join('/'));
          const emitted = posix.join(outDir, posix.relative(rootDir, splitExtension(file)[0]));
          if (!emitted.startsWith('..')) forms.push(emitted, `${emitted}.js`);
        }
        for (const form of forms) {
          sources.set(form, file);
          if (subject.packageRoot && form.startsWith(`${subject.packageRoot}/`)) sources.set(form.slice(subject.packageRoot.length + 1), file);
        }
      }
      const instances: Candidate[] = [];
      const seen = new Set<string>();
      for (const config of [...subject.headTree.entries.keys()].sort()) {
        if (!infraPattern.test(config) || lockfilePattern.test(config) || config.split('/').includes('node_modules') || (subject.headTree.bytes(config)?.length ?? 0) > 512 * 1024) continue;
        for (const token of new Set(headText(subject, config)?.match(/[\w@.\-/]+/g) ?? [])) {
          const cleaned = token.replace(/^\.\//, '').replace(/[.]+$/, '');
          const file = sources.get(cleaned);
          if (!file || (!cleaned.includes('/') && !cleaned.includes('.')) || seen.has(`${config}\0${file}`)) continue;
          seen.add(`${config}\0${file}`);
          instances.push({
            key: `${config}:${file}`,
            description: `${file} moved to ${relocated(file)} (importers rewritten); ${config} still names ${quote(cleaned)}`,
            build: () => moveWithImporters(subject, file, relocated(file)),
          });
        }
      }
      return instances;
    },
  },
  {
    id: 'M23',
    title: 'Stage into a gitignored path (the file is missing from the commit, or force-added under an ignore)',
    expectedKillers: 'K1',
    candidates(subject) {
      const missing: Candidate[] = [...subject.pathMap.moves].map(([from, to]) => ({
        variant: 'missing',
        key: to,
        description: `destination ${to} (of ${from}) not committed, as if gitignored`,
        build: () => new Map([[to, null]]),
      }));
      const ignoreFiles = [...subject.headTree.entries.keys()].filter((file) => posix.basename(file) === '.gitignore');
      const ignoredDirectories: string[] = [];
      for (const ignoreFile of ignoreFiles) {
        for (const line of (headText(subject, ignoreFile) ?? '').split(/\r?\n/)) {
          // Directory-like entries only (`logs`, `upload/`), not file names (`config.json`).
          const match = /^\/?([\w.-]+)(\/?)$/.exec(line.trim());
          if (match && match[1] !== 'node_modules' && !match[1]!.startsWith('.') && (match[2] || !match[1]!.includes('.'))) ignoredDirectories.push(posix.join(posix.dirname(ignoreFile), match[1]!));
        }
      }
      const destinations = [...subject.pathMap.moves.values()].filter((file) => movable(subject, file)).flatMap((file) => ignoredDirectories.slice(0, 3).map((directory) => [file, posix.join(directory, posix.basename(file))] as const));
      const ignored = ignoredPaths(subject.headTree, '.gitignore', destinations.map(([, to]) => to), path.join(subject.scratch, 'gitignore'));
      const forced: Candidate[] = destinations.filter(([, to]) => ignored.has(to)).map(([file, to]) => ({
        variant: 'force-added',
        key: `${file}->${to}`,
        description: `${file} moved to gitignored ${to} and force-added (importers rewritten)`,
        build: () => moveWithImporters(subject, file, to),
      }));
      return [...missing, ...forced];
    },
  },
  {
    id: 'M24',
    title: 'Lose the exec bit (or gain one)',
    expectedKillers: 'K1 (modes)',
    candidates(subject) {
      const executables = [...subject.headTree.entries.values()].filter((entry) => entry.mode === '100755').map((entry) => entry.path).sort();
      const flip = (file: string, mode: string, variant: string): Candidate => ({
        variant,
        key: file,
        description: `${file}: mode ${headMode(subject, file)} -> ${mode}`,
        build: () => new Map([[file, { bytes: subject.headTree.bytes(file)!, mode }]]),
      });
      const scripts = executables.filter((file) => isRepoSource(file) || /(^|\/)[^/.]+$|\.sh$/.test(file));
      return prefer(prefer(scripts, () => executables).map((file) => flip(file, '100644', 'lose-exec')), () => [...subject.pathMap.moves.values()].sort().map((file) => flip(file, '100755', 'gain-exec')));
    },
  },
  {
    id: 'M25',
    title: 'Miss a non-import site kind',
    expectedKillers: 'K3 (site inventory)',
    candidates: (subject) => subject.rewritten.filter((site) => !['import', 'mock'].includes(site.site.kind)).map((site) => ({ ...revert(subject, site), variant: site.site.kind as SiteKind })),
  },
  {
    id: 'M26',
    title: 'Edit a non-reference string containing the path',
    expectedKillers: 'K2',
    candidates(subject) {
      const fragments: [string, string][] = [];
      for (const [from, to] of subject.pathMap.moves) {
        const strip = (file: string) => splitExtension(subject.packageRoot && file.startsWith(`${subject.packageRoot}/`) ? file.slice(subject.packageRoot.length + 1) : file)[0];
        const [oldPath, newPath] = [strip(from), strip(to)];
        fragments.push([oldPath, newPath]);
        const lastTwo = (file: string) => file.split('/').slice(-2).join('/');
        if (lastTwo(oldPath).includes('/')) fragments.push([lastTwo(oldPath), lastTwo(newPath)]);
      }
      const literals = touchedSources(subject).flatMap((file) => {
        const parsed = parse(subject, file);
        if (!parsed) return [];
        const spans = (subject.analyses.head.files.get(file)?.sites ?? []).map((site) => [site.start, site.end]);
        const found: { file: string; start: number; end: number; text: string }[] = [];
        const visit = (node: ts.Node) => {
          if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            const start = node.getStart(parsed.source) + 1;
            const end = node.getEnd() - 1;
            if (!spans.some(([siteStart, siteEnd]) => siteStart! < end && start < siteEnd!) && end - start >= 3) found.push({ file, start, end, text: parsed.text.slice(start, end) });
          }
          ts.forEachChild(node, visit);
        };
        visit(parsed.source);
        return found;
      });
      const withPath = literals.flatMap((literal) => {
        const fragment = fragments.find(([oldPath]) => literal.text.includes(oldPath));
        return fragment ? [{ literal, from: fragment[0], to: fragment[1] }] : [];
      });
      if (withPath.length) {
        return withPath.map(({ literal, from, to }) => ({
          variant: 'old-path-text',
          key: `${literal.file}@${literal.start}`,
          description: `${literal.file}: non-reference string ${quote(literal.text.slice(0, 60))} edited (${quote(from)} -> ${quote(to)})`,
          build: () => editSpans(subject, literal.file, [{ start: literal.start, end: literal.end, text: literal.text.split(from).join(to) }]),
        }));
      }
      return literals.map((literal) => ({
        variant: 'any-string',
        key: `${literal.file}@${literal.start}`,
        description: `${literal.file}: non-reference string ${quote(literal.text.slice(0, 60))} edited to start with 'modules/' (no string holds an old path)`,
        build: () => editSpans(subject, literal.file, [{ start: literal.start, end: literal.start, text: 'modules/' }]),
      }));
    },
  },
  {
    id: 'M27',
    title: 'Create a shadowing file',
    expectedKillers: 'K1, K3 (all files)',
    candidates(subject) {
      const moved = new Set(subject.pathMap.moves.values());
      const sites = prefer(headSites(subject).filter((reference) => moved.has(resolvedFile(reference.site) ?? '')), () => headSites(subject));
      const byTarget = new Map<string, Candidate>();
      const moves: Candidate[] = [];
      let movableSources: string[] | undefined;
      const donors = () => (movableSources ??= touchedSources(subject).filter((file) => inPackage(subject, file) && movable(subject, file) && !isToolConfig(file)));
      for (const reference of sites) {
        const target = resolvedFile(reference.site);
        if (!target || !isRepoSource(target) || ['triple-slash', 'url-reference'].includes(reference.site.kind) || byTarget.has(target)) continue;
        const ending = endingOf(reference.site.specifier, target);
        const format = subject.analyses.head.files.get(target)?.format ?? 'cjs';
        let shadow: string | null = null;
        let variant = '';
        if (ending?.kind === 'directory') {
          shadow = `${posix.dirname(target)}${/\.(ts|tsx)$/.test(target) ? '.ts' : '.js'}`;
          variant = 'file-beside-directory';
        } else if ((ending?.kind === 'bare' || ending?.kind === 'mapped') && /\.(ts|tsx)$/.test(target) && !isDeclaration(target)) {
          shadow = `${splitExtension(target)[0]}.js`;
          variant = 'js-beside-ts';
        }
        if (!shadow || isTracked(subject, shadow) || subject.headTree.directories.has(shadow)) continue;
        const shadowPath = shadow;
        byTarget.set(target, {
          variant,
          key: shadowPath,
          description: `new ${shadowPath} shadows ${target} for ${quote(reference.site.specifier)} in ${reference.file} (and every other importer)`,
          build: () => new Map([[shadowPath, { bytes: Buffer.from(format === 'esm' ? 'export {};\n' : 'module.exports = {};\n'), mode: '100644' }]]),
        });
        // The same shadow made by a move (nothing added, K1's tree-set check is satisfied): only resolution over
        // every file, including the importers nobody edited, sees `reference` flip.
        for (const donor of donors().filter((file) => file !== target && splitExtension(file)[1] === splitExtension(shadowPath)[1]).slice(0, 3)) {
          moves.push({
            variant: 'moved-into-shadow',
            key: `${donor}->${shadowPath}`,
            description: `${donor} moved to ${shadowPath} (importers rewritten), which shadows ${target} for ${quote(reference.site.specifier)} in ${reference.file} (and every other importer)`,
            build: () => moveWithImporters(subject, donor, shadowPath),
          });
        }
      }
      return [...byTarget.values(), ...moves];
    },
  },
  {
    id: 'M28',
    title: 'Move a file under baseUrl to the name of an npm package',
    expectedKillers: 'K3 (all files)',
    candidates(subject) {
      const root = subject.headFs.root;
      const packageOf = (specifier: string) => /^(@[^/:]+\/[^/:]+|[^./@:][^/:]*)(\/|$)/.exec(specifier)?.[1];
      const shadows = new Map<string, { name: string; importer: string; destinationStem: string }>();
      for (const reference of headSites(subject)) {
        const name = packageOf(reference.site.specifier);
        if (!name || reference.site.resolution.type === 'file' || reference.site.kind === 'triple-slash') continue;
        const baseUrl = subject.headScopes(reference.file).options.baseUrl;
        if (!baseUrl) continue;
        const destinationStem = posix.join(posix.relative(root, baseUrl.split(path.sep).join('/')), name);
        if (!shadows.has(destinationStem)) shadows.set(destinationStem, { name, importer: reference.file, destinationStem });
      }
      const donors = touchedSources(subject).filter((file) => inPackage(subject, file) && movable(subject, file) && !isToolConfig(file) && !isDeclaration(file));
      return [...shadows.values()].flatMap(({ name, importer, destinationStem }) => donors.slice(0, 3).map((donor) => {
        const to = destinationStem + splitExtension(donor)[1];
        return {
          key: `${donor}->${to}`,
          description: `${donor} moved to ${to} (importers rewritten): under baseUrl it shadows the package '${name}' that ${importer} imports`,
          build: () => (isTracked(subject, to) || subject.headTree.directories.has(destinationStem) ? null : moveWithImporters(subject, donor, to)),
        };
      }));
    },
  },
  {
    id: 'M29',
    title: 'Introduce a __mocks__ basename collision',
    expectedKillers: 'K1, K6 (haste map)',
    candidates(subject) {
      const mocks = [...subject.headTree.entries.keys()].filter((file) => /(^|\/)__mocks__\/[^/]+$/.test(file) && !file.split('/').includes('node_modules')).sort();
      const directories = [...new Set([...subject.pathMap.moves.values()].filter((file) => !isCoMoveArtifact(file)).map((file) => posix.dirname(file)))].sort();
      return mocks.flatMap((mock) => directories.filter((directory) => posix.join(directory, '__mocks__') !== posix.dirname(mock)).slice(0, 2).flatMap((directory) => {
        const copy = posix.join(directory, '__mocks__', posix.basename(mock));
        if (isTracked(subject, copy)) return [];
        return [{
          key: `${mock}->${copy}`,
          description: `second manual mock ${copy} with the basename of ${mock}`,
          build: () => new Map([[copy, { bytes: subject.headTree.bytes(mock)!, mode: headMode(subject, mock) }]]),
        }];
      }));
    },
  },
  {
    id: 'M30',
    title: 'Edit alias config inconsistently (tsconfig paths, Jest moduleNameMapper, Vite alias)',
    expectedKillers: 'K2, K3 (multi-resolver)',
    candidates(subject) {
      const instances: Candidate[] = [];
      for (const file of [...subject.headTree.entries.keys()].sort()) {
        if (file.split('/').includes('node_modules')) continue;
        const text = headText(subject, file);
        if (text === undefined) continue;
        const edit = (variant: string, anchor: RegExp, value: RegExp, insert: (value: string) => string | null) => {
          const at = anchor.exec(text);
          if (!at) return;
          value.lastIndex = at.index + at[0].length;
          const match = value.exec(text);
          if (!match) return;
          const start = match.index + match[0].indexOf(match[1]!);
          const replaced = insert(match[1]!);
          if (replaced === null) return;
          instances.push({
            variant,
            key: `${file}@${start}`,
            description: `${file}: ${variant} target ${quote(match[1]!)} -> ${quote(replaced)} (other resolvers' config unchanged)`,
            build: () => editFile(subject, file, text.slice(0, start) + replaced + text.slice(start + match[1]!.length)),
          });
        };
        const insertSegment = (value: string) => {
          const star = value.search(/\*|\$1/);
          return star === -1 ? null : `${value.slice(0, star)}moved/${value.slice(star)}`;
        };
        if (/(^|\/)tsconfig[^/]*\.json$/.test(file)) edit('tsconfig-paths', /"paths"\s*:\s*\{/, /\[\s*"([^"\\]*)"/g, insertSegment);
        if (/(^|\/)jest\.config\.[^/]+$/.test(file) || (posix.basename(file) === 'package.json' && /"jest"\s*:/.test(text))) {
          edit('jest-moduleNameMapper', /moduleNameMapper["']?\s*:\s*\{/, /:\s*\[?\s*["']([^"'\\]*)["']/g, insertSegment);
        }
        if (/(^|\/)(vite|vitest)\.config\.[^/]+$/.test(file)) edit('vite-alias', /alias\s*:\s*[{[]/, /(?:replacement\s*:|:)[^'"]*?["']([^"'\\]+)["']/g, (value) => `${value.replace(/\/$/, '')}/moved`);
      }
      return instances;
    },
  },
];

export const operatorIds = operators.map((operator) => operator.id);

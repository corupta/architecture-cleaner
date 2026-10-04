// K3a resolution identity under TypeScript (plan §3.4, research 04b C2): every source file f of base and its head
// counterpart g = map(f) belong to the same tsconfig programs, keep their module format, and under each program
// every site i of g resolves to map(what site i of f resolved to), by the same resolver; unresolved sites keep
// their text. Covers every file, not just edited ones, so shadowing (a new `src/foo.ts` beside `src/foo/index.ts`)
// and retargeting are caught. Rewritten specifiers must keep their form class (specifier-form.ts). Mock sites go
// through the analyzer's model of Jest moduleNameMapper / Vite aliases; the runners' own resolvers are K3b's.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createSiteResolver, type SiteResolver } from '../analyzer/analyze.js';
import { moduleResolutionHost, toAbsolute, toRelative } from '../analyzer/repo-fs.js';
import { loadRunnerConfig, type RunnerConfig } from '../analyzer/runner-config.js';
import { loadScopes, type ScopeLookup } from '../analyzer/tsconfig-scopes.js';
import type { Analysis, AnalyzedFile, Resolution } from '../analyzer/types.js';
import { formChanges, specifierForm } from './specifier-form.js';
import { type Check, type CertifyContext, type Finding, result, type Side, type Violation } from './types.js';

const title = 'Resolution identity under TypeScript';
const isRelative = (specifier: string) => /^\.\.?(\/|$)/.test(specifier);

interface Model {
  analysis: Analysis;
  scopes: ScopeLookup;
  runner: RunnerConfig;
  resolve: SiteResolver;
  /** A type reference directive (`types` entry, `/// <reference types>`) from `containingFile` (repo-relative) under `options`. */
  resolveTypes(name: string, containingFile: string, options: ts.CompilerOptions): Resolution;
  automaticTypes(options: ts.CompilerOptions): string[];
  read(file: string): string | undefined;
}

function modelOf(context: CertifyContext, side: Side, analysis: Analysis): Model {
  const repo = context.fs[side];
  const runner = loadRunnerConfig(repo);
  const host = moduleResolutionHost(repo);
  return {
    analysis,
    scopes: loadScopes(repo),
    runner,
    resolve: createSiteResolver(repo, runner),
    resolveTypes(name, containingFile, options) {
      const resolved = ts.resolveTypeReferenceDirective(name, toAbsolute(repo, containingFile), options, host).resolvedTypeReferenceDirective?.resolvedFileName;
      if (!resolved) return { type: 'unresolved' };
      const relative = toRelative(repo, resolved);
      return relative.startsWith('..') || relative.split('/').includes('node_modules') ? { type: 'external', path: resolved, via: 'typescript' } : { type: 'file', path: relative, via: 'typescript' };
    },
    // TS < 6 includes every typeRoots package when `types` is unset; TS 6 only for '*'. Model the wider one.
    automaticTypes: (options) => ts.getAutomaticTypeDirectiveNames(options.types === undefined ? { ...options, types: ['*'] } : options, host),
    read: (file) => repo.read(file),
  };
}

const typesReference = /^\/\/\/\s*<reference\s+types\s*=\s*(["'])([^"']*)\1/;

/** Non-relative `/// <reference types="…" />` names in a file's header (relative ones are reference sites already). */
function typeReferences(text: string): string[] {
  if (!text.includes('<reference')) return [];
  return (ts.getLeadingCommentRanges(text, 0) ?? []).map((range) => typesReference.exec(text.slice(range.pos, range.end))?.[2])
    .filter((name): name is string => name !== undefined && !/^\.\.?\//.test(name));
}

/**
 * Workspace packages: repository directories the environment links into node_modules (`node_modules/a -> ../a`).
 * Resolution through such a link reads the environment checkout's working tree, not either commit.
 */
function workspaceLinks(context: CertifyContext): { link: string; directory: string }[] {
  const { checkout, linked } = context.environment;
  const links: { link: string; directory: string }[] = [];
  const visit = (directory: string, prefix: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name.startsWith('@') && !prefix.includes('@')) visit(absolute, `${prefix}${entry.name}/`);
      if (!entry.isSymbolicLink()) continue;
      let real: string;
      try {
        real = fs.realpathSync(absolute);
      } catch {
        continue;
      }
      const relative = path.relative(checkout, real).split(path.sep).join('/');
      if (!relative.startsWith('..') && !path.isAbsolute(relative) && !relative.split('/').includes('node_modules')) links.push({ link: `${prefix}${entry.name}`, directory: relative });
    }
  };
  for (const directory of linked) visit(path.join(checkout, directory, 'node_modules'), `${directory ? `${directory}/` : ''}node_modules/`);
  return links;
}

const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length;
const describe = (resolution: Resolution) => (resolution.type === 'unresolved' ? 'unresolved' : `${resolution.type} ${resolution.path} (${resolution.via})`);

/** One compile context of a file: a tsconfig program that includes it, or the fallback scope when none does. */
interface Program {
  label: string;
  before: { options: ts.CompilerOptions; reuse: boolean };
  after: { options: ts.CompilerOptions; reuse: boolean };
}

export function checkTypeScriptResolution(context: CertifyContext): { violations: Violation[]; findings: Finding[]; metrics: Record<string, number> } {
  const { pathMap } = context;
  const analyses = context.analyses();
  const base = modelOf(context, 'base', analyses.base);
  const head = modelOf(context, 'head', analyses.head);
  const violations = new Map<string, Violation>();
  const add = (file: string, detail: string) => violations.set(`${file}\0${detail}`, { file, detail });
  const findings: Finding[] = [];
  const counts = { resolutionMismatches: 0, formChanges: 0, contextChanges: 0, typeDirectiveMismatches: 0, workspaceLinks: 0, virtualModuleSplits: 0 };
  const metrics = { files: 0, sites: 0, resolutions: 0, multiProgramFiles: 0, rewrittenSpecifiers: 0, typeDirectives: 0, addedFiles: 0, deletedFiles: 0 };
  // Unresolved relative sites name a path that no tracked file has (virtual mocks, generated or untracked files).
  const virtualPaths: { file: string; specifier: string; before: string; after: string }[] = [];

  function compareSites(file: AnalyzedFile, later: AnalyzedFile, programs: Program[]) {
    const mismatches = new Map<string, { detail: string; labels: string[] }>();
    const formProblems = new Map<string, string>();
    for (const program of programs) {
      const before = program.before.reuse ? file.sites.map((site) => site.resolution) : file.sites.map((site) => base.resolve(file.path, site, program.before.options));
      const after = program.after.reuse ? later.sites.map((site) => site.resolution) : later.sites.map((site) => head.resolve(later.path, site, program.after.options));
      metrics.resolutions += before.length;
      file.sites.forEach((site, index) => {
        const was = before[index]!;
        const is = after[index]!;
        const laterSite = later.sites[index]!;
        const expected: Resolution = was.type === 'file' ? { ...was, path: pathMap.map(was.path) } : was;
        const same = expected.type === 'unresolved'
          ? is.type === 'unresolved' && laterSite.specifier === site.specifier
          : is.type === expected.type && is.path === expected.path && is.via === expected.via;
        const sites = () => `line ${lineAt(context.head.text(later.path) ?? '', laterSite.start)}: ${site.kind} '${site.specifier}'${laterSite.specifier === site.specifier ? '' : ` -> '${laterSite.specifier}'`}`;
        const mismatch = (detail: string) => {
          const entry = mismatches.get(`${index}\0${detail}`) ?? { detail, labels: [] };
          entry.labels.push(program.label);
          mismatches.set(`${index}\0${detail}`, entry);
        };
        if (!same) {
          mismatch(`${sites()}: expected ${describe(expected)}, got ${is.type === 'unresolved' && expected.type === 'unresolved' ? 'unresolved with different text' : describe(is)}`);
          return;
        }
        if (site.kind === 'mock') {
          // Second opinion where the runner model is silent or partial: when TypeScript resolves the mock's text
          // in base (`vi.mock('./x.js')` for x.ts, which the Vite model leaves unresolved), it must still reach map(that) in head.
          const typescriptBefore = base.resolve(file.path, { ...site, kind: 'require' }, program.before.options);
          if (typescriptBefore.type !== 'unresolved') {
            const typescriptAfter = head.resolve(later.path, { ...laterSite, kind: 'require' }, program.after.options);
            const wanted = typescriptBefore.type === 'file' ? pathMap.map(typescriptBefore.path) : typescriptBefore.path;
            if (typescriptAfter.type !== typescriptBefore.type || typescriptAfter.path !== wanted) {
              mismatch(`${sites()}: as a module path (TypeScript) expected ${typescriptBefore.type} ${wanted}, got ${describe(typescriptAfter)}`);
              return;
            }
          }
        }
        if (laterSite.specifier === site.specifier || formProblems.has(`${index}`)) return;
        const forms = {
          before: specifierForm(site, was, { file: file.path, options: program.before.options, runner: base.runner, root: context.fs.base.root, read: base.read }),
          after: specifierForm(laterSite, is, { file: later.path, options: program.after.options, runner: head.runner, root: context.fs.head.root, read: head.read }),
        };
        const problems = formChanges({ before: site.specifier, after: laterSite.specifier, kind: site.kind, format: later.format }, forms,
          { before: was.type === 'unresolved' ? null : was.path, after: is.type === 'unresolved' ? null : is.path });
        if (problems.length) formProblems.set(`${index}`, `${sites()}: ${problems.join('; ')}`);
      });
    }
    for (const { detail, labels } of mismatches.values()) {
      counts.resolutionMismatches++;
      add(later.path, programs.length > 1 ? `${detail} under ${labels.join(', ')}` : detail);
    }
    for (const detail of formProblems.values()) {
      counts.formChanges++;
      add(later.path, `form class changes: ${detail}`);
    }
    file.sites.forEach((site, index) => {
      const specifier = later.sites[index]!.specifier;
      const relative = isRelative(site.specifier) || site.kind === 'triple-slash';
      if (site.resolution.type !== 'unresolved' || !relative || specifier !== site.specifier) return;
      virtualPaths.push({
        file: later.path,
        specifier,
        before: path.posix.join(path.posix.dirname(file.path), site.specifier),
        after: path.posix.join(path.posix.dirname(later.path), specifier),
      });
    });
  }

  for (const file of base.analysis.files.values()) {
    const target = pathMap.forward.get(file.path);
    if (target === undefined) {
      metrics.deletedFiles++;
      add(file.path, `deleted: its ${file.sites.length} reference sites have no counterpart in head`);
      continue;
    }
    const later = head.analysis.files.get(target);
    if (!later) {
      add(target, `${file.path} is a source file in base, ${target} is not one in head`);
      continue;
    }
    metrics.files++;
    if (file.format !== later.format) {
      counts.contextChanges++;
      add(target, `module format ${file.format} -> ${later.format}${target === file.path ? '' : ` (moved from ${file.path})`}`);
    }
    const programsBefore = base.scopes(file.path).programs;
    const programsAfter = head.scopes(target).programs;
    const mappedBefore = programsBefore.map((config) => pathMap.map(config)).sort();
    if (mappedBefore.join('\0') !== programsAfter.join('\0')) {
      counts.contextChanges++;
      add(target, `tsconfig programs [${programsBefore.join(', ')}] -> [${programsAfter.join(', ')}]`);
    }
    const programs: Program[] = [];
    // Outside every program (or every program gone): the scope each analysis used, which must be the same tsconfig.
    if (programsBefore.length === 0 || !programsBefore.some((config) => head.scopes.programs.has(pathMap.map(config)))) {
      if (programsBefore.length === 0 && pathMap.map(file.config ?? '') !== (later.config ?? '')) {
        counts.contextChanges++;
        add(target, `outside every program, its options come from ${file.config ?? 'the defaults'} in base and ${later.config ?? 'the defaults'} in head`);
      }
      programs.push({ label: file.config ?? 'default options', before: { options: base.scopes(file.path).options, reuse: true }, after: { options: head.scopes(target).options, reuse: true } });
    } else {
      for (const config of programsBefore) {
        const after = head.scopes.programs.get(pathMap.map(config));
        if (!after) continue;
        programs.push({ label: config, before: { options: base.scopes.programs.get(config)!.options, reuse: config === file.config }, after: { options: after.options, reuse: pathMap.map(config) === later.config } });
      }
    }
    if (programs.length > 1) metrics.multiProgramFiles++;
    if (file.sites.length !== later.sites.length) {
      add(target, `${file.sites.length} reference sites in base, ${later.sites.length} in head`);
      continue;
    }
    metrics.sites += file.sites.length;
    file.sites.forEach((site, index) => {
      if (site.kind !== later.sites[index]!.kind) add(target, `site ${index} changes kind: ${site.kind} -> ${later.sites[index]!.kind}`);
      if (site.specifier !== later.sites[index]!.specifier) metrics.rewrittenSpecifiers++;
    });
    compareSites(file, later, programs);
  }

  // Type reference directives: each program's `types` (or the automatic @types/typeRoots list) and every file's
  // non-relative `/// <reference types>` resolve to map(their base target): a moved typeRoots entry leaves the program.
  const sameType = (before: Resolution, after: Resolution) => (before.type === 'unresolved' ? after.type === 'unresolved'
    : after.type === before.type && after.path === (before.type === 'file' ? pathMap.map(before.path) : before.path));
  for (const [config, program] of base.scopes.programs) {
    const later = head.scopes.programs.get(pathMap.map(config));
    if (!later) continue;
    const names = base.automaticTypes(program.options);
    const laterNames = head.automaticTypes(later.options);
    if (names.join('\0') !== laterNames.join('\0')) {
      counts.typeDirectiveMismatches++;
      add(config, `type directives [${names.join(', ')}] -> [${laterNames.join(', ')}]`);
    }
    // TS resolves `types` entries from an inferred file in the tsconfig's directory.
    const inferred = (configPath: string) => path.posix.join(path.posix.dirname(configPath), '__inferred type names__.ts');
    for (const name of names) {
      const before = base.resolveTypes(name, inferred(config), program.options);
      const after = head.resolveTypes(name, inferred(pathMap.map(config)), later.options);
      metrics.typeDirectives++;
      if (sameType(before, after)) continue;
      counts.typeDirectiveMismatches++;
      add(config, `type directive '${name}': expected ${describe(before.type === 'file' ? { ...before, path: pathMap.map(before.path) } : before)}, got ${describe(after)}`);
    }
  }
  for (const file of base.analysis.files.values()) {
    const target = pathMap.forward.get(file.path);
    const names = typeReferences(base.read(file.path) ?? '');
    if (target === undefined || names.length === 0) continue;
    const laterNames = typeReferences(head.read(target) ?? '');
    names.forEach((name, index) => {
      const before = base.resolveTypes(name, file.path, base.scopes(file.path).options);
      const after = laterNames[index] === undefined ? { type: 'unresolved' as const } : head.resolveTypes(laterNames[index]!, target, head.scopes(target).options);
      metrics.typeDirectives++;
      if (laterNames[index] === name && sameType(before, after)) return;
      counts.typeDirectiveMismatches++;
      add(target, `/// <reference types="${name}" />: expected ${describe(before.type === 'file' ? { ...before, path: pathMap.map(before.path) } : before)}, got ${laterNames[index] === name ? describe(after) : `'${laterNames[index]}'`}`);
    });
  }

  for (const { link, directory } of workspaceLinks(context)) {
    const inside = [...pathMap.moves].filter(([from, to]) => [from, to].some((file) => directory === '' || file.startsWith(`${directory}/`)));
    if (inside.length) {
      counts.workspaceLinks++;
      add(link, `links the workspace package ${directory ? `${directory}/` : 'at the repository root'}, where ${inside.length} files moved (${inside.slice(0, 3).map(([from]) => from).join(', ')}${inside.length > 3 ? ', …' : ''}): `
        + 'resolution through the link reads the environment checkout, not the commits, so it is not certified');
    }
  }

  // Two sites that named the same missing path (a virtual mock and its user) must still agree, and two that didn't must not start to.
  const byBefore = new Map<string, Set<string>>();
  const byAfter = new Map<string, Set<string>>();
  for (const entry of virtualPaths) {
    byBefore.set(entry.before, (byBefore.get(entry.before) ?? new Set()).add(entry.after));
    byAfter.set(entry.after, (byAfter.get(entry.after) ?? new Set()).add(entry.before));
  }
  for (const entry of virtualPaths) {
    if (byBefore.get(entry.before)!.size > 1 || byAfter.get(entry.after)!.size > 1) counts.virtualModuleSplits++;
    if (byBefore.get(entry.before)!.size > 1) add(entry.file, `unresolved '${entry.specifier}' named ${entry.before} like other sites in base; they now name ${[...byBefore.get(entry.before)!].sort().join(', ')}`);
    if (byAfter.get(entry.after)!.size > 1) add(entry.file, `unresolved '${entry.specifier}' now names ${entry.after}, like sites that named ${[...byAfter.get(entry.after)!].sort().join(', ')} in base`);
    if (entry.before !== entry.after) {
      findings.push({ kind: 'unresolved-relative-moved', file: entry.file, detail: `unresolved '${entry.specifier}' named ${entry.before}, now ${entry.after}: an untracked, generated or virtual module at the old path is no longer reached` });
    }
  }

  for (const file of head.analysis.files.values()) {
    const origin = pathMap.inverse.get(file.path);
    if (origin === undefined) {
      metrics.addedFiles++;
      add(file.path, `added: its ${file.sites.length} reference sites have no counterpart in base`);
    } else if (!base.analysis.files.has(origin)) add(file.path, `a source file in head, but ${origin} is not one in base`);
  }
  return { violations: [...violations.values()], findings, metrics: { ...metrics, ...counts } };
}

export const typescriptResolution: Check = {
  id: 'K3a',
  title,
  run(context) {
    const { violations, findings, metrics } = checkTypeScriptResolution(context);
    const kinds: [keyof typeof metrics, string][] = [['resolutionMismatches', 'resolution mismatches'], ['formChanges', 'form-class changes'], ['contextChanges', 'program or format changes'],
      ['typeDirectiveMismatches', 'type directive mismatches'], ['workspaceLinks', 'workspace links over moves'], ['virtualModuleSplits', 'virtual module splits'], ['addedFiles', 'added source files'], ['deletedFiles', 'deleted source files']];
    const summary = violations.length
      ? `${violations.length} violations (${kinds.filter(([key]) => metrics[key]).map(([key, label]) => `${metrics[key]} ${label}`).join(', ')})`
      : `${metrics.sites} sites in ${metrics.files} files resolve to map(base) under every program (${metrics.multiProgramFiles} files in several); ${metrics.rewrittenSpecifiers} rewritten specifiers keep their form`;
    return result('K3a', title, { summary, violations, findings, metrics });
  },
};

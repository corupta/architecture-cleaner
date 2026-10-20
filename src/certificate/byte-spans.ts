// K2 byte-span confinement (plan §3.4): for every file, the head bytes at map(f) equal the base bytes of f
// outside the recognized specifier spans; non-source files are byte-identical. A rewritten span may not contain
// characters that could change how the rest of the file parses (quotes, backslashes, line breaks, `${`).
// Spans are only as good as their recognition, so in every moved or edited file each loader call must be one the
// extractor reads, through the real loader: a call it reads by name only (`require` bound to a parameter) has an
// argument that isn't a specifier relative to the file, and one it can't read (`(require)('./x')`) is invisible to
// K2 and K3 alike. A `vi` or `jest` imported from another package is the runner's only when the environment proves
// that package re-exports it (genuine-loaders.ts). Unmoved files may not reach a moved file through a loader call the
// extractor can't read, nor through an import in a file it doesn't read at all (a .vue component importing `@/services/user`).
// One more class of change is accepted (plan §2.3 S3): a source file whose bytes outside the spans differ in layout
// only (layout.ts: equal tokens and syntax trees, no directive near a changed line break), unless a source map maps its
// lines or a coverage gate measures its line totals. Each such file is a finding; without one the result is as before.
import path from 'node:path';
import ts from 'typescript';
import { isSourceFile } from '../analyzer/analyze.js';
import { coverageGates } from '../analyzer/coverage-settings.js';
import { scriptKindOf } from '../analyzer/reference-sites.js';
import type { ReferenceSite } from '../analyzer/types.js';
import { unwrapExpression } from './path-expressions.js';
import type { CommitTree } from './git-tree.js';
import { genuineReExports } from './genuine-loaders.js';
import { compareLayout, specifierPlaceholder } from './layout.js';
import type { SpanView } from './spans.js';
import { type Check, type CertifyContext, type Finding, result, type Violation } from './types.js';

const title = 'Byte-span confinement';
const unsafeSpan = /['"`\\\r\n\u2028\u2029]|\$\{/;

// The calls the extractor reads by callee name (src/analyzer/reference-sites.ts), and the roots of those names.
const loaderCallees = new Set(['require', 'require.resolve',
  'jest.mock', 'jest.doMock', 'jest.unmock', 'jest.dontMock', 'jest.requireActual', 'jest.requireMock', 'jest.createMockFromModule',
  'vi.mock', 'vi.doMock', 'vi.unmock', 'vi.doUnmock', 'vi.importActual', 'vi.importMock']);
const loaderRoots = new Set(['require', 'jest', 'vi', 'URL']);
// Imports that bind a root to the real thing: the runners' explicit globals, Node's URL.
const genuineImports: Record<string, Set<string>> = { jest: new Set(['@jest/globals']), vi: new Set(['vitest']), URL: new Set(['url', 'node:url']) };
// The runners' bindings another package may re-export (vite-plus/test re-exports vitest's vi).
const reExportable = { jest: genuineImports.jest!, vi: genuineImports.vi! };

/** Whether `import { name } from 'module'` in `file` binds the real loader root. */
type GenuineImport = (name: string, module: string) => boolean;
const byName: GenuineImport = (name, module) => genuineImports[name]?.has(module) === true;
const loaderHint = /\brequire\b|\bimport\s*\(|\b(jest|vi)\s*\.|\bURL\b/;

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index++) if (text.charCodeAt(index) === 10) line++;
  return line;
}

interface LoaderCall {
  /** Offset of the first character inside the literal's quotes (a site's `start` when the extractor reads it). */
  start: number;
  specifier: string;
  /** The callee's root name (require, jest, vi, URL); null for import(). */
  root: string | null;
  text: string;
}

/** `(0, f)(…)` and `(f as T)(…)` call f. */
function unwrapCallee(expression: ts.Expression): ts.Expression {
  let node = unwrapExpression(expression);
  while (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) node = unwrapExpression(node.right);
  return node;
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const object = calleeName(unwrapCallee(expression.expression));
    return object === null ? null : `${object}.${expression.name.text}`;
  }
  return null;
}

/** A local `require` that loads relative to this file: `createRequire(import.meta.url)` or `createRequire(__filename)`. */
function isFileRequire(declaration: ts.VariableDeclaration): boolean {
  const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
  if (!initializer || !ts.isCallExpression(initializer) || !/(^|\.)createRequire$/.test(calleeName(unwrapCallee(initializer.expression)) ?? '')) return false;
  const anchor = initializer.arguments[0]?.getText().replace(/\s/g, '');
  return anchor === 'import.meta.url' || anchor === '__filename';
}

/**
 * Loader-shaped calls whose argument is a literal once parentheses and casts are peeled off, and the loader roots
 * (require, jest, vi, URL) the file binds at runtime to something other than the real loader, with the line.
 */
function scanLoaders(file: string, text: string, genuineImport: GenuineImport = byName): { calls: LoaderCall[]; shadowed: Map<string, number> } {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const calls: LoaderCall[] = [];
  const shadowed = new Map<string, number>();
  // Ambient declarations (`declare const jest`, anything in a .d.ts) bind no value: a call still reaches the global.
  const ambient = (node: ts.Node) => sourceFile.isDeclarationFile
    || ts.findAncestor(node, (ancestor) => ts.canHaveModifiers(ancestor) && (ts.getModifiers(ancestor)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) ?? false)) !== undefined;
  const declare = (name: ts.Node | undefined, genuine = false) => {
    if (!name || !ts.isIdentifier(name) || !loaderRoots.has(name.text) || genuine || shadowed.has(name.text) || ambient(name)) return;
    shadowed.set(name.text, sourceFile.getLineAndCharacterOfPosition(name.getStart(sourceFile)).line + 1);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || (ts.isNewExpression(node) && node.arguments?.length === 2)) {
      const argument = node.arguments?.[0];
      const literal = argument && unwrapExpression(argument);
      const callee = node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'import' : calleeName(unwrapCallee(node.expression));
      const loader = ts.isNewExpression(node) ? callee === 'URL' && node.arguments![1]!.getText(sourceFile) === 'import.meta.url' : callee === 'import' || loaderCallees.has(callee ?? '');
      // A URL resolves `data.json` like `./data.json`, against the file; an absolute one or one with a scheme doesn't.
      const fileUrl = !ts.isNewExpression(node) || (literal !== undefined && ts.isStringLiteralLike(literal) && !/^(\/|[a-z][a-z\d+.-]*:)/i.test(literal.text));
      if (loader && fileUrl && literal && ts.isStringLiteralLike(literal)) {
        const specifier = ts.isNewExpression(node) && !/^\.{1,2}\//.test(literal.text) ? `./${literal.text}` : literal.text;
        calls.push({ start: literal.getStart(sourceFile) + 1, specifier, root: callee === 'import' ? null : callee!.split('.')[0]!, text: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 100) });
      }
    }
    if (ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text;
      const { name, namedBindings } = node.importClause;
      declare(name);
      if (namedBindings && ts.isNamespaceImport(namedBindings)) declare(namedBindings.name);
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          if (!element.isTypeOnly) declare(element.name, (element.propertyName ?? element.name).text === element.name.text && genuineImport(element.name.text, module));
        }
      }
    } else if (ts.isVariableDeclaration(node)) declare(node.name, ts.isIdentifier(node.name) && node.name.text === 'require' && isFileRequire(node));
    else if (ts.isBindingElement(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node)
      || ts.isClassExpression(node) || ts.isImportEqualsDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) declare(node.name);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { calls, shadowed };
}

/** Problems with the loader calls of a moved or edited file (its head text and sites). */
function loaderViolations(file: string, text: string, sites: readonly ReferenceSite[], genuineImport: GenuineImport): string[] {
  if (!loaderHint.test(text)) return [];
  const { calls, shadowed } = scanLoaders(file, text, genuineImport);
  const starts = new Set(sites.map((site) => site.start));
  const problems: string[] = [];
  for (const call of calls) {
    if (!starts.has(call.start)) problems.push(`line ${lineOf(text, call.start)}: ${call.text} loads a module in a form the span extractor doesn't read, so neither K2 nor K3 sees its specifier`);
    else if (call.root !== null && shadowed.has(call.root)) {
      problems.push(`line ${lineOf(text, call.start)}: ${call.text} calls the '${call.root}' declared on line ${shadowed.get(call.root)}, not the module loader: '${call.specifier}' isn't a specifier relative to this file`);
    }
  }
  return problems;
}

const stemOf = (file: string) => file.replace(/(\.d)?\.[cm]?[jt]sx?$/, '').replace(/\/index$/, '');

/**
 * Whether a specifier written in `directory` may name the base path `moved`: a relative one by its path, an alias or
 * baseUrl path (`@/services/user`, `src/services/user`) by its tail, within the same package only (an alias is the
 * package's own; `$lib/services/album.service` in web/ never names server/src/services/album.service.ts).
 */
function mayName(directory: string, specifier: string, moved: string, packageOf: (file: string) => string): boolean {
  const movedStem = stemOf(moved);
  if (/^\.\.?(\/|$)/.test(specifier)) {
    const target = stemOf(path.posix.normalize(path.posix.join(directory, specifier)).replace(/\/$/, ''));
    return movedStem === target || movedStem.startsWith(`${target}/`) || moved.startsWith(`${target}.`);
  }
  if (packageOf(path.posix.join(directory, '_')) !== packageOf(moved)) return false;
  const segments = specifier.replace(/\/$/, '').split('/');
  const tail = stemOf(segments.slice(/^@./.test(specifier) ? 2 : 1).join('/'));
  return tail !== '' && (movedStem === tail || movedStem.endsWith(`/${tail}`));
}

/** The directory of the nearest package.json above a file ('' for the root), in a tree. */
function packageLookup(tree: CommitTree): (file: string) => string {
  const manifests = new Set([...tree.entries.keys()].filter((file) => path.posix.basename(file) === 'package.json').map((file) => path.posix.dirname(file)));
  return (file) => {
    for (let directory = path.posix.dirname(file); directory !== '.'; directory = path.posix.dirname(directory)) if (manifests.has(directory)) return directory;
    return '';
  };
}

/** Where two chunk lists first differ, as a line number in the head file and a short excerpt of each side. */
function firstDifference(before: SpanView, after: SpanView): string {
  const beforeText = before.chunks.join('\u0000');
  const afterText = after.chunks.join('\u0000');
  let index = 0;
  while (index < beforeText.length && index < afterText.length && beforeText[index] === afterText[index]) index++;
  // Map the offset in the joined head chunks back to the head file (spans re-inserted).
  let headOffset = 0;
  let consumed = 0;
  for (let chunk = 0; chunk < after.chunks.length; chunk++) {
    const length = after.chunks[chunk]!.length;
    if (index <= consumed + length) {
      headOffset += index - consumed;
      break;
    }
    headOffset += length + (after.raw[chunk]?.length ?? 0);
    consumed += length + 1;
  }
  const headText = after.chunks.map((chunk, position) => chunk + (after.raw[position] ?? '')).join('');
  const excerpt = (text: string) => JSON.stringify(text.slice(Math.max(0, index - 30), index + 50));
  return `line ${lineOf(headText, headOffset)}: ${excerpt(beforeText)} -> ${excerpt(afterText)}`;
}

/** Unmoved, unchanged files that load a moved file through a call the extractor can't read (its text can't follow the move). */
function unreadLoadersOfMovedFiles(context: CertifyContext, files: string[]): Violation[] {
  const { base, pathMap, views } = context;
  if (pathMap.moves.size === 0) return [];
  base.prefetch(files);
  const packageOf = packageLookup(base);
  const violations: Violation[] = [];
  for (const file of files) {
    const text = base.text(file);
    if (text === undefined || !loaderHint.test(text)) continue;
    const reaching = scanLoaders(file, text).calls.flatMap((call) => {
      const moved = [...pathMap.moves.keys()].find((from) => mayName(path.posix.dirname(file), call.specifier, from, packageOf));
      return moved === undefined ? [] : [{ call, moved }];
    });
    if (reaching.length === 0) continue;
    const starts = new Set(views.base(file)?.sites.map((site) => site.start));
    for (const { call, moved } of reaching) {
      if (starts.has(call.start)) continue;
      violations.push({ file, detail: `line ${lineOf(text, call.start)}: ${call.text} may load moved ${moved} (now ${pathMap.map(moved)}) in a form the span extractor doesn't read, so its specifier can't follow the move` });
    }
  }
  return violations;
}

// Single-file components and documents with module syntax that only their own toolchain reads (a bundler plugin):
// the span extractor treats them as text, so their imports can neither follow a move nor be checked.
const componentFile = /\.(vue|svelte|astro|mdx|marko)$/;
const componentImport = /\b(?:import|export)\s+(?:[^'";]*?\bfrom\s*)?(['"])([^'"\n]+)\1|\b(?:import|require)\s*\(\s*(['"])([^'"\n]+)\3\s*\)/g;

/** Component files that move with relative imports, or whose imports may name a moved file. */
function unreadComponentImports(context: CertifyContext): Violation[] {
  const { base, pathMap } = context;
  if (pathMap.moves.size === 0) return [];
  const components = [...pathMap.forward].filter(([from]) => componentFile.test(from) && !from.split('/').includes('node_modules'));
  base.prefetch(components.map(([from]) => from));
  const packageOf = packageLookup(base);
  const violations: Violation[] = [];
  for (const [from, to] of components) {
    const text = base.text(from) ?? '';
    for (const match of text.matchAll(componentImport)) {
      const specifier = (match[2] ?? match[4])!;
      const where = `line ${lineOf(text, match.index)}: '${specifier}'`;
      if (from !== to && /^\.\.?(\/|$)/.test(specifier)) {
        violations.push({ file: from, detail: `moved to ${to}; ${where} is a relative import in a file the span extractor doesn't read, so it can't follow the move` });
        continue;
      }
      const moved = [...pathMap.moves.keys()].find((candidate) => mayName(path.posix.dirname(from), specifier, candidate, packageOf));
      if (moved !== undefined) violations.push({ file: from, detail: `${where} may name moved ${moved} (now ${pathMap.map(moved)}) in a file the span extractor doesn't read, so it can't follow the move` });
    }
  }
  return violations;
}

// Configs whose coverage settings a gate can measure (analyzer/coverage-settings.ts decides whether one does).
const coverageConfig = /(^|\/)(package\.json|(jest|vitest|vite)([.-][^/]*)?\.(config|workspace)([.-][^/]*)?\.[cm]?[jt]s|jest([.-][^/]*)?\.json|\.nycrc(\.(json|ya?ml))?|\.c8rc(\.json)?)$/;

/** Where a coverage gate over a head file is (a threshold, a CLI flag), from the configs in its directory and above. */
function coverageGateOver(context: CertifyContext): (file: string) => string | null {
  let gate: ((config: string) => string | null) | undefined;
  const configs = [...context.head.entries.keys()].filter((file) => coverageConfig.test(file) && !file.split('/').includes('node_modules')).sort();
  return (file) => {
    gate ??= coverageGates(context.fs.head);
    for (const config of configs) {
      const directory = path.posix.dirname(config);
      if (directory !== '.' && !file.startsWith(`${directory}/`)) continue;
      const where = gate(config);
      if (where) return `${where} (over ${config})`;
    }
    return null;
  };
}

export function checkByteSpans(context: CertifyContext): { violations: Violation[]; metrics: Record<string, number>; findings: Finding[] } {
  const { base, head, pathMap, views } = context;
  const violations: Violation[] = [];
  const findings: Finding[] = [];
  let compared = 0;
  let changedSpans = 0;
  let editedFiles = 0;
  let layoutOnlyFiles = 0;
  const gateOver = coverageGateOver(context);
  const reExports = genuineReExports(context.environment.checkout, reExportable);
  const loaderCheck = (file: string, view: SpanView | undefined) => {
    const text = view?.source ? head.text(file) : undefined;
    const genuineImport: GenuineImport = (name, module) => byName(name, module) || reExports(name, module, file);
    if (text !== undefined) for (const detail of loaderViolations(file, text, view!.sites, genuineImport)) violations.push({ file, detail });
  };
  const unchanged: string[] = [];
  for (const [from, to] of pathMap.forward) {
    const baseEntry = base.entries.get(from)!;
    const headEntry = head.entries.get(to)!;
    if (baseEntry.oid === headEntry.oid) {
      if (from !== to) loaderCheck(to, views.head(to));
      else if (isSourceFile(from) && baseEntry.mode !== '120000') unchanged.push(from);
      continue;
    }
    compared++;
    const before = views.base(from);
    const after = views.head(to);
    if (!before || !after) {
      violations.push({ file: to, detail: 'content changed and could not be read (submodule or missing blob)' });
      continue;
    }
    if (!before.utf8 || !after.utf8) {
      violations.push({ file: to, detail: 'content changed in a file that is not valid UTF-8' });
      continue;
    }
    if (!before.source || !after.source) {
      violations.push({ file: to, detail: 'content changed in a file without specifier spans (only module specifiers may change)' });
      continue;
    }
    if (before.sites.length !== after.sites.length) {
      violations.push({ file: to, detail: `${before.sites.length} reference sites in base, ${after.sites.length} in head; ${firstDifference(before, after)}` });
      continue;
    }
    const differentChunk = before.chunks.findIndex((chunk, index) => chunk !== after.chunks[index]);
    if (differentChunk !== -1) {
      const layout = compareLayout(to, before.chunks.join(specifierPlaceholder), after.chunks.join(specifierPlaceholder));
      if (!layout.layoutOnly) {
        violations.push({ file: to, detail: `bytes outside specifier spans changed, ${firstDifference(before, after)}; not layout only: ${layout.problem}` });
        continue;
      }
      if (head.entries.has(`${to}.map`)) {
        violations.push({ file: to, detail: `layout only, but ${to}.map maps its lines and columns` });
        continue;
      }
      const gate = layout.changedBreaks ? gateOver(to) : null;
      if (gate) {
        violations.push({ file: to, detail: `layout only, but its line breaks changed and a coverage gate measures its line totals: ${gate}` });
        continue;
      }
      layoutOnlyFiles++;
      findings.push({
        kind: 'layout-only',
        file: to,
        detail: layout.changedBreaks
          ? `layout only: line breaks changed in ${layout.changedBreaks} places from line ${layout.firstLine}, ${layout.lineDelta >= 0 ? '+' : ''}${layout.lineDelta} lines; stack traces name its later lines by their new numbers`
          : 'layout only: spaces between tokens or a trailing comma changed, no line break',
      });
    }
    let edited = false;
    before.sites.forEach((site, index) => {
      const later = after.sites[index]!;
      if (site.kind !== later.kind) violations.push({ file: to, detail: `site ${index} changed kind: ${site.kind} -> ${later.kind}` });
      if (before.raw[index] === after.raw[index]) return;
      edited = true;
      changedSpans++;
      if (unsafeSpan.test(after.raw[index]!)) violations.push({ file: to, detail: `rewritten specifier ${JSON.stringify(after.raw[index])} contains quote, escape, line-break or template characters` });
    });
    if (edited) editedFiles++;
    loaderCheck(to, after);
  }
  violations.push(...unreadLoadersOfMovedFiles(context, unchanged));
  violations.push(...unreadComponentImports(context));
  // The layout-only count only when there is one: a result without one is byte for byte what it was before S3.
  return { violations, metrics: { comparedFiles: compared, editedFiles, changedSpans, ...(layoutOnlyFiles ? { layoutOnlyFiles } : {}) }, findings };
}

export const byteSpanConfinement: Check = {
  id: 'K2',
  title,
  run(context) {
    const { violations, metrics, findings } = checkByteSpans(context);
    const layout = metrics.layoutOnlyFiles ? `; ${metrics.layoutOnlyFiles} files changed in layout only (equal tokens and syntax trees)` : '';
    const summary = violations.length
      ? `${violations.length} violations: bytes outside specifier spans, or loader calls whose spans can't be checked`
      : `${metrics.changedSpans} specifier spans changed in ${metrics.editedFiles} files${layout}; every other byte identical`;
    return result('K2', title, { summary, violations, metrics, findings });
  },
};

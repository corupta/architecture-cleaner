// Findings in the code at the run's base commit (plan §2.3 findings log), all deterministic: tables written by files
// of several plan groups, a base class that injects many dependencies into many subclasses (immich's BaseService:
// how many of the injected members each subclass touches), production code that imports test code, and the plan
// validator's warnings for the plan the run executed.
import ts from 'typescript';
import { testPattern, testSupportPattern } from '../planner/facts-roles.js';
import { validatePlan } from '../planner/validate.js';
import type { Target } from './target.js';
import type { CollectedFinding } from './types.js';

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A table written (Kysely/Prisma/Drizzle write calls, facts `tables.writes`) by files of two or more plan groups. */
export function multiWriterTableFindings(target: Target): CollectedFinding[] {
  const writers = new Map<string, string[]>();
  const readers = new Map<string, string[]>();
  for (const file of target.facts.files) {
    for (const table of file.tables.writes) writers.set(table, [...(writers.get(table) ?? []), file.path]);
    for (const table of file.tables.reads) readers.set(table, [...(readers.get(table) ?? []), file.path]);
  }
  const groupOf = (file: string) => target.groupOf.get(file) ?? 'unplaced';
  const findings: CollectedFinding[] = [];
  for (const [table, files] of [...writers].sort((a, b) => byCodeUnit(a[0], b[0]))) {
    const byGroup = new Map<string, string[]>();
    for (const file of files) byGroup.set(groupOf(file), [...(byGroup.get(groupOf(file)) ?? []), target.repoPath(file)]);
    if (byGroup.size < 2) continue;
    const readerFiles = readers.get(table) ?? [];
    const readerGroups = new Set(readerFiles.map(groupOf));
    findings.push({
      key: table,
      kind: 'multi-writer-table',
      title: `Table ${table} is written by ${byGroup.size} groups`,
      files: files.map(target.repoPath),
      evidence: [
        `Table ${table} is written by ${plural(files.length, 'file')} in ${byGroup.size} plan groups${readerFiles.length ? ` (and read by ${plural(readerFiles.length, 'file')} in ${plural(readerGroups.size, 'group')})` : ''}:`,
        ...[...byGroup].sort((a, b) => byCodeUnit(a[0], b[0])).map(([group, groupFiles]) => `- ${group}: ${groupFiles.sort(byCodeUnit).join(', ')}`),
      ].join('\n'),
      source: 'facts',
      weight: byGroup.size,
    });
  }
  return findings;
}

/** A class whose constructor injects at least this many members (parameter properties)... */
export const godInjectionMembers = 10;
/** ...and that at least this many classes extend. */
export const godInjectionSubclasses = 3;
const listedMembers = 8;

interface ClassInfo {
  name: string;
  /** Package-relative. */
  file: string;
  declaration: ts.ClassDeclaration;
  sourceFile: ts.SourceFile;
  injected: { name: string; type: string | null }[];
}

function classesOf(sourceFile: ts.SourceFile, file: string): ClassInfo[] {
  const classes: ClassInfo[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const constructor = node.members.find(ts.isConstructorDeclaration);
      const injected = (constructor?.parameters ?? []).filter((parameter) => ts.isParameterPropertyDeclaration(parameter, constructor!) && ts.isIdentifier(parameter.name))
        .map((parameter) => ({ name: (parameter.name as ts.Identifier).text, type: parameter.type ? parameter.type.getText(sourceFile) : null }));
      classes.push({ name: node.name.text, file, declaration: node, sourceFile, injected });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return classes;
}

/** The class an `extends X` names: X's import (or X itself in the same file), resolved by the analyzer to a file. */
function extendedClass(target: Target, subclass: ClassInfo): { file: string; name: string } | null {
  const heritage = subclass.declaration.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
  if (!heritage || !ts.isIdentifier(heritage)) return null;
  const local = heritage.text;
  for (const statement of subclass.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    const imported = bindings && ts.isNamedImports(bindings) ? bindings.elements.find((element) => element.name.text === local) : undefined;
    if (!imported) continue;
    const specifier = statement.moduleSpecifier.text;
    const site = target.analysis.files.get(target.repoPath(subclass.file))?.sites.find((candidate) => candidate.kind === 'import' && candidate.specifier === specifier);
    if (site?.resolution.type !== 'file') return null;
    const prefix = target.repoPath('');
    return { file: site.resolution.path.startsWith(prefix) ? site.resolution.path.slice(prefix.length) : site.resolution.path, name: (imported.propertyName ?? imported.name).text };
  }
  return { file: subclass.file, name: local };
}

/** `this.<member>` reads in a class body, for members in `names`. */
function membersTouched(declaration: ts.ClassDeclaration, names: ReadonlySet<string>): Set<string> {
  const touched = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword && names.has(node.name.text)) touched.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  for (const member of declaration.members) visit(member);
  return touched;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const listOf = (names: string[]) => (names.length > listedMembers ? `${names.slice(0, listedMembers).join(', ')}, … ${names.length - listedMembers} more` : names.join(', '));

/**
 * A base class whose constructor injects >= godInjectionMembers members and that >= godInjectionSubclasses classes
 * extend: every subclass receives every member; the evidence counts how many each one touches (this.<member>).
 */
export function godInjectionFindings(target: Target): CollectedFinding[] {
  const classes = target.productionFiles.flatMap((file) => {
    const text = target.repo.read(target.repoPath(file));
    return text === undefined ? [] : classesOf(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), file);
  });
  const extended = new Map(classes.map((candidate) => [candidate, extendedClass(target, candidate)]));
  const findings: CollectedFinding[] = [];
  for (const base of classes.filter((candidate) => candidate.injected.length >= godInjectionMembers)) {
    const subclasses = classes.filter((candidate) => candidate !== base && extended.get(candidate)?.file === base.file && extended.get(candidate)?.name === base.name);
    if (subclasses.length < godInjectionSubclasses) continue;
    const names = new Set(base.injected.map((member) => member.name));
    const uses = subclasses.map((subclass) => ({ subclass, touched: [...membersTouched(subclass.declaration, names)].sort(byCodeUnit) }))
      .sort((a, b) => b.touched.length - a.touched.length || byCodeUnit(a.subclass.name, b.subclass.name));
    const counts = uses.map((use) => use.touched.length);
    const average = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const usersOf = new Map(base.injected.map((member) => [member.name, uses.filter((use) => use.touched.includes(member.name)).length]));
    const unused = base.injected.map((member) => member.name).filter((name) => usersOf.get(name) === 0);
    const mostUsed = [...usersOf].filter(([, users]) => users > 0).sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0])).slice(0, 5);
    const repositories = base.injected.filter((member) => member.type?.endsWith('Repository')).length;
    const total = base.injected.length;
    const busiest = uses[0]!;
    findings.push({
      key: `${base.file}\0${base.name}`,
      kind: 'god-injection',
      title: `${base.name} injects ${total} members into ${subclasses.length} classes`,
      files: [base.file, ...subclasses.map((subclass) => subclass.file)].map(target.repoPath),
      evidence: [
        `${base.name} (${target.repoPath(base.file)}) takes ${total} constructor-injected members${repositories ? ` (${repositories} of them repositories)` : ''}, and ${subclasses.length} classes extend it, so each receives all ${total}.`,
        `Each subclass reads ${average.toFixed(1)} of them on average through this.<member> (median ${median(counts)}, min ${Math.min(...counts)}, max ${busiest.touched.length} in ${busiest.subclass.name}); ${unused.length ? `${plural(unused.length, 'member')} no subclass reads: ${listOf(unused)}` : 'every member has a reader'}.`,
        `Most read: ${mostUsed.map(([name, users]) => `${name} (${users} classes)`).join(', ')}.`,
        `Per class (members read of ${total}):`,
        ...uses.map(({ subclass, touched }) => `- ${subclass.name} (${target.repoPath(subclass.file)}): ${touched.length}${touched.length ? ` (${listOf(touched)})` : ''}`),
      ].join('\n'),
      source: 'facts',
      weight: total * subclasses.length,
    });
  }
  return findings;
}

/** Production code (module root, neither a test nor test support) whose import resolves to a test file or test support. */
export function testImportFindings(target: Target): CollectedFinding[] {
  const prefix = target.repoPath('');
  const isTestCode = (repoPath: string) => {
    const packagePath = repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath;
    return testPattern.test(packagePath) || testSupportPattern.test(packagePath);
  };
  const findings: CollectedFinding[] = [];
  for (const file of target.productionFiles) {
    const importer = target.repoPath(file);
    const references = (target.analysis.files.get(importer)?.sites ?? []).flatMap((site) =>
      site.kind !== 'mock' && site.resolution.type === 'file' && isTestCode(site.resolution.path) ? [{ site, resolved: site.resolution.path }] : []);
    if (!references.length) continue;
    const text = target.repo.read(importer) ?? '';
    const lineOf = (offset: number) => text.slice(0, offset).split('\n').length;
    findings.push({
      key: importer,
      kind: 'prod-imports-test',
      title: `Production code imports test code: ${importer}`,
      files: [importer, ...references.map((reference) => reference.resolved)],
      evidence: [
        `${importer} is production code (no test, no test support), yet ${plural(references.length, 'reference')} resolve to test code:`,
        ...references.map(({ site, resolved }) => `- line ${lineOf(site.start)}: ${site.kind} '${site.specifier}' → ${resolved}${site.typeOnly ? ' (type only)' : ''}`),
      ].join('\n'),
      source: 'analyzer',
      weight: references.length,
    });
  }
  return findings;
}

/** The plan validator's warnings for the run's plan, recomputed over the facts at the base commit. */
export function planWarningFindings(target: Target): { findings: CollectedFinding[]; errors: string[] } {
  const validation = validatePlan(target.facts, target.draft, target.plan);
  const findings = validation.issues.filter((issue) => issue.severity === 'warning').map((issue): CollectedFinding => ({
    key: `${issue.code}\0${issue.group ?? ''}\0${issue.file ?? issue.detail}`,
    kind: 'plan-warning',
    title: `Plan warning (${issue.code}): ${issue.group ?? issue.file ?? 'the plan'}`,
    files: issue.file ? [target.repoPath(issue.file)] : [],
    evidence: `The plan validator's rule ${issue.code}, on the run's plan.yaml${issue.group ? ` (group ${issue.group})` : ''}: ${issue.detail}`,
    source: 'validator',
    weight: 1,
  }));
  return { findings, errors: validation.issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.code}: ${issue.detail}`) };
}

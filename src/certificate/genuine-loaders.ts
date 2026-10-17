// K2: whether an imported `vi` or `jest` is the test runner's own, so that `vi.mock('./x')` names a path relative to
// the calling file. Imported from the runner's module itself (`vitest`, `@jest/globals`) it is; imported from another
// package it is only when the environment proves that package re-exports the runner's binding: vite-plus/test is
// `export * from 'vitest'` (kaneo). Every file the package can load for that specifier (each condition of its
// `exports` but `types`) must re-export the name from the runner's module, directly or through files proven so in
// turn, and define nothing of that name itself. Anything else is unproven, and the call stays a violation.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { stripBom } from '../analyzer/analyze.js';
import { installedPackage } from './runtime-probe.js';

const maxDepth = 4;
const extensions = ['', '.js', '.mjs', '.cjs', '/index.js', '/index.mjs', '/index.cjs'];

/** `@scope/name/sub` -> { name: '@scope/name', subpath: './sub' }; relative, absolute and `node:` specifiers -> undefined. */
function packageSpecifier(specifier: string): { name: string; subpath: string } | undefined {
  if (/^(\.|\/|[a-z][a-z0-9+.-]*:)/i.test(specifier)) return undefined;
  const segments = specifier.split('/');
  const length = specifier.startsWith('@') ? 2 : 1;
  if (segments.length < length || segments.slice(0, length).some((segment) => segment === '')) return undefined;
  const rest = segments.slice(length).join('/');
  return { name: segments.slice(0, length).join('/'), subpath: rest ? `./${rest}` : '.' };
}

const existingFile = (candidate: string) => (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() ? fs.realpathSync(candidate) : undefined);

/**
 * Every file a package maps the subpath to: each target of its `exports` entry under any condition but `types`, or
 * without `exports`, `main` (the subpath itself for deep imports). Undefined when it can't tell (patterns, no entry).
 */
function targetsOf(directory: string, subpath: string): string[] | undefined {
  let manifest: { exports?: unknown; main?: unknown };
  try {
    manifest = JSON.parse(stripBom(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))) as typeof manifest;
  } catch {
    return undefined;
  }
  if (manifest.exports === undefined) {
    const relative = subpath === '.' ? (typeof manifest.main === 'string' ? manifest.main : 'index.js') : subpath;
    const file = extensions.map((extension) => existingFile(path.join(directory, `${relative}${extension}`))).find((candidate) => candidate !== undefined);
    return file ? [file] : undefined;
  }
  const { exports } = manifest;
  const bySubpath = typeof exports === 'object' && exports !== null && !Array.isArray(exports) && Object.keys(exports).some((key) => key.startsWith('.'));
  const entry = bySubpath ? (exports as Record<string, unknown>)[subpath] : subpath === '.' ? exports : undefined;
  const targets: string[] = [];
  const collect = (value: unknown): boolean => {
    // null: not exported under that condition.
    if (value === null) return true;
    if (typeof value === 'string') {
      const file = value.startsWith('./') && !value.includes('*') ? existingFile(path.join(directory, value)) : undefined;
      if (file) targets.push(file);
      return file !== undefined;
    }
    if (Array.isArray(value)) return value.every(collect);
    if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).every(([condition, target]) => condition === 'types' || collect(target));
    return false;
  };
  return entry !== undefined && collect(entry) && targets.length ? [...new Set(targets)] : undefined;
}

/**
 * The modules a file re-exports `name` from: `export { name } from 'm'` (these win), else every `export * from 'm'`,
 * or CommonJS that is exactly `module.exports = require('m')`. Undefined when the file defines or renames the name
 * itself, or when it can't tell.
 */
function reExportSources(file: string, name: string): string[] | undefined {
  let text: string;
  try {
    text = stripBom(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const named: string[] = [];
  const stars: string[] = [];
  let module = false;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) module = true;
    else if (ts.isExportDeclaration(statement)) {
      module = true;
      const from = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
      if (!statement.exportClause) {
        if (from === undefined) return undefined;
        stars.push(from);
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        if (statement.exportClause.name.text === name) return undefined;
      } else {
        for (const element of statement.exportClause.elements) {
          if (element.name.text !== name) continue;
          if (from === undefined || (element.propertyName ?? element.name).text !== name) return undefined;
          named.push(from);
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      module = true;
      if (name === 'default') return undefined;
    } else if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      module = true;
      if (ts.getModifiers(statement)!.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
        if (name === 'default') return undefined;
        continue;
      }
      const declared = ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.flatMap((declaration) => (ts.isIdentifier(declaration.name) ? [declaration.name.text] : ['']))
        : [(statement as ts.DeclarationStatement).name?.getText(sourceFile) ?? ''];
      // A destructuring export can bind anything; a declaration of the name defines it here.
      if (declared.includes(name) || declared.includes('')) return undefined;
    }
  }
  if (module) return named.length ? named : stars.length ? stars : undefined;
  const statements = sourceFile.statements.filter((statement) => !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === 'use strict'));
  const only = statements.length === 1 ? statements[0]! : undefined;
  if (!only || !ts.isExpressionStatement(only) || !ts.isBinaryExpression(only.expression) || only.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return undefined;
  const { left, right } = only.expression;
  const required = ts.isCallExpression(right) && ts.isIdentifier(right.expression) && right.expression.text === 'require' && right.arguments.length === 1 && ts.isStringLiteral(right.arguments[0]!) ? right.arguments[0].text : undefined;
  return left.getText(sourceFile) === 'module.exports' && required !== undefined ? [required] : undefined;
}

/**
 * `prove(name, module, file)`: whether `module`, installed for the repo-relative `file` in the environment checkout,
 * re-exports the genuine `name` (one of `genuine[name]`, the runner's own modules).
 */
export function genuineReExports(checkout: string, genuine: Readonly<Record<string, ReadonlySet<string>>>): (name: string, module: string, file: string) => boolean {
  const cache = new Map<string, boolean>();
  const provesFile = (name: string, file: string, depth: number): boolean => {
    const sources = depth < maxDepth ? reExportSources(file, name) : undefined;
    return sources !== undefined && sources.every((source) => provesModule(name, source, path.dirname(file), depth + 1));
  };
  const provesModule = (name: string, module: string, from: string, depth: number): boolean => {
    if (genuine[name]?.has(module)) return true;
    if (module.startsWith('./') || module.startsWith('../')) {
      const file = extensions.map((extension) => existingFile(path.join(from, `${module}${extension}`))).find((candidate) => candidate !== undefined);
      return file !== undefined && provesFile(name, file, depth);
    }
    const specifier = packageSpecifier(module);
    const directory = specifier && installedPackage(from, specifier.name);
    if (!specifier || !directory) return false;
    const key = `${name}\0${fs.realpathSync(directory)}\0${specifier.subpath}`;
    const known = cache.get(key);
    if (known !== undefined) return known;
    const targets = targetsOf(directory, specifier.subpath);
    const proven = targets !== undefined && targets.every((target) => provesFile(name, target, depth));
    cache.set(key, proven);
    return proven;
  };
  return (name, module, file) => genuine[name] !== undefined && provesModule(name, module, path.join(checkout, path.posix.dirname(file)), 0);
}

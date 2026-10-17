// string-flow.ts: what a token inside a JS/TS file is to the program, on one-file snippets.
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { followsSubstitution, isCommentAt, stringUses, stringValueAt } from '../../src/certificate/string-flow.js';

/** The use of the first occurrence of `needle` in `text`, as if the file lived at `file`. */
function useOf(text: string, needle: string, file = 'src/a.ts') {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const offset = text.indexOf(needle);
  if (offset === -1) throw new Error(`no ${needle}`);
  return stringUses(file, sourceFile)(offset);
}
const consumer = (text: string, needle: string) => {
  const use = useOf(text, needle);
  return use.kind === 'consumed' ? use.consumer : use.kind;
};

describe('string-flow', () => {
  it('tells comments, JSDoc and types from values', () => {
    expect(useOf('// see admin/x\nexport const a = 1;\n', 'admin/x').kind).toBe('comment');
    expect(useOf('/** Uses admin/x. */\nexport function f() {}\n', 'admin/x').kind).toBe('comment');
    expect(useOf("type T = 'admin/x' | `team/${string}`;\n", 'admin/x').kind).toBe('type');
    expect(useOf("type T = 'admin/x' | `team/${string}`;\n", 'team/').kind).toBe('type');
    expect(useOf("interface I { 'admin/x': number }\n", 'admin/x').kind).toBe('type');
    expect(useOf("export const value = 'admin/x';\n", 'admin/x').kind).toBe('open');
    expect(useOf("const o = { 'admin/x': 1 };\nexport default o;\n", 'admin/x').kind).toBe('open');
  });

  it('names the consumers that take something other than a path', () => {
    expect(consumer("import { Get } from '@nestjs/common';\nclass C { @Get('admin/:id') get() {} }\n", 'admin/')).toBe('an HTTP route (Get from @nestjs/common)');
    expect(consumer("import { createRoute } from '@hono/zod-openapi';\nexport const r = createRoute({ path: '/admin/{id}' });\n", '/admin')).toBe('an HTTP route (createRoute from @hono/zod-openapi)');
    expect(consumer("describe.each([1])('admin/x %s', () => {});\n", 'admin/x')).toBe('the title of a describe() block');
    expect(consumer("expect(x).not.toEqual({ path: 'admin/x' });\n", 'admin/x')).toBe('a value toEqual compares');
    expect(consumer("expect(x).toEqual(expect.stringContaining('admin/x'));\n", 'admin/x')).toBe('a value expect.stringContaining compares');
    expect(consumer("if (topic === 'admin/x') run();\n", 'admin/x')).toBe('a comparison');
    expect(consumer("switch (topic) { case 'admin/x': break; }\n", 'admin/x')).toBe('a switch case');
    expect(consumer("export const field = { description: 'An ID (of admin/x)' };\n", 'admin/x')).toBe('prose (the description of an object)');
    expect(consumer("throw new Error(`admin/${id} failed`);\n", 'admin/')).toBe('an error message (new Error)');
  });

  it('follows a string through a constant, a loop and a local function, and stops where it is unknown', () => {
    expect(consumer("const TOPIC = 'admin/x';\nconsole.log(TOPIC);\n", 'admin/x')).toBe('console output (console.log)');
    expect(consumer("for (const t of ['admin/x']) console.info(t);\n", 'admin/x')).toBe('console output (console.info)');
    expect(consumer("function get(path: string) { return fetch(`https://h${path}`); }\nget('/admin/x');\n", '/admin/x')).toBe('a URL (fetch)');
    // Exported, returned, assigned, or read through `arguments`: the string can go anywhere.
    expect(useOf("export const TOPIC = 'admin/x';\n", 'admin/x').kind).toBe('open');
    expect(useOf("const TOPIC = 'admin/x';\nexport { TOPIC };\n", 'admin/x').kind).toBe('open');
    expect(useOf("export const f = () => 'admin/x';\n", 'admin/x').kind).toBe('open');
    expect(useOf("function get(path: string) { return read(arguments[0]); }\nget('admin/x');\n", 'admin/x').kind).toBe('open');
    expect(useOf("function get(path: string) { path = path + '/'; return fetch(path); }\nget('admin/x');\n", 'admin/x').kind).toBe('open');
    // A test table is data the test function receives; an imported function of the same name as a known one is not it.
    expect(useOf("it.each(['admin/x'])('reads %s', (file) => read(file));\n", 'admin/x').kind).toBe('open');
    expect(useOf("import { Get } from './routes';\nGet('admin/x');\n", 'admin/x').kind).toBe('open');
  });

  it('judges a segment of a path built from the file location by the path it builds', () => {
    const use = useOf("import { resolve } from 'node:path';\nexport const util = resolve(__dirname, './src/util');\n", './src/util', 'kernel/vite.config.ts');
    expect(use).toEqual({ kind: 'path-expression', expression: "resolve(__dirname, './src/util')", values: [{ anchor: 'repo', text: '/repo/kernel/src/util', complete: true }] });
    expect(useOf("import { resolve } from 'node:path';\nexport const util = resolve(process.cwd(), './src/util');\n", './src/util').kind).toBe('open');
  });

  it('locates substitutions and the static end of a template', () => {
    const text = 'export const url = (base: string, id: string) => `${base.trim()}/team/hook/${id}/done`;\n';
    const sourceFile = ts.createSourceFile('src/a.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(followsSubstitution(sourceFile, text.indexOf('/team'))).toBe(true);
    expect(followsSubstitution(sourceFile, text.indexOf('team'))).toBe(false);
    expect(stringValueAt(sourceFile, text.indexOf('/team'))).toEqual({ literal: false, tail: '/done' });
    expect(isCommentAt(sourceFile, text.indexOf('/team'))).toBe(false);
  });
});

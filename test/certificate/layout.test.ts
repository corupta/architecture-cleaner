// K2's layout-only class (plan §2.3 S3): a genuine re-wrap of import lines passes, alone, next to moves, or in a file
// that was moved too (path-map.ts pairs it by its import layout key); every layout-looking change that isn't one fails
// with a violation naming the first differing token, the side with syntax errors, the changed tree, the changed gap
// outside an import or export declaration, or the directive; a K2 result without a layout-only file is exactly what
// it was before the class existed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { byteSpanConfinement, checkByteSpans } from '../../src/certificate/byte-spans.js';
import { certify } from '../../src/certificate/certify.js';
import { compareLayout, joinChunks } from '../../src/certificate/layout.js';
import { certifyFiles, checkOf, localNodeModules, variant, vitestRepo } from './runner-repos.js';
import { type Tree, twoCommits, withContext } from './two-commit-repo.js';

const k2 = (base: Tree, head: Tree) => withContext(base, head, checkByteSpans);
const details = (base: Tree, head: Tree) => k2(base, head).violations.map((violation) => violation.detail);

const oneLine = "import { alpha, beta, gamma } from './letters';\nexport const all = [alpha, beta, gamma];\n";
const wrapped = "import {\n  alpha,\n  beta,\n  gamma,\n} from './letters';\nexport const all = [alpha, beta, gamma];\n";
const letters = 'export const alpha = 1;\nexport const beta = 2;\nexport const gamma = 3;\n';

describe('K2 accepts a layout-only change', () => {
  it('passes a re-wrap of an import line (trailing comma added) and reports the file as a finding', () => {
    const result = k2({ 'src/all.ts': oneLine, 'src/letters.ts': letters }, { 'src/all.ts': wrapped, 'src/letters.ts': letters });
    expect(result.violations).toEqual([]);
    expect(result.metrics).toEqual({ comparedFiles: 1, editedFiles: 0, changedSpans: 0, layoutOnlyFiles: 1 });
    expect(result.findings).toEqual([{ kind: 'layout-only', file: 'src/all.ts', detail: 'layout only: line breaks changed in 4 places from line 1, +4 lines; stack traces name its later lines by their new numbers' }]);
  });

  it('passes the reverse (a multi-line clause joined, its trailing comma removed) and an export-from clause', () => {
    expect(details({ 'src/all.ts': wrapped, 'src/letters.ts': letters }, { 'src/all.ts': oneLine, 'src/letters.ts': letters })).toEqual([]);
    const reExport = (text: string) => ({ 'src/index.ts': text, 'src/letters.ts': letters });
    expect(details(reExport("export { alpha, beta } from './letters';\n"), reExport("export {\n  alpha,\n  beta,\n} from './letters';\n"))).toEqual([]);
  });

  it('passes spaces changed between tokens with no line break, and says no line moved', () => {
    const result = k2({ 'src/all.ts': oneLine.replace('{ alpha, beta, gamma }', '{alpha,beta,gamma}'), 'src/letters.ts': letters }, { 'src/all.ts': oneLine, 'src/letters.ts': letters });
    expect(result.violations).toEqual([]);
    expect(result.findings.map((finding) => finding.detail)).toEqual(['layout only: spaces between tokens or a trailing comma changed, no line break']);
  });

  it('passes a re-wrap together with a specifier rewrite of the same declaration, the target moved in the same commit', () => {
    const result = k2({ 'src/all.ts': oneLine, 'src/letters.ts': letters }, { 'src/all.ts': wrapped.replace('./letters', './modules/letters/letters'), 'src/modules/letters/letters.ts': letters });
    expect(result.violations).toEqual([]);
    expect(result.metrics).toEqual({ comparedFiles: 1, editedFiles: 1, changedSpans: 1, layoutOnlyFiles: 1 });
  });

  it('still checks a rewritten span in a layout-only file', () => {
    expect(details({ 'src/all.ts': oneLine, 'src/letters.ts': letters }, { 'src/all.ts': wrapped.replace('./letters', "./let' + 'ters"), 'src/letters.ts': letters })[0]).toMatch(/not layout only|quote/);
  });

  it('passes a directive that stays clear of the changed lines', () => {
    const base = `// @ts-expect-error: not typed\nimport legacy from './legacy';\n${oneLine}`;
    const head = `// @ts-expect-error: not typed\nimport legacy from './legacy';\n${wrapped}`;
    expect(details({ 'src/all.ts': base, 'src/letters.ts': letters, 'src/legacy.js': 'module.exports = 1;\n' }, { 'src/all.ts': head, 'src/letters.ts': letters, 'src/legacy.js': 'module.exports = 1;\n' })).toEqual([]);
  });
});

describe('K2 rejects layout-looking changes that are not layout only', () => {
  const rejected = (file: string, base: string, head: string) => {
    const found = details({ [file]: base }, { [file]: head });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^bytes outside specifier spans changed, line \d+: .*; not layout only: /);
    return found[0]!.replace(/^.*; not layout only: /, '');
  };

  it('a line break that changes automatic semicolon insertion', () => {
    expect(rejected('src/f.ts', 'export function f(x: number) {\n  return x;\n}\n', 'export function f(x: number) {\n  return\n  x;\n}\n'))
      .toBe('same tokens, different syntax tree near head line 2: a line break changed how the code parses (automatic semicolon insertion)');
    expect(rejected('src/g.ts', 'let a = 1;\nlet b = 2;\na\n++b;\n', 'let a = 1;\nlet b = 2;\na++\nb;\n')).toMatch(/^token \d+ differs|different syntax tree/);
  });

  it('whitespace inside a string, a template literal or JSX text', () => {
    expect(rejected('src/s.ts', "export const s = 'a b';\n", "export const s = 'a  b';\n")).toBe('token 5 differs: base has token "\'a b\'" on line 1, head has token "\'a  b\'" on line 1');
    expect(rejected('src/t.ts', 'const x = 1;\nexport const t = `a ${x} b`;\n', 'const x = 1;\nexport const t = `a ${x}\n b`;\n')).toMatch(/^token \d+ differs: base has token "\} b`"/);
    expect(rejected('src/v.tsx', 'export const v = <div>a b</div>;\n', 'export const v = <div>a\n  b</div>;\n')).toMatch(/^token \d+ differs: base has token "a b"/);
    expect(rejected('src/w.tsx', 'export const w = <b>x</b>;\nexport const v = <div> {w}</div>;\n', 'export const w = <b>x</b>;\nexport const v = <div>{w}</div>;\n')).toMatch(/^token \d+ differs: base has token " "/);
    expect(rejected('src/j.tsx', 'export const j = <div>// text</div>;\n', 'export const j = <div>//  text</div>;\n')).toMatch(/^token \d+ differs: base has token "\/\/ text"/);
  });

  it('a comma that is not a trailing comma of an import or export clause', () => {
    const call = 'declare function f(a: number, b: number): number;\nexport const c = f(1, 2);\n';
    expect(rejected('src/c.ts', call, call.replace('f(1, 2)', 'f(\n  1,\n  2,\n)'))).toMatch(/^token \d+ differs: base has token "\)" on line 2, head has token ","/);
    expect(rejected('src/d.ts', 'export const d = [1, 2];\n', 'export const d = [1, 2,];\n')).toMatch(/^token \d+ differs/);
    expect(rejected('src/e.ts', 'export const e = [1, 2];\n', 'export const e = [1 2];\n')).toMatch(/^token \d+ differs/);
    const attributes = "import data from './data.json' with { type: 'json' };\nexport { data };\n";
    expect(rejected('src/h.ts', attributes, attributes.replace("{ type: 'json' }", "{\n  type: 'json',\n}"))).toMatch(/^token \d+ differs: base has token "\}"/);
  });

  it('a line break moved past a directive: before, inside, on the same line, or within the lines it reaches', () => {
    const directive = (comment: string) => `${comment}\n${oneLine}`;
    expect(rejected('src/a.ts', directive('// @ts-expect-error'), `// @ts-expect-error\n${wrapped}`)).toBe('the directive "// @ts-expect-error" on line 1 precedes or sits inside a statement whose line breaks changed');
    expect(rejected('src/b.ts', directive('// eslint-disable-next-line import/no-unresolved'), `// eslint-disable-next-line import/no-unresolved\n${wrapped}`)).toMatch(/^the directive "\/\/ eslint-disable-next-line import\/no-unresolved" on line 1 precedes/);
    expect(rejected('src/c.ts', "import { alpha, /* @ts-ignore */ beta } from './letters';\n", "import {\n  alpha,\n  /* @ts-ignore */ beta,\n} from './letters';\n")).toMatch(/precedes or sits inside/);
    const sameLine = "import { alpha, beta } from './letters'; // eslint-disable-line no-console\nexport const all = [alpha, beta];\n";
    expect(rejected('src/d.ts', sameLine, sameLine.replace('{ alpha, beta }', '{\n  alpha,\n  beta,\n}'))).toMatch(/^line breaks changed within the lines the directive "\/\/ eslint-disable-line no-console" on line \d applies to$/);
    const reach = "/* c8 ignore next 3 */\nexport const one = 1;\nimport { alpha, beta } from './letters';\nexport const two = [alpha, beta];\n";
    expect(rejected('src/e.ts', reach, reach.replace('{ alpha, beta }', '{\n  alpha,\n  beta,\n}'))).toMatch(/^line breaks changed within the lines the directive "\/\* c8 ignore next 3 \*\/" on line 1 applies to$/);
    const prettierIgnore = "// prettier-ignore\nimport { alpha,\n  beta } from './letters';\nexport const all = [alpha, beta];\n";
    expect(rejected('src/m.ts', prettierIgnore, prettierIgnore.replace('{ alpha,\n  beta }', '{ alpha, beta }'))).toMatch(/precedes or sits inside/);
  });

  it("a comment's text, a comment added, the shebang, a byte order mark", () => {
    expect(rejected('src/a.ts', `// letters\n${oneLine}`, `// letters!\n${oneLine}`)).toBe('token 1 differs: base has comment "// letters" on line 1, head has comment "// letters!" on line 1');
    expect(rejected('src/b.ts', oneLine, `${oneLine}// TODO\n`)).toMatch(/^token \d+ differs: base has the end of the file, head has comment "\/\/ TODO"/);
    expect(rejected('src/c.ts', `#!/usr/bin/env node\n${oneLine}`, `#!/usr/bin/env  node\n${oneLine}`)).toBe('the shebang line changed');
    expect(rejected('src/d.ts', oneLine, `\ufeff${oneLine}`)).toBe('the byte order mark was added');
  });

  it('spaces that make an HTML-like comment for Node (<!--, a line-leading -->): outside an import or export declaration', () => {
    expect(rejected('src/a.js', 'let x = 1, y = 2;\nexports.z = x < !--y;\n', 'let x = 1, y = 2;\nexports.z = x <!--y;\n')).toBe('the whitespace between token "<" on line 2 and token "!" on line 2 changed outside an import or export declaration');
    expect(rejected('src/b.js', 'let y = 2;\nexports.z = y-- > 0;\n', 'let y = 2;\nexports.z = y\n-- > 0;\n')).toMatch(/^different syntax tree|same tokens, different syntax tree|syntax errors/);
  });

  it('text between tokens that is neither whitespace nor a comment (conflict markers)', () => {
    expect(rejected('src/a.ts', 'export const a = 1;\n', '<<<<<<< ours\nexport const a = 1;\n>>>>>>> theirs\n')).toMatch(/neither whitespace nor a comment|token \d+ differs|syntax errors/);
  });

  it('a layout change in a file a source map maps, or under a coverage gate', () => {
    const files = (text: string, extra: Tree = {}): Tree => ({ 'src/all.ts': text, 'src/letters.ts': letters, ...extra });
    expect(details(files(oneLine, { 'src/all.ts.map': '{}' }), files(wrapped, { 'src/all.ts.map': '{}' }))).toEqual(['layout only, but src/all.ts.map maps its lines and columns']);
    expect(details(files(`${oneLine}//# sourceMappingURL=all.js.map\n`), files(`${wrapped}//# sourceMappingURL=all.js.map\n`))[0])
      .toMatch(/not layout only: its layout changed and a sourceMappingURL comment maps its lines and columns$/);
    const gated = { 'package.json': `${JSON.stringify({ name: 'gated', jest: { coverageThreshold: { global: { lines: 80 } } } })}\n` };
    expect(details(files(oneLine, gated), files(wrapped, gated))).toEqual(['layout only, but its line breaks changed and a coverage gate measures its line totals: a threshold in package.json (over package.json)']);
    const ungated = { 'package.json': `${JSON.stringify({ name: 'ungated', jest: { collectCoverageFrom: ['src/**'] } })}\n` };
    expect(details(files(oneLine, ungated), files(wrapped, ungated))).toEqual([]);
  });
});

describe('K2 accepts layout changes only inside top-level import and export-from declarations', () => {
  const rejected = (file: string, base: string, head: string) => {
    const found = details({ [file]: base }, { [file]: head });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/; not layout only: /);
    return found[0]!.replace(/^.*; not layout only: /s, '');
  };
  const outside = (between: string) => `the whitespace between ${between} changed outside an import or export declaration`;

  it('rejects a call re-wrapped, a blank line between statements or imports, an indent, and space at the end of the file', () => {
    const call = 'declare function f(a: number, b: number): number;\nexport const c = f(1, 2);\n';
    expect(rejected('src/a.ts', call, call.replace('f(1, 2)', 'f(\n  1, 2)'))).toBe(outside('token "(" on line 2 and token "1" on line 3'));
    expect(rejected('src/b.ts', 'export const a = 1;\nexport const b = 2;\n', 'export const a = 1;\n\nexport const b = 2;\n')).toBe(outside('token ";" on line 1 and token "export" on line 3'));
    const imports = "import { alpha } from './letters';\nimport { beta } from './letters';\nexport const all = [alpha, beta];\n";
    expect(rejected('src/c.ts', imports, imports.replace(";\nimport { beta }", ";\n\nimport { beta }"))).toBe(outside('token ";" on line 1 and token "import" on line 3'));
    expect(rejected('src/d.ts', 'export function d() {\n  return 1;\n}\n', 'export function d() {\n    return 1;\n}\n')).toBe(outside('token "{" on line 1 and token "return" on line 2'));
    expect(rejected('src/e.ts', 'export const e = 1;\n', 'export const e = 1;\n\n')).toBe(outside('token ";" on line 1 and the end of the file'));
  });

  it('rejects whitespace changed in an import nested in a module declaration, an export without a specifier, or around a declaration', () => {
    const nested = "declare module 'letters' {\n  import { alpha, beta } from './letters';\n  export { alpha, beta };\n}\n";
    expect(rejected('src/a.d.ts', nested, nested.replace('{ alpha, beta } from', '{\n    alpha,\n    beta } from'))).toBe(outside('token "{" on line 2 and token "alpha" on line 3'));
    expect(rejected('src/b.d.ts', nested, nested.replace('{ alpha, beta } from', '{ alpha, beta, } from'))).toMatch(/^token \d+ differs: base has token "\}" on line 2, head has token ","/);
    const local = 'const alpha = 1;\nconst beta = 2;\nexport { alpha, beta };\n';
    expect(rejected('src/c.ts', local, local.replace('{ alpha, beta }', '{\n  alpha,\n  beta\n}'))).toBe(outside('token "{" on line 3 and token "alpha" on line 4'));
    expect(rejected('src/d.ts', local, local.replace('{ alpha, beta }', '{ alpha, beta, }'))).toMatch(/^token \d+ differs: base has token "\}" on line 3, head has token ","/);
    expect(rejected('src/e.ts', oneLine, oneLine.replace("import {", "import  {").replace("';\nexport", "';  \nexport"))).toBe(outside('token ";" on line 1 and token "export" on line 2'));
  });

  it('L1: rejects a line break before an arrow\'s =>, which tsc (TS1200) and every runtime reject', () => {
    const arrow = 'declare function helper(value: number): number;\nexport const double = (value: number) => helper(value) * 2;\n';
    expect(rejected('src/a.ts', arrow, arrow.replace(') =>', ')\n  =>'))).toBe(outside('token ")" on line 2 and token "=>" on line 3'));
    expect(rejected('src/b.ts', 'export const f = async (x: number) => x;\n', 'export const f = async (x: number)\n=> x;\n')).toBe(outside('token ")" on line 1 and token "=>" on line 2'));
    expect(rejected('src/c.js', 'const f = x => x;\nmodule.exports = { f };\n', 'const f = x\n=> x;\nmodule.exports = { f };\n')).toBe(outside('token "x" on line 1 and token "=>" on line 2'));
  });

  it('L2: rejects a line break that attaches or detaches a JSDoc or @internal comment', () => {
    const detached = 'export const limit = 10; /** @internal */\nexport const resetForTests = (): void => {};\n';
    const attached = 'export const limit = 10;\n/** @internal */\nexport const resetForTests = (): void => {};\n';
    expect(rejected('src/a.ts', detached, attached)).toBe(outside('token ";" on line 1 and comment "/** @internal */" on line 2'));
    expect(rejected('src/b.ts', attached, detached)).toBe(outside('token ";" on line 1 and comment "/** @internal */" on line 1'));
    expect(rejected('src/c.ts', detached.replace('/**', '/*'), attached.replace('/**', '/*'))).toMatch(/^the whitespace between token ";" on line 1 and comment "\/\* @internal \*\/"/);
    expect(rejected('src/d.js', 'exports.a = 1; /** @param {string} name */\nexports.greet = (name) => name;\n', 'exports.a = 1;\n/** @param {string} name */\nexports.greet = (name) => name;\n')).toMatch(/^the whitespace between token ";" on line 1 and comment "\/\*\* @param/);
  });

  it('L4: rejects a changed gap holding a CR, U+2028, U+2029, a no-break space, or a line terminator the file does not use', () => {
    const terminator = (character: string) => `the whitespace between token "{" on line 1 and token "alpha" on line ${character === '\u00a0' ? 1 : 2} changed, and head has ${({ '\r': 'U+000D', '\u2028': 'U+2028', '\u2029': 'U+2029', '\u00a0': 'U+00A0' } as Record<string, string>)[character]} in it`;
    for (const character of ['\r', '\u2028', '\u2029', '\u00a0']) {
      expect(rejected('src/a.ts', oneLine, oneLine.replace('{ alpha', `{${character}  alpha`)).slice(0, terminator(character).length)).toBe(terminator(character));
    }
    expect(rejected('src/b.ts', 'export const a = 1;\nexport const b = 2;\n', 'export const a = 1;\u2028export const b = 2;\n')).toBe(outside('token ";" on line 1 and token "export" on line 2'));
    expect(rejected('src/c.ts', oneLine.replace('{ alpha', '{\u00a0alpha'), oneLine)).toMatch(/and base has U\+00A0 in it: only spaces, tabs and the file's line terminator \(\\n\) may change$/);
    const crlf = (text: string) => text.replaceAll('\n', '\r\n');
    expect(details({ 'src/d.ts': crlf(oneLine), 'src/letters.ts': letters }, { 'src/d.ts': crlf(wrapped), 'src/letters.ts': letters })).toEqual([]);
    expect(rejected('src/e.ts', crlf(oneLine), crlf(oneLine).replace('{ alpha', '{\n  alpha'))).toMatch(/and head has U\+000A in it: only spaces, tabs and the file's line terminator \(\\r\\n\) may change$/);
    expect(rejected('src/f.ts', oneLine.replace('\n', '\u2028'), oneLine.replace('\n', '\u2028').replace('{ alpha', '{\n  alpha'))).toMatch(/and head has U\+000A in it: only spaces, tabs and no line break \(the file's first one is a lone CR, U\+2028 or U\+2029\) may change$/);
  });

  it('L5: rejects a base with syntax errors whose head adds the missing separator as a line break', () => {
    expect(rejected('src/flags.ts', 'export class Flags { verbose = false dryRun = true }\n', 'export class Flags { verbose = false\n  dryRun = true }\n')).toBe('base has syntax errors');
    expect(rejected('src/calls.js', 'foo() bar()\n', 'foo()\nbar()\n')).toBe('base has syntax errors');
    expect(rejected('src/calls.ts', 'export const a = 1;\n', 'export const a = 1 export const b = 2;\n')).toMatch(/^token \d+ differs/);
  });

  it('L6: accepts an import re-wrap in a file that ends with a JSDoc comment', () => {
    const trailing = '/**\n * Loads a module.\n */\n';
    expect(compareLayout('a.ts', `${oneLine}${trailing}`, `${oneLine}${trailing}`)).toEqual({ layoutOnly: true, changedBreaks: 0, firstLine: 0, lineDelta: 0 });
    expect(compareLayout('a.ts', `${oneLine}${trailing}`, `${wrapped}${trailing}`)).toEqual({ layoutOnly: true, changedBreaks: 4, firstLine: 1, lineDelta: 4 });
    expect(compareLayout('a.ts', 'export const a = 1;\n/** trailing doc */\n', 'export const a = 1;\n/** trailing  doc */\n')).toMatchObject({ layoutOnly: false, problem: expect.stringMatching(/^token \d+ differs: base has comment "\/\*\* trailing doc \*\/"/) });
  });

  it('L3: a string literal that spells the placeholder cannot pass for a moved specifier span', () => {
    expect(joinChunks(["import a from '", "';\n"], ["import a from '", "';\n"])).toEqual(["import a from 'ac-specifier';\n", "import a from 'ac-specifier';\n"]);
    expect(joinChunks(["x('", "'); y('ac-specifier');\n"], ["x('ac-specifier-1'); y('", "');\n"])).toEqual(["x('ac-specifier-2'); y('ac-specifier');\n", "x('ac-specifier-1'); y('ac-specifier-2');\n"]);
    const assets = (icon: string, theme: string) => `export const icon = import.meta.resolve('${icon}');\nexport const theme = import.meta.resolve('${theme}');\n`;
    const tree = (text: string): Tree => ({ 'src/assets.ts': text, 'src/icon.svg': '<svg/>\n', 'package.json': '{ "name": "assets", "type": "module" }\n' });
    const found = details(tree(assets('./icon.svg', 'ac-specifier')), tree(assets('ac-specifier', './icon.svg')));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/not layout only: token \d+ differs: base has token "'ac-specifier-1'" on line 1, head has token "'ac-specifier'" on line 1$/);
  });
});

describe('compareLayout', () => {
  it('compares comments in the trailing comma it drops, and the comments of an empty file', () => {
    expect(compareLayout('a.ts', "import { a, /* x */ } from 'ac-specifier';\n", "import { a /* x */ } from 'ac-specifier';\n")).toMatchObject({ layoutOnly: true });
    expect(compareLayout('a.ts', "import { a /* x */, } from 'ac-specifier';\n", "import { a /* y */ } from 'ac-specifier';\n")).toMatchObject({ layoutOnly: false });
    expect(compareLayout('a.ts', '// only a comment\n', '// only a comment\n')).toEqual({ layoutOnly: true, changedBreaks: 0, firstLine: 0, lineDelta: 0 });
    expect(compareLayout('a.ts', '// only a comment\n', '\n\n// only a comment\n')).toEqual({ layoutOnly: false, problem: 'the whitespace between the start of the file and comment "// only a comment" on line 3 changed outside an import or export declaration' });
  });
});

describe('a K2 result without a layout-only file is unchanged', () => {
  const importer = (specifier: string) => `import { b } from '${specifier}';\nexport const a = b;\n`;

  it('keeps its metrics keys, summary and findings for a specifier-only change, a pure move and a violation', () => {
    const resultOf = (base: Tree, head: Tree) => withContext(base, head, (context) => byteSpanConfinement.run(context));
    expect(resultOf({ 'src/a.ts': importer('./b'), 'src/b.ts': 'export const b = 1;\n' }, { 'src/a.ts': importer('./lib/b'), 'src/lib/b.ts': 'export const b = 1;\n' })).toEqual({
      id: 'K2', title: 'Byte-span confinement', status: 'pass', summary: '1 specifier spans changed in 1 files; every other byte identical',
      metrics: { comparedFiles: 1, editedFiles: 1, changedSpans: 1 }, violations: [], findings: [], durationMs: 0,
    });
    expect(resultOf({ 'src/b.ts': 'export const b = 1;\n' }, { 'src/lib/b.ts': 'export const b = 1;\n' })).toEqual({
      id: 'K2', title: 'Byte-span confinement', status: 'pass', summary: '0 specifier spans changed in 0 files; every other byte identical',
      metrics: { comparedFiles: 0, editedFiles: 0, changedSpans: 0 }, violations: [], findings: [], durationMs: 0,
    });
    const failed = resultOf({ 'src/a.ts': importer('./b') }, { 'src/a.ts': "import type { b } from './b';\nexport const a = b;\n" }) as Awaited<ReturnType<typeof byteSpanConfinement.run>>;
    expect(failed).toMatchObject({ status: 'fail', summary: '1 violations: bytes outside specifier spans, or loader calls whose spans can\'t be checked', metrics: { comparedFiles: 1, editedFiles: 0, changedSpans: 0 }, findings: [] });
    expect(Object.keys(failed.metrics)).toEqual(['comparedFiles', 'editedFiles', 'changedSpans']);
  });
});

describe('a mixed commit: moves and a re-wrap', () => {
  const service = "import { alpha, beta, gamma } from '../letters';\nexport const service = [alpha, beta, gamma];\n";
  const wrappedService = "import {\n  alpha,\n  beta,\n  gamma,\n} from '../letters/letters';\nexport const service = [alpha, beta, gamma];\n";
  const tsconfig = '{ "compilerOptions": { "strict": true } }\n';
  const base: Tree = { 'src/all.ts': oneLine, 'src/letters.ts': letters, 'src/services/service.ts': service, 'tsconfig.json': tsconfig };
  const moved: Tree = { 'src/all.ts': wrapped.replace('./letters', './modules/letters/letters'), 'src/modules/letters/letters.ts': letters, 'src/modules/service/service.ts': service.replace('../letters', '../letters/letters'), 'tsconfig.json': tsconfig };
  const certifyTrees = async (from: Tree, head: Tree) => {
    const repo = twoCommits(from, head);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-layout-work-'));
    try {
      return await certify({ repo: repo.root, base: repo.base, head: repo.head, packageRoot: '', environment: repo.root, profile: null, oracles: false, only: ['K1', 'K2', 'K3a'], workDir, keep: false });
    } finally {
      fs.rmSync(repo.root, { recursive: true, force: true });
    }
  };
  const statuses = (certificate: Awaited<ReturnType<typeof certify>>) => certificate.checks.map((check) => [check.id, check.status]);

  it('certifies moves with an importer re-wrapped (K1, K2 pass)', async () => {
    const mixed = await certifyTrees(base, moved);
    expect(statuses(mixed)).toEqual([['K1', 'pass'], ['K2', 'pass'], ['K3a', 'pass']]);
    expect(mixed.checks.find((check) => check.id === 'K2')!.metrics).toEqual({ comparedFiles: 2, editedFiles: 2, changedSpans: 2, layoutOnlyFiles: 1 });
  });

  it('pairs a moved file whose own imports were re-wrapped too (the whole PR with S3 on), and K2 holds it to the layout class', async () => {
    const movedAndWrapped = await certifyTrees(base, { ...moved, 'src/modules/service/service.ts': wrappedService });
    expect(statuses(movedAndWrapped)).toEqual([['K1', 'pass'], ['K2', 'pass'], ['K3a', 'pass']]);
    expect(movedAndWrapped.pathMap.entries).toEqual({ 'src/letters.ts': 'src/modules/letters/letters.ts', 'src/services/service.ts': 'src/modules/service/service.ts' });
    expect(movedAndWrapped.checks.find((check) => check.id === 'K2')!.metrics).toEqual({ comparedFiles: 2, editedFiles: 2, changedSpans: 2, layoutOnlyFiles: 2 });
    // The key reads whitespace inside the declaration as one space: a U+2028 there pairs the file, and K2 rejects it.
    const separator = await certifyTrees(base, { ...moved, 'src/modules/service/service.ts': wrappedService.replace('{\n  alpha', '{\u2028  alpha') });
    expect(separator.pathMap.entries).toMatchObject({ 'src/services/service.ts': 'src/modules/service/service.ts' });
    expect(statuses(separator)).toEqual([['K1', 'pass'], ['K2', 'fail'], ['K3a', 'pass']]);
    expect(separator.checks.find((check) => check.id === 'K2')!.violations[0]!.detail).toMatch(/not layout only: the whitespace between token "\{" on line 1 and token "alpha" on line 2 changed, and head has U\+2028 in it/);
  });

  it('leaves a moved file unpaired when more than import layout changed, or when its layout key is not unique (K1 fails closed)', async () => {
    const reformatted = await certifyTrees(base, { ...moved, 'src/modules/service/service.ts': wrappedService.replace('[alpha, beta, gamma]', '[\n  alpha,\n  beta,\n  gamma,\n]') });
    expect(reformatted.checks.find((check) => check.id === 'K1')!.status).toBe('fail');
    expect(reformatted.pathMap.deleted).toEqual(['src/services/service.ts']);
    const twins: Tree = { ...base, 'src/services/twin.ts': service };
    const twinsMoved: Tree = { ...moved, 'src/modules/service/service.ts': wrappedService, 'src/modules/service/twin.ts': wrappedService.replace('{\n  alpha', '{ alpha') };
    const ambiguous = await certifyTrees(twins, twinsMoved);
    expect(ambiguous.checks.find((check) => check.id === 'K1')!.status).toBe('fail');
    expect(ambiguous.pathMap.deleted).toEqual(['src/services/service.ts', 'src/services/twin.ts']);
  });
});

describe('a commit that only re-wraps a spec file\'s imports', () => {
  it('passes K3b and K6 under vitest: test lists, load status and names are compared, never line numbers', async () => {
    const wrappedSpec = variant(vitestRepo, {}, {
      'src/services/billing.test.ts': [["import { describe, expect, it, vi } from 'vitest';", "import {\n  describe,\n  expect,\n  it,\n  vi,\n} from 'vitest';"]],
    });
    const certificate = await certifyFiles(vitestRepo, wrappedSpec, { only: ['K1', 'K2', 'K3b', 'K6'], nodeModules: localNodeModules });
    expect(certificate.checks.map((check) => [check.id, check.status])).toEqual([['K1', 'pass'], ['K2', 'pass'], ['K3b', 'pass'], ['K6', 'pass']]);
    expect(checkOf(certificate, 'K2').metrics).toMatchObject({ layoutOnlyFiles: 1 });
    expect(checkOf(certificate, 'K6').metrics).toMatchObject({ baseTests: 2, headTests: 2, baseUnloadable: 0, headUnloadable: 0 });
  }, 120_000);
});

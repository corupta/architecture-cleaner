// K2's layout-only class (plan §2.3 S3): a genuine re-wrap of import lines passes, alone or next to moves; every
// layout-looking change that isn't one fails with a violation naming the first differing token, the changed tree or
// the directive; a K2 result without a layout-only file is exactly what it was before the class existed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { byteSpanConfinement, checkByteSpans } from '../../src/certificate/byte-spans.js';
import { certify } from '../../src/certificate/certify.js';
import { compareLayout } from '../../src/certificate/layout.js';
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
    const sameLine = "declare function f(...a: number[]): void;\nf(1, 2); // eslint-disable-line no-console\nf(3);\n";
    expect(rejected('src/d.ts', sameLine, sameLine.replace('f(1, 2);', 'f(\n  1,\n  2);'))).toMatch(/^line breaks changed within the lines the directive "\/\/ eslint-disable-line no-console" on line \d applies to$/);
    const reach = "declare function f(...a: number[]): void;\n/* c8 ignore next 3 */\nf(1);\nf(2, 3);\nf(4);\n";
    expect(rejected('src/e.ts', reach, reach.replace('f(2, 3);', 'f(\n  2,\n  3);'))).toMatch(/^line breaks changed within the lines the directive "\/\* c8 ignore next 3 \*\/" on line 2 applies to$/);
    const prettierIgnore = '// prettier-ignore\nexport const matrix = [1, 0,\n  0, 1];\n';
    expect(rejected('src/m.ts', prettierIgnore, '// prettier-ignore\nexport const matrix = [1, 0, 0, 1];\n')).toMatch(/precedes or sits inside/);
  });

  it("a comment's text, a comment added, the shebang, a byte order mark", () => {
    expect(rejected('src/a.ts', `// letters\n${oneLine}`, `// letters!\n${oneLine}`)).toBe('token 1 differs: base has comment "// letters" on line 1, head has comment "// letters!" on line 1');
    expect(rejected('src/b.ts', oneLine, `${oneLine}// TODO\n`)).toMatch(/^token \d+ differs: base has the end of the file, head has comment "\/\/ TODO"/);
    expect(rejected('src/c.ts', `#!/usr/bin/env node\n${oneLine}`, `#!/usr/bin/env  node\n${oneLine}`)).toBe('the shebang line changed');
    expect(rejected('src/d.ts', oneLine, `\ufeff${oneLine}`)).toBe('the byte order mark was added');
  });

  it('spaces that make an HTML-like comment for Node (<!--, a line-leading -->)', () => {
    expect(rejected('src/a.js', 'let x = 1, y = 2;\nexports.z = x < !--y;\n', 'let x = 1, y = 2;\nexports.z = x <!--y;\n')).toMatch(/^the space around "[<!]" on head line 2 changed: <!-- and a line-leading --> are comments to Node/);
    expect(rejected('src/b.js', 'let y = 2;\nexports.z = y-- > 0;\n', 'let y = 2;\nexports.z = y\n-- > 0;\n')).toMatch(/^the space around "--"|different syntax tree|syntax errors/);
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

describe('compareLayout', () => {
  it('compares comments in the trailing comma it drops, and the comments of an empty file', () => {
    expect(compareLayout('a.ts', "import { a, /* x */ } from 'ac-specifier';\n", "import { a /* x */ } from 'ac-specifier';\n")).toMatchObject({ layoutOnly: true });
    expect(compareLayout('a.ts', "import { a /* x */, } from 'ac-specifier';\n", "import { a /* y */ } from 'ac-specifier';\n")).toMatchObject({ layoutOnly: false });
    expect(compareLayout('a.ts', '// only a comment\n', '\n\n// only a comment\n')).toMatchObject({ layoutOnly: true, changedBreaks: 1, firstLine: 1, lineDelta: 2 });
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
  it('certifies moves with an importer re-wrapped (K1, K2 pass); a moved file whose own layout changed is not paired (K1 fails closed)', async () => {
    const service = "import { alpha, beta, gamma } from '../letters';\nexport const service = [alpha, beta, gamma];\n";
    const base: Tree = { 'src/all.ts': oneLine, 'src/letters.ts': letters, 'src/services/service.ts': service, 'tsconfig.json': '{ "compilerOptions": { "strict": true } }\n' };
    const moved: Tree = { 'src/all.ts': wrapped.replace('./letters', './modules/letters/letters'), 'src/modules/letters/letters.ts': letters, 'src/modules/service/service.ts': service.replace('../letters', '../letters/letters'), 'tsconfig.json': base['tsconfig.json']! };
    const certifyTrees = async (head: Tree) => {
      const repo = twoCommits(base, head);
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-layout-work-'));
      try {
        return await certify({ repo: repo.root, base: repo.base, head: repo.head, packageRoot: '', environment: repo.root, profile: null, oracles: false, only: ['K1', 'K2', 'K3a'], workDir, keep: false });
      } finally {
        fs.rmSync(repo.root, { recursive: true, force: true });
      }
    };
    const mixed = await certifyTrees(moved);
    expect(mixed.checks.map((check) => [check.id, check.status])).toEqual([['K1', 'pass'], ['K2', 'pass'], ['K3a', 'pass']]);
    expect(mixed.checks.find((check) => check.id === 'K2')!.metrics).toEqual({ comparedFiles: 2, editedFiles: 2, changedSpans: 2, layoutOnlyFiles: 1 });
    const movedAndWrapped = await certifyTrees({ ...moved, 'src/modules/service/service.ts': "import {\n  alpha,\n  beta,\n  gamma,\n} from '../letters/letters';\nexport const service = [alpha, beta, gamma];\n" });
    expect(movedAndWrapped.verdict).toBe('fail');
    expect(movedAndWrapped.checks.find((check) => check.id === 'K1')!.status).toBe('fail');
    expect(movedAndWrapped.pathMap.deleted).toEqual(['src/services/service.ts']);
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

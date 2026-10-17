// path-expressions.ts: what a path-building expression evaluates to, for the names it can follow.
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { moduleBindings, pathEvaluator } from '../../src/certificate/path-expressions.js';

/** The values of the argument of the last `sink(…)` call in `text`, for a file at scripts/x.mjs. */
function sinkValues(text: string) {
  const sourceFile = ts.createSourceFile('scripts/x.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let argument: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'sink') argument = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return pathEvaluator(sourceFile, 'scripts/x.mjs', moduleBindings(sourceFile))(argument!).map((value) => `${value.anchor}:${value.text}${value.complete ? '' : '…'}`);
}
const prelude = "import { join } from 'node:path';\nconst root = join(import.meta.dirname, '..');\n";

describe('path-expressions: names with several known values', () => {
  it('takes a loop variable over a literal array as each element', () => {
    expect(sinkValues(`${prelude}for (const file of ['a.json', 'b/c.json']) sink(join(root, file));\n`)).toEqual(['repo:/repo/a.json', 'repo:/repo/b/c.json']);
  });

  it('takes a parameter of a function only this file calls as each argument and its default', () => {
    expect(sinkValues(`${prelude}function rewrite(relative = 'd.json') { sink(join(root, relative)); }\nrewrite('a.json');\nrewrite();\n`)).toEqual(['repo:/repo/d.json', 'repo:/repo/a.json']);
  });

  it('stays opaque when a call, an element or the function hides a value', () => {
    // An opaque argument, an exported or passed function, a reassigned parameter, `arguments`, a spread: no exact value.
    const opaque = 'repo:/repo/…';
    expect(sinkValues(`${prelude}function rewrite(relative) { sink(join(root, relative)); }\nrewrite('a.json');\nrewrite(process.argv[2]);\n`)).toEqual([opaque]);
    expect(sinkValues(`${prelude}export function rewrite(relative) { sink(join(root, relative)); }\nrewrite('a.json');\n`)).toEqual([opaque]);
    expect(sinkValues(`${prelude}function rewrite(relative) { sink(join(root, relative)); }\nrewrite('a.json');\n[1].map(rewrite);\n`)).toEqual([opaque]);
    expect(sinkValues(`${prelude}function rewrite(relative) { relative += '.bak'; sink(join(root, relative)); }\nrewrite('a.json');\n`)).toEqual([opaque]);
    expect(sinkValues(`${prelude}function rewrite(relative) { log(arguments); sink(join(root, relative)); }\nrewrite('a.json');\n`)).toEqual([opaque]);
    expect(sinkValues(`${prelude}for (const file of ['a.json', ...more]) sink(join(root, file));\n`)).toEqual([opaque]);
    expect(sinkValues(`${prelude}for (let file of ['a.json']) { file = file + '.bak'; sink(join(root, file)); }\n`)).toEqual([opaque]);
  });
});

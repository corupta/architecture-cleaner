// A small known-good result with a genuine re-wrap (plan §2.3 S3), the control the layout operators (M34–M39) mutate:
// src/services/letters.service.ts moves to src/modules/letters/, and the importer whose declaration the longer
// specifier pushes past a 90-column printWidth is re-wrapped the way prettier does it (one binding per line, a
// trailing comma). The head also has what the layout operators look for: line and block directives next to
// statements, returns, a postfix update in a statement without a semicolon, strings, template literals, JSX text,
// calls and arrays, a JSDoc comment after a statement, an arrow function, all in the files edited in place (a
// mutant of a moved file whose text differs beyond its import layout isn't paired with its base: K1's).
import fs from 'node:fs';
import path from 'node:path';
import { materializePair } from './harness.js';
import type { SubjectSpec } from './subject.js';

const shared: Record<string, string> = {
  'package.json': `${JSON.stringify({ name: 'mutation-layout', private: true }, null, 2)}\n`,
  'tsconfig.json': `${JSON.stringify({ compilerOptions: { target: 'es2022', module: 'commonjs', moduleResolution: 'node', strict: true, jsx: 'preserve', types: [] }, include: ['src'] }, null, 2)}\n`,
  'src/jsx.d.ts': 'declare namespace JSX {\n  interface IntrinsicElements {\n    [name: string]: unknown;\n  }\n}\n',
};

const letters = "export const vowelLetters = ['a', 'e', 'i', 'o', 'u'];\nexport const consonantLetters = ['b', 'c', 'd'];\nexport const alphabetLetters = [...vowelLetters, ...consonantLetters];\n";

const report = (declaration: string) => [
  '// The report: a little of everything the layout operators look for.',
  declaration,
  '',
  '// eslint-disable-next-line @typescript-eslint/no-unused-vars',
  'const unused = describeLetters(1, 2);',
  '',
  'export function describeLetters(first: number, second: number): string {',
  '  // @ts-expect-error: padStart is called on a number',
  '  const padded = String.prototype.padStart.call(first, second);',
  '  return `${padded} of ${alphabetLetters.length} letters: ${vowelLetters.join(\', \')}`;',
  '}',
  '',
  '/** @internal Counts the consonants, one at a time. */',
  'export function count(): number {',
  '  let total = 0;',
  '  /* c8 ignore next */',
  '  total++;',
  '  return total + consonantLetters.length;',
  '}',
  '',
  'export const twice = (value: number) => value * 2;',
  '',
  'export function tally(): number {',
  '  let ticks = 0',
  '  ticks++',
  '  count()',
  '  return ticks',
  '}',
  '',
  'export const sizes = [count(), describeLetters(3, 4).length];',
  '',
].join('\n');

const view = (specifier: string) => [
  `import { vowelLetters } from '${specifier}';`,
  '',
  "export const view = <p title={`vowels: ${vowelLetters.length}`}>The vowels are {vowelLetters.join(' ')}.</p>;",
  '',
  'export const note = (',
  '  <p>',
  '    Copy the vowels if the list is too short.',
  '  </p>',
  ');',
  '',
].join('\n');

export const layoutTrees: Record<'before' | 'after', Record<string, string>> = {
  before: {
    ...shared,
    'src/services/letters.service.ts': letters,
    'src/report.ts': report("import { alphabetLetters, consonantLetters, vowelLetters } from './services/letters.service';"),
    'src/view.tsx': view('./services/letters.service'),
  },
  after: {
    ...shared,
    'src/modules/letters/letters.service.ts': letters,
    'src/report.ts': report("import {\n  alphabetLetters,\n  consonantLetters,\n  vowelLetters,\n} from './modules/letters/letters.service';"),
    'src/view.tsx': view('./modules/letters/letters.service'),
  },
};

function writeTree(directory: string, tree: Record<string, string>): void {
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [file, content] of Object.entries(tree)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
  }
}

export function layoutSubject(): SubjectSpec {
  return {
    name: 'synthetic:layout',
    target: 'synthetic',
    packageRoot: '',
    profile: null,
    prepare(workDir) {
      const trees = path.join(workDir, 'trees', 'layout');
      writeTree(path.join(trees, 'before'), layoutTrees.before);
      writeTree(path.join(trees, 'after'), layoutTrees.after);
      return materializePair(path.join(workDir, 'repos', 'synthetic-layout'), path.join(trees, 'before'), path.join(trees, 'after'));
    },
  };
}

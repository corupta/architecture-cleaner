// The layout mutants (M34–M39): on the synthetic layout subject, whose good head is a genuine re-wrap (the control
// passes every static check, K2 calling the re-wrapped file layout only), every variant has instances and every
// mutant is killed by K2, through the harness as `node dist/mutation/run.js --targets synthetic` runs it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { directiveComment } from '../../src/certificate/layout.js';
import { headText } from '../../src/mutation/edits.js';
import { runHarness, staticChecks } from '../../src/mutation/harness.js';
import { layoutOperators } from '../../src/mutation/layout-operators.js';
import { layoutSubject } from '../../src/mutation/layout-subject.js';
import { operatorIds } from '../../src/mutation/operators.js';
import { openSubject } from '../../src/mutation/subject.js';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-layout-mutation-'));
afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

describe('layout operators', () => {
  it('are registered after M33, so --inject-fault can name them too', () => {
    expect(layoutOperators.map((operator) => operator.id)).toEqual(['M34', 'M35', 'M36', 'M37', 'M38', 'M39']);
    expect(operatorIds.slice(-7)).toEqual(['M33', 'M34', 'M35', 'M36', 'M37', 'M38', 'M39']);
  });

  it('propose every variant on the layout subject, each mutant differing from the good head in one file', () => {
    const subject = openSubject(layoutSubject(), path.join(workDir, 'open'));
    const variants = Object.fromEntries(layoutOperators.map((operator) => [operator.id, [...new Set(operator.candidates(subject).map((candidate) => candidate.variant))].sort()]));
    expect(variants).toEqual({
      M34: ['postfix', 'return'],
      M35: ['jsx', 'string', 'template'],
      M36: ['array-hole', 'removed'],
      M37: ['blank-line', 'into-statement'],
      M38: ['block', 'line'],
      M39: ['arrow', 'carriage-return', 'jsdoc', 'line-separator'],
    });
    for (const operator of layoutOperators) {
      for (const candidate of operator.candidates(subject)) expect(candidate.build()!.size).toBe(1);
    }
  });

  it('make no equivalent mutant: each breaks the parse or the build, or changes the emitted code, a directive or the lines git counts', () => {
    const subject = openSubject(layoutSubject(), path.join(workDir, 'equivalence'));
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, declaration: true, stripInternal: true };
    const syntaxErrors = (file: string, text: string) => (ts.createSourceFile(file, text, ts.ScriptTarget.Latest) as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics.length;
    const emitted = (file: string, text: string) => `${ts.transpileModule(text, { fileName: file, compilerOptions: options }).outputText}\n${ts.transpileDeclaration(text, { fileName: file, compilerOptions: options }).outputText}`;
    // TS1200 and friends come from the checker's grammar pass, not the parser.
    const grammarErrors = (file: string, text: string) => {
      const host = ts.createCompilerHost({ noLib: true });
      host.getSourceFile = (name, version) => (name === file ? ts.createSourceFile(name, text, version) : undefined);
      return ts.createProgram([file], { noLib: true, noResolve: true, jsx: ts.JsxEmit.React }, host).getSemanticDiagnostics().map((diagnostic) => diagnostic.code).filter((code) => code >= 1000 && code < 2000);
    };
    const directives = (text: string) => ts.createSourceFile('a.ts', text, ts.ScriptTarget.Latest).getFullText().split(/(?=\/[/*])/).filter((part) => directiveComment.test(part)).length;
    const gitLines = (text: string) => text.split('\n').length;
    let checked = 0;
    for (const operator of layoutOperators) {
      for (const candidate of operator.candidates(subject)) {
        const [file, content] = [...candidate.build()!][0]!;
        const good = headText(subject, file)!;
        const mutant = content!.bytes.toString('utf8');
        const changes = [
          syntaxErrors(file, mutant) > syntaxErrors(file, good) && 'syntax errors',
          emitted(file, mutant) !== emitted(file, good) && 'emitted code',
          grammarErrors(file, mutant).length > grammarErrors(file, good).length && 'grammar errors',
          directives(mutant) < directives(good) && 'a directive',
          gitLines(mutant) !== gitLines(good) && 'the lines git counts',
        ].filter(Boolean);
        expect.soft(changes, `${operator.id}.${candidate.variant} ${candidate.description}`).not.toEqual([]);
        // M34 claims the same tokens and a different tree: its mutants must parse.
        if (operator.id === 'M34') expect.soft(syntaxErrors(file, mutant), candidate.description).toBe(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('are all killed by K2 while the genuine re-wrap passes every static check', async () => {
    const result = await runHarness({
      subjects: [layoutSubject()], hunt: [], operators: layoutOperators.map((operator) => operator.id), cap: 2, checks: staticChecks, staged: true,
      workDir: path.join(workDir, 'harness'), quiet: true, log: () => {},
    });
    expect(result.issues).toEqual([]);
    expect(result.controls.map((control) => [control.subject, control.verdict, control.failing])).toEqual([['synthetic:layout', 'pass', []]]);
    expect(result.notApplicable).toEqual([]);
    expect(new Set(result.mutants.map((mutant) => `${mutant.operator}.${mutant.variant}`)).size).toBe(15);
    for (const mutant of result.mutants) {
      expect.soft(mutant.effectivelySurvived, mutant.description).toBe(false);
      expect.soft(mutant.effectiveKilledBy, mutant.description).toContain('K2');
    }
  }, 300_000);
});

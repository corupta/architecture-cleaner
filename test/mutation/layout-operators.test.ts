// The layout mutants (M34–M38): on the synthetic layout subject, whose good head is a genuine re-wrap (the control
// passes every static check, K2 calling the re-wrapped file layout only), every variant has instances and every
// mutant is killed by K2, through the harness as `node dist/mutation/run.js --targets synthetic` runs it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runHarness, staticChecks } from '../../src/mutation/harness.js';
import { layoutOperators } from '../../src/mutation/layout-operators.js';
import { layoutSubject } from '../../src/mutation/layout-subject.js';
import { operatorIds } from '../../src/mutation/operators.js';
import { openSubject } from '../../src/mutation/subject.js';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-layout-mutation-'));
afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

describe('layout operators', () => {
  it('are registered after M33, so --inject-fault can name them too', () => {
    expect(layoutOperators.map((operator) => operator.id)).toEqual(['M34', 'M35', 'M36', 'M37', 'M38']);
    expect(operatorIds.slice(-6)).toEqual(['M33', 'M34', 'M35', 'M36', 'M37', 'M38']);
  });

  it('propose every variant on the layout subject, each mutant differing from the good head in one file', () => {
    const subject = openSubject(layoutSubject(), path.join(workDir, 'open'));
    const variants = Object.fromEntries(layoutOperators.map((operator) => [operator.id, [...new Set(operator.candidates(subject).map((candidate) => candidate.variant))].sort()]));
    expect(variants).toEqual({
      M34: ['postfix', 'return'],
      M35: ['jsx', 'string', 'template'],
      M36: ['array-trailing', 'call-trailing', 'removed'],
      M37: ['blank-line', 'into-statement'],
      M38: ['block', 'line'],
    });
    for (const operator of layoutOperators) {
      for (const candidate of operator.candidates(subject)) expect(candidate.build()!.size).toBe(1);
    }
  });

  it('are all killed by K2 while the genuine re-wrap passes every static check', async () => {
    const result = await runHarness({
      subjects: [layoutSubject()], hunt: [], operators: layoutOperators.map((operator) => operator.id), cap: 2, checks: staticChecks, staged: true,
      workDir: path.join(workDir, 'harness'), quiet: true, log: () => {},
    });
    expect(result.issues).toEqual([]);
    expect(result.controls.map((control) => [control.subject, control.verdict, control.failing])).toEqual([['synthetic:layout', 'pass', []]]);
    expect(result.notApplicable).toEqual([]);
    expect(new Set(result.mutants.map((mutant) => `${mutant.operator}.${mutant.variant}`)).size).toBe(12);
    for (const mutant of result.mutants) {
      expect.soft(mutant.effectivelySurvived, mutant.description).toBe(false);
      expect.soft(mutant.effectiveKilledBy, mutant.description).toContain('K2');
    }
  }, 300_000);
});

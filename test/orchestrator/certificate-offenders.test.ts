// C2: what a failed certificate tells the replan. K3b and K6 list their errored runners (marked `error: `) before the
// violations; the offenders skip the marked errors, and the detail (the attempt's text, the pinned finding, failRun's
// message) shows the violations first, so three errored runners can't hide the violation that pinned a file.
import { describe, expect, it } from 'vitest';
import type { Certificate, CheckResult } from '../../src/certificate/types.js';
import { certificateOffenders } from '../../src/orchestrator/attempt.js';

const check = (id: string, status: CheckResult['status'], violations: CheckResult['violations']): CheckResult => (
  { id, title: id, status, summary: '', metrics: {}, violations, findings: [], durationMs: 0 } as CheckResult);
const certificateOf = (checks: CheckResult[]) => ({ pathMap: { entries: { 'src/a.ts': 'src/modules/a/a.ts' } }, checks } as unknown as Certificate);
const errored = (runner: number) => ({ detail: `error: vitest-${runner}: vitest could not resolve in base\nits stack` });

describe('certificateOffenders', () => {
  it('shows a failed check\'s violations before its marked errors, and pins from the violations only', () => {
    const violation = { file: 'src/modules/a/a.ts', detail: "site 0 '../db' (import): base src/db.ts, head unresolved" };
    const { offenders, detail } = certificateOffenders(certificateOf([check('K3b', 'fail', [errored(0), errored(1), errored(2), violation])]));
    expect(offenders).toEqual([{ file: 'src/a.ts', detail: violation.detail }]);
    expect(detail).toBe("K3b src/modules/a/a.ts: site 0 '../db' (import): base src/db.ts, head unresolved; error: vitest-0: vitest could not resolve in base; error: vitest-1: vitest could not resolve in base");
  });

  it('keeps each check\'s own order otherwise: an errored check\'s entries, then the next check', () => {
    const { offenders, detail } = certificateOffenders(certificateOf([
      check('K0', 'pass', [{ detail: 'not shown' }]),
      check('K6', 'error', [errored(0), errored(1)]),
      check('K4', 'fail', [{ file: 'docs/a.md', detail: 'names src/a.ts' }, { file: 'docs/b.md', detail: 'names src/a.ts' }]),
    ]));
    expect(offenders.map((offender) => offender.file)).toEqual(['docs/a.md', 'docs/b.md']);
    expect(detail).toBe('K6 error: vitest-0: vitest could not resolve in base; error: vitest-1: vitest could not resolve in base; K4 docs/a.md: names src/a.ts; docs/b.md: names src/a.ts');
  });
});

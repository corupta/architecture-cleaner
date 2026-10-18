// Which FAIL has no verdict: one whose every non-passing check errored without listing evidence about the change. The
// shapes are the certifier's own: a crashed check (certify.ts), K8's marked errors, K3b and K6 with one unmarked error
// per errored runner ahead of the violations other runners found.
import { describe, expect, it } from 'vitest';
import type { Certificate, CheckResult } from '../../src/certificate/types.js';
import { erroredWithEvidence, withoutVerdict } from '../../src/orchestrator/runner.js';

const check = (fields: Partial<CheckResult>): CheckResult => ({ id: 'K3b', title: 't', status: 'pass', summary: 's', metrics: {}, violations: [], findings: [], durationMs: 0, ...fields });
const failed = (...checks: CheckResult[]) => ({ verdict: 'fail', checks }) as Certificate;

describe('a certificate without a verdict', () => {
  it('reads a crash, marked oracle errors and a single runner\'s error as no evidence', () => {
    expect(erroredWithEvidence(check({ id: 'K3a', status: 'error', summary: 'crashed: boom', violations: [{ detail: 'Error: boom\n    at x' }] }))).toBe(false);
    expect(erroredWithEvidence(check({ id: 'K8', status: 'error', violations: [{ detail: 'error: unit on base: no report' }, { detail: 'error: tsc on base: killed' }] }))).toBe(false);
    expect(erroredWithEvidence(check({ id: 'K6', status: 'error', violations: [{ detail: 'vitest could not list or load the tests of base: killed' }] }))).toBe(false);
    expect(withoutVerdict(failed(check({ id: 'K0' }), check({ id: 'K8', status: 'error', violations: [{ detail: 'error: unit on base: no report' }] })))).toBe(true);
  });

  it('reads an errored check that lists a violation as a verdict', () => {
    const k3b = check({ status: 'error', violations: [{ detail: 'vitest-1 could not resolve in base: killed' }, { file: 'src/a.ts', detail: 'retargeted' }] });
    expect(erroredWithEvidence(k3b)).toBe(true);
    expect(withoutVerdict(failed(k3b))).toBe(false);
    expect(erroredWithEvidence(check({ id: 'K8', status: 'error', violations: [{ detail: 'error: unit on base: no report' }, { file: 'x', detail: 'not reachable' }] }))).toBe(true);
    // Two unmarked entries can't be told apart from an error and a violation: a verdict.
    expect(erroredWithEvidence(check({ id: 'K6', status: 'error', violations: [{ detail: 'jest-0: killed' }, { detail: 'vitest-1: killed' }] }))).toBe(true);
    expect(withoutVerdict(failed(check({ id: 'K4', status: 'fail', violations: [{ detail: 'an old path' }] }), check({ id: 'K8', status: 'error', violations: [{ detail: 'error: x' }] })))).toBe(false);
    expect(withoutVerdict({ verdict: 'pass', checks: [] } as unknown as Certificate)).toBe(false);
  });
});

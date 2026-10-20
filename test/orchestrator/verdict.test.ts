// Which FAIL has no verdict: one in which no check failed, so every check that didn't pass errored. K3b and K6 (like
// K8) fail on any violation and list their errors first, marked `error: `; only errors make them `error`. Certified
// here on a repo with two vitest packages: `broken/`, whose config throws (that runner errors on base), and the root,
// where a move left an import dangling (that runner finds the violation).
import { describe, expect, it } from 'vitest';
import type { Certificate, CheckResult } from '../../src/certificate/types.js';
import { withoutVerdict } from '../../src/orchestrator/runner.js';
import { certifyFiles, checkOf, localNodeModules, variant, vitestRepo, vitestRepoMoved } from '../certificate/runner-repos.js';

const check = (fields: Partial<CheckResult>): CheckResult => ({ id: 'K3b', title: 't', status: 'pass', summary: 's', metrics: {}, violations: [], findings: [], durationMs: 0, ...fields });
const failed = (...checks: CheckResult[]) => ({ verdict: 'fail', checks }) as Certificate;

const broken = {
  'broken/package.json': JSON.stringify({ name: 'broken', private: true, type: 'module', scripts: { test: 'vitest run' } }),
  'broken/vitest.config.mjs': "throw new Error('this config does not load');\n",
  'broken/src/sum.ts': 'export const sum = (a: number, b: number) => a + b;\n',
  'broken/src/sum.test.ts': "import { expect, it } from 'vitest';\nimport { sum } from './sum.js';\n\nit('adds', () => expect(sum(1, 2)).toBe(3));\n",
};
const base = { ...vitestRepo, ...broken };
// The gateway (and its manual mock) moved, the test's vi.mock rewritten, billing.ts's '@/services/gateway' not.
const dangling = {
  ...variant(vitestRepo, { 'src/services/gateway.ts': 'src/platform/gateway.ts', 'src/services/__mocks__/gateway.ts': 'src/platform/__mocks__/gateway.ts' }, {
    'src/services/billing.test.ts': [["vi.mock('./gateway.js')", "vi.mock('../platform/gateway.js')"]],
  }),
  ...broken,
};
const correct = { ...vitestRepoMoved, ...broken };
const marked = (runner: string, text: string) => expect.stringMatching(new RegExp(`^error: ${runner}: vitest ${text}: .*this config does not load`));

describe('K3b and K6 with one runner errored', () => {
  it('fail when the other runner finds a violation, the error listed first and marked', async () => {
    const certificate = await certifyFiles(base, dangling, { only: ['K3b', 'K6'], nodeModules: localNodeModules });
    const k3b = checkOf(certificate, 'K3b');
    expect(k3b.status).toBe('fail');
    expect(k3b.violations.map((violation) => violation.detail)).toEqual([
      marked('vitest-0', 'could not resolve in base'),
      expect.stringMatching(/^site 1 '@\/services\/gateway' \(import\): base src\/platform\/gateway\.ts, head unresolved/),
    ]);
    expect(k3b.summary).toMatch(/^vitest: error; vitest 5\.\S+: 1 violations \(1 dangling\)$/);
    const k6 = checkOf(certificate, 'K6');
    expect(k6.status).toBe('fail');
    expect(k6.violations[0]!.detail).toEqual(marked('vitest-0', 'could not list or load the tests of base'));
    expect(k6.violations.slice(1).map((violation) => violation.file)).toContain('src/services/billing.test.ts');
    expect(k6.violations.slice(1).every((violation) => !violation.detail.startsWith('error: '))).toBe(true);
    expect(k6.summary).toMatch(/^vitest: error; vitest 5\.\S+: \d+ violations/);
    expect(certificate.verdict).toBe('fail');
    expect(withoutVerdict(certificate)).toBe(false);
  });

  it('fail when the errored runner itself lists a violation (a site list that changed under its cwd)', async () => {
    const edited = variant(correct, {}, { 'broken/src/sum.test.ts': [["import { sum } from './sum.js';", "import { sum } from './sum.js';\nimport './sum.js';"]] });
    const k3b = checkOf(await certifyFiles(base, edited, { only: ['K3b'], nodeModules: localNodeModules }), 'K3b');
    expect(k3b.status).toBe('fail');
    // The root runner's cwd holds broken/ too, so it lists the same file.
    const changed = { file: 'broken/src/sum.test.ts', detail: 'reference sites differ from broken/src/sum.test.ts in base (2 -> 3); see K2' };
    expect(k3b.violations).toEqual([{ detail: marked('vitest-0', 'could not resolve in base') }, changed, changed]);
    expect(k3b.summary).toMatch(/^vitest: error, 1 violations; vitest 5\.\S+: 1 violations: reference sites differ/);
  });

  it('error, listing only the marked errors, when no runner finds a violation', async () => {
    const certificate = await certifyFiles(base, correct, { only: ['K3b', 'K6'], nodeModules: localNodeModules });
    for (const [id, text] of [['K3b', 'could not resolve in base'], ['K6', 'could not list or load the tests of base']] as const) {
      const result = checkOf(certificate, id);
      expect(result.status).toBe('error');
      expect(result.violations.map((violation) => violation.detail)).toEqual([marked('vitest-0', text)]);
      expect(result.summary).toMatch(/^vitest-0: vitest could not/);
    }
    expect(withoutVerdict(certificate)).toBe(true);
  });
});

describe('a certificate without a verdict', () => {
  it('is a FAIL in which every check that did not pass errored: a crash, K8 that could not run on base', () => {
    const crash = check({ id: 'K3a', status: 'error', summary: 'crashed: boom', violations: [{ detail: 'Error: boom\n    at x' }] });
    const oracle = check({ id: 'K8', status: 'error', violations: [{ detail: 'error: unit on base: no report' }, { detail: 'error: tsc on base: killed' }] });
    expect(withoutVerdict(failed(check({ id: 'K0' }), crash, oracle))).toBe(true);
    // K8's unreachable prerequisites name files, unmarked: still errors, not evidence about the change.
    expect(withoutVerdict(failed(check({ id: 'K8', status: 'error', violations: [{ file: 'a', detail: 'not reachable' }, { file: 'b', detail: 'not reachable' }] })))).toBe(true);
  });

  it('is not one with a failed check, even next to an errored one, nor a PASS', () => {
    expect(withoutVerdict(failed(check({ id: 'K4', status: 'fail', violations: [{ detail: 'an old path' }] }), check({ id: 'K8', status: 'error', violations: [{ detail: 'error: x' }] })))).toBe(false);
    expect(withoutVerdict({ verdict: 'pass', checks: [] } as unknown as Certificate)).toBe(false);
  });
});

// The run's step records, pins and attribution, commit messages, and the report's seams: pure functions, no git.
import { describe, expect, it } from 'vitest';
import type { Analysis, AnalyzedFile } from '../../src/analyzer/types.js';
import { stepMessage, subjectLine } from '../../src/orchestrator/commit-message.js';
import { formatDuration, renderReport } from '../../src/orchestrator/report.js';
import { attributeOffenders, commonDirectory, effectiveMoves, planSteps, renameSteps } from '../../src/orchestrator/steps.js';
import type { RunState } from '../../src/orchestrator/types.js';
import { readPlanYaml } from '../../src/planner/plan-file.js';
import { planYaml } from './fixture.js';

const planFile = readPlanYaml(planYaml('0'.repeat(40), {
  'module/user': [{ path: 'src/controllers/user.controller.ts' }, { path: 'src/services/user.service.ts', tests: ['src/services/user.service.spec.ts'] }, { path: 'src/modules/user/user.dto.ts' }],
  'shared/format': [{ path: 'src/utils/format.ts' }],
  'shared/clock': [{ path: 'src/utils/clock.ts' }],
}));

const analyzed = (path: string, targets: string[]): AnalyzedFile => ({
  path, format: 'esm', config: null, hazards: [],
  sites: targets.map((target) => ({ kind: 'import', specifier: target, start: 0, end: 0, typeOnly: false, resolution: { type: 'file', path: target, via: 'typescript' } })),
});

describe('step records', () => {
  const steps = planSteps(planFile);

  it('keeps each plan line as an entry (subject, then its tests) at repo paths, only when it moves', () => {
    expect(steps.map((step) => [step.index, step.rung, step.group, step.status, step.round])).toEqual([[1, 'R1', 'module/user', 'pending', 1], [2, 'R2', 'shared/shared', 'pending', 1]]);
    expect(steps[0]!.entries).toEqual([
      ['server/src/controllers/user.controller.ts'],
      ['server/src/services/user.service.ts', 'server/src/services/user.service.spec.ts'],
    ]);
    expect(steps[0]!.moves['server/src/services/user.service.spec.ts']).toBe('server/src/modules/user/user.service.spec.ts');
    expect(steps[1]!.entries).toEqual([['server/src/utils/format.ts'], ['server/src/utils/clock.ts']]);
  });

  it('subtracts pins from the requested moves', () => {
    expect([...effectiveMoves(steps[0]!, new Set(['server/src/services/user.service.ts', 'server/src/services/user.service.spec.ts'])).keys()]).toEqual(['server/src/controllers/user.controller.ts']);
  });

  it('numbers R3 steps after the plan and renames a file with the files named after it', () => {
    const renames = renameSteps([{ index: 1, rung: 'R3', group: 'module/user', moves: new Map([
      ['server/src/modules/user/userController.ts', 'server/src/modules/user/user.controller.ts'],
      ['server/src/modules/user/userController.spec.ts', 'server/src/modules/user/user.controller.spec.ts'],
      ['server/src/modules/user/UserDto.ts', 'server/src/modules/user/user.dto.ts'],
    ]) }], 3);
    expect(renames.map((step) => [step.index, step.rung, step.group])).toEqual([[3, 'R3', 'module/user']]);
    expect(renames[0]!.entries).toEqual([['server/src/modules/user/UserDto.ts'], ['server/src/modules/user/userController.spec.ts', 'server/src/modules/user/userController.ts']]);
  });

  it('attributes a failure to entries: own files and co-moves, then the paths the detail names, then what an importer references', () => {
    const step = steps[0]!;
    const effective = effectiveMoves(step, new Set());
    const tracked = new Set([...Object.keys(step.moves), 'server/src/services/__mocks__/user.service.ts', 'server/src/main.ts', 'server/src/app.ts']);
    let analyzedOnce = 0;
    const analysis = (): Analysis => {
      analyzedOnce++;
      return { files: new Map([
        ['server/src/main.ts', analyzed('server/src/main.ts', ['server/src/controllers/user.controller.ts', 'server/src/services/user.service.ts', 'server/src/utils/format.ts'])],
        ['server/src/app.ts', analyzed('server/src/app.ts', [])],
      ]) };
    };
    const [controller, service] = [step.entries[0], step.entries[1]];
    expect(attributeOffenders(step, effective, [{ file: 'server/src/services/user.service.spec.ts', detail: 'x' }], tracked, analysis)).toEqual({ entries: [service], unattributed: [] });
    expect(attributeOffenders(step, effective, [{ file: 'server/src/services/__mocks__/user.service.ts', detail: 'x' }], tracked, analysis)).toEqual({ entries: [service], unattributed: [] });
    // An importer's missed rewrite names its target (by its new path): only that entry.
    const missed = "line 3: import '../services/user.service.js': expected file server/src/modules/user/user.service.ts (typescript), got unresolved";
    expect(attributeOffenders(step, effective, [{ file: 'server/src/main.ts', detail: missed }], tracked, analysis)).toEqual({ entries: [service], unattributed: [] });
    expect(attributeOffenders(step, effective, [{ detail: `K1: ${missed}` }], tracked, analysis)).toEqual({ entries: [service], unattributed: [] });
    expect(analyzedOnce).toBe(0);
    // Without a named path, every moved file the importer references.
    expect(attributeOffenders(step, effective, [{ file: 'server/src/main.ts', detail: 'bytes outside a specifier span changed' }], tracked, analysis)).toEqual({ entries: [controller, service], unattributed: [] });
    expect(attributeOffenders(step, effective, [{ file: 'server/src/app.ts', detail: 'x' }, { file: 'server/package.json', detail: 'y' }, { detail: 'crashed: no file' }], tracked, analysis))
      .toEqual({ entries: [], unattributed: ['server/src/app.ts', 'server/package.json', 'crashed: no file'] });
    // A path is named only as a whole: user.service.ts is not user.service.tsx.
    expect(attributeOffenders(step, effective, [{ detail: 'server/src/modules/user/user.service.tsx' }], tracked, analysis).entries).toEqual([]);
  });

  it('finds the deepest common directory', () => {
    expect(commonDirectory(['a/b/c/x.ts', 'a/b/y.ts'])).toBe('a/b');
    expect(commonDirectory(['a/x.ts', 'b/y.ts'])).toBe('');
    expect(commonDirectory(['x.ts'])).toBe('');
  });
});

describe('commit messages', () => {
  const base = { scope: 'server', packageRoot: 'server', index: 7, planSha256: 'abcdef0123456789', counts: { filesMoved: 3, specifierEdits: 12, filesEdited: 5 }, pinned: [], replans: 0 };
  const moves = new Map([['server/src/services/user.service.ts', 'server/src/modules/user/user.service.ts'], ['server/src/controllers/user.controller.ts', 'server/src/modules/user/user.controller.ts']]);

  it('names the move, the normalization or the boundary rules in a conventional subject', () => {
    expect(subjectLine({ ...base, rung: 'R1', group: 'module/user', moves })).toBe('refactor(server): move user into src/modules/user');
    expect(subjectLine({ ...base, rung: 'R2', group: 'platform/registry', moves: new Map([['server/src/a.ts', 'server/src/platform/registry/a.ts']]) })).toBe('refactor(server): move registry into src/platform/registry');
    expect(subjectLine({ ...base, rung: 'R3', group: 'module/user', moves: new Map([['server/src/modules/user/userController.ts', 'server/src/modules/user/user.controller.ts']]) })).toBe('refactor(server): normalize file names in src/modules/user');
    expect(subjectLine({ ...base, rung: 'R4', group: 'boundaries', moves: new Map() })).toBe('chore(server): add boundary rules with a frozen baseline');
  });

  it('carries the step, the plan, the counts, pins and replans, then the trailers as the last paragraph', () => {
    expect(stepMessage({ ...base, rung: 'R1', group: 'module/user', moves, pinned: ['server/src/services/user-paths.ts'], replans: 2 }, ['Ac-Certificate: pass (static) K0=pass', 'Ac-Certificate-Digest: sha256:00'])).toBe([
      'refactor(server): move user into src/modules/user',
      '',
      'Step 7 (R1, module/user) of plan sha256 abcdef012345.',
      '3 files moved; 12 specifier edits in 5 files.',
      'Pinned (left in place): src/services/user-paths.ts.',
      'Replanned 2 times.',
      '',
      'Ac-Certificate: pass (static) K0=pass',
      'Ac-Certificate-Digest: sha256:00',
      '',
    ].join('\n'));
    expect(stepMessage({ ...base, rung: 'R4', group: 'boundaries', moves: new Map(), added: ['server/.dependency-cruiser.json'], summary: '6 rules' })).toContain('Adds .dependency-cruiser.json: 6 rules.');
  });
});

describe('report', () => {
  it('formats durations', () => {
    expect([formatDuration(420), formatDuration(59_940), formatDuration(59_960), formatDuration(125_000), formatDuration(179_700), formatDuration(3_725_000)])
      .toEqual(['0.4 s', '59.9 s', '1 m 00 s', '2 m 05 s', '3 m 00 s', '1 h 02 m']);
  });

  it('renders the findings section through the seam', () => {
    const state = {
      status: 'completed', base: 'b'.repeat(40), head: 'c'.repeat(40), branch: 'ac/run-x', repo: '/r', environment: '/r', packageRoot: 'server', profile: { name: 'fixture' },
      plan: { file: 'plan/plan.yaml', source: 'p', sha256: 'f'.repeat(64), steps: 0, moves: 0 }, rungs: [], steps: [], pins: [], findings: [{ kind: 'pinned', step: 2, files: ['a.ts'], detail: 'why' }],
      fault: null, cost: { budgetRun: null, mode: 'replay', llmUsd: 0, planRecordedUsd: null },
      timeline: { startedAt: '', durationMs: 1000, preflightMs: 0, baselineMs: 0, stepsMs: 0, rungCertificationMs: 0, bisectMs: 0, runCertificationMs: 0, resumedAt: [] },
    } as unknown as RunState;
    expect(renderReport(state)).toContain('- **pinned** (1)\n  - step 2: `a.ts`: why');
    expect(renderReport(state, { findings: () => 'rendered elsewhere' })).toContain('## Findings\n\nrendered elsewhere\n');
    expect(renderReport(state)).toContain('planner LLM spend of this run $0.0000 (replayed from the cassette); the plan cost unknown');
    expect(renderReport(state, { narration: { costUsd: 0.000977, calls: 2, replayed: false } })).toContain('(replayed from the cassette); findings narration $0.0010 in 2 calls; the plan cost unknown');
    expect(renderReport(state, { narration: { costUsd: 0.000977, calls: 2, replayed: true } })).toContain('findings narration $0.0010 in 2 calls when recorded (replayed: $0 now);');
  });
});

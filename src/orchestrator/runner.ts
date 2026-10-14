// The state one `ac run` invocation carries (the run's state, its directory, the injected dependencies) and what every
// phase shares: findings, the quarantine at a commit's paths, certifying a range into the run directory.
import fs from 'node:fs';
import { runBaseline, type QuarantineEntry } from '../certificate/baseline.js';
import { certify, checks } from '../certificate/certify.js';
import type { Certificate, CertifyOptions, CheckId } from '../certificate/types.js';
import { boundaryRung } from '../boundaries/index.js';
import { executeMove } from '../executor/execute.js';
import { normalizationSteps } from '../filename-normalization/index.js';
import type { PlanFile } from '../planner/plan-file.js';
import type { RunDirectory } from './run-directory.js';
import type { BoundaryRung, CertificateRecord, RunEvent, RunFinding, RungId, RungRecord, RunState, StepRecord } from './types.js';

export interface RunDependencies {
  executeMove: typeof executeMove;
  certify: typeof certify;
  runBaseline: typeof runBaseline;
  normalizationSteps: typeof normalizationSteps;
  /** Contract C6; null: R4 is reported as not available. */
  boundaryRung: BoundaryRung | null;
  /**
   * The findings log (src/findings), run when the run ends (any status); returns report.md's findings section. null:
   * report.md lists the run's own findings by kind.
   */
  findings: ((runDirectory: string) => Promise<string>) | null;
}

export const defaultDependencies: RunDependencies = {
  executeMove,
  certify,
  runBaseline,
  normalizationSteps,
  boundaryRung,
  findings: null,
};

/** A run that can't start or resume (a dirty worktree, an existing branch, a mismatched head): nothing was changed. */
export class RunError extends Error {}

/** Every check except the oracles: what each step's certificate runs. */
export const staticCheckIds = (): CheckId[] => checks.map((check) => check.id).filter((id) => id !== 'K8');

export const padded = (index: number) => String(index).padStart(3, '0');
export const certificateName = (step: StepRecord) => `${padded(step.index)}-${step.rung}-${step.group.replace('/', '-')}`;
export const failingChecks = (certificate: Certificate) => certificate.checks.filter((check) => check.status === 'fail' || check.status === 'error').map((check) => check.id);

export interface Runner {
  state: RunState;
  directory: RunDirectory;
  planFile: PlanFile;
  dependencies: RunDependencies;
  maxSteps: number | null;
  stepsThisInvocation: number;
  log(message: string): void;
  save(): void;
  event(event: Omit<RunEvent, 'ts'>): void;
}

export function createRunner(state: RunState, directory: RunDirectory, planFile: PlanFile, dependencies: RunDependencies, maxSteps: number | null, log: (message: string) => void): Runner {
  const invocationStarted = performance.now();
  const previousDuration = state.timeline.durationMs;
  return {
    state,
    directory,
    planFile,
    dependencies,
    maxSteps,
    stepsThisInvocation: 0,
    log,
    save() {
      state.timeline.durationMs = previousDuration + Math.round(performance.now() - invocationStarted);
      directory.saveState(state);
    },
    event: (event) => directory.event(event),
  };
}

export const elapsed = (started: number) => Math.round(performance.now() - started);

export function addFinding(runner: Runner, finding: RunFinding): void {
  runner.state.findings.push(finding);
}

export function rungOf(state: RunState, id: RungId): RungRecord {
  return state.rungs.find((rung) => rung.id === id)!;
}

/** The quarantine (contract C2, at the run's base paths) at `commit`'s paths: mapped through every certified step up to it. */
function quarantineAt(state: RunState, commit: string): QuarantineEntry[] {
  let entries = state.quarantine;
  if (commit === state.base) return entries;
  for (const step of state.steps.filter((candidate) => candidate.status === 'certified').sort((a, b) => a.index - b.index)) {
    entries = entries.map((entry) => ({ ...entry, file: step.pathMap?.[entry.file] ?? entry.file }));
    if (step.commit === commit) break;
  }
  return entries;
}

export async function certifyRange(runner: Runner, base: string, head: string, work: string, options: { only?: CheckId[]; oracles: boolean }): Promise<Certificate> {
  const { state } = runner;
  const certifyOptions: CertifyOptions = {
    repo: state.repo,
    base,
    head,
    packageRoot: state.packageRoot,
    environment: state.environment,
    profile: state.profile,
    oracles: options.oracles,
    ...(options.only ? { only: options.only } : {}),
    workDir: runner.directory.workDir(work),
    // Per-tree results (K6's inventory, the analyses) survive between certifications: step k+1's base is step k's head.
    cacheDir: runner.directory.path('cache'),
    keep: false,
    // Only the oracles read it; a speculative base (--jobs) has no certified pathMap to map it through yet.
    ...(options.oracles ? { quarantine: quarantineAt(state, base) } : {}),
  };
  try {
    return await runner.dependencies.certify(certifyOptions);
  } finally {
    fs.rmSync(certifyOptions.workDir, { recursive: true, force: true });
  }
}

export function storeCertificate(runner: Runner, file: string, certificate: Certificate): CertificateRecord {
  return runner.directory.storeCertificate(file, certificate);
}

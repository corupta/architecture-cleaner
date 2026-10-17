// The planner's row of the bench: `planRepo` exactly as `ac plan` and `ac run` call it (default edit settings, the
// profile's critic prompt), through a gateway on the entry's cassette, so a replay reproduces the recorded plan (the
// immich entry's plan.yaml hashes to the S6 run's b4c7c548883c…). Its placements are the partition the bench scores.
import crypto from 'node:crypto';
import type { RepoFs } from '../analyzer/repo-fs.js';
import type { Profile } from '../certificate/profile.js';
import type { Gateway } from '../gateway/types.js';
import { criticSettingsFor } from '../planner/critic.js';
import { defaultEditSettings } from '../planner/edit.js';
import { planOutputs } from '../planner/outputs.js';
import { planRepo } from '../planner/plan.js';
import { groupKey } from '../planner/types.js';
import type { Assignment } from './baselines.js';

export interface PlannerPartition {
  method: string;
  assignment: Assignment;
  groups: number;
  /** sha256 of plan.yaml as `ac plan` writes it. */
  planSha256: string;
  /** What the edit and critic calls cost when they were recorded. */
  recordedCostUsd: number;
  /** The validator's errors: the bench scores an invalid plan too, and says so. */
  errors: string[];
}

const modelNames = { super: 'Super', ultra: 'Ultra', lightning: 'Lightning' } as const;

export const plannerMethod = `planner (${modelNames[defaultEditSettings.model]})`;

export async function planPartition(repo: RepoFs, gateway: Gateway, profile: Profile, roots: { packageRoot: string; moduleRoot: string }): Promise<PlannerPartition> {
  const critic = criticSettingsFor(profile);
  const run = await planRepo(repo, gateway, { ...roots, pins: profile.plan?.pins ?? [], edit: defaultEditSettings, critic });
  const planYaml = planOutputs(run, { name: profile.name }, { edit: defaultEditSettings, critic }).get('plan.yaml')!;
  return {
    method: plannerMethod,
    assignment: new Map(run.plan.placements.map((placement) => [placement.path, groupKey(placement)])),
    groups: run.validation.metrics.groups,
    planSha256: crypto.createHash('sha256').update(planYaml).digest('hex'),
    recordedCostUsd: run.editRun.costUsd + (run.criticRun?.costUsd ?? 0),
    errors: run.validation.issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.code}: ${issue.detail}`),
  };
}

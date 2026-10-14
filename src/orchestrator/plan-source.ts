// Where a run's plan comes from: an existing plan.yaml (its recorded cost read from the plan.md beside it), or the
// planner in-process exactly as `ac plan` runs it (replay by default; live calls only through src/gateway).
import fs from 'node:fs';
import path from 'node:path';
import { gitRepoFs } from '../analyzer/repo-fs.js';
import type { Profile } from '../certificate/profile.js';
import { createGateway } from '../gateway/gateway.js';
import type { CassetteMode } from '../gateway/types.js';
import { defaultCriticSettings } from '../planner/critic.js';
import { defaultEditSettings } from '../planner/edit.js';
import { planOutputs } from '../planner/outputs.js';
import { planRepo } from '../planner/plan.js';
import type { RunPlanInput } from './run.js';

export interface PlannedRun {
  plan: RunPlanInput;
  cost: { budgetRun: string | null; mode: CassetteMode | null; llmUsd: number };
}

/** plan.md's "- Cost: **$0.1961** in 2 calls" line. */
const recordedCost = /^- Cost: \*\*\$([0-9.]+)\*\*/m;

export function planFromFile(file: string): PlannedRun {
  const markdown = path.join(path.dirname(file), 'plan.md');
  const match = fs.existsSync(markdown) ? recordedCost.exec(fs.readFileSync(markdown, 'utf8')) : null;
  return {
    plan: { text: fs.readFileSync(file, 'utf8'), source: path.resolve(file), files: new Map(), recordedCostUsd: match ? Number(match[1]) : null },
    cost: { budgetRun: null, mode: null, llmUsd: 0 },
  };
}

export interface PlannerOptions {
  repo: string;
  profile: Profile;
  cassette: string;
  mode: CassetteMode;
  /** Budget run charged by live calls (record and auto need one). */
  run: string | null;
}

/** Plans the repo at its checked-out commit; every output but plan.yaml and the step files (the run writes its own) goes to plan/. */
export async function planInProcess(options: PlannerOptions): Promise<PlannedRun> {
  const runId = options.run ?? 'replay';
  const gateway = createGateway({ runId, mode: options.mode, cassettePath: path.resolve(options.cassette) });
  const spentBefore = gateway.spent().run;
  const packageRoot = options.profile.packageRoot.replace(/^\.\/?/, '').replace(/\/$/, '');
  const critic = defaultCriticSettings;
  const run = await planRepo(gitRepoFs(options.repo), gateway, {
    packageRoot, moduleRoot: options.profile.plan?.moduleRoot ?? 'src', pins: options.profile.plan?.pins ?? [], edit: defaultEditSettings, critic,
  });
  if (!run.validation.valid) throw new Error('the planner produced an invalid plan (no steps); run `ac plan` to see the validator errors');
  const outputs = planOutputs(run, { name: options.profile.name }, { edit: defaultEditSettings, critic });
  return {
    plan: {
      text: outputs.get('plan.yaml')!,
      source: 'planner',
      files: new Map([...outputs].filter(([file]) => file !== 'plan.yaml' && !file.startsWith('steps/'))),
      recordedCostUsd: run.editRun.costUsd + (run.criticRun?.costUsd ?? 0),
    },
    cost: { budgetRun: options.run, mode: options.mode, llmUsd: options.mode === 'replay' ? 0 : gateway.spent().run - spentBefore },
  };
}

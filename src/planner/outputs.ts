// What `ac plan` writes: plan.yaml (editable), plan.md (readable), plan.json (every candidate, for analysis) and, when
// the plan is valid, one step file per group. Pure functions of the run, so a replay writes the same bytes as the recording.
import type { ModelKey, TemplateKwargs } from '../gateway/types.js';
import type { CriticSettings } from './critic.js';
import type { EditSettings } from './edit.js';
import type { PlanRun } from './plan.js';
import { planFileOf, writePlanYaml } from './plan-file.js';
import { planMarkdown } from './report.js';
import { stepFileName, stepJson, stepsOf } from './steps.js';

/** `Nemotron 3 Ultra (medium_effort)`. */
export const modelLabel = (model: ModelKey, kwargs: TemplateKwargs) =>
  `Nemotron 3 ${model[0]!.toUpperCase()}${model.slice(1)}${kwargs.medium_effort ? ' (medium_effort)' : kwargs.low_effort ? ' (low_effort)' : ''}`;

const code = (text: string) => `\`${text}\``;

/** File name (`steps/` for step files) → content. An invalid plan gets no step files: fix plan.yaml, then `ac steps`. */
export function planOutputs(run: PlanRun, target: { name: string }, settings: { edit: EditSettings; critic: CriticSettings | null }): Map<string, string> {
  const { facts } = run;
  const packageLabel = facts.packageRoot ? `${facts.packageRoot}/` : '';
  const sha = facts.sha.slice(0, 10);
  const planFile = planFileOf(facts, run.plan);
  const steps = stepsOf(planFile);
  const markdown = planMarkdown(run, {
    title: `${target.name} ${packageLabel} plan`,
    target: `${target.name} ${code(packageLabel || '.')} @ ${code(sha)}`,
    models: { edit: modelLabel(settings.edit.model, settings.edit.templateKwargs), critic: settings.critic ? modelLabel(settings.critic.model, settings.critic.templateKwargs) : '' },
    steps,
  });
  const record = {
    facts,
    draft: { assignment: Object.fromEntries(run.draft.assignment), confidence: Object.fromEntries(run.draft.confidence), contested: run.draft.contested },
    groupIds: Object.fromEntries(run.groupIds),
    candidates: [run.draftCandidate, ...run.candidates].map(({ plan: _plan, ...candidate }) => candidate),
    winner: run.winner.label,
    critic: run.criticRun,
    validation: run.validation,
  };
  return new Map([
    ['plan.yaml', writePlanYaml(planFile, `ac plan for ${target.name} ${packageLabel} @ ${sha}`)],
    ['plan.md', markdown],
    ['plan.json', `${JSON.stringify(record, null, 1)}\n`],
    ...(run.validation.valid ? steps.map((step) => [`steps/${stepFileName(step, steps.length)}`, stepJson(step)] as [string, string]) : []),
  ]);
}

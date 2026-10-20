// What `ac plan` writes: plan.yaml (editable), plan.md (readable), plan.json (every candidate, for analysis), each
// candidate's full plan as candidates/<label>.yaml (the seeds draft too, so `ac steps` can take any of them) and, when
// the plan is valid, one step file per group. Pure functions of the run, so a replay writes the same bytes as the recording.
import { models, reasoningMode } from '../gateway/models.js';
import type { ModelKey, TemplateKwargs } from '../gateway/types.js';
import type { CriticSettings } from './critic.js';
import type { EditSettings } from './edit.js';
import type { PlanRun } from './plan.js';
import { candidateFileName, planFileOf, writePlanYaml } from './plan-file.js';
import { planMarkdown } from './report.js';
import { stepFileName, stepJson, stepsOf } from './steps.js';
import type { SummarySettings } from './summaries.js';

/** `Nemotron 3 Ultra (medium_effort)`, `Nemotron 3.5 Lightning (thinking off)`, `Nemotron 3.5 Super VL (thinking on)`. */
export const modelLabel = (model: ModelKey, kwargs: TemplateKwargs) => `${models[model].name} (${reasoningMode(kwargs)})`;

const code = (text: string) => `\`${text}\``;

/** File name (`steps/` for step files) → content. An invalid plan gets no step files: fix plan.yaml, then `ac steps`. */
export function planOutputs(run: PlanRun, target: { name: string }, settings: { edit: EditSettings; critic: CriticSettings | null; summaries?: SummarySettings | null }): Map<string, string> {
  const { facts } = run;
  const packageLabel = facts.packageRoot ? `${facts.packageRoot}/` : '';
  const sha = facts.sha.slice(0, 10);
  const planFile = planFileOf(facts, run.plan);
  const steps = stepsOf(planFile);
  const markdown = planMarkdown(run, {
    title: `${target.name} ${packageLabel} plan`,
    target: `${target.name} ${code(packageLabel || '.')} @ ${code(sha)}`,
    models: {
      edit: modelLabel(settings.edit.model, settings.edit.templateKwargs),
      critic: settings.critic ? modelLabel(settings.critic.model, settings.critic.templateKwargs) : '',
      summaries: settings.summaries ? modelLabel(settings.summaries.model, settings.summaries.templateKwargs) : '',
    },
    steps,
  });
  const record = {
    facts,
    draft: { assignment: Object.fromEntries(run.draft.assignment), confidence: Object.fromEntries(run.draft.confidence), contested: run.draft.contested },
    groupIds: Object.fromEntries(run.groupIds),
    ...(run.summaryRun ? { summaries: { ...run.summaryRun, purposes: Object.fromEntries(run.summaryRun.purposes), failures: Object.fromEntries(run.summaryRun.failures) } } : {}),
    candidates: [run.draftCandidate, ...run.candidates].map(({ plan: _plan, ...candidate }) => candidate),
    winner: run.winner.label,
    critic: run.criticRun,
    validation: run.validation,
  };
  const title = `ac plan for ${target.name} ${packageLabel} @ ${sha}`;
  const candidates = [run.draftCandidate, ...run.candidates].filter((candidate) => !candidate.error).map((candidate): [string, string] =>
    [candidateFileName(candidate.label), writePlanYaml(planFileOf(facts, candidate.plan), `${title}: candidate ${candidate.label}${candidate === run.winner ? ' (the winner, before the critic)' : ''}`)]);
  return new Map([
    ['plan.yaml', writePlanYaml(planFile, title)],
    ['plan.md', markdown],
    ['plan.json', `${JSON.stringify(record, null, 1)}\n`],
    ...candidates,
    ...(run.validation.valid ? steps.map((step) => [`steps/${stepFileName(step, steps.length)}`, stepJson(step)] as [string, string]) : []),
  ]);
}

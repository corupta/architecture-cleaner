// plan.md: the readable plan (like docs/gates/immich-plan.md). Every number comes from the run itself, so a replay
// renders the same bytes.
import { displayPath } from './facts.js';
import type { PlanRun } from './plan.js';
import { candidateFileName } from './plan-file.js';
import type { Step } from './steps.js';
import { groupKey, type Placement } from './types.js';
import { turboMqFloor } from './validate.js';

const money = (usd: number) => `$${usd.toFixed(4)}`;
const percent = (part: number, whole: number) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : '0%');
const code = (text: string) => `\`${text}\``;

export interface ReportContext {
  title: string;
  /** e.g. `immich-app/immich server/ @ 02063972e8`. */
  target: string;
  models: Record<string, string>;
  steps: Step[];
}

export function planMarkdown(run: PlanRun, context: ReportContext): string {
  const { facts, draft, plan, validation, editRun, criticRun, summaryRun } = run;
  const display = (path: string) => displayPath(facts, path);
  const roleOf = new Map(facts.files.map((file) => [file.path, file.role]));
  const groups = new Map<string, Placement[]>();
  for (const placement of plan.placements) groups.set(groupKey(placement), [...(groups.get(groupKey(placement)) ?? []), placement]);
  const ordered = [...groups].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const costUsd = editRun.costUsd + (criticRun?.costUsd ?? 0) + (summaryRun?.costUsd ?? 0);
  const calls = editRun.calls + (criticRun ? 1 : 0) + (summaryRun?.calls ?? 0);
  const tokens = {
    prompt: editRun.usage.promptTokens + (criticRun?.usage.promptTokens ?? 0) + (summaryRun?.usage.promptTokens ?? 0),
    completion: editRun.usage.completionTokens + (criticRun?.usage.completionTokens ?? 0) + (summaryRun?.usage.completionTokens ?? 0),
    reasoning: editRun.usage.reasoningTokens + (criticRun?.usage.reasoningTokens ?? 0) + (summaryRun?.usage.reasoningTokens ?? 0),
  };
  const bySource = (source: Placement['source']) => plan.placements.filter((placement) => placement.source === source).length;
  const pinsByReason = new Map<string, number>();
  for (const pin of facts.pins) pinsByReason.set(pin.reason, (pinsByReason.get(pin.reason) ?? 0) + 1);
  const { metrics } = validation;
  const kinds = (kind: Placement['kind']) => [...groups.keys()].filter((key) => key.startsWith(`${kind}/`)).length;

  const lines: string[] = [];
  lines.push(`# ${context.title}`, '');
  const oneLiners = summaryRun ? ` → ${context.models.summaries} writes a one-line purpose for each of the ${summaryRun.calls} low-confidence files` : '';
  lines.push(`${context.target}. Planner: deterministic facts and seeds draft${oneLiners} → ${context.models.edit} edits the draft (json_schema strict, K=${editRun.candidates.length} ${editRun.sampling === 'n' ? 'in one n=K call' : 'in sequential calls'}) → the validator filters and ranks the edits → ${criticRun ? `${context.models.critic} reviews the winner (${criticRun.critiques.length + criticRun.errors.length > 1 ? `K=${criticRun.critiques.length + criticRun.errors.length} reviews in one n=K call` : '1 call'}) → the validator checks each suggestion` : 'no critic'}.`, '');
  lines.push(`- Movable files planned: **${facts.files.length}**; pinned and left in place: **${facts.pins.length}** (${[...pinsByReason].sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${count} ${reason}`).join(', ')}).`);
  lines.push(`- Final plan: **${metrics.groups} groups** (${kinds('module')} modules, ${kinds('platform')} platform, ${kinds('shared')} shared); cross-group edge ratio ${metrics.crossEdgeRatio}; groups in cycles ${metrics.groupsInCycles}; TurboMQ sum ${metrics.turboMqSum.toFixed(2)}.`);
  lines.push(`- Placed away from the seeds draft: **${metrics.movedFromDraft}** files (${percent(metrics.movedFromDraft, facts.files.length)}); moved by the planner ${bySource('planner')}, by the critic ${bySource('critic')}; ${plan.placements.filter((placement) => placement.contested).length} contested.`);
  lines.push(`- Cost: **${money(costUsd)}** in ${calls} calls (${tokens.prompt} prompt, ${tokens.completion} completion tokens, ${tokens.reasoning} of them reasoning).`, '');

  lines.push('## Candidates', '', '| candidate | valid | groups | edit: group entries / moves | dropped by the validator | warnings | TurboMQ sum | cross-edge ratio | groups in cycles | placed away from draft | plan |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const candidate of [run.draftCandidate, ...run.candidates]) {
    const mark = candidate === run.winner ? ' (winner)' : '';
    if (candidate.error) {
      lines.push(`| ${candidate.label} | — | — | ${candidate.error} | — | — | — | — | — | — | — |`);
      continue;
    }
    const m = candidate.validation.metrics;
    const edit = candidate.edit ? `${candidate.edit.groups.length} / ${candidate.edit.moves.length}` : '—';
    const dropped = candidate.edit ? candidate.dropped.length : '—';
    const warnings = candidate.validation.issues.filter((issue) => issue.severity === 'warning').length;
    lines.push(`| ${candidate.label}${mark} | ${candidate.validation.valid ? 'yes' : 'no'} | ${m.groups} | ${edit} | ${dropped} | ${warnings} | ${m.turboMqSum.toFixed(2)} | ${m.crossEdgeRatio} | ${m.groupsInCycles} | ${m.movedFromDraft} | ${code(candidateFileName(candidate.label))} |`);
  }
  lines.push('', `Ranking: valid first, then fewer errors; among plans that keep at least ${Math.round(turboMqFloor * 100)}% of the draft's TurboMQ sum, fewer validator warnings (the layout rules), then a higher TurboMQ sum and fewer groups in cycles. TurboMQ alone ranks the least-edited plan first (G1, and again here), and picking a plan without ground truth is still open, so every candidate is listed, and each one's full plan (before the critic) sits next to plan.yaml: \`ac steps <plan dir>/candidates/<file>.yaml --out <dir>\` makes steps from any of them.`, '');

  if (summaryRun) {
    lines.push(`## Low-confidence file purposes (${summaryRun.purposes.size} of ${summaryRun.calls})`, '');
    for (const path of draft.contested) {
      const purpose = summaryRun.purposes.get(path);
      lines.push(`- ${code(display(path))}: ${purpose ?? `no line (${summaryRun.failures.get(path)})`}`);
    }
    lines.push('');
  }

  lines.push('## Groups', '', '| group | files | roles | from draft groups | files |', '|---|---|---|---|---|');
  for (const [key, placements] of ordered) {
    const roles = new Map<string, number>();
    const labels = new Map<string, number>();
    for (const placement of placements) {
      roles.set(roleOf.get(placement.path)!, (roles.get(roleOf.get(placement.path)!) ?? 0) + 1);
      const label = draft.assignment.get(placement.path)!;
      labels.set(label, (labels.get(label) ?? 0) + 1);
    }
    const count = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([word, n]) => `${n} ${word}`).join(', ');
    const shown = placements.slice(0, 8).map((placement) => code(display(placement.path))).join(', ') + (placements.length > 8 ? `, … ${placements.length - 8} more` : '');
    lines.push(`| ${key} | ${placements.length} | ${count(roles)} | ${count(labels)} | ${shown} |`);
  }

  const decided = plan.placements.filter((placement) => placement.rationale);
  lines.push('', `## Contested files moved by Nemotron (${decided.length})`, '');
  for (const placement of decided) lines.push(`- ${code(display(placement.path))} → ${groupKey(placement)} (${placement.source}, draft "${draft.assignment.get(placement.path)}", ${placement.confidence}): ${placement.rationale}`);
  const undecided = plan.placements.filter((placement) => placement.contested && !placement.rationale);
  lines.push('', `Contested files left where the draft put them (${undecided.length}): ${undecided.map((placement) => `${code(display(placement.path))} (${groupKey(placement)}, ${placement.confidence})`).join(', ') || 'none'}.`);

  if (criticRun) {
    lines.push('', '## Critic review', '');
    const several = criticRun.critiques.length + criticRun.errors.length > 1;
    criticRun.critiques.forEach((critique, index) => lines.push(`${several ? `Review ${index + 1}:\n\n` : ''}> ${critique.review.replace(/\s*\n\s*/g, ' ')}`, ''));
    if (criticRun.errors.length) lines.push(`${criticRun.critiques.length ? 'Choices without a review' : 'The critic returned no review'}: ${criticRun.errors.join('; ')}.`, '');
    for (const suggestion of criticRun.suggestions) {
      const evidence = suggestion.evidence ? ` (evidence: ${suggestion.evidence})` : '';
      lines.push(`- ${suggestion.accepted ? 'accepted' : 'rejected'}${suggestion.sample ? ` (review ${suggestion.sample})` : ''}: ${suggestion.summary}${suggestion.rationale ? `: ${suggestion.rationale}` : ''}${evidence}${suggestion.reason ? ` (${suggestion.reason})` : ''}`);
    }
  }

  lines.push('', '## Validator', '');
  const issues = validation.issues.length ? validation.issues.map((issue) => `- ${issue.severity} ${issue.code}: ${issue.detail}`) : ['- no issues'];
  lines.push(...issues, '', 'Strongest graph disagreements left in the plan (own edge share vs the pulling group):', '');
  for (const item of metrics.disagreements.slice(0, 12)) lines.push(`- ${code(display(item.path))} in ${item.group} (${item.ownShare}) pulled to ${item.pulledTo} (${item.share})`);
  if (metrics.cycles.length) lines.push('', `Group cycles: ${metrics.cycles.map((cycle) => `${cycle.length} groups (${cycle.slice(0, 6).join(', ')}${cycle.length > 6 ? ', …' : ''})`).join('; ')}.`);

  lines.push('', '## Pinned', '', '| reason | files |', '|---|---|');
  for (const [reason, count] of [...pinsByReason].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    const pins = facts.pins.filter((pin) => pin.reason === reason);
    lines.push(`| ${reason} (${count}) | ${pins.slice(0, 10).map((pin) => code(display(pin.path))).join(', ')}${pins.length > 10 ? `, … ${pins.length - 10} more` : ''} |`);
  }

  lines.push('', '## Steps', '', '| step | rung | group | moves (with tests) | kept in a subfolder (name clash) |', '|---|---|---|---|---|');
  for (const step of context.steps) lines.push(`| ${step.index} | ${step.rung} | ${step.group} | ${step.moves.size} | ${step.disambiguated.map((path) => code(display(path))).join(', ') || '—'} |`);
  return `${lines.join('\n')}\n`;
}

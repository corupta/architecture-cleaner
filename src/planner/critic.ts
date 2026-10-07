// The critic (plan §3.5 item 5): one Ultra call reviews the winning plan like a staff engineer. Its suggestions go
// back through the validator's name and kind checks one by one; only the ones that pass change the plan.
import { z } from 'zod';
import type { Gateway, ModelKey, TemplateKwargs } from '../gateway/types.js';
import { factsText, layoutText, placementRules } from './edit.js';
import { displayPath, fileNamed } from './facts.js';
import { canonicalGroup, validatePlan } from './validate.js';
import { groupKey, type Draft, type Facts, type Placement, type Plan, type Validation } from './types.js';

const groupKinds = ['module', 'shared', 'platform'] as const;

const systemPrompt = `You are a staff engineer reviewing a proposed feature-module plan for a TypeScript backend that is sliced by technical type. A deterministic tool moves the files later and certifies every move, so you only judge the map.

${layoutText}

Placement rules the planner followed:
${placementRules}

You receive per-file facts (with ids, for the edges), the PLAN (final groups with their file paths) and the validator's warnings. The warnings are hints, not rules: act on one only when the fix is clearly better architecture, and never split a cohesive group or merge unrelated files just to silence one. Review the plan the way you would review a colleague's design before approving it:
- "review": at most 120 words of plain prose: what is right, what is wrong, and what you change and why.
- "groups": changes to whole groups only, each {group: the current "<kind>/<name>", name, kind}: rename it, change its kind, or merge it into another group by giving that group's name. Omit the groups you keep.
- "moves": single files to move, each {file: its path exactly as the PLAN lists it, to: the final group name, kind, rationale}.
Keep the changes small and certain: at most one file in ten, and none where the plan is defensible. Names come from the repo's own vocabulary.`;

const critiqueSchema = {
  type: 'object',
  properties: {
    review: { type: 'string' },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: { group: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string', enum: groupKinds } },
        required: ['group', 'name', 'kind'],
        additionalProperties: false,
      },
    },
    moves: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, to: { type: 'string' }, kind: { type: 'string', enum: groupKinds }, rationale: { type: 'string' } },
        required: ['file', 'to', 'kind', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['review', 'groups', 'moves'],
  additionalProperties: false,
};

const critiqueValue = z.object({
  review: z.string(),
  groups: z.array(z.object({ group: z.string(), name: z.string(), kind: z.enum(groupKinds) })),
  moves: z.array(z.object({ file: z.string(), to: z.string(), kind: z.enum(groupKinds), rationale: z.string() })),
});

export type Critique = z.infer<typeof critiqueValue>;

export interface CriticSettings {
  model: ModelKey;
  templateKwargs: TemplateKwargs;
  maxTokens: number;
}

export const defaultCriticSettings: CriticSettings = { model: 'ultra', templateKwargs: { medium_effort: true }, maxTokens: 32_000 };

export interface Suggestion {
  /** `group module/asset-media → module/asset` or `move 42 → module/album`. */
  summary: string;
  rationale?: string;
  accepted: boolean;
  reason?: string;
}

export interface CriticRun {
  critique?: Critique;
  error?: string;
  costUsd: number;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number };
}

/** Bare kebab name: `modules/album` → `album`. */
export const bareName = (name: string) => name.trim().toLowerCase().replace(/^(modules?|shared|platform)\//, '');

/** The plan by path, not by id: G1-style id lists made the critic attach rationales to the wrong files. */
export function planText(facts: Facts, plan: Plan, validation: Validation): string {
  const display = (path: string) => displayPath(facts, path);
  const members = new Map<string, string[]>();
  for (const placement of plan.placements) members.set(groupKey(placement), [...(members.get(groupKey(placement)) ?? []), display(placement.path)]);
  const groups = [...members].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, paths]) => `${key}: ${paths.join(' ')}`);
  const warnings = validation.issues.filter((issue) => issue.severity === 'warning').map((issue) => `${issue.code}: ${issue.detail}`);
  const { metrics } = validation;
  const disagreements = metrics.disagreements.slice(0, 15).map((item) => `${display(item.path)} in ${item.group} (${item.ownShare}) pulled to ${item.pulledTo} (${item.share})`);
  return [
    `PLAN (group: file paths under ${facts.moduleRoot || '.'}/)\n${groups.join('\n')}`,
    `VALIDATOR WARNINGS\n${warnings.join('\n') || '(none)'}`,
    `STRONGEST GRAPH DISAGREEMENTS (file in group (own edge share) pulled to group (share))\n${disagreements.join('\n') || '(none)'}`,
    `METRICS: ${metrics.groups} groups, cross-group edge ratio ${metrics.crossEdgeRatio}, ${metrics.groupsInCycles} groups in cycles`,
  ].join('\n\n');
}

export async function runCritic(gateway: Gateway, facts: Facts, plan: Plan, validation: Validation, settings: CriticSettings = defaultCriticSettings): Promise<CriticRun> {
  const result = await gateway.structured({
    model: settings.model,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `${factsText(facts)}\n\n${planText(facts, plan, validation)}` }],
    schemaName: 'plan_review',
    schema: critiqueSchema,
    parse: (value: unknown) => critiqueValue.parse(value),
    maxTokens: settings.maxTokens,
    templateKwargs: settings.templateKwargs,
  });
  const choice = result.choices[0];
  const usage = { promptTokens: result.usage?.promptTokens ?? 0, completionTokens: result.usage?.completionTokens ?? 0, reasoningTokens: result.usage?.reasoningTokens ?? 0 };
  return { costUsd: result.costUsd, usage, ...(choice?.value ? { critique: choice.value } : { error: choice?.error ?? 'no choice' }) };
}

/**
 * Applies the suggestions one at a time, in order, each through the validator: a suggestion is kept only if the plan
 * it produces has no more errors and no more warnings than the plan before it (S5: an ungated critic split the
 * registries into one-file groups and merged cron into database just to silence warnings). Suggestions that change
 * nothing are dropped silently.
 */
export function applyCritique(facts: Facts, draft: Draft, plan: Plan, critique: Critique): { plan: Plan; suggestions: Suggestion[] } {
  const suggestions: Suggestion[] = [];
  let current = plan;
  let currentValidation = validatePlan(facts, draft, plan);
  const count = (validation: Validation, severity: 'error' | 'warning') => validation.issues.filter((issue) => issue.severity === severity);
  const attempt = (summary: string, revised: Plan, rationale?: string) => {
    const validation = validatePlan(facts, draft, revised);
    const before = new Set(currentValidation.issues.map((issue) => `${issue.code} ${issue.detail}`));
    const added = validation.issues.filter((issue) => !before.has(`${issue.code} ${issue.detail}`)).map((issue) => `${issue.code}: ${issue.detail}`);
    const suggestion: Suggestion = { summary, accepted: false, ...(rationale ? { rationale } : {}) };
    if (count(validation, 'error').length > count(currentValidation, 'error').length) suggestion.reason = `adds an error (${added.join('; ')})`;
    else if (count(validation, 'warning').length > count(currentValidation, 'warning').length) suggestion.reason = `adds a warning (${added.join('; ')})`;
    else {
      suggestion.accepted = true;
      current = revised;
      currentValidation = validation;
    }
    suggestions.push(suggestion);
  };

  for (const entry of critique.groups) {
    const key = entry.group.trim().toLowerCase();
    const target = canonicalGroup(bareName(entry.name), entry.kind);
    const summary = `group ${key} → ${groupKey(target)}`;
    if (!current.placements.some((placement) => groupKey(placement) === key)) {
      suggestions.push({ summary, accepted: false, reason: 'no such group' });
      continue;
    }
    if (groupKey(target) === key) continue;
    attempt(summary, { placements: current.placements.map((placement) => (groupKey(placement) === key ? { ...placement, ...target } : placement)) });
  }
  for (const move of critique.moves) {
    const target = canonicalGroup(bareName(move.to), move.kind);
    const file = fileNamed(facts, move.file);
    const summary = `move ${file?.path ?? move.file} → ${groupKey(target)}`;
    const placement = file && current.placements.find((candidate) => candidate.path === file.path);
    if (!placement) {
      suggestions.push({ summary, accepted: false, reason: 'no such movable file', rationale: move.rationale });
      continue;
    }
    if (groupKey(placement) === groupKey(target)) continue;
    const moved: Placement = { ...placement, ...target, contested: true, source: 'critic', rationale: move.rationale };
    attempt(summary, { placements: current.placements.map((candidate) => (candidate.path === file.path ? moved : candidate)) }, move.rationale);
  }
  return { plan: current, suggestions };
}

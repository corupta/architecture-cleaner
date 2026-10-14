// The critic (plan §3.5 item 5): Ultra reviews the winning plan like a staff engineer, K reviews from one n=K call. Every
// suggestion of every review goes back through the validator one by one; only the ones that pass change the plan.
import { z } from 'zod';
import type { Gateway, ModelKey, TemplateKwargs } from '../gateway/types.js';
import { factsText, layoutText, placementRules } from './edit.js';
import { displayPath, fileNamed } from './facts.js';
import { canonicalGroup, mergeEvidence, moveEvidence, registryGroup, validatePlan } from './validate.js';
import { groupKey, type Draft, type Facts, type Issue, type Placement, type Plan, type Validation } from './types.js';

const groupKinds = ['module', 'shared', 'platform'] as const;

const systemPrompt = `You are a staff engineer reviewing a proposed feature-module plan for a TypeScript backend that is sliced by technical type. A deterministic tool moves the files later and certifies every move, so you only judge the map.

${layoutText}

Placement rules the planner followed:
${placementRules}

You receive per-file facts (with ids, for the edges), the PLAN (final groups with their file paths) and the validator's warnings. The warnings are hints, not rules: act on one only when the fix is clearly better architecture, and never split a cohesive group or merge unrelated files just to silence one. Review the plan the way you would review a colleague's design before approving it:
- "review": at most 120 words of plain prose: what is right, what is wrong, and what you change and why.
- "groups": changes to whole groups only, each {group: the current "<kind>/<name>", name, kind}: rename it, change its kind, or merge it into another group by giving that group's name. Omit the groups you keep.
- "moves": single files to move, each {file: its path exactly as the PLAN lists it, to: the final group name, kind, rationale}.
Keep the changes small and certain: at most one file in ten, and none where the plan is defensible. Names come from the repo's own vocabulary.
Each change is checked on its own and dropped if it adds any validator warning to any group, even while it clears another. Merging a group into an existing one needs evidence: an edge between their files, or a table or route prefix both use; a shared word is not enough. A registry group holds registries only.`;

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
  /**
   * Reviews from one n=K call, gated in order. Default 1: on immich (S6) K=3 reviews read draft labels as plan groups
   * and the gate let one move system-metadata.service.ts away from its controller and repository; the single review
   * made only evidenced changes.
   */
  samples: number;
}

export const defaultCriticSettings: CriticSettings = { model: 'ultra', templateKwargs: { medium_effort: true }, maxTokens: 32_000, samples: 1 };

export interface Suggestion {
  /** `group module/asset-media → module/asset` or `move src/utils/date.ts → module/album`. */
  summary: string;
  rationale?: string;
  accepted: boolean;
  reason?: string;
  /** For a merge into an existing group: what links the two (`3 edges; tables album`). */
  evidence?: string;
  /** 1-based review it came from, when the critic returned more than one. */
  sample?: number;
}

export interface CriticRun {
  /** The valid reviews, in choice order. */
  critiques: Critique[];
  /** Why a choice gave no review (truncated, unparseable), in choice order. */
  errors: string[];
  costUsd: number;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number };
}

/** Bare kebab name: `modules/album` → `album`. */
export const bareName = (name: string) => name.trim().toLowerCase().replace(/^(modules?|shared|platform)\//, '');

/** A group key as the critic writes it: `modules/auth-admin` and `platforms/http` name `module/auth-admin` and `platform/http`. */
export const groupKeyOf = (written: string) => written.trim().toLowerCase().replace(/^(module|platform)s\//, '$1/');

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
    ...(settings.samples > 1 ? { n: settings.samples } : {}),
  });
  const choices = [...result.choices].sort((a, b) => a.index - b.index);
  const usage = { promptTokens: result.usage?.promptTokens ?? 0, completionTokens: result.usage?.completionTokens ?? 0, reasoningTokens: result.usage?.reasoningTokens ?? 0 };
  return {
    costUsd: result.costUsd,
    usage,
    critiques: choices.flatMap((choice) => (choice.value ? [choice.value] : [])),
    errors: choices.length ? choices.flatMap((choice) => (choice.value ? [] : [`choice ${choice.index + 1}: ${choice.error ?? `finish reason ${choice.finishReason}`}`])) : ['no choice'],
  };
}

/**
 * Issues of `after` that `before` doesn't account for, compared per severity, code and group: a suggestion that
 * clears one warning and adds another (S5: platform/move → module/move-history swapped platform-feature for
 * singleton-group) adds one. When a suggestion renames or merges a group, `before`'s issues on it count under the
 * group it became, so a rename that keeps its warnings adds none.
 */
export function addedIssues(before: Issue[], after: Issue[], renamed?: { from: string; to: string }): Issue[] {
  const keyOf = (issue: Issue, group = issue.group) => `${issue.severity} ${issue.code} ${group ?? ''}`;
  const left = new Map<string, number>();
  for (const issue of before) {
    const key = keyOf(issue, renamed && issue.group === renamed.from ? renamed.to : issue.group);
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  const known = new Set(before.map((issue) => `${issue.code} ${issue.detail}`));
  const byKey = new Map<string, Issue[]>();
  for (const issue of after) byKey.set(keyOf(issue), [...(byKey.get(keyOf(issue)) ?? []), issue]);
  return [...byKey].flatMap(([key, issues]) => {
    const extra = issues.length - (left.get(key) ?? 0);
    if (extra <= 0) return [];
    // Name the new ones: those whose text is new, else the last ones of the key.
    const fresh = issues.filter((issue) => !known.has(`${issue.code} ${issue.detail}`));
    return (fresh.length >= extra ? fresh : issues).slice(-extra);
  });
}

/** One review through the gate; see applyCritiques. */
export function applyCritique(facts: Facts, draft: Draft, plan: Plan, critique: Critique): { plan: Plan; suggestions: Suggestion[] } {
  return applyCritiques(facts, draft, plan, [critique]);
}

/**
 * Applies the suggestions one at a time, review by review in order, each through the validator: a suggestion is kept
 * only if it adds no error and no warning to any group (addedIssues; S5: an ungated critic split the registries into
 * one-file groups and merged cron into database just to silence warnings, and a count-only gate let it trade warnings).
 * Anything that joins an existing group needs evidence, not just a shared word: a group renamed onto it, or a group's
 * last file moved into it, by mergeEvidence; any other file moved into it by moveEvidence (S6: tag.service.ts could
 * leave its controller and repository for module/album, linked to it by nothing). A registry needs none to join the
 * composition root. A later review never overrides an earlier kept suggestion: one that touches a group or file a
 * kept suggestion already changed is rejected. Suggestions that change nothing (a repeat of a kept one included) are
 * dropped silently.
 */
export function applyCritiques(facts: Facts, draft: Draft, plan: Plan, critiques: Critique[]): { plan: Plan; suggestions: Suggestion[] } {
  const suggestions: Suggestion[] = [];
  let current = plan;
  let currentValidation = validatePlan(facts, draft, plan);
  const changedGroups = new Map<string, number>();
  const changedFiles = new Map<string, number>();
  let sample = 1;
  const numbered = (suggestion: Suggestion): Suggestion => (critiques.length > 1 ? { ...suggestion, sample } : suggestion);
  const attempt = (suggestion: Suggestion, revised: Plan, touched: { groups: string[]; files: string[] }, renamed?: { from: string; to: string }) => {
    const validation = validatePlan(facts, draft, revised);
    const added = addedIssues(currentValidation.issues, validation.issues, renamed);
    const listed = added.map((issue) => `${issue.code}: ${issue.detail}`).join('; ');
    if (added.some((issue) => issue.severity === 'error')) suggestion.reason = `adds an error (${listed})`;
    else if (added.length) suggestion.reason = `adds a warning (${listed})`;
    else {
      suggestion.accepted = true;
      current = revised;
      currentValidation = validation;
      for (const group of touched.groups) changedGroups.set(group, sample);
      for (const file of touched.files) changedFiles.set(file, sample);
    }
    suggestions.push(suggestion);
  };
  /** Rejects (and returns false for) a suggestion on something an earlier kept suggestion changed. */
  const untouched = (suggestion: Suggestion, groups: string[], files: string[]) => {
    const earlier = [...groups.map((group) => changedGroups.get(group)), ...files.map((file) => changedFiles.get(file))].find((value) => value !== undefined);
    if (earlier === undefined) return true;
    suggestions.push({ ...suggestion, reason: `already changed by a kept suggestion${critiques.length > 1 ? ` of review ${earlier}` : ''}` });
    return false;
  };

  const exists = (group: string) => current.placements.some((placement) => groupKey(placement) === group);
  const filesOf = (group: string) => current.placements.filter((placement) => groupKey(placement) === group).map((placement) => placement.path);
  const isRegistry = (path: string) => facts.files.some((candidate) => candidate.path === path && candidate.role === 'registry');
  /**
   * False (and the suggestion rejected) when nothing links what joins the existing group `target`: the group `source`
   * (a merge), or the one file `moved` out of a group that keeps others (a move).
   */
  const supported = (suggestion: Suggestion, target: string, joining: { source: string } | { moved: string }) => {
    if (!exists(target)) return true;
    const files = 'source' in joining ? filesOf(joining.source) : [joining.moved];
    if (target === registryGroup && files.every(isRegistry)) {
      suggestion.evidence = 'registries join the composition root';
      return true;
    }
    const evidence = 'source' in joining ? mergeEvidence(facts, current, joining.source, target) : moveEvidence(facts, current, joining.moved, target);
    const found = [
      ...(evidence.edges ? [`${evidence.edges} edge${evidence.edges === 1 ? '' : 's'}`] : []),
      ...(evidence.tables.length ? [`tables ${evidence.tables.join(', ')}`] : []),
      ...(evidence.routes.length ? [`routes ${evidence.routes.join(', ')}`] : []),
    ];
    if (found.length) suggestion.evidence = found.join('; ');
    else {
      const what = 'source' in joining ? `a merge without evidence: no edge between the files of ${joining.source} and ${target}` : `a move without evidence: no edge between ${joining.moved} and the files of ${target}`;
      suggestions.push({ ...suggestion, reason: `${what}, no table or route both use` });
    }
    return found.length > 0;
  };

  for (const critique of critiques) {
    for (const entry of critique.groups) {
      const key = groupKeyOf(entry.group);
      const target = canonicalGroup(bareName(entry.name), entry.kind);
      const summary = `group ${key} → ${groupKey(target)}`;
      if (groupKey(target) === key || suggestions.some((kept) => kept.accepted && kept.summary === summary)) continue;
      if (!exists(key)) {
        if (untouched(numbered({ summary, accepted: false }), [key], [])) suggestions.push(numbered({ summary, accepted: false, reason: 'no such group' }));
        continue;
      }
      const suggestion = numbered({ summary, accepted: false });
      if (!untouched(suggestion, [key, groupKey(target)], [])) continue;
      if (!supported(suggestion, groupKey(target), { source: key })) continue;
      attempt(suggestion, { placements: current.placements.map((placement) => (groupKey(placement) === key ? { ...placement, ...target } : placement)) },
        { groups: [key, groupKey(target)], files: filesOf(key) }, { from: key, to: groupKey(target) });
    }
    for (const move of critique.moves) {
      const target = canonicalGroup(bareName(move.to), move.kind);
      const file = fileNamed(facts, move.file);
      const summary = `move ${file?.path ?? move.file} → ${groupKey(target)}`;
      const placement = file && current.placements.find((candidate) => candidate.path === file.path);
      if (!placement) {
        suggestions.push(numbered({ summary, accepted: false, reason: 'no such movable file', rationale: move.rationale }));
        continue;
      }
      if (groupKey(placement) === groupKey(target)) continue;
      const suggestion = numbered({ summary, accepted: false, ...(move.rationale ? { rationale: move.rationale } : {}) });
      if (!untouched(suggestion, [], [file.path])) continue;
      // Moving a group's last file is merging that group (S6: the critic moved schema-check.ts, platform/check's only
      // file, after its group merge was refused for want of evidence).
      const last = filesOf(groupKey(placement)).length === 1;
      if (last && !untouched(suggestion, [groupKey(placement), groupKey(target)], [])) continue;
      if (!supported(suggestion, groupKey(target), last ? { source: groupKey(placement) } : { moved: file.path })) continue;
      const moved: Placement = { ...placement, ...target, contested: true, source: 'critic', rationale: move.rationale };
      attempt(suggestion, { placements: current.placements.map((candidate) => (candidate.path === file.path ? moved : candidate)) },
        { groups: last ? [groupKey(placement), groupKey(target)] : [], files: [file.path] }, last ? { from: groupKey(placement), to: groupKey(target) } : undefined);
    }
    sample++;
  }
  return { plan: current, suggestions };
}

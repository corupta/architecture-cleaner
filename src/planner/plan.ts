// `ac plan`: facts → seeds draft → (opt-in Lightning one-liners) → K Nemotron edits → the validator filters and ranks
// them → the critic reviews the winner → the final plan (plan §3.5). Every LLM output passes the deterministic
// validator before it counts.
import type { RepoFs } from '../analyzer/repo-fs.js';
import type { Gateway } from '../gateway/types.js';
import { applyCritiques, runCritic, type CriticRun, type CriticSettings, type Suggestion } from './critic.js';
import { editPrompt, runEdit, type EditRun, type EditSettings } from './edit.js';
import { buildFacts } from './facts.js';
import { seedDraft } from './seeds.js';
import { runSummaries, type SummaryRun, type SummarySettings } from './summaries.js';
import type { Draft, Facts, Issue, Plan, PlanEdit, Validation } from './types.js';
import { applyEdit, checkEdit, rankCandidates, validatePlan } from './validate.js';

export interface PlanOptions {
  packageRoot: string;
  moduleRoot: string;
  /** Extra package-relative pin globs from the target profile. */
  pins: string[];
  edit: EditSettings;
  /** null: no critic call. */
  critic: CriticSettings | null;
  /** Lightning one-liners for the draft's low-confidence files, fed to the editor; off (null or absent) by default. */
  summaries?: SummarySettings | null;
}

export interface Candidate {
  label: string;
  error?: string;
  edit?: PlanEdit;
  /** What the validator dropped from the edit before applying it. */
  dropped: Issue[];
  plan: Plan;
  validation: Validation;
  reasoningChars: number;
}

export interface PlanRun {
  facts: Facts;
  draft: Draft;
  groupIds: Map<string, string>;
  /** null when summaries are off. */
  summaryRun: SummaryRun | null;
  /** The draft as a plan (labels as module names): the baseline every candidate is compared with. */
  draftCandidate: Candidate;
  candidates: Candidate[];
  /** Best-ranked candidate, or the draft when no edit came back. */
  winner: Candidate;
  editRun: EditRun;
  criticRun: (CriticRun & { suggestions: Suggestion[] }) | null;
  plan: Plan;
  validation: Validation;
}

export async function planRepo(repo: RepoFs, gateway: Gateway, options: PlanOptions): Promise<PlanRun> {
  const facts = buildFacts(repo, { packageRoot: options.packageRoot, moduleRoot: options.moduleRoot, pins: options.pins });
  // Nothing movable means a wrong root, not an empty plan: fail before the n=K edit and the critic spend anything.
  if (!facts.files.length) {
    const where = `${facts.packageRoot ? `${facts.packageRoot}/` : ''}${facts.moduleRoot || '.'}/`;
    throw new Error(`no movable files under ${where} (${facts.pins.length} pinned): check --root and --module-root, or the profile`);
  }
  const draft = seedDraft(facts);
  const summaryRun = options.summaries ? await runSummaries(gateway, repo, facts, draft, options.summaries) : null;
  const prompt = editPrompt(facts, draft, summaryRun?.purposes);
  const { groupIds } = prompt;
  const asCandidate = (label: string, edit: PlanEdit, extra: Partial<Candidate> = {}): Candidate => {
    const { accepted, issues } = checkEdit(facts, draft, edit, groupIds);
    const plan = applyEdit(facts, draft, accepted, groupIds);
    return { label, edit, dropped: issues, plan, validation: validatePlan(facts, draft, plan), reasoningChars: 0, ...extra };
  };
  const draftCandidate = asCandidate('seeds draft', { groups: [], moves: [] });
  delete draftCandidate.edit;

  const editRun = await runEdit(gateway, prompt, options.edit);
  const candidates = editRun.candidates.map((candidate) =>
    candidate.edit
      ? asCandidate(candidate.label, candidate.edit, { reasoningChars: candidate.reasoningChars })
      : { ...draftCandidate, label: candidate.label, error: candidate.error ?? 'no edit', reasoningChars: candidate.reasoningChars });
  const ranked = rankCandidates(candidates.filter((candidate) => !candidate.error), draftCandidate.validation.metrics.turboMqSum);
  const winner = ranked[0] ?? draftCandidate;

  let criticRun: PlanRun['criticRun'] = null;
  let plan = winner.plan;
  if (options.critic && winner !== draftCandidate) {
    const run = await runCritic(gateway, facts, winner.plan, winner.validation, options.critic);
    const applied = applyCritiques(facts, draft, winner.plan, run.critiques);
    criticRun = { ...run, suggestions: applied.suggestions };
    plan = applied.plan;
  }
  return { facts, draft, groupIds, summaryRun, draftCandidate, candidates, winner, editRun, criticRun, plan, validation: validatePlan(facts, draft, plan) };
}

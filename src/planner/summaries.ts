// The Lightning one-liners (plan §3.5 step 1): one line of purpose per low-confidence file of the seeds draft, from
// Nemotron 3.5 Lightning reading the file's source and its neighbours. A cheap fan-out: one json_schema strict call per
// file, thinking off (a summary, not a judgment). The lines reach the draft editor as hints. Opt-in (PlanOptions
// .summaries), so the committed immich plan's edit prompt stays as recorded.
import { z } from 'zod';
import type { RepoFs } from '../analyzer/repo-fs.js';
import type { Gateway, ModelKey, TemplateKwargs } from '../gateway/types.js';
import { displayPath } from './facts.js';
import type { Draft, Facts } from './types.js';

export interface SummarySettings {
  model: ModelKey;
  templateKwargs: TemplateKwargs;
  maxTokens: number;
  /** The source is cut after this many characters. */
  maxSourceCharacters: number;
}

export const defaultSummarySettings: SummarySettings = { model: 'lightning', templateKwargs: { enable_thinking: false }, maxTokens: 256, maxSourceCharacters: 6000 };

export interface SummaryRun {
  /** Package path → one-line purpose, by path. */
  purposes: Map<string, string>;
  /** Package path → why it has no line (a truncated or invalid answer), by path. */
  failures: Map<string, string>;
  costUsd: number;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number };
  calls: number;
}

const systemPrompt = `You describe one source file of a TypeScript backend for an architect who is grouping the files into feature modules. Answer with one line of at most 20 words: what the file does and which feature or plumbing concern it serves, in the repo's own words (its routes, tables, symbols). Never answer with a file type alone ("a utility file", "a service").`;

const purposeSchema = {
  type: 'object',
  properties: { purpose: { type: 'string' } },
  required: ['purpose'],
  additionalProperties: false,
};

const purposeValue = z.object({ purpose: z.string().trim().min(1) });

const listed = (paths: string[], limit: number) => (paths.length ? `${paths.slice(0, limit).join(' ')}${paths.length > limit ? ` +${paths.length - limit} more` : ''}` : '(none)');

/** The user message for one file: its facts, its neighbours by path, then its source (cut at the limit). */
export function summaryPrompt(repo: RepoFs, facts: Facts, path: string, settings: SummarySettings): string {
  const file = facts.files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`${path} is not a movable file`);
  const display = (filePath: string) => displayPath(facts, filePath);
  const uses = facts.edges.filter((edge) => edge.from === path).map((edge) => display(edge.to));
  const usedBy = facts.edges.filter((edge) => edge.to === path).map((edge) => display(edge.from));
  const source = repo.read(facts.packageRoot ? `${facts.packageRoot}/${path}` : path) ?? '';
  const cut = source.length > settings.maxSourceCharacters ? `${source.slice(0, settings.maxSourceCharacters)}\n… (cut at ${settings.maxSourceCharacters} of ${source.length} characters)` : source;
  const { reads, writes } = file.tables;
  return [
    `FILE ${display(path)} (role ${file.role}, ${file.loc} lines)`,
    `EXPORTS: ${listed(file.exports, 12)}`,
    ...(reads.length || writes.length ? [`TABLES: reads ${listed(reads, 12)}; writes ${listed(writes, 12)}`] : []),
    ...(file.routes.length ? [`ROUTES: ${file.routes.join(' ')}`] : []),
    `USES: ${listed(uses, 15)}`,
    `USED BY: ${listed(usedBy, 15)}`,
    `SOURCE:\n${cut}`,
  ].join('\n');
}

/** One Lightning call per low-confidence draft file (draft.contested, in path order), all in flight at once. */
export async function runSummaries(gateway: Gateway, repo: RepoFs, facts: Facts, draft: Draft, settings: SummarySettings = defaultSummarySettings): Promise<SummaryRun> {
  const results = await Promise.all(draft.contested.map((path) => gateway.structured({
    model: settings.model,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: summaryPrompt(repo, facts, path, settings) }],
    schemaName: 'file_purpose',
    schema: purposeSchema,
    parse: (value: unknown) => purposeValue.parse(value).purpose.replace(/\s+/g, ' '),
    maxTokens: settings.maxTokens,
    templateKwargs: settings.templateKwargs,
  })));
  const run: SummaryRun = { purposes: new Map(), failures: new Map(), costUsd: 0, usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 }, calls: results.length };
  results.forEach((result, index) => {
    const path = draft.contested[index]!;
    const choice = result.choices[0];
    if (choice?.value) run.purposes.set(path, choice.value);
    else run.failures.set(path, choice?.error ?? 'no choice');
    run.costUsd += result.costUsd;
    run.usage.promptTokens += result.usage?.promptTokens ?? 0;
    run.usage.completionTokens += result.usage?.completionTokens ?? 0;
    run.usage.reasoningTokens += result.usage?.reasoningTokens ?? 0;
  });
  return run;
}

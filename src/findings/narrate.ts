// The findings narrator (plan §3.2): Nemotron 3.5 Lightning writes 1–2 plain sentences per finding for a reviewer,
// text only. Findings go in a few batched calls (json_schema strict, thinking off, a short max_tokens). Every
// narration passes a lexical guard or is dropped, and the finding keeps its deterministic evidence: no empty or
// overlong text, and none of these unless the finding's title and evidence (as the model saw them) contain it: a path
// or code identifier, a capitalized name, the name in "the <name> table/module/class/...", a number in digits (as a
// whole token) or in words (one to twenty, dozen, twice, thrice). The guard checks words, not claims: a number or
// name the evidence has can still be put to the wrong use. Narration never changes anything but the narration text.
import { z } from 'zod';
import { models } from '../gateway/models.js';
import type { Gateway, ModelKey, TemplateKwargs } from '../gateway/types.js';
import { modelLabel } from '../planner/outputs.js';
import type { Finding, NarrationRecord } from './types.js';

export interface NarrationSettings {
  model: ModelKey;
  templateKwargs: TemplateKwargs;
  /** The first this-many findings (in ranked order) are narrated. */
  maxFindings: number;
  /** Findings per call. */
  batchSize: number;
  /** max_tokens per call: this per finding of the batch, plus a little for the JSON around them. */
  tokensPerFinding: number;
  /** A longer narration is dropped. */
  maxCharacters: number;
  /** Evidence characters the model sees per finding (the guard checks against what it saw). */
  evidenceCharacters: number;
}

export const defaultNarrationSettings: NarrationSettings = {
  model: 'lightning',
  templateKwargs: { enable_thinking: false },
  maxFindings: 40,
  batchSize: 20,
  tokensPerFinding: 120,
  maxCharacters: 360,
  evidenceCharacters: 1200,
};

const narrationValue = z.object({ narrations: z.array(z.object({ id: z.string(), text: z.string() })) });

const narrationSchema = {
  type: 'object',
  properties: {
    narrations: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'], additionalProperties: false },
    },
  },
  required: ['narrations'],
  additionalProperties: false,
};

const systemPrompt = `You narrate a findings log for a code reviewer. An automated refactoring moved the files of a repository into feature modules and changed nothing else. Each finding is a fact about the code that the refactoring recorded and deliberately left as it was: it is never fixed in this change.

For each finding, write 1-2 plain sentences: what its evidence shows, then what it tells a reviewer about the code's structure. Use only what the finding's title and evidence say. Never name a file, path, class, member, table, rule or number that is not written in them. Never count list items or compute new numbers: a long list is cut short with "…", so use only the totals the evidence states. Don't speculate about consequences the evidence doesn't show, and don't suggest fixing it in this change. No markdown. Answer with exactly one narration per finding id.`;

/** What the model is shown for a finding; the guard checks a narration against exactly this. */
export function shownText(finding: Finding, settings: Pick<NarrationSettings, 'evidenceCharacters'>): { id: string; kind: string; title: string; evidence: string } {
  const evidence = finding.evidence.length > settings.evidenceCharacters ? `${finding.evidence.slice(0, settings.evidenceCharacters)}…` : finding.evidence;
  return { id: finding.id, kind: finding.kind, title: finding.title, evidence };
}

const ordinaryWords = new Set(['e.g', 'i.e', 'etc', 'vs']);
const acronyms = new Set(['PR', 'API', 'APIs', 'CI', 'SQL', 'HTTP', 'ID', 'IDs', 'JSON', 'URL', 'TS', 'DI', 'DAG', 'LLM', 'OK', 'TypeScript', 'JavaScript', 'NestJS']);
const numberWords = new Map(Object.entries({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, dozen: 12, twice: 2, thrice: 3,
}));
/** "the <name> table": the nouns whose name the guard checks, the words before the name, and names that name nothing. */
const structuralNouns = /^(tables?|modules?|class(es)?|repositor(y|ies)|services?|controllers?|folders?|groups?)$/i;
const determiners = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'its', 'their', 'each', 'every', 'another']);
const genericWords = new Set([
  'same', 'other', 'whole', 'shared', 'single', 'separate', 'different', 'feature', 'platform', 'base', 'entire', 'own', 'new', 'old', 'large',
  'central', 'common', 'given', 'existing', 'specific', 'original', 'current', 'first', 'last', 'next', 'target', 'source', 'related', 'plan', 'moved',
  'parent', 'owning', 'containing', 'host',
]);

/** A token a narration may only repeat from what the model was shown, and how that text must contain it. */
export interface NamedToken {
  text: string;
  /** substring: as written; word: as a whole word, in any case; number: `digits` as a whole token, or a number word itself. */
  match: 'substring' | 'word' | 'number';
  digits?: string;
}

/** Whether `start` begins a sentence: the text's start, or after . ! ? : ; and any opening quote or bracket. */
const sentenceStart = (text: string, start: number) => /(^|[.!?:;]["')\]]*\s+)["'(\[]*$/.test(text.slice(0, start));

/**
 * What a narration names, which it may only repeat: backticked spans, path-like and identifier-like tokens, numbers in
 * digits or words, capitalized words inside a sentence, and the name in "the <name> table/module/class/...".
 */
export function namedTokens(text: string): NamedToken[] {
  const tokens: NamedToken[] = [...text.matchAll(/`([^`]+)`/g)].map((match) => ({ text: match[1]!, match: 'substring' as const }));
  const plain = text.replace(/`[^`]+`/g, ' ').replace(/(\d),(\d{3})\b/g, '$1$2');
  const words = [...plain.matchAll(/[\w$@./<>-]+/g)].map((match) => {
    const leading = /^[./<>-]*/.exec(match[0])![0].length;
    const token = match[0].replace(/^[./<>-]+|[./<>-]+$/g, '');
    return { token, start: match.index + leading, end: match.index + leading + token.length };
  });
  words.forEach(({ token, start }, index) => {
    if (!token || ordinaryWords.has(token.toLowerCase()) || acronyms.has(token)) return;
    const pathLike = token.includes('/') || /[\w$]\.[A-Za-z_$<]/.test(token);
    const identifierLike = /[a-z][A-Z]/.test(token) || /^[A-Z][a-z0-9]*[A-Z]/.test(token) || /[_$<>]/.test(token) || /[A-Za-z]\d|\d[A-Za-z]/.test(token);
    const number = /^\d+(\.\d+)?$/.test(token) ? token : numberWords.get(token.toLowerCase())?.toString();
    if (pathLike || identifierLike) tokens.push({ text: token, match: 'substring' });
    else if (number !== undefined) tokens.push({ text: token, match: 'number', digits: number });
    else if (/^[A-Z][a-z]+$/.test(token) && !sentenceStart(plain, start)) tokens.push({ text: token, match: 'word' });
    else if (structuralNouns.test(token) && index >= 2) {
      const [determiner, name] = [words[index - 2]!, words[index - 1]!];
      const adjacent = /^\s+$/.test(plain.slice(determiner.end, name.start)) && /^\s+$/.test(plain.slice(name.end, start));
      const named = /^[a-z]+$/.test(name.token) && !genericWords.has(name.token) && !numberWords.has(name.token) && !determiners.has(name.token);
      if (adjacent && named && determiners.has(determiner.token.toLowerCase())) tokens.push({ text: name.token, match: 'word' });
    }
  });
  return tokens;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordPattern = (word: string) => new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(word)}(?![A-Za-z0-9_])`, 'i');
/** A number as a whole token: not inside an identifier, a path segment like e2e, or a longer number. */
const numberPattern = (digits: string) => new RegExp(`(^|[^\\w.])${escapeRegExp(digits)}(?!\\w|\\.\\d)`);

function contains(shown: string, token: NamedToken): boolean {
  if (token.match === 'substring') return shown.includes(token.text);
  if (token.match === 'word') return wordPattern(token.text).test(shown);
  return numberPattern(token.digits!).test(shown.replace(/(\d),(\d{3})\b/g, '$1$2')) || (token.text !== token.digits && wordPattern(token.text).test(shown));
}

/** Why a narration is dropped, or null when it may stand. */
export function narrationProblem(text: string, shown: string, maxCharacters: number): string | null {
  if (!text) return 'empty';
  if (text.length > maxCharacters) return `longer than ${maxCharacters} characters`;
  const missing = namedTokens(text).find((token) => !contains(shown, token));
  return missing ? `names "${missing.text}", which the evidence doesn't contain` : null;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Narrates the first `maxFindings` of `findings` (already ranked) in batches; returns the narrations that passed the
 * guard, by finding id, and what the narrator did. A failed call (a replay miss, a refused budget) stops narration;
 * the findings keep their evidence.
 */
export async function narrateFindings(gateway: Gateway, findings: readonly Finding[], settings: NarrationSettings = defaultNarrationSettings): Promise<{ narrations: Map<string, string>; record: NarrationRecord }> {
  const narrations = new Map<string, string>();
  const record: NarrationRecord = { model: models[settings.model].id, label: modelLabel(settings.model, settings.templateKwargs), calls: 0, costUsd: 0, replayed: true, narrated: 0, dropped: [], notReturned: [] };
  const chosen = findings.slice(0, settings.maxFindings);
  for (let start = 0; start < chosen.length; start += settings.batchSize) {
    const batch = chosen.slice(start, start + settings.batchSize).map((finding) => shownText(finding, settings));
    let result;
    try {
      result = await gateway.structured({
        model: settings.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Findings (JSON):\n${JSON.stringify(batch, null, 1)}` },
        ],
        schemaName: 'findings_narration',
        schema: narrationSchema,
        parse: (value) => narrationValue.parse(value),
        maxTokens: 64 + settings.tokensPerFinding * batch.length,
        templateKwargs: settings.templateKwargs,
      });
    } catch (error) {
      record.error = errorMessage(error);
      break;
    }
    record.calls++;
    record.costUsd += result.costUsd;
    record.replayed &&= result.replayed;
    const choice = result.choices[0];
    const answered = new Map<string, string>();
    for (const narration of choice?.value?.narrations ?? []) if (!answered.has(narration.id)) answered.set(narration.id, narration.text.replace(/\s+/g, ' ').trim());
    for (const shown of batch) {
      const text = answered.get(shown.id);
      if (text === undefined) {
        record.notReturned.push({ id: shown.id, reason: `no narration returned${choice?.error ? ` (${choice.error})` : ''}` });
        continue;
      }
      const problem = narrationProblem(text, `${shown.kind}\n${shown.title}\n${shown.evidence}`, settings.maxCharacters);
      if (problem) record.dropped.push({ id: shown.id, reason: problem });
      else narrations.set(shown.id, text);
    }
  }
  record.narrated = narrations.size;
  record.replayed &&= record.calls > 0;
  record.costUsd = Number(record.costUsd.toFixed(6));
  return { narrations, record };
}

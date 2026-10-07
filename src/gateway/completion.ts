// Reading a chat completion body, live or replayed. Per choice: `finish_reason: length` is a truncation and its content
// is never parsed (Ultra and Lightning leak raw reasoning into it); otherwise JSON.parse then the caller's validator,
// whose failures become the choice's error. Reasoning comes from `message.reasoning_content` only.
import type { ChoiceResult, Usage } from './types.js';

interface RawChoice {
  index?: unknown;
  finish_reason?: unknown;
  message?: { content?: unknown; reasoning_content?: unknown } | null;
}

interface RawCompletion {
  choices?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; completion_tokens_details?: { reasoning_tokens?: unknown } | null } | null;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function parseCompletion(bodyText: string): RawCompletion | undefined {
  try {
    const value: unknown = JSON.parse(bodyText);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as RawCompletion) : undefined;
  } catch {
    return undefined;
  }
}

const rawChoices = (completion: RawCompletion | undefined): RawChoice[] | undefined =>
  Array.isArray(completion?.choices) ? (completion.choices as RawChoice[]) : undefined;

/** Usage as reported; null when absent or malformed (the gateway then charges the full estimate). */
export function usageOf(bodyText: string): Usage | null {
  const usage = parseCompletion(bodyText)?.usage;
  if (typeof usage?.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number') return null;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;
  return { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, reasoningTokens: typeof reasoningTokens === 'number' ? reasoningTokens : null };
}

export function finishReasonsOf(bodyText: string): (string | null)[] {
  return (rawChoices(parseCompletion(bodyText)) ?? []).map((choice) => (typeof choice?.finish_reason === 'string' ? choice.finish_reason : null));
}

function readChoice<T>(choice: RawChoice, position: number, parse: (value: unknown) => T): ChoiceResult<T> {
  const index = typeof choice?.index === 'number' ? choice.index : position;
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
  const reasoningContent = choice?.message?.reasoning_content;
  const reasoning = typeof reasoningContent === 'string' ? reasoningContent : null;
  if (finishReason === 'length') return { index, finishReason, reasoning, error: 'truncated' };
  const content = choice?.message?.content;
  if (typeof content !== 'string') return { index, finishReason, reasoning, error: 'no content' };
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (error) {
    return { index, finishReason, reasoning, error: `content is not JSON: ${errorMessage(error)}` };
  }
  try {
    return { index, finishReason, reasoning, value: parse(json) };
  } catch (error) {
    return { index, finishReason, reasoning, error: `content does not validate: ${errorMessage(error)}` };
  }
}

/** The choices of a 2xx body, by index; undefined when the body is not a completion at all. */
export function readChoices<T>(bodyText: string, parse: (value: unknown) => T): ChoiceResult<T>[] | undefined {
  const choices = rawChoices(parseCompletion(bodyText));
  return choices?.map((choice, position) => readChoice(choice, position, parse)).sort((a, b) => a.index - b.index);
}

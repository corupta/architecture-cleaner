// The LLM gateway's contract (plan §3.6). Every model call goes through `Gateway.structured`: json_schema strict,
// explicit sampling, a max_tokens cap, reasoning controlled only through chat_template_kwargs, cassettes and a ledger.

export type ModelKey = 'super' | 'ultra' | 'lightning';

/** record: always call and append to the cassette. replay: never call; a miss fails. auto: replay hits, record misses. */
export type CassetteMode = 'record' | 'replay' | 'auto';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** chat_template_kwargs, the only reasoning control (never `reasoning_effort`). */
export interface TemplateKwargs {
  enable_thinking?: boolean;
  /** Super only. */
  low_effort?: boolean;
  /** Ultra only. */
  medium_effort?: boolean;
}

export interface StructuredRequest<T> {
  model: ModelKey;
  messages: ChatMessage[];
  /** response_format json_schema name. */
  schemaName: string;
  /** A strict JSON schema (every property required, additionalProperties false). */
  schema: Record<string, unknown>;
  /** Validates a parsed choice (a zod schema's `parse`); throws on mismatch. */
  parse: (value: unknown) => T;
  maxTokens: number;
  /** Choices in one call (n=K). Defaults to 1. */
  n?: number;
  templateKwargs?: TemplateKwargs;
}

export interface ChoiceResult<T> {
  index: number;
  finishReason: string | null;
  /** The validated value; absent on truncation (`finish_reason: length`), unparseable or invalid content. */
  value?: T;
  error?: string;
  /** `message.reasoning_content` only. */
  reasoning: string | null;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number | null;
}

export interface StructuredResult<T> {
  choices: ChoiceResult<T>[];
  usage: Usage | null;
  /** usage × the pinned price table; what the call cost when it was recorded (replays cost nothing now). */
  costUsd: number;
  replayed: boolean;
  /** Cassette key: hash of (model, messages, tools, params) plus the occurrence index of that hash in this run. */
  key: string;
}

/** A non-2xx answer (recorded and replayed like any other), a refused budget, or a replay miss. */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code: 'http' | 'budget' | 'replay-miss' | 'transport',
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface Gateway {
  structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
  /** Ledger totals in USD, including calls made by this process. */
  spent(): { run: number; global: number };
}

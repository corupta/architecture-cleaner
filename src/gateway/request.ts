// The request rules of plan §3.6, enforced here rather than left to callers: the body is built from scratch out of a
// validated StructuredRequest, so it can only ever carry json_schema strict output, temperature 1.0 and top_p 0.95,
// a max_tokens cap, n when above 1, chat_template_kwargs at top level and store:false. No tools, no stream, and no
// reasoning_effort (a partial, model-dependent alias on Token Factory).
import { isModelKey, models } from './models.js';
import type { ChatMessage, ModelKey, StructuredRequest, TemplateKwargs } from './types.js';

export interface RequestBody {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
  top_p: number;
  n?: number;
  response_format: { type: 'json_schema'; json_schema: { name: string; strict: true; schema: Record<string, unknown> } };
  chat_template_kwargs?: TemplateKwargs;
  store: false;
}

/** A request that breaks a rule; thrown before anything is hashed, reserved or sent. */
export class RequestRuleError extends Error {}

const requestFields = new Set(['model', 'messages', 'schemaName', 'schema', 'parse', 'maxTokens', 'n', 'templateKwargs']);
const roles = new Set(['system', 'user', 'assistant']);
/** Which models honour each chat_template_kwargs flag (docs/gates/tf-probes.md, "Reasoning controls"). */
const templateKwargModels: Record<keyof TemplateKwargs, readonly ModelKey[]> = {
  enable_thinking: ['super', 'ultra', 'lightning', 'super-vl'],
  low_effort: ['super', 'super-vl'],
  medium_effort: ['ultra'],
};
const schemaNamePattern = /^[A-Za-z0-9_-]{1,64}$/;
const isPositiveInteger = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function refuse(detail: string): never {
  throw new RequestRuleError(`gateway refused the request: ${detail}`);
}

function templateKwargsFor(model: ModelKey, kwargs: unknown): TemplateKwargs | undefined {
  if (kwargs === undefined) return undefined;
  if (!isPlainObject(kwargs)) refuse('templateKwargs must be an object');
  for (const [name, value] of Object.entries(kwargs)) {
    if (!Object.hasOwn(templateKwargModels, name)) refuse(`chat_template_kwargs.${name} is not allowed (enable_thinking, low_effort, medium_effort)`);
    const allowed = templateKwargModels[name as keyof TemplateKwargs];
    if (!allowed.includes(model)) refuse(`chat_template_kwargs.${name} is for ${allowed.join(', ')} only, not ${model}`);
    if (typeof value !== 'boolean') refuse(`chat_template_kwargs.${name} must be a boolean`);
  }
  const typed = kwargs as TemplateKwargs;
  const ordered: TemplateKwargs = {};
  if (typed.enable_thinking !== undefined) ordered.enable_thinking = typed.enable_thinking;
  if (typed.low_effort !== undefined) ordered.low_effort = typed.low_effort;
  if (typed.medium_effort !== undefined) ordered.medium_effort = typed.medium_effort;
  return Object.keys(ordered).length ? ordered : undefined;
}

export function buildRequestBody(request: StructuredRequest<unknown>): RequestBody {
  if (!isPlainObject(request)) refuse('the request must be an object');
  for (const field of Object.keys(request)) if (!requestFields.has(field)) refuse(`unknown field ${field}`);
  if (!isModelKey(request.model)) refuse(`unknown model ${JSON.stringify(request.model)} (${Object.keys(models).join(', ')})`);
  if (!Array.isArray(request.messages) || request.messages.length === 0) refuse('messages must be a non-empty array');
  const messages = request.messages.map((message, index): ChatMessage => {
    if (!isPlainObject(message) || !roles.has(message.role as string) || typeof message.content !== 'string') {
      refuse(`messages[${index}] must be { role: system | user | assistant, content: string }`);
    }
    return { role: message.role, content: message.content };
  });
  if (typeof request.schemaName !== 'string' || !schemaNamePattern.test(request.schemaName)) refuse(`schemaName must match ${schemaNamePattern}`);
  if (!isPlainObject(request.schema)) refuse('schema must be a JSON schema object');
  if (typeof request.parse !== 'function') refuse('parse must be a function');
  if (!isPositiveInteger(request.maxTokens)) refuse('maxTokens must be a positive integer');
  const n = request.n ?? 1;
  if (!isPositiveInteger(n)) refuse('n must be a positive integer');
  const kwargs = templateKwargsFor(request.model, request.templateKwargs);
  return {
    model: models[request.model].id,
    messages,
    max_tokens: request.maxTokens,
    temperature: 1.0,
    top_p: 0.95,
    ...(n > 1 ? { n } : {}),
    response_format: { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema: request.schema } },
    ...(kwargs ? { chat_template_kwargs: kwargs } : {}),
    store: false,
  };
}

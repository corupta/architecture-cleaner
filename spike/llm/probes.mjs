// Token Factory probe matrix (gate session step 0). Every call goes through the gateway run `tf-probes`.
//   node spike/llm/probes.mjs > ~/ac-work/tf-probes/results.jsonl
import { chat, models, reasoningOf } from './client.mjs';

const reasoningPrompt = 'How many integers n with 1 <= n <= 300 are divisible by 3 or 5 but not by 7? Reply with only the number.';
const reasoningAnswer = '120';
const trivialPrompt = 'Reply with the single word: pong';

const answerSchema = {
  type: 'object',
  properties: {
    zebra_count: { type: 'integer' },
    mood: { type: 'string', enum: ['calm', 'stormy'] },
  },
  required: ['zebra_count', 'mood'],
  additionalProperties: false,
};
// The prompt deliberately asks for different keys; obeying the schema over the prompt means it is enforced.
const schemaPrompt = 'Return a JSON object with a single key "answer" holding 2+2.';

const submitTool = {
  type: 'function',
  function: {
    name: 'submit_plan',
    description: 'Submit the final plan.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        modules: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['name', 'files'], additionalProperties: false } },
      },
      required: ['modules'],
      additionalProperties: false,
    },
  },
};
const weatherTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the weather for one city.',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
};
const toolPrompt = 'Files: src/services/user.service.ts, src/controllers/user.controller.ts, src/services/album.service.ts. Group them into feature modules.';

const reasoningCase = (label, extra) => ({ label, group: 'reasoning', body: { messages: [{ role: 'user', content: reasoningPrompt }], max_tokens: 4096, ...extra } });

function casesFor(modelKey) {
  const effortFlag = modelKey === 'super' ? { low_effort: true } : modelKey === 'ultra' ? { medium_effort: true } : null;
  const cases = [
    reasoningCase('default'),
    reasoningCase('kwargs.enable_thinking=false', { chat_template_kwargs: { enable_thinking: false } }),
    reasoningCase('extra_body.kwargs.enable_thinking=false', { extra_body: { chat_template_kwargs: { enable_thinking: false } } }),
    reasoningCase('reasoning_effort=none', { reasoning_effort: 'none' }),
    reasoningCase('reasoning_effort=low', { reasoning_effort: 'low' }),
    reasoningCase('reasoning_effort=high', { reasoning_effort: 'high' }),
    reasoningCase('max_tokens=64 (truncation)', { max_tokens: 64 }),
    { label: 'json_schema strict, thinking on', group: 'json', schema: answerSchema, body: { messages: [{ role: 'user', content: schemaPrompt }], max_tokens: 2048, response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: answerSchema } } } },
    { label: 'json_schema strict, thinking off', group: 'json', schema: answerSchema, body: { messages: [{ role: 'user', content: schemaPrompt }], max_tokens: 512, chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: answerSchema } } } },
    { label: 'json_object, thinking off', group: 'json', body: { messages: [{ role: 'user', content: schemaPrompt }], max_tokens: 512, chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object' } } },
    { label: 'guided_json, thinking off', group: 'json', schema: answerSchema, body: { messages: [{ role: 'user', content: schemaPrompt }], max_tokens: 512, chat_template_kwargs: { enable_thinking: false }, guided_json: answerSchema } },
    { label: 'tool_choice named + strict, thinking on', group: 'tools', body: { messages: [{ role: 'user', content: toolPrompt }], max_tokens: 2048, tools: [submitTool, weatherTool], tool_choice: { type: 'function', function: { name: 'submit_plan' } } } },
    { label: 'tool_choice named + strict, thinking off', group: 'tools', body: { messages: [{ role: 'user', content: toolPrompt }], max_tokens: 1024, chat_template_kwargs: { enable_thinking: false }, tools: [submitTool, weatherTool], tool_choice: { type: 'function', function: { name: 'submit_plan' } } } },
    { label: 'tool_choice=required', group: 'tools', body: { messages: [{ role: 'user', content: toolPrompt }], max_tokens: 2048, tools: [submitTool, weatherTool], tool_choice: 'required' } },
    { label: 'parallel tool calls (auto) + force_nonempty_content', group: 'tools', body: { messages: [{ role: 'user', content: 'What is the weather in Oslo and in Lima? Use the tool for each city.' }], max_tokens: 2048, tools: [weatherTool], tool_choice: 'auto', chat_template_kwargs: { force_nonempty_content: true } } },
    { label: 'stream, thinking on', group: 'stream', body: { messages: [{ role: 'user', content: reasoningPrompt }], max_tokens: 4096, stream: true } },
  ];
  if (effortFlag) cases.splice(6, 0, reasoningCase(`kwargs.${Object.keys(effortFlag)[0]}=true`, { chat_template_kwargs: effortFlag }));
  if (modelKey === 'lightning') {
    cases.push({ label: 'n=1 baseline, thinking off', group: 'billing', body: { messages: [{ role: 'user', content: trivialPrompt }], max_tokens: 16, chat_template_kwargs: { enable_thinking: false } } });
    cases.push({ label: 'n=2, thinking off', group: 'billing', body: { messages: [{ role: 'user', content: trivialPrompt }], max_tokens: 16, n: 2, chat_template_kwargs: { enable_thinking: false } } });
    cases.push({ label: 'service_tier=flex', group: 'billing', body: { messages: [{ role: 'user', content: trivialPrompt }], max_tokens: 16, service_tier: 'flex', chat_template_kwargs: { enable_thinking: false } } });
    cases.push({ label: 'lowercase model id', group: 'ids', model: 'nvidia/nemotron-3_5-lightning', body: { messages: [{ role: 'user', content: trivialPrompt }], max_tokens: 16, chat_template_kwargs: { enable_thinking: false } } });
  }
  if (modelKey === 'ultra') {
    cases.push({ label: 'lowercase model id', group: 'ids', model: 'nvidia/nemotron-3-ultra-550b-a55b', body: { messages: [{ role: 'user', content: trivialPrompt }], max_tokens: 16, chat_template_kwargs: { enable_thinking: false } } });
  }
  return cases;
}

function matchesSchema(value, schema) {
  if (!value || typeof value !== 'object') return false;
  const keys = Object.keys(value);
  return schema.required.every((key) => keys.includes(key)) && keys.every((key) => key in schema.properties)
    && Number.isInteger(value.zebra_count) && ['calm', 'stormy'].includes(value.mood);
}

function summarizeStream(text) {
  let content = '';
  let reasoningContent = '';
  let reasoning = '';
  let usage = null;
  let finishReason = null;
  let chunks = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    chunks++;
    const chunk = JSON.parse(data);
    const delta = chunk.choices?.[0]?.delta ?? {};
    content += delta.content ?? '';
    reasoningContent += delta.reasoning_content ?? '';
    reasoning += delta.reasoning ?? '';
    if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
    if (chunk.usage) usage = chunk.usage;
  }
  return { chunks, content, reasoningContentChars: reasoningContent.length, reasoningChars: reasoning.length, usage, finishReason };
}

async function runCase(modelKey, probe) {
  const model = probe.model ?? models[modelKey];
  const startedAt = Date.now();
  const { status, json, text } = await chat('tf-probes', { model, ...probe.body });
  const result = { modelKey, model, label: probe.label, group: probe.group, status, latencyMs: Date.now() - startedAt };
  if (status >= 400) return { ...result, error: text.slice(0, 400) };
  if (probe.body.stream) {
    const stream = summarizeStream(text);
    return { ...result, ...stream, correct: stream.content.trim() === reasoningAnswer };
  }
  const choice = json.choices?.[0];
  const message = choice?.message ?? {};
  const content = message.content ?? null;
  const reasoningText = reasoningOf(message);
  result.finishReason = choice?.finish_reason;
  result.choices = json.choices?.length;
  result.usage = json.usage;
  result.serviceTier = json.service_tier;
  result.messageKeys = Object.keys(message);
  result.content = content === null ? null : content.slice(0, 300);
  result.reasoningField = message.reasoning_content != null ? 'reasoning_content' : message.reasoning != null ? 'reasoning' : null;
  result.reasoningChars = reasoningText?.length ?? 0;
  result.thinkTagInContent = /<\/?think>/.test(content ?? '');
  if (probe.group === 'reasoning') result.correct = (content ?? '').trim() === reasoningAnswer;
  if (probe.group === 'json') {
    try {
      const parsed = JSON.parse((content ?? '').replace(/^```(?:json)?\s*|\s*```$/g, ''));
      result.jsonParses = true;
      result.parsed = parsed;
      if (probe.schema) result.schemaEnforced = matchesSchema(parsed, probe.schema);
    } catch {
      result.jsonParses = false;
    }
  }
  if (probe.group === 'tools') {
    result.toolCalls = (message.tool_calls ?? []).map((call) => {
      let argumentsParse = true;
      try {
        JSON.parse(call.function.arguments);
      } catch {
        argumentsParse = false;
      }
      return { name: call.function.name, argumentsParse, arguments: call.function.arguments.slice(0, 200) };
    });
    result.rawToolCallTextInContent = /<tool_call>|<function=/.test(content ?? '');
  }
  return result;
}

async function runModel(modelKey) {
  for (const probe of casesFor(modelKey)) {
    const result = await runCase(modelKey, probe).catch((error) => ({ modelKey, label: probe.label, error: String(error) }));
    process.stdout.write(JSON.stringify(result) + '\n');
  }
}

const order = (process.argv[2] ?? 'lightning,super,ultra').split(',');
await Promise.all(order.map(runModel));

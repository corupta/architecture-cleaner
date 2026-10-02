// Follow-up probes: sampling determinism and the reasoning_effort → template-flag mapping.
import { chat, models, reasoningOf } from './client.mjs';

const creative = [{ role: 'user', content: 'Write one unusual 12-word sentence about a lighthouse. Output only the sentence.' }];
const off = { chat_template_kwargs: { enable_thinking: false } };
const cases = [];
for (const modelKey of ['super', 'ultra', 'lightning']) {
  for (const repeat of [1, 2]) cases.push({ modelKey, label: `determinism: no temperature #${repeat}`, body: { messages: creative, max_tokens: 64, ...off } });
  for (const repeat of [1, 2]) cases.push({ modelKey, label: `determinism: temperature=1.0 top_p=0.95 #${repeat}`, body: { messages: creative, max_tokens: 64, temperature: 1.0, top_p: 0.95, ...off } });
}
const trivial = [{ role: 'user', content: 'What is 2+2? Reply with only the number.' }];
for (const effort of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
  cases.push({ modelKey: 'super', label: `effort map: reasoning_effort=${effort}`, body: { messages: trivial, max_tokens: 512, reasoning_effort: effort } });
  cases.push({ modelKey: 'ultra', label: `effort map: reasoning_effort=${effort}`, body: { messages: trivial, max_tokens: 512, reasoning_effort: effort } });
}
cases.push({ modelKey: 'super', label: 'effort map: none (baseline prompt tokens)', body: { messages: trivial, max_tokens: 512 } });
cases.push({ modelKey: 'ultra', label: 'effort map: none (baseline prompt tokens)', body: { messages: trivial, max_tokens: 512 } });
cases.push({ modelKey: 'super', label: 'billing: n=1', body: { messages: creative, max_tokens: 32, ...off } });
cases.push({ modelKey: 'super', label: 'billing: n=3', body: { messages: creative, max_tokens: 32, n: 3, ...off } });

await Promise.all(['super', 'ultra', 'lightning'].map(async (modelKey) => {
  for (const probe of cases.filter((c) => c.modelKey === modelKey)) {
    const { status, json, text } = await chat('tf-probes', { model: models[modelKey], ...probe.body });
    const message = json?.choices?.[0]?.message;
    process.stdout.write(JSON.stringify({ modelKey, label: probe.label, status, usage: json?.usage, choices: json?.choices?.length, content: json?.choices?.map((c) => c.message.content), reasoningChars: reasoningOf(message)?.length ?? 0, error: status >= 400 ? text.slice(0, 300) : undefined }) + '\n');
  }
}));

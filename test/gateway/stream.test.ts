// Streamed completions (S8c): the server-sent events reader and the assembler that turns a stream's chunks into the one
// body a non-streamed call answers. The transport over a local SSE server is in transport.test.ts.
import { describe, expect, it } from 'vitest';
import { finishReasonsOf, readChoices, usageOf } from '../../src/gateway/completion.js';
import { createCompletionAssembler, createEventReader, formatDuration } from '../../src/gateway/stream.js';

describe('event reader', () => {
  it('yields each event’s data once its blank line arrives, however the text is split into pieces', () => {
    const text = ': keep-alive\n\ndata: {"a":1}\n\nevent: message\nid: 7\ndata: first\ndata: second\n\r\ndata:no-space\r\n\r\ndata: [DONE]\n\n';
    const whole = createEventReader();
    const expected = ['{"a":1}', 'first\nsecond', 'no-space', '[DONE]'];
    expect([...whole.feed(text), ...whole.end()]).toEqual(expected);
    for (const size of [1, 2, 3, 5, 8]) {
      const reader = createEventReader();
      const events: string[] = [];
      for (let start = 0; start < text.length; start += size) events.push(...reader.feed(text.slice(start, start + size)));
      events.push(...reader.end());
      expect(events, `pieces of ${size}`).toEqual(expected);
    }
  });

  it('keeps a lone \\r at the end of a piece until the next one says whether it ends the line', () => {
    const reader = createEventReader();
    expect(reader.feed('data: x\r')).toEqual([]);
    expect(reader.feed('\n\r')).toEqual([]);
    expect(reader.feed('\n')).toEqual(['x']);
    expect(reader.feed('data: y\r\r')).toEqual([]);
    expect(reader.feed('data: z')).toEqual(['y']);
  });

  it('at the end, yields an event whose data lines all arrived and drops a line cut off mid-way', () => {
    const complete = createEventReader();
    expect(complete.feed('data: [DONE]\n')).toEqual([]);
    expect(complete.end()).toEqual(['[DONE]']);
    const cut = createEventReader();
    expect(cut.feed('data: {"a":1}\n\ndata: {"choi')).toEqual(['{"a":1}']);
    expect(cut.end()).toEqual([]);
  });
});

const chunk = (choices: object[], extra: object = {}) => JSON.stringify({ id: 'chatcmpl-s', object: 'chat.completion.chunk', created: 1761000000, model: 'nvidia/Nemotron-3.5-Super-VL', choices, usage: null, ...extra });
const usage = { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, completion_tokens_details: { reasoning_tokens: 30 } };

describe('completion assembler', () => {
  it('assembles interleaved choices into the body a non-streamed call answers, which completion.ts reads the same', () => {
    const assembler = createCompletionAssembler(3);
    const events = [
      chunk([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]),
      chunk([{ index: 2, delta: { role: 'assistant', content: '' }, finish_reason: null }]),
      chunk([{ index: 1, delta: { role: 'assistant', content: '' }, finish_reason: null }]),
      chunk([{ index: 1, delta: { reasoning_content: 'Long' }, finish_reason: null }]),
      chunk([{ index: 0, delta: { reasoning_content: 'Count', content: null }, finish_reason: null }]),
      chunk([{ index: 2, delta: { reasoning_content: 'Quick.' }, finish_reason: null }]),
      chunk([{ index: 0, delta: { reasoning_content: ' them.' }, finish_reason: null }]),
      chunk([{ index: 1, delta: { reasoning_content: ' thought' }, finish_reason: null }]),
      chunk([{ index: 2, delta: { content: '{"answer": 7}' }, finish_reason: 'stop' }]),
      chunk([{ index: 0, delta: { content: '{"answer"' }, finish_reason: null }]),
      chunk([{ index: 1, delta: {}, finish_reason: 'length' }]),
      chunk([{ index: 0, delta: { content: ': 120}' }, finish_reason: null }]),
      chunk([{ index: 0, delta: {}, finish_reason: 'stop' }]),
      chunk([], { usage }),
      '[DONE]',
    ];
    for (const event of events) assembler.add(event);
    expect(assembler.done).toBe(true);
    const nonStreamed = JSON.stringify({
      id: 'chatcmpl-s',
      choices: [
        { index: 0, message: { role: 'assistant', content: '{"answer": 120}', reasoning_content: 'Count them.' }, finish_reason: 'stop' },
        { index: 1, message: { role: 'assistant', content: null, reasoning_content: 'Long thought' }, finish_reason: 'length' },
        { index: 2, message: { role: 'assistant', content: '{"answer": 7}', reasoning_content: 'Quick.' }, finish_reason: 'stop' },
      ],
      created: 1761000000,
      model: 'nvidia/Nemotron-3.5-Super-VL',
      object: 'chat.completion',
      usage,
    });
    const body = assembler.body();
    expect(JSON.parse(body)).toEqual(JSON.parse(nonStreamed));
    expect(readChoices(body, (value) => value)).toEqual(readChoices(nonStreamed, (value) => value));
    expect(usageOf(body)).toEqual({ promptTokens: 120, completionTokens: 40, reasoningTokens: 30 });
    expect(finishReasonsOf(body)).toEqual(['stop', 'length', 'stop']);
    expect(assembler.progress()).toBe('~tokens per choice: #0 4 stop, #1 2 length, #2 2 stop');
  });

  it('takes delta.reasoning only when a delta has no reasoning_content, so mirrored text is never doubled', () => {
    const assembler = createCompletionAssembler(1);
    assembler.add(chunk([{ index: 0, delta: { reasoning_content: 'a', reasoning: 'a' } }]));
    assembler.add(chunk([{ index: 0, delta: { reasoning: 'b' } }]));
    assembler.add(chunk([{ index: 0, delta: { reasoning_content: null, reasoning: 'c' } }]));
    assembler.add(chunk([{ index: 0, delta: { content: '{}' }, finish_reason: 'stop' }]));
    expect(JSON.parse(assembler.body()).choices[0].message).toEqual({ role: 'assistant', content: '{}', reasoning_content: 'abc' });
  });

  it('keeps every choice of n, a silent one with null text, and usage only once a chunk carries it', () => {
    const assembler = createCompletionAssembler(2);
    expect(assembler.progress()).toBe('no token yet');
    assembler.add(chunk([{ index: 0, delta: { reasoning_content: 'x' } }]));
    expect(assembler.progress()).toBe('~tokens per choice: #0 1 thinking, #1 0 thinking');
    expect([assembler.usage, assembler.done]).toEqual([null, false]);
    const body = JSON.parse(assembler.body());
    expect(body.choices).toEqual([
      { index: 0, message: { role: 'assistant', content: null, reasoning_content: 'x' }, finish_reason: null },
      { index: 1, message: { role: 'assistant', content: null, reasoning_content: null }, finish_reason: null },
    ]);
    expect(body.usage).toBeNull();
  });

  it('lists the choices no finish_reason has reached, by index', () => {
    const assembler = createCompletionAssembler(3);
    expect(assembler.unfinished).toEqual([0, 1, 2]);
    assembler.add(chunk([{ index: 1, delta: { content: '{}' }, finish_reason: 'stop' }]));
    assembler.add(chunk([{ index: 0, delta: { reasoning_content: 'x' }, finish_reason: null }]));
    expect(assembler.unfinished).toEqual([0, 2]);
    assembler.add(chunk([{ index: 2, delta: {}, finish_reason: 'length' }, { index: 0, delta: {}, finish_reason: 'stop' }]));
    expect(assembler.unfinished).toEqual([]);
  });

  it('throws on an event that is not a chunk, an error event or a choice without an index: the stream broke', () => {
    expect(() => createCompletionAssembler(1).add('{"choices": [')).toThrow(/^an event is not JSON/);
    expect(() => createCompletionAssembler(1).add('[1]')).toThrow(/^an event is not a chunk/);
    expect(() => createCompletionAssembler(1).add('{"error": {"message": "engine died", "code": 500}}')).toThrow(/^the stream reported an error: .*engine died/);
    expect(() => createCompletionAssembler(1).add('{"object": "error", "message": "overloaded"}')).toThrow(/^the stream reported an error/);
    expect(() => createCompletionAssembler(1).add(chunk([{ delta: { content: 'x' } }]))).toThrow(/^a chunk's choice has no index/);
  });
});

describe('durations', () => {
  it('read as minutes and seconds, or milliseconds under a second', () => {
    expect([formatDuration(250), formatDuration(59_499), formatDuration(60_000), formatDuration(2_052_400), formatDuration(5_420_000)]).toEqual(['250ms', '0m59s', '1m00s', '34m12s', '90m20s']);
  });
});

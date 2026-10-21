// Streamed completions (S8c). A request above 64k max_tokens streams (request.ts): Token Factory's nginx gave a
// non-streamed Super VL call a 504 after exactly 600 s, while a stream keeps bytes flowing. Its server-sent events are
// read here and assembled into the one chat.completion body a non-streamed call answers, so completion.ts, the
// cassette, the replay and the bench read it unchanged. The raw events (one per token and choice, hundreds of MB for a
// long call) are never kept.

/** Splits server-sent events text, fed in pieces as it arrives, into each event's data: its `data:` lines joined by
 * newlines. Comments and the other fields (event, id, retry) are skipped. */
export function createEventReader() {
  // `\r` at the very end may be the first half of a `\r\n` split between two pieces, so it waits for the next one.
  const lineBreak = /\r\n|\n|\r(?!$)/g;
  let pending = '';
  let dataLines: string[] = [];
  const events: string[] = [];

  function readLine(line: string) {
    if (line === '') {
      if (dataLines.length) events.push(dataLines.join('\n'));
      dataLines = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') dataLines.push(value);
  }

  function take(): string[] {
    return events.splice(0);
  }

  return {
    /** The data of every event completed by this piece of text. */
    feed(text: string): string[] {
      pending += text;
      lineBreak.lastIndex = 0;
      let start = 0;
      for (let match = lineBreak.exec(pending); match; match = lineBreak.exec(pending)) {
        readLine(pending.slice(start, match.index));
        start = lineBreak.lastIndex;
      }
      pending = pending.slice(start);
      return take();
    },
    /** At the end of the body: an event whose data lines all arrived, though its closing blank line did not. A line cut
     * off mid-way is dropped. */
    end(): string[] {
      if (pending.endsWith('\r')) readLine(pending.slice(0, -1));
      pending = '';
      readLine('');
      return take();
    },
  };
}

interface ChoiceState {
  role: string | null;
  content: string[];
  reasoning: string[];
  finishReason: string | null;
  /** Deltas that carried text: about one token each. */
  deltas: number;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const joined = (parts: string[]) => (parts.length ? parts.join('') : null);
const roughCount = (count: number) => (count < 1000 ? String(count) : `${(count / 1000).toFixed(1)}k`);

/**
 * Assembles the chunks of one streamed chat completion with `n` choices. Per choice index, in arrival order: the text
 * of `delta.content` and of `delta.reasoning_content` (a delta that carries only `delta.reasoning`, its alias on some
 * servers, counts that instead; Super and Lightning mirror the same text into both, tf-probes.md, so never both), the
 * role, and the last finish_reason. Usage comes from the last chunk that carries it (the final one, with
 * `stream_options.include_usage`). A chunk that is not JSON or reports an error throws: the stream broke.
 */
export function createCompletionAssembler(n: number) {
  const choices = new Map<number, ChoiceState>();
  const choiceAt = (index: number) => {
    let choice = choices.get(index);
    if (!choice) choices.set(index, (choice = { role: null, content: [], reasoning: [], finishReason: null, deltas: 0 }));
    return choice;
  };
  for (let index = 0; index < n; index++) choiceAt(index);
  let id: unknown = null;
  let created: unknown = null;
  let model: unknown = null;
  let usage: Record<string, unknown> | null = null;
  let done = false;

  function addChoice(raw: unknown) {
    if (!isPlainObject(raw) || !Number.isSafeInteger(raw.index) || (raw.index as number) < 0) throw new Error(`a chunk's choice has no index: ${JSON.stringify(raw).slice(0, 200)}`);
    const choice = choiceAt(raw.index as number);
    if (typeof raw.finish_reason === 'string') choice.finishReason = raw.finish_reason;
    const delta = raw.delta;
    if (!isPlainObject(delta)) return;
    if (choice.role === null && typeof delta.role === 'string') choice.role = delta.role;
    const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : typeof delta.reasoning === 'string' ? delta.reasoning : '';
    const content = typeof delta.content === 'string' ? delta.content : '';
    if (reasoning) choice.reasoning.push(reasoning);
    if (content) choice.content.push(content);
    if (reasoning || content) choice.deltas++;
  }

  return {
    /** One event's data: a chunk, or `[DONE]`. */
    add(data: string): void {
      if (data === '[DONE]') {
        done = true;
        return;
      }
      let chunk: unknown;
      try {
        chunk = JSON.parse(data);
      } catch {
        throw new Error(`an event is not JSON: ${data.slice(0, 200)}`);
      }
      if (!isPlainObject(chunk)) throw new Error(`an event is not a chunk: ${data.slice(0, 200)}`);
      if ((chunk.error !== undefined && chunk.error !== null) || chunk.object === 'error') throw new Error(`the stream reported an error: ${data.slice(0, 500)}`);
      if (id === null && typeof chunk.id === 'string') id = chunk.id;
      if (created === null && typeof chunk.created === 'number') created = chunk.created;
      if (model === null && typeof chunk.model === 'string') model = chunk.model;
      if (isPlainObject(chunk.usage)) usage = chunk.usage;
      if (Array.isArray(chunk.choices)) for (const choice of chunk.choices) addChoice(choice);
    },
    /** Whether `[DONE]` arrived. */
    get done() {
      return done;
    },
    get usage() {
      return usage;
    },
    /** The indexes of the choices no finish_reason has reached yet; a complete answer has none. */
    get unfinished(): number[] {
      return [...choices.entries()].filter(([, choice]) => choice.finishReason === null).map(([index]) => index).sort((a, b) => a - b);
    },
    /** About how many tokens each choice has streamed, and how far it is (`~tokens per choice: #0 41.2k thinking, #1 3.1k
     * answering, #2 512.0k length`), or `no token yet`. */
    progress(): string {
      const ordered = [...choices.entries()].sort(([a], [b]) => a - b);
      if (ordered.every(([, choice]) => choice.deltas === 0)) return 'no token yet';
      const parts = ordered.map(([index, choice]) => `#${index} ${roughCount(choice.deltas)} ${choice.finishReason ?? (choice.content.length ? 'answering' : 'thinking')}`);
      return `~tokens per choice: ${parts.join(', ')}`;
    },
    /** The completion as a non-streamed call answers it; text no delta carried is null, as there. */
    body(): string {
      return JSON.stringify({
        id,
        choices: [...choices.entries()].sort(([a], [b]) => a - b).map(([index, choice]) => ({
          index,
          message: { role: choice.role ?? 'assistant', content: joined(choice.content), reasoning_content: joined(choice.reasoning) },
          finish_reason: choice.finishReason,
        })),
        created,
        model,
        object: 'chat.completion',
        usage,
      });
    },
  };
}

export type CompletionAssembler = ReturnType<typeof createCompletionAssembler>;

/** `34m12s`, or `850ms` under a second. */
export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

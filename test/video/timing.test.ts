// video/cut/timing.mjs: the voice-over's timing in the cut. The takes keep 1 s of room tone at each end
// (video/rough-cut.md), so a take is trimmed to its speech and its first word falls 0.3 s into its beat; its sentence
// ends come from its pauses, so the captions, and the check that each sentence lands on its shot, follow the voice.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const timing = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../video/cut/timing.mjs')).href);

/** A silencedetect log for the given silences, the last one open when it reaches the end of the take. */
const log = (silences: [number, number | null][]) =>
  silences.map(([start, end]) => `[silencedetect @ 0x1] silence_start: ${start}\n${end === null ? '' : `[silencedetect @ 0x1] silence_end: ${end} | silence_duration: ${end - start}\n`}`).join('');

describe('parseSilences', () => {
  it('reads each silence, closes one still open at the end of the take, and clamps a start before 0', () => {
    expect(timing.parseSilences(log([[-0.02, 1.01], [4.2, 4.65], [9.1, null]]), 10.2)).toEqual([
      { start: 0, end: 1.01 },
      { start: 4.2, end: 4.65 },
      { start: 9.1, end: 10.2 },
    ]);
  });
});

describe('alignSentences and placeTake', () => {
  // Three sentences of 10, 5 and 10 words, 1 s of room tone at each end. Their word counts put the sentence ends at
  // 4.6 s and 6.4 s; the pauses after them come later (a slow first sentence), and a comma pause in each of
  // sentences 1 and 3 is a decoy.
  const silences = [{ start: 0, end: 1 }, { start: 3, end: 3.2 }, { start: 5, end: 5.4 }, { start: 6.6, end: 7 }, { start: 8.1, end: 8.3 }, { start: 10, end: 11 }];
  const aligned = timing.alignSentences([10, 5, 10], silences, 11);

  it('finds the speech between the room tone and ends the sentences at the pauses nearest their word counts, in order', () => {
    expect(aligned.speechStart).toBe(1);
    expect(aligned.speechEnd).toBe(10);
    expect(aligned.aligned).toBe(true);
    expect(aligned.spans).toEqual([{ start: 1, end: 5 }, { start: 5.4, end: 6.6 }, { start: 7, end: 10 }]);
  });

  it('places the first word 0.3 s into the beat, not the take\'s leading room tone (the S10 defect: 1 s late)', () => {
    const placed = timing.placeTake(43, aligned, 11);
    expect(placed.offset + aligned.speechStart).toBeCloseTo(43.3);
    expect(placed.from).toBeCloseTo(0.85);
    expect(placed.to).toBeCloseTo(10.25);
    expect(placed.at).toBeCloseTo(43.15);
    expect(placed.end).toBeCloseTo(52.3);
    const captions = timing.beatCaptions(['One two three four five six seven eight nine ten.', 'One two three four five.', 'One two three four five six seven eight nine ten.'], aligned.spans, placed.offset);
    expect(captions[0].start).toBeCloseTo(43.3);
    expect(captions.at(-1).end).toBeCloseTo(52.25);
  });

  it('falls back to word counts when the take has fewer pauses than sentence ends', () => {
    const fallback = timing.alignSentences([10, 5, 10], [{ start: 0, end: 1 }, { start: 10, end: 11 }], 11);
    expect(fallback.aligned).toBe(false);
    expect(fallback.spans.map((span: { start: number }) => span.start)).toEqual([1, 4.6, 6.4]);
  });

  it('without a take spreads the sentences over the slot by word count', () => {
    expect(timing.alignSentences([1, 3], [], 8).spans).toEqual([{ start: 0, end: 2 }, { start: 2, end: 8 }]);
  });
});

describe('beatCaptions', () => {
  it('keeps a line up through a short pause and lets it go in a long one', () => {
    const captions = timing.beatCaptions(['A short one.', 'Then a second.', 'And a third.'], [{ start: 0, end: 1 }, { start: 1.4, end: 2.4 }, { start: 3.5, end: 4.5 }], 10);
    expect(captions.map((caption: { start: number; end: number }) => [caption.start, caption.end])).toEqual(
      [[10, 11.35], [11.4, 12.35], [13.5, 14.45]].map((pair) => pair.map((value) => expect.closeTo(value, 9))));
  });

  it('splits a long sentence into caption lines of at most 84 characters, spread by word count', () => {
    const sentence = 'Ours: Nemotron 3 Ultra, on Nebius Token Factory, edits a deterministic map, and a second call reviews it, for twenty cents.';
    const captions = timing.beatCaptions([sentence], [{ start: 0, end: 6 }], 0);
    expect(captions.length).toBe(2);
    expect(captions.every((caption: { text: string }) => caption.text.length <= 84)).toBe(true);
    expect(captions.map((caption: { text: string }) => caption.text).join(' ')).toBe(sentence);
  });
});

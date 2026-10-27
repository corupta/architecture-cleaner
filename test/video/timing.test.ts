// video/cut/timing.mjs: the voice-over's timing in the cut. The takes keep 1 s of room tone at each end
// (video/rough-cut.md), so a take is trimmed to its speech and its first word falls 0.3 s into its beat; its sentence
// ends come from its pauses, so the captions, and the check that each sentence lands on its shot, follow the voice.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const timing = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../video/cut/timing.mjs')).href);

describe('alignSentences and shapeTake', () => {
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

  it('trims a take to its speech, so its first word falls 0.3 s into the beat, not after its room tone (S10: 1 s late)', () => {
    const shaped = timing.shapeTake(aligned, silences, 11);
    expect(shaped.segments).toEqual([[0.85, 10.25]]);
    expect(shaped.length).toBeCloseTo(9.4);
    const at = 43 + 0.3 - shaped.at(aligned.speechStart);
    expect(at).toBeCloseTo(43.15);
    const spans = aligned.spans.map((span: { start: number; end: number }) => ({ start: shaped.at(span.start), end: shaped.at(span.end) }));
    const captions = timing.beatCaptions(['One two three four five six seven eight nine ten.', 'One two three four five.', 'One two three four five six seven eight nine ten.'], spans, at);
    expect(captions[0].start).toBeCloseTo(43.3);
    expect(captions.at(-1).end).toBeCloseTo(52.25);
  });

  it('shortens every pause longer than maxPause, half kept each side, and maps the sentences through it and the tempo', () => {
    const shaped = timing.shapeTake(aligned, silences, 11, { maxPause: 0.3, tempo: 1.05 });
    // The 0.4 s pauses lose 0.1 s each; the 0.2 s ones and the room tone outside the speech are left as they were.
    expect(shaped.segments.map((segment: number[]) => segment.map((value) => Number(value.toFixed(6))))).toEqual([[0.85, 5.15], [5.25, 6.75], [6.85, 10.25]]);
    expect(shaped.length).toBeCloseTo(9.2 / 1.05);
    expect(shaped.at(5.4)).toBeCloseTo(4.45 / 1.05);
    // A time inside a cut maps to the cut.
    expect(shaped.at(5.2)).toBeCloseTo(4.3 / 1.05);
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

describe('anchorSentences', () => {
  // Pauses at 1.9–2.4 (before the speech), 14.2–14.6 and 20.3–21.4; the second sentence starts at 14.55 by the
  // transcript, the third at 18.5 with no pause before it; a false start sits at 1.0–1.6, before the first anchor.
  const silences = [{ start: 0, end: 0.9 }, { start: 1.9, end: 2.4 }, { start: 14.2, end: 14.6 }, { start: 20.3, end: 21.4 }];

  it('starts the speech at the first anchor, so a false start before it is left out (S10: the failure take)', () => {
    const aligned = timing.anchorSentences([2.45, 14.55, 18.5], 20.3, silences);
    expect(aligned.speechStart).toBe(2.4);
    expect(aligned.spans).toEqual([{ start: 2.4, end: 14.2 }, { start: 14.6, end: 18.45 }, { start: 18.45, end: 20.3 }]);
    expect(timing.shapeTake(aligned, silences, 22).segments[0][0]).toBeCloseTo(2.25);
  });
});

describe('frameLevels, pauseLevel and findSilences', () => {
  // 1 s of room tone at ±100, then 9 s of speech at ±10,000 with a 0.4 s pause at 4 s; 16 kHz.
  const take = (gain: number) => Int16Array.from({ length: 160_000 }, (_, index) => {
    const quiet = index < 16_000 || (index >= 64_000 && index < 70_400);
    return (quiet ? 100 : 10_000) * gain * (index % 2 ? 1 : -1);
  });

  it('puts the pause level 12 dB above the take\'s own noise floor', () => {
    expect(timing.pauseLevel(timing.frameLevels(take(1), 16_000))).toBeCloseTo(20 * Math.log10(100 / 32768) + 12, 6);
  });

  it('follows a take recorded hot, whose room tone a fixed -40 dB would miss (S10: no pause found in three takes)', () => {
        // Recorded 12 dB hotter, its room tone sits at -38.3 dB: a fixed -40 dB finds no pause; its own level finds both.
    const levels = timing.frameLevels(take(4), 16_000);
    expect(timing.findSilences(levels, -40)).toEqual([]);
    expect(timing.findSilences(levels, timing.pauseLevel(levels))).toEqual([{ start: 0, end: 1 }, { start: 4, end: 4.4 }]);
  });

  it('keeps only runs of at least 0.15 s, and closes one that reaches the end of the take', () => {
    expect(timing.findSilences([-60, -60, -20, -60, -20, -60, -60, -60, -60, -60, -60, -60, -60], -50)).toEqual([{ start: 0.1, end: 0.26 }]);
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

describe('keepTogether', () => {
  it('keeps a duration on one line and leaves other numbers alone', () => {
    expect(timing.keepTogether('$11.76 in 9 min 26 s, then its $12 cap; 1 h 55 m; 38 modules, 63 steps, 169 s'))
      .toBe('$11.76 in 9\u00a0min\u00a026\u00a0s, then its $12 cap; 1\u00a0h\u00a055\u00a0m; 38 modules, 63 steps, 169\u00a0s');
  });
});

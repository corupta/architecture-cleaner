// The voice-over's timing, apart from render.mjs so it can be tested without ffmpeg: where a take's speech starts and
// ends, which of its pauses end each sentence, and the caption lines spread over each sentence.

/** "1:05" → 65. */
export const seconds = (clock) => clock.split(':').reduce((total, part) => total * 60 + Number(part), 0);

/** A beat's voice-over as sentences, split after `.`, `?` or `!`. */
export const sentences = (text) => text.split(/(?<=[.?!])\s+/).filter(Boolean);

export const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

/**
 * Caption chunks of at most `limit` characters (two lines of 42), split at sentence ends; a longer sentence is split
 * into parts of about equal length at word boundaries, so no part is a one-word tail that flashes.
 */
export function chunks(text, limit = 84) {
  const result = [];
  for (const sentence of sentences(text)) {
    const words = sentence.split(/\s+/);
    const parts = Math.ceil(sentence.length / limit);
    const prefix = (end) => words.slice(0, end).join(' ').length;
    let start = 0;
    for (let part = 1; part < parts; part += 1) {
      const goal = (sentence.length * part) / parts;
      let end = start + 1;
      while (end < words.length - 1 && Math.abs(prefix(end + 1) - goal) < Math.abs(prefix(end) - goal)) end += 1;
      result.push(words.slice(start, end).join(' '));
      start = end;
    }
    result.push(words.slice(start).join(' '));
  }
  return result;
}

/**
 * A duration stays on one line ("9 min 26 s", "1 h 55 m", "169 s"): libass wraps only at plain spaces, so the spaces
 * inside one become no-break spaces.
 */
export const keepTogether = (text) => text.replace(/\d+ (?:h|min|m|s|ms)\b(?: \d+ (?:h|min|m|s|ms)\b)*/g, (duration) => duration.replace(/ /g, '\u00a0'));

/**
 * Where each sentence of a take is spoken, in the take's own seconds. The speech runs from the end of a leading
 * silence to the start of a trailing one (the takes keep 1 s of room tone at each end). Of the pauses in between, the
 * sentence ends are the ones closest, in order, to where the sentences' word counts put them; with fewer pauses than
 * sentence ends, the word counts alone place them. `sentenceWords` are the sentences' word counts.
 */
export function alignSentences(sentenceWords, silences, duration) {
  const leading = silences.find((silence) => silence.start <= 0.1);
  const trailing = silences.findLast((silence) => silence.end >= duration - 0.1);
  const speechStart = leading ? leading.end : 0;
  const speechEnd = trailing && trailing !== leading ? trailing.start : duration;
  const pauses = silences.filter((silence) => silence.start > speechStart && silence.end < speechEnd);
  const total = sentenceWords.reduce((sum, count) => sum + count, 0);
  const targets = [];
  let words = 0;
  for (const count of sentenceWords.slice(0, -1)) {
    words += count;
    targets.push(speechStart + ((speechEnd - speechStart) * words) / total);
  }
  const aligned = pauses.length >= targets.length;
  const ends = aligned ? closestInOrder(targets, pauses) : targets.map((at) => ({ start: at, end: at }));
  const spans = sentenceWords.map((_, index) => ({
    start: index === 0 ? speechStart : ends[index - 1].end,
    end: index === sentenceWords.length - 1 ? speechEnd : ends[index].start,
  }));
  return { speechStart, speechEnd, spans, pauses: pauses.length, aligned };
}

/** The RMS level (dBFS) of each 20 ms frame of 16-bit mono samples. */
export function frameLevels(samples, rate) {
  const frame = Math.round(rate * 0.02);
  const levels = [];
  for (let start = 0; start + frame <= samples.length; start += frame) {
    let sum = 0;
    for (let index = start; index < start + frame; index += 1) sum += samples[index] * samples[index];
    const rms = Math.sqrt(sum / frame) / 32768;
    levels.push(rms > 0 ? 20 * Math.log10(rms) : -120);
  }
  return levels;
}

/**
 * The level a take's pauses sit under: 12 dB above its noise floor, the 5th percentile of its frames' levels. A fixed
 * level misses every pause of a take recorded hot, whose room tone sits above it.
 */
export function pauseLevel(levels) {
  const sorted = [...levels].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length * 0.05)] + 12;
}

/**
 * A take's silences, `{ start, end }` in seconds: runs of 20 ms frames below `level`, at least `minimum` s long. Read
 * from the frames' RMS, not from single samples (ffmpeg's silencedetect), whose room-tone peaks break a pause apart.
 */
export function findSilences(levels, level, minimum = 0.15) {
  const silences = [];
  let run = 0;
  levels.forEach((value, index) => {
    if (value < level) run += 1;
    if ((value >= level || index === levels.length - 1) && run) {
      const end = value < level ? index + 1 : index;
      if (run * 0.02 >= minimum) silences.push({ start: Number(((end - run) * 0.02).toFixed(2)), end: Number((end * 0.02).toFixed(2)) });
      run = 0;
    }
  });
  return silences;
}

/**
 * A take as the cut plays it: trimmed to its speech with a breath of room tone either side, every pause longer than
 * `maxPause` shortened to it (half kept on each side, so no word loses its breath), then played at `tempo` (pitch
 * kept). `segments` are the kept parts, `[from, to]` in the take's seconds; `at(t)` maps a time in the take to the
 * shaped take's seconds; `length` is the shaped take's.
 */
export function shapeTake(aligned, silences, length, { maxPause = Infinity, tempo = 1 } = {}) {
  const from = Math.max(0, aligned.speechStart - 0.15);
  const to = Math.min(length, aligned.speechEnd + 0.25);
  const segments = [];
  let start = from;
  for (const pause of silences) {
    if (pause.start <= aligned.speechStart || pause.end >= aligned.speechEnd || pause.end - pause.start <= maxPause) continue;
    segments.push([start, pause.start + maxPause / 2]);
    start = pause.end - maxPause / 2;
  }
  segments.push([start, to]);
  const at = (time) => {
    let kept = 0;
    for (const [segmentFrom, segmentTo] of segments) {
      if (time <= segmentFrom) break;
      kept += Math.min(time, segmentTo) - segmentFrom;
      if (time <= segmentTo) break;
    }
    return kept / tempo;
  };
  return { segments, tempo, at, length: at(to) };
}

/**
 * Where each sentence of a take is spoken, from where each sentence starts (`anchors`, in the take's seconds, read off
 * a word-level transcript: cut/words.py) and where its speech ends (`end`). An anchor moves to the end of a pause that
 * ends just before it (the transcript's word times run a little late); a sentence ends where the pause before the
 * next begins, or where the next starts when the speaker ran on. The speech starts at the first anchor, so whatever
 * comes before it (a false start, a breath) is left out of the cut.
 */
export function anchorSentences(anchors, end, silences) {
  const starts = anchors.map((anchor) => silences.findLast((silence) => silence.end >= anchor - 0.8 && silence.end <= anchor + 0.25)?.end ?? anchor - 0.05);
  const spans = starts.map((start, index) => {
    if (index === starts.length - 1) return { start, end };
    const next = starts[index + 1];
    return { start, end: silences.find((silence) => silence.end === next && silence.start > start)?.start ?? next };
  });
  return { speechStart: starts[0], speechEnd: end, spans, pauses: silences.filter((silence) => silence.start > starts[0] && silence.end < end).length, aligned: true };
}

/** One pause per target, in order, minimizing the total distance from each pause's middle to its target. */
function closestInOrder(targets, pauses) {
  if (!targets.length) return [];
  const middle = (pause) => (pause.start + pause.end) / 2;
  // cost[k][j]: the least total distance with target k at pause j; from[k][j]: the pause of target k − 1 for it.
  const cost = targets.map(() => pauses.map(() => Infinity));
  const from = targets.map(() => pauses.map(() => -1));
  pauses.forEach((pause, j) => { cost[0][j] = Math.abs(middle(pause) - targets[0]); });
  for (let k = 1; k < targets.length; k += 1) {
    let best = -1;
    for (let j = k; j < pauses.length; j += 1) {
      if (best < 0 || cost[k - 1][j - 1] < cost[k - 1][best]) best = j - 1;
      cost[k][j] = cost[k - 1][best] + Math.abs(middle(pauses[j]) - targets[k]);
      from[k][j] = best;
    }
  }
  const last = targets.length - 1;
  let j = cost[last].indexOf(Math.min(...cost[last]));
  const chosen = [];
  for (let k = last; k >= 0; k -= 1) {
    chosen.unshift(pauses[j]);
    j = from[k][j];
  }
  return chosen;
}

/**
 * A beat's caption lines on the video's timeline: each sentence's chunks spread over its span by word count, `offset`
 * mapping the take's seconds to the video's. A line stays up through a pause shorter than 0.6 s, so the captions
 * don't flicker off between sentences.
 */
export function beatCaptions(sentenceTexts, spans, offset) {
  const captions = [];
  sentenceTexts.forEach((sentence, index) => {
    const parts = chunks(sentence);
    const counts = parts.map(wordCount);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const { start, end } = spans[index];
    let at = start;
    parts.forEach((part, partIndex) => {
      const span = ((end - start) * counts[partIndex]) / total;
      captions.push({ start: offset + at, end: offset + at + span - 0.05, text: part });
      at += span;
    });
  });
  for (let index = 0; index < captions.length - 1; index += 1) {
    const gap = captions[index + 1].start - captions[index].end;
    if (gap > 0 && gap < 0.6) captions[index].end = captions[index + 1].start - 0.05;
  }
  return captions;
}

// Helpers for the v2 graphics. Each page defines window.renderAt(seconds): a pure function of time that sets the
// whole picture (no CSS transitions or animations, no timers, no randomness), so a capture is the same every run.
// The data comes from video/out/v2/data.js (node v2/graphics/data.mjs), loaded before this file.
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
/** Ease in and out (cubic). */
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Progress of `t` through [start, start + length], eased, clamped to 0..1. */
const progress = (t, start, length) => ease(clamp((t - start) / length));
const lerp = (from, to, amount) => from + (to - from) * amount;
/** Opacity for an element that fades in at `start` over `length` s (and out at `end`, if given). */
const fade = (t, start, length = 0.4, end = Infinity) => Math.min(progress(t, start, length), 1 - progress(t, end, length));
const data = window.AC_DATA;

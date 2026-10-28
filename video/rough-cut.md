# The captioned rough cut, and the voice-over

corupta records only the voice-over (plan §9). Everything else is assembled by a script, so a change to a shot, a
caption or a timing is a re-render, not an edit session.

## Order of work

1. **Script OK** (corupta, 15 min): [script.md](script.md) and [shots.md](shots.md). The notes in the script are the
   decisions to take (the hook's tree diff; the optional 5 s).
2. **Captures** on a quiet machine: the site and card shots (seconds each) and the seven tapes (the four that run
   immich's tools take 2 to 11 minutes each).
3. **Rough cut v0, silent**: [cut/](cut/) assembles the shots into the script's slots at the script's times, with
   the voice-over burned in as captions and the lower thirds as text. It is the timing reference for the recording.
4. **Voice-over** (corupta, 1–1.5 h, Oct 23–24): read the script against v0, one beat per take, so each beat can be
   re-recorded alone.
   - A quiet room, the phone or laptop mic close; WAV or the phone's lossless format. Leave 1 s of silence before and
     after each beat.
   - Files: `video/vo/<beat>.wav` (hook, failure, ours, result, credibility, close), not committed.
   - Pace: the script's word counts fit about 130 words a minute. A beat that runs long is cut in the text, not sped up.
5. **Rough cut v1** (`node cut/render.mjs`; `--timing` prints the timing alone, without rendering video): the cut
   script trims each take to its speech and lays it so its first word falls 0.3 s into its beat. It finds a take's
   pauses below its own noise floor + 12 dB (the takes weren't all recorded at one level), levels each take to the
   same loudness, holds its peaks under −6 dBFS, and mixes in float. Each sentence starts where `edl.json`'s
   `voice.beats.<beat>.sentences` says, read off a word-level transcript of the take (`cut/words.py`, Vosk, offline);
   whatever comes before the first sentence (a false start) is left out. Without anchors, the sentence ends are read
   from the take's pauses. `voice` can also shorten pauses (`maxPause`) and set a pace (`tempo`), per beat; S10's cut
   uses neither. Captions are timed by the sentences (one line per sentence, or two for a long one, spread over the
   sentence by word count). It writes `out/cut/timing.md`: each sentence's seconds and the shots under it, the check
   that each sentence lands on its shot. The `.srt` goes to YouTube as closed captions; `edl.json`'s `burnCaptions` decides whether they're also burned in (S10's cut: not, so a viewer with CC on doesn't see them twice).
6. **Final** (`node cut/render.mjs --final`, Oct 25–27): no music bed; 1 s of the first and last frames added around
   the cut, fading from and to black, so no word is faded; the voice normalized to −14 LUFS for YouTube (two-pass
   loudnorm, linear, true peak −1.5 dBTP), mixed as stereo before the normalization (an encoder upmix costs about
   1 LU); its own thumbnail (`cards/thumbnail.html`, rendered by `node diagram/render.mjs`, made to be read small; `out/cut/thumbnail.png`, 1280×720) and the captions 1 s later
   (`out/cut/final.srt`). It refuses to run without all six takes and exits 1 unless the file itself is ≤ 3:00, at
   −14 ± 1 LUFS integrated and a true peak at or below −1 dBFS.

## What the cut script does (ffmpeg only)

- Per shot: trim (`-ss`/`-t`), speed up a CLI wait (`setpts=PTS/<k>`, k from the slot length), hold the last frame
  if the slot is longer (`tpad=stop_mode=clone`), scale and pad to 1920×1080.
- Concatenate the segments (each already 1920×1080 at 30 fps), H.264 `yuv420p`, AAC 48 kHz stereo.
- Captions: written from the script's quoted voice-over lines, timed by the takes (above), burned in with libass
  (`ass=`), white text with a dark box, bottom center, at most two lines of 42 characters; the same lines as `.srt`.
- Lower thirds: the right-hand column of the script's tables, libass too, bottom left in the site's colors, the
  first 4.3 s of each shot.
- Sped-up CLI shots get a small "×8" (or whatever k is) badge, so nobody mistakes the speed for the tool's.

## Honesty rules for the edit

- No number on screen that isn't in [docs/numbers.md](../docs/numbers.md).
- Sped-up footage is marked as sped up; no re-typed or staged terminal output: every CLI frame is the tool's own.
- opencode is named, with its model and provider said aloud (storyboard decision 4).
- The graph beat says the cycle grows (decision 5); Super VL is called preliminary, with its limits on screen (decision 6).

// The rough cut: the captures (video/out/{cli,site}/) laid into the slots of cut/edl.json, the voice-over of
// script.md burned in as captions, each shot's lower third from script.md's tables, a speed badge on every shot that
// is sped up, and the voice-over takes (video/vo/<beat>.wav, or the phone's .flac or .m4a) when they exist; silent
// otherwise. ffmpeg only (libass for every text, so no drawtext is needed). Writes out/cut/rough.mp4,
// out/cut/captions.srt (YouTube's closed captions) and out/cut/timing.md (each sentence's time and the shots under
// it). A shot whose capture is missing renders as a labeled placeholder, so the timing can be reviewed early.
//
// Each take is trimmed to its speech (the takes keep 1 s of room tone at each end), its pauses shortened and its tempo
// set as edl.json's `voice` says, its first word 0.3 s into its beat; its sentence ends are read from its pauses (below
// its own noise floor + 12 dB), so the captions follow the voice.
//
// --final renders the upload, out/cut/final.mp4: every take required, 1 s before and after the cut fading from and
// to black, the voice at −14 LUFS (two-pass loudnorm, true peak −1.5 dBTP), checked on the file (≤ 3:00, −14 ± 1
// LUFS); with final.srt (the captions 1 s later) and thumbnail.png (cards/thumbnail.html, 1280×720). Exit 1 if a
// check fails.
//
//   node cut/render.mjs [--final | --timing] [--ffmpeg <path>] [--ffprobe <path>]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { alignSentences, anchorSentences, beatCaptions, findSilences, frameLevels, keepTogether, pauseLevel, seconds, sentences, shapeTake, wordCount } from './timing.mjs';

const { values } = parseArgs({
  options: {
        final: { type: 'boolean', default: false },
    timing: { type: 'boolean', default: false },
    ffmpeg: { type: 'string', default: process.env.FFMPEG ?? 'ffmpeg' },
    ffprobe: { type: 'string', default: process.env.FFPROBE ?? 'ffprobe' },
  },
});
const video = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(video, 'out');
const work = path.join(out, 'cut');
fs.mkdirSync(work, { recursive: true });
const fps = 30;
const ffmpeg = (args) => execFileSync(values.ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
/** What an analysis filter (silencedetect, ebur128, loudnorm) prints: ffmpeg's log, on stderr. */
const analyze = (input, filter) => spawnSync(values.ffmpeg, ['-hide_banner', '-nostats', '-i', input, '-af', filter, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr;
const duration = (file) => Number(execFileSync(values.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
/** ebur128's summary of a file: integrated loudness (LUFS) and true peak (dBFS). */
const loudness = (file) => {
  const log = analyze(file, 'ebur128=peak=true:framelog=quiet');
  return { integrated: Number(/^\s+I:\s+(-?[\d.]+) LUFS/m.exec(log)?.[1]), peak: Number(/^\s+Peak:\s+(-?[\d.]+) dBFS/m.exec(log)?.[1]) };
};

/** The script's beats (time range, voice-over) and each shot's lower third, read from script.md. */
function readScript() {
  const beats = [];
  const lowerThirds = new Map();
  let beat = null;
  for (const line of fs.readFileSync(path.join(video, 'script.md'), 'utf8').split('\n')) {
    const heading = /^## (\d+:\d\d(?:\.\d)?)–(\d+:\d\d(?:\.\d)?) ([^(]+?)\s*(\(|$)/.exec(line);
    if (heading) {
      beat = { id: heading[3].toLowerCase().replace(/^the /, '').split(' ')[0], title: heading[3], start: seconds(heading[1]), end: seconds(heading[2]), voiceOver: [] };
      beats.push(beat);
      continue;
    }
    if (line.startsWith('## ')) beat = null;
    if (beat && line.startsWith('> ')) beat.voiceOver.push(line.slice(2));
    const row = /^\| `([a-z0-9-]+)`[^|]*\| (.+?) \|$/.exec(line);
    if (row && row[2] !== '—') lowerThirds.set(row[1], row[2].replace(/`/g, ''));
  }
  return { beats, lowerThirds };
}

/** A beat's take: vo/<beat>.wav, or the phone's lossless .flac or .m4a. */
const takeFile = (id) => ['wav', 'flac', 'm4a'].map((extension) => path.join(video, 'vo', `${id}.${extension}`)).find((file) => fs.existsSync(file));

const assTime = (value) => {
  const centiseconds = Math.round(value * 100);
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor(centiseconds / 6000) % 60;
  const secs = Math.floor(centiseconds / 100) % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
};
const srtTime = (value) => assTime(value).replace(/^(\d+):/, (_, hours) => `${hours.padStart(2, '0')}:`).replace('.', ',') + '0';
const srt = (captions, shift = 0) => captions.map((caption, index) => `${index + 1}\n${srtTime(caption.start + shift)} --> ${srtTime(caption.end + shift)}\n${caption.text}\n`).join('\n');

const { beats, lowerThirds } = readScript();
for (const card of fs.readdirSync(path.join(video, 'cards')).filter((file) => file.endsWith('.html'))) {
  const placeholders = fs.readFileSync(path.join(video, 'cards', card), 'utf8').match(/REPO_URL|SITE_URL/g);
  if (placeholders) console.log(`warning: cards/${card} still has ${[...new Set(placeholders)].join(' and ')}: fill them before the final cut`);
}
const edl = JSON.parse(fs.readFileSync(path.join(video, 'cut', 'edl.json'), 'utf8'));
const total = edl.shots.at(-1).end;
/**
 * How the takes are shaped to the timeline (edl.json `voice`): pauses shortened to `maxPause` s, played at `tempo`;
 * `beats` overrides either for one beat (a slower take can be sped up more than a brisk one).
 */
const shapingOf = (id) => ({ maxPause: Infinity, tempo: 1, ...edl.voice, ...edl.voice?.beats?.[id] });
if (values.final) {
  const missing = beats.filter((beat) => !takeFile(beat.id)).map((beat) => `vo/${beat.id}.wav`);
  if (missing.length) {
    console.error(`--final needs every take; missing: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// 1. One segment per shot, exactly its slot long.
const events = [];
// (--timing: only the takes' timing, for fitting the timeline to them; no video.)
const segments = values.timing ? [] : edl.shots.map((shot, index) => {
  const slot = shot.end - shot.start;
  const segment = path.join(work, `${String(index).padStart(2, '0')}-${shot.shot}.mp4`);
  const source = path.join(out, shot.file);
  // A terminal's last lines sit at the bottom, where the captions go: CLI shots are scaled into the top 87% of the frame.
  const fit = shot.file.startsWith('cli/')
    ? 'scale=1664:936,pad=1920:1080:128:16:color=0x1b1b1a'
    : 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x1b1b1a';
  if (!fs.existsSync(source)) {
    ffmpeg(['-f', 'lavfi', '-i', `color=c=0x3a3a37:s=1920x1080:r=${fps}:d=${slot}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', segment]);
    events.push({ style: 'Missing', start: shot.start, end: shot.end, text: `missing capture: ${shot.shot}\\N(${shot.file})` });
    console.log(`${shot.shot}: missing ${shot.file}, placeholder`);
    return segment;
  }
  const from = shot.from ?? 0;
  const to = shot.to ?? duration(source);
  const speed = shot.speed === 'fit' ? (to - from) / (slot - (shot.hold ?? 0)) : shot.speed ?? 1;
  ffmpeg(['-ss', String(from), '-t', String(to - from), '-i', source, '-an', '-vf',
    `setpts=(PTS-STARTPTS)/${speed},fps=${fps},${fit},tpad=stop_mode=clone:stop_duration=${slot},trim=duration=${slot},setpts=PTS-STARTPTS`,
    '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', segment]);
  // A CLI wait sped up, or left out, is marked so nobody takes the footage's speed for the tool's; a page scroll isn't.
  const badge = shot.badge ?? (shot.file.startsWith('cli/') && speed > 1.2 ? `×${speed >= 10 ? Math.round(speed) : speed.toFixed(1)}` : null);
  if (badge) events.push({ style: 'Badge', start: shot.start, end: shot.end, text: badge });
  const lower = lowerThirds.get(shot.shot);
  if (lower) events.push({ style: 'Lower', start: shot.start + 0.2, end: Math.min(shot.end, shot.start + 4.5), text: lower });
  console.log(`${shot.shot}: ${slot} s from ${(to - from).toFixed(1)} s of ${shot.file} at ×${speed.toFixed(2)}`);
  return segment;
});

// 2. Captions: each beat's sentences over its take (vo/<beat>.wav), timed by the take's pauses, or, without a take,
// spread over the beat's slot by word count. The first word falls 0.3 s into the beat.
const lead = 0.3;
const takes = [];
const captions = [];
const timing = [];
let overruns = 0;
for (const beat of beats) {
  const take = takeFile(beat.id);
  const texts = sentences(beat.voiceOver.join(' '));
  const counts = texts.map(wordCount);
  let aligned;
  let offset;
  if (take) {
        const length = duration(take);
    // Pauses are found below the take's own noise floor + 12 dB: the takes weren't all recorded at one level.
    const pcm = execFileSync(values.ffmpeg, ['-v', 'error', '-i', take, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], { maxBuffer: 1 << 28 });
        const levels = frameLevels(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2), 16000);
    const level = pauseLevel(levels);
    const silences = findSilences(levels, level);
        const shaping = shapingOf(beat.id);
    // Sentence starts read off the take's transcript (edl.json voice.beats.<beat>.sentences) win over the pauses.
    if (shaping.sentences && shaping.sentences.length !== texts.length) throw new Error(`${beat.id}: ${shaping.sentences.length} sentence anchors for ${texts.length} sentences`);
    aligned = shaping.sentences ? anchorSentences(shaping.sentences, shaping.end ?? length, silences) : alignSentences(counts, silences, length);
    const shaped = shapeTake(aligned, silences, length, shaping);
    // The take's first word falls `lead` s into its beat; its sentences are mapped through the shaping.
    const at = beat.start + lead - shaped.at(aligned.speechStart);
    offset = at;
    aligned = { ...aligned, spans: aligned.spans.map((span) => ({ start: shaped.at(span.start), end: shaped.at(span.end) })) };
    // Each take at −20 LUFS before the mix, so a beat recorded further from the mic isn't quieter than the others.
    const { integrated } = loudness(take);
    takes.push({ file: take, segments: shaped.segments, tempo: shaped.tempo, at, gain: Number.isFinite(integrated) ? -20 - integrated : 0 });
    const end = at + shaped.at(aligned.speechEnd);
    console.log(`${beat.id}: ${path.basename(take)}, speech ${(aligned.speechEnd - aligned.speechStart).toFixed(1)} s of ${length.toFixed(1)} s → ${shaped.length.toFixed(1)} s shaped (pauses at ${level.toFixed(1)} dB), ${texts.length} sentences, ${shaping.sentences ? 'starts from the transcript' : aligned.aligned ? `ends from ${aligned.pauses} pauses` : `${aligned.pauses} pauses, too few: ends by word count`}, last word at ${end.toFixed(1)} s`);
    if (end > beat.end) {
      overruns += 1;
      console.log(`${beat.id}: the take runs ${(end - beat.end).toFixed(1)} s past the beat's end (${beat.end} s)`);
    }
  } else {
    aligned = alignSentences(counts, [], beat.end - beat.start - 0.8);
    offset = beat.start + lead;
  }
  captions.push(...beatCaptions(texts, aligned.spans, offset));
  texts.forEach((sentence, index) => {
    const start = offset + aligned.spans[index].start;
    const end = offset + aligned.spans[index].end;
    const under = edl.shots.filter((shot) => shot.start < end && shot.end > start).map((shot) => `${shot.shot} ${shot.start}–${shot.end}`);
    timing.push(`| ${beat.id}${take ? '' : ' (no take)'} | ${start.toFixed(1)}–${end.toFixed(1)} | ${under.join(', ')} | ${sentence} |`);
  });
}
// Captions are burned in unless edl.json says `"burnCaptions": false` (then only the .srt carries them, for YouTube's CC).
if (edl.burnCaptions !== false) events.push(...captions.map((caption) => ({ style: 'Caption', ...caption })));
fs.writeFileSync(path.join(work, 'timing.md'), `# Each sentence's time and the shots under it\n\n| Beat | Seconds | Shots | Sentence |\n|---|---|---|---|\n${timing.join('\n')}\n`);
if (values.timing) {
  console.log(timing.join('\n'));
  process.exit(overruns ? 1 : 0);
}

const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&HB0000000,0,0,0,0,100,100,0,0,3,14,0,2,300,300,48,1
Style: Lower,DejaVu Sans,34,&H001B1B1D,&H001B1B1D,&H00FCFCFB,&H20FCFCFB,1,0,0,0,100,100,0,0,3,16,0,1,60,600,150,1
Style: Badge,DejaVu Sans Mono,40,&H00FFFFFF,&H00FFFFFF,&H003468EB,&H003468EB,1,0,0,0,100,100,0,0,3,12,0,9,60,60,48,1
Style: Missing,DejaVu Sans,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,5,100,100,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.sort((left, right) => left.start - right.start).map((event) => `Dialogue: 0,${assTime(event.start)},${assTime(event.end)},${event.style},,0,0,0,,${keepTogether(event.text).replace(/\n/g, '\\N')}`).join('\n')}
`;
const assFile = path.join(work, 'cut.ass');
fs.writeFileSync(assFile, ass);
fs.writeFileSync(path.join(work, 'captions.srt'), srt(captions));

// 3. Concatenate, mix the takes into one voice track (or silence), burn the text in. The voice is stereo from the mix
// on (the same signal left and right): an implicit upmix at the encoder costs about 1 LU and would undo loudnorm.
const list = path.join(work, 'segments.txt');
fs.writeFileSync(list, segments.map((segment) => `file '${segment}'`).join('\n'));
const silent = path.join(work, 'silent.mp4');
ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
const voice = path.join(work, 'voice.wav');
if (takes.length) {
        // Clipped peaks are repaired first, one take at a time. (atrim's `duration` after amix ends ffmpeg 7.0's output at
  // the first take's delay, with no error; `end` doesn't.)
  const repaired = takes.map((take, index) => {
    const file = path.join(work, `take-${index}.wav`);
    ffmpeg(['-i', take.file, '-af', 'adeclip', file]);
    return file;
  });
    // Each take: its kept parts joined (sample-exact), its tempo, leveled (and its peaks held under -6 dBFS, so a quiet
  // take brought up to the others doesn't clip), laid at its place. The voice track is float, so the mix never clips.
  const inputs = takes.map((take, index) => {
    const parts = take.segments.map((_, part) => `[t${index}s${part}]`);
    const cuts = take.segments.map(([from, to], part) => `[t${index}c${part}]atrim=start=${from.toFixed(4)}:end=${to.toFixed(4)},asetpts=PTS-STARTPTS${parts[part]}`);
    return `[${index}:a]asplit=${take.segments.length}${take.segments.map((_, part) => `[t${index}c${part}]`).join('')};${cuts.join(';')};` +
      `${parts.join('')}concat=n=${parts.length}:v=0:a=1,atempo=${take.tempo},aformat=sample_rates=48000:channel_layouts=mono,highpass=f=80,volume=${take.gain.toFixed(2)}dB,alimiter=limit=0.5:level=false,adelay=${Math.round(take.at * 1000)}:all=1[a${index}]`;
  });
  ffmpeg([...repaired.flatMap((file) => ['-i', file]), '-filter_complex',
    `${inputs.join(';')};${takes.map((_, index) => `[a${index}]`).join('')}amix=inputs=${takes.length}:normalize=0,pan=stereo|c0=c0|c1=c0,apad=whole_dur=${total},atrim=end=${total}[voice]`,
        '-map', '[voice]', '-c:a', 'pcm_f32le', voice]);
} else {
  ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(total), '-c:a', 'pcm_f32le', voice]);
}
const rough = path.join(work, 'rough.mp4');
ffmpeg(['-i', silent, '-i', voice, '-filter_complex', `[0:v]ass=${assFile}[video]`, '-map', '[video]', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', rough]);
console.log(`rough cut: ${path.relative(video, rough)} (${duration(rough).toFixed(1)} s), captions: ${path.relative(video, path.join(work, 'captions.srt'))}, timing: ${path.relative(video, path.join(work, 'timing.md'))}${takes.length ? `, ${takes.length} voice-over takes` : ', silent'}${overruns ? `, ${overruns} beats overrun` : ''}`);

// 4. The upload: 1 s of the first and last frames around the cut, fading from and to black; the voice normalized to
// −14 LUFS in two passes (measure, then a linear gain), so speech keeps its dynamics.
if (values.final) {
  const pad = 1;
  const length = total + 2 * pad;
  const shape = `adelay=${pad * 1000}:all=1,apad=whole_dur=${length},atrim=end=${length}`;
  const target = 'I=-14:TP=-1.5:LRA=11';
  const measured = JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(analyze(voice, `${shape},loudnorm=${target}:print_format=json`))[0]);
  const loudnorm = `loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
  const final = path.join(work, 'final.mp4');
  ffmpeg(['-i', silent, '-i', voice, '-filter_complex',
    `[0:v]ass=${assFile},tpad=start_duration=${pad}:start_mode=clone:stop_duration=${pad}:stop_mode=clone,fade=t=in:st=0:d=${pad},fade=t=out:st=${total + pad}:d=${pad}[video];` +
    `[1:a]${shape},${loudnorm},aresample=48000,afade=t=in:st=0:d=${pad},afade=t=out:st=${total + pad}:d=${pad}[audio]`,
    '-map', '[video]', '-map', '[audio]', '-r', String(fps), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', final]);
  fs.writeFileSync(path.join(work, 'final.srt'), srt(captions, pad));
    // The thumbnail: cards/thumbnail.html, rendered by diagram/render.mjs (made to be read small).
  const card = path.join(out, 'thumbnail.png');
  const thumbnail = path.join(work, 'thumbnail.png');
  const failures = [];
  if (fs.existsSync(card)) {
    ffmpeg(['-i', card, '-vf', 'scale=1280:720', thumbnail]);
    if (fs.statSync(thumbnail).size >= 2 * 1024 * 1024) failures.push('the thumbnail is 2 MB or more (YouTube\'s limit)');
  } else failures.push(`no ${path.relative(video, card)} for the thumbnail: node diagram/render.mjs`);
  const finalLength = duration(final);
  const { integrated, peak } = loudness(final);
  if (!(finalLength <= 180)) failures.push(`${finalLength.toFixed(2)} s on the file, over 3:00`);
  if (!(Math.abs(integrated + 14) <= 1)) failures.push(`${integrated} LUFS integrated, not −14 ± 1`);
  if (!(peak <= -1)) failures.push(`true peak ${peak} dBFS, above −1`);
  console.log(`final: ${path.relative(video, final)}, ${finalLength.toFixed(2)} s, ${integrated} LUFS, true peak ${peak} dBFS; final.srt; thumbnail.png`);
  for (const failure of failures) console.error(`final: ${failure}`);
  if (failures.length) process.exit(1);
}

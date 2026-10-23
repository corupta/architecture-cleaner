// The rough cut: the captures (video/out/{cli,site}/) laid into the slots of cut/edl.json, the voice-over of
// script.md burned in as captions, each shot's lower third from script.md's tables, a speed badge on every shot that
// is sped up, and the voice-over takes (video/vo/<beat>.wav) when they exist; silent otherwise. ffmpeg only (libass
// for every text, so no drawtext is needed). Writes out/cut/rough.mp4 and out/cut/captions.srt (YouTube's closed
// captions). A shot whose capture is missing renders as a labeled placeholder, so the timing can be reviewed early.
//
//   node cut/render.mjs [--ffmpeg <path>] [--ffprobe <path>]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
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
const duration = (file) => Number(execFileSync(values.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());

/** "1:05" → 65. */
const seconds = (clock) => clock.split(':').reduce((total, part) => total * 60 + Number(part), 0);

/** The script's beats (time range, voice-over) and each shot's lower third, read from script.md. */
function readScript() {
  const beats = [];
  const lowerThirds = new Map();
  let beat = null;
  for (const line of fs.readFileSync(path.join(video, 'script.md'), 'utf8').split('\n')) {
    const heading = /^## (\d+:\d\d)–(\d+:\d\d) ([^(]+?)\s*(\(|$)/.exec(line);
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

/**
 * Caption chunks of at most `limit` characters (two lines of 42), split at sentence ends; a longer sentence is split
 * into parts of about equal length at word boundaries, so no part is a one-word tail that flashes.
 */
function chunks(text, limit = 84) {
  const result = [];
  for (const sentence of text.split(/(?<=[.?!])\s+/)) {
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

const assTime = (value) => {
  const centiseconds = Math.round(value * 100);
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor(centiseconds / 6000) % 60;
  const secs = Math.floor(centiseconds / 100) % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
};
const srtTime = (value) => assTime(value).replace(/^(\d+):/, (_, hours) => `${hours.padStart(2, '0')}:`).replace('.', ',') + '0';

const { beats, lowerThirds } = readScript();
for (const card of fs.readdirSync(path.join(video, 'cards')).filter((file) => file.endsWith('.html'))) {
  const placeholders = fs.readFileSync(path.join(video, 'cards', card), 'utf8').match(/REPO_URL|SITE_URL/g);
  if (placeholders) console.log(`warning: cards/${card} still has ${[...new Set(placeholders)].join(' and ')}: fill them before the final cut`);
}
const edl = JSON.parse(fs.readFileSync(path.join(video, 'cut', 'edl.json'), 'utf8'));

// 1. One segment per shot, exactly its slot long.
const events = [];
const segments = edl.shots.map((shot, index) => {
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

// 2. Captions: each beat's voice-over over its take (vo/<beat>.wav) or, without one, over the beat's slot.
const takes = [];
const captions = [];
for (const beat of beats) {
  const take = path.join(video, 'vo', `${beat.id}.wav`);
  const hasTake = fs.existsSync(take);
  const start = beat.start + 0.3;
  const length = hasTake ? duration(take) : beat.end - beat.start - 0.8;
  if (hasTake) {
    takes.push({ file: take, start: beat.start + 0.3 });
    if (beat.start + 0.3 + length > beat.end) console.log(`${beat.id}: the take runs ${(beat.start + 0.3 + length - beat.end).toFixed(1)} s past the beat's end (${beat.end} s)`);
  }
  const parts = chunks(beat.voiceOver.join(' '));
  const words = parts.map((part) => part.split(/\s+/).length);
  const total = words.reduce((sum, count) => sum + count, 0);
  let at = start;
  parts.forEach((part, index) => {
    const span = (length * words[index]) / total;
    captions.push({ start: at, end: at + span - 0.05, text: part });
    at += span;
  });
}
events.push(...captions.map((caption) => ({ style: 'Caption', ...caption })));

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
${events.sort((left, right) => left.start - right.start).map((event) => `Dialogue: 0,${assTime(event.start)},${assTime(event.end)},${event.style},,0,0,0,,${event.text.replace(/\n/g, '\\N')}`).join('\n')}
`;
const assFile = path.join(work, 'cut.ass');
fs.writeFileSync(assFile, ass);
fs.writeFileSync(path.join(work, 'captions.srt'), captions.map((caption, index) => `${index + 1}\n${srtTime(caption.start)} --> ${srtTime(caption.end)}\n${caption.text}\n`).join('\n'));

// 3. Concatenate, burn the text in, lay the takes (or silence) under it.
const list = path.join(work, 'segments.txt');
fs.writeFileSync(list, segments.map((segment) => `file '${segment}'`).join('\n'));
const silent = path.join(work, 'silent.mp4');
ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
const total = edl.shots.at(-1).end;
const audioInputs = takes.flatMap((take) => ['-i', take.file]);
const audioFilter = takes.length
  ? `${takes.map((take, index) => `[${index + 1}:a]aresample=48000,adelay=${Math.round(take.start * 1000)}:all=1[a${index}]`).join(';')};${takes.map((_, index) => `[a${index}]`).join('')}amix=inputs=${takes.length}:normalize=0,apad,atrim=duration=${total}[audio]`
  : `anullsrc=r=48000:cl=stereo,atrim=duration=${total}[audio]`;
const rough = path.join(work, 'rough.mp4');
ffmpeg(['-i', silent, ...audioInputs, '-filter_complex', `[0:v]ass=${assFile}[video];${audioFilter}`, '-map', '[video]', '-map', '[audio]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', rough]);
console.log(`rough cut: ${path.relative(video, rough)} (${duration(rough).toFixed(1)} s), captions: ${path.relative(video, path.join(work, 'captions.srt'))}${takes.length ? `, ${takes.length} voice-over takes` : ', silent'}`);

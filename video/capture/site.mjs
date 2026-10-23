// Scripted captures of the replay site for the demo video. Each shot opens a page of a built site (`npx ac site --out`)
// and holds, scrolls, opens and highlights, rendered frame by frame: a screenshot per frame at a fixed frame rate, not a
// screen recording, so a shot comes out the same on every run and never drops a frame. ffmpeg encodes each shot to
// <out>/<id>.mp4 (H.264, 1920×1080, 30 fps) and keeps its first and last frame as PNG stills.
//
// A card (a title or a table made for the video, video/cards/*.html) is captured the same way.
//
//   node capture/site.mjs --site /tmp/s9-site --out out/site [--only site-ab,site-fault] [--ffmpeg <path>]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { siteShots } from './site-shots.mjs';

const videoDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const { values } = parseArgs({
  options: {
    site: { type: 'string' },
    out: { type: 'string', default: 'out/site' },
    only: { type: 'string' },
    ffmpeg: { type: 'string', default: process.env.FFMPEG ?? 'ffmpeg' },
  },
});
if (!values.site) throw new Error('--site <a built site dir> is required (npx ac site --out <dir>)');

const fps = 30;
// A 1280×720 CSS viewport at 1.5× gives 1920×1080 frames with the site's text large enough to read on a phone.
const viewport = { width: 1280, height: 720 };
const scale = 1.5;
const only = values.only ? new Set(values.only.split(',')) : null;
const site = path.resolve(values.site);
const out = path.resolve(values.out);
fs.mkdirSync(out, { recursive: true });

const highlightCss = `
.ac-video-highlight{outline:4px solid #eb6834!important;outline-offset:4px;border-radius:4px;background:rgba(250,178,25,.18)!important;transition:none!important}
html{scroll-behavior:auto!important}
*{caret-color:transparent!important}`;

/** Ease in and out, so a scroll starts and stops gently. */
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

async function locate(page, target) {
  const locator = page.locator(target).first();
  await locator.waitFor({ state: 'attached', timeout: 5000 });
  return locator;
}

/** The scroll offset that puts `target` `margin` CSS pixels below the top of the viewport, clamped to the page. */
async function offsetOf(page, target, margin = 24) {
  if (typeof target === 'number') return target;
  const locator = await locate(page, target);
  return locator.evaluate((element, margin) => {
    const top = element.getBoundingClientRect().top + window.scrollY - margin;
    return Math.max(0, Math.min(top, document.documentElement.scrollHeight - window.innerHeight));
  }, margin);
}

async function render(shot, browser) {
  const frames = path.join(out, `${shot.id}.frames`);
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale, colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(`file://${shot.card ? path.join(videoDirectory, shot.card) : path.join(site, shot.page)}`);
  await page.addStyleTag({ content: highlightCss });
  await page.evaluate(() => document.fonts.ready);
  let frame = 0;
  let last = null;
  const snap = async () => {
    const file = path.join(frames, `${String(frame++).padStart(5, '0')}.png`);
    await page.screenshot({ path: file });
    last = file;
  };
  /** A held frame is the same picture: copy the last one instead of taking another screenshot. */
  const hold = async (seconds) => {
    if (!last) await snap();
    for (let index = 1; index < Math.round(seconds * fps); index += 1) {
      const file = path.join(frames, `${String(frame++).padStart(5, '0')}.png`);
      fs.copyFileSync(last, file);
    }
  };
  for (const step of shot.steps) {
    if ('scrollTo' in step) {
      const from = await page.evaluate(() => window.scrollY);
      const to = await offsetOf(page, step.scrollTo, step.margin);
      const count = Math.max(1, Math.round((step.seconds ?? 1.5) * fps));
      for (let index = 1; index <= count; index += 1) {
        await page.evaluate((y) => window.scrollTo(0, y), Math.round(from + (to - from) * ease(index / count)));
        await snap();
      }
    } else if ('jumpTo' in step) {
      await page.evaluate((y) => window.scrollTo(0, y), await offsetOf(page, step.jumpTo, step.margin));
      await snap();
    } else if ('open' in step) {
      await (await locate(page, step.open)).evaluate((element) => { element.closest('details').open = true; });
      await snap();
    } else if ('highlight' in step) {
      await (await locate(page, step.highlight)).evaluate((element) => element.classList.add('ac-video-highlight'));
      await snap();
    } else if ('clear' in step) {
      await page.evaluate(() => document.querySelectorAll('.ac-video-highlight').forEach((element) => element.classList.remove('ac-video-highlight')));
      await snap();
    } else if ('hold' in step) {
      await hold(step.hold);
    } else {
      throw new Error(`${shot.id}: unknown step ${JSON.stringify(step)}`);
    }
  }
  await page.close();
  const video = path.join(out, `${shot.id}.mp4`);
  execFileSync(values.ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frames, '%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video]);
  fs.copyFileSync(path.join(frames, '00000.png'), path.join(out, `${shot.id}.first.png`));
  fs.copyFileSync(last, path.join(out, `${shot.id}.last.png`));
  fs.rmSync(frames, { recursive: true, force: true });
  return { id: shot.id, frames: frame, seconds: frame / fps, video };
}

const browser = await chromium.launch();
try {
  for (const shot of siteShots.filter((shot) => !only || only.has(shot.id))) {
    const result = await render(shot, browser);
    console.log(`${result.id}: ${result.frames} frames, ${result.seconds.toFixed(1)} s → ${path.relative(process.cwd(), result.video)}`);
  }
} finally {
  await browser.close();
}

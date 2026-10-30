// Renders a Strudel pattern to a WAV: Strudel (@strudel/web, the same engine as strudel.cc) plays it in the headless
// Chromium the captures use, and render.html taps everything it sends to the speakers. It plays in real time, so a
// 3-minute bed takes 3 minutes; run it on a quiet machine, or the audio thread can drop buffers.
//
//   node v2/music/render.mjs [--pattern v2/music/bed.strudel.js] [--seconds 180] [--out out/v2/music/bed.wav]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const video = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const { values } = parseArgs({
  options: {
    pattern: { type: 'string', default: 'v2/music/bed.strudel.js' },
    seconds: { type: 'string', default: '180' },
    out: { type: 'string', default: 'out/v2/music/bed.wav' },
  },
});

// The page and Strudel's bundle are served from video/ (a module script can't load from file://).
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer((request, response) => {
  const file = path.join(video, decodeURIComponent(request.url.split('?')[0]));
  if (!file.startsWith(video) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error(`page error: ${error.message}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/v2/music/render.html`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate((code) => window.__start(code), fs.readFileSync(path.resolve(video, values.pattern), 'utf8'));
  await page.waitForTimeout(Number(values.seconds) * 1000);
  await page.evaluate(() => window.__stop());
  const { rate, data } = await page.evaluate(() => window.__take());
  const pcm = Buffer.from(data, 'base64');
  // A 16-bit stereo PCM WAV header.
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  const out = path.resolve(video, values.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.concat([header, pcm]));
  console.log(`${path.relative(video, out)}: ${(pcm.length / 4 / rate).toFixed(1)} s at ${rate} Hz`);
} finally {
  await browser.close();
  server.close();
}

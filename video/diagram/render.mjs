// Renders the README's diagram (diagram/restructure.html) to docs/assets/restructure.png, and the video's thumbnail
// (cards/thumbnail.html) to out/thumbnail.png, which `cut/render.mjs --final` takes, and its 3:2 Devpost version
// (out/thumbnail-devpost.png). The video's close card uses the
// same diagram (cards/close.html; capture/site.mjs --only card-close).
//   node diagram/render.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const video = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(path.dirname(video), 'docs', 'assets', 'restructure.png');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(path.join(video, 'diagram', 'restructure.html')).href);
await page.locator('#diagram').screenshot({ path: out });
const thumbnail = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await thumbnail.goto(pathToFileURL(path.join(video, 'cards', 'thumbnail.html')).href);
await thumbnail.screenshot({ path: path.join(video, 'out', 'thumbnail.png') });
// Devpost's project thumbnail and gallery want 3:2.
const devpost = await browser.newPage({ viewport: { width: 1080, height: 720 } });
await devpost.goto(`${pathToFileURL(path.join(video, 'cards', 'thumbnail.html')).href}?layout=devpost`);
await devpost.screenshot({ path: path.join(video, 'out', 'thumbnail-devpost.png') });
await browser.close();
console.log(`${path.relative(path.dirname(video), out)}, video/out/thumbnail.png, video/out/thumbnail-devpost.png`);

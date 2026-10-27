// Renders the README's diagram (diagram/restructure.html) to docs/assets/restructure.png. The video's close card uses
// the same diagram (cards/close.html; capture/site.mjs --only card-close).
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
await browser.close();
console.log(path.relative(path.dirname(video), out));

// One-off: eyeball the moon cover-flow through the real face stylesheet +
// Chrome, plus a threshold(128) pass to simulate the 1-bit panel.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { renderWidget } from '../control-src/widgets/_ssr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(join(ROOT, 'public', 'dashboard.css'), 'utf8');

const SYN = 29.530588853, REF = Date.UTC(2000, 0, 6, 18, 14, 0);
const now = REF + 0.6 * SYN * 86400000 + 3600000; // ~waning gibbous
const card = renderWidget('moon', {
  now, cellW: 20, cellH: 9, settings: { variant: 'flow' }, variant: 'flow'
});

const html = `<!doctype html><html><head><meta charset="utf8"><style>${css}
  body{margin:0;background:#fff;width:720px}
</style></head><body>
  <div style="padding:14px"><div style="height:420px;border:2px solid #000">${card}</div></div>
</body></html>`;

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 720, height: 460, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const buf = await page.screenshot();
await browser.close();

await sharp(buf).toFile(join(ROOT, 'test', '_component-preview.png'));       // as-rendered
await sharp(buf).greyscale().threshold(128)
  .toFile(join(ROOT, 'test', '_component-preview-1bit.png'));                // panel sim
console.log('wrote preview + 1bit sim');

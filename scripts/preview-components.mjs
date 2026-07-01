// One-off: eyeball components through the real face stylesheet + Chrome at
// panel scale (deviceScaleFactor 1). Not wired into npm scripts.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer';
import { renderWidget } from '../control-src/widgets/_ssr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(join(ROOT, 'public', 'dashboard.css'), 'utf8');

const SYN = 29.530588853, REF = Date.UTC(2000, 0, 6, 18, 14, 0);
const at = (p) => REF + p * SYN * 86400000 + 3600000;
const flow = (now, w, h) => renderWidget('moon', {
  now, cellW: w, cellH: h, settings: { variant: 'flow' }, variant: 'flow'
});

const rows = [
  ['Wide (±2), waxing gibbous', flow(at(0.4), 20, 8), 340],
  ['Wide (±2), waning crescent', flow(at(0.85), 20, 8), 340],
  ['Medium (±1), first quarter', flow(at(0.25), 12, 6), 260],
  ['Medium (±1), full', flow(at(0.5), 12, 6), 260]
].map(([label, card, hpx]) =>
  `<div><div style="font:600 12px var(--face-grotesk);margin:0 0 6px 2px">${label}</div>
    <div style="height:${hpx}px;border:2px solid #000">${card}</div></div>`).join('');

const html = `<!doctype html><html><head><meta charset="utf8"><style>${css}
  body{margin:0;background:#fff;width:900px}
  .wrap{display:flex;flex-direction:column;gap:16px;padding:16px}
</style></head><body><div class="wrap">${rows}</div></body></html>`;

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1360, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const out = join(ROOT, 'test', '_component-preview.png');
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);

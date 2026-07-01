// One-off: moon cover-flow at several widths, threshold(128) = panel sim.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { renderWidget } from '../control-src/widgets/_ssr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(join(ROOT, 'public', 'dashboard.css'), 'utf8');
const PXW = 800 / 24;
const SYN = 29.530588853, REF = Date.UTC(2000, 0, 6, 18, 14, 0);
const now = REF + 0.6 * SYN * 86400000 + 3600000;

const widths = [12, 16, 20, 24];
const rows = widths.map((cw) => {
  const card = renderWidget('moon', { now, cellW: cw, cellH: 8, settings: { variant: 'flow' }, variant: 'flow' });
  const px = Math.round(cw * PXW);
  return `<div><div style="font:600 12px var(--face-grotesk);margin:0 0 6px 2px">cellW ${cw} (${px}px)</div>
    <div style="width:${px}px;height:340px;border:2px solid #000">${card}</div></div>`;
}).join('');

const html = `<!doctype html><html><head><meta charset="utf8"><style>${css}
  body{margin:0;background:#fff;width:840px}.wrap{display:flex;flex-direction:column;gap:16px;padding:16px}
</style></head><body><div class="wrap">${rows}</div></body></html>`;

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 840, height: 1520, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const buf = await page.screenshot();
await browser.close();
await sharp(buf).greyscale().threshold(128).toFile(join(ROOT, 'test', '_component-preview.png'));
console.log('wrote 1bit sim');

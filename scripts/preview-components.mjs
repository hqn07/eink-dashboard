// One-off: render the gauge + heatmap primitives through the real face
// stylesheet + Chrome at 800×480 (deviceScaleFactor 1, same as the panel
// pipeline) so we can eyeball them. Not wired into npm scripts. Output:
// test/_component-preview.png
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer';
import { gaugeHtml, heatmapHtml } from '../control-src/widgets/_shared.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(join(ROOT, 'public', 'dashboard.css'), 'utf8');

// A week of synthetic "activity" (7 rows × 18 weeks), last value = today.
const days = Array.from({ length: 7 * 18 }, (_, i) =>
  Math.max(0, Math.round(6 * Math.sin(i / 7) + (i % 5) + Math.random() * 3)));

const card = (title, body) => `<div style="border:2px solid #000;height:220px;display:flex;flex-direction:column">
  <div class="tr-titlebar"><span>${title}</span></div>
  <div class="tr-body" style="justify-content:center;align-items:center">${body}</div></div>`;

const html = `<!doctype html><html><head><meta charset="utf8"><style>${css}
  body{margin:0;background:#fff;width:800px}
  .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:12px}
</style></head><body><div class="grid">
  ${card('GAUGE 42/300', gaugeHtml({ value: 42, max: 300, center: 42, label: 'GOOD' }))}
  ${card('GAUGE 168 RED', gaugeHtml({ value: 168, max: 300, center: 168, label: 'UNHEALTHY', red: true, size: 'lg' }))}
  ${card('GAUGE 78%', gaugeHtml({ value: 78, max: 100, center: '78%', label: 'HUMIDITY', size: 'sm' }))}
  <div style="grid-column:1/4;border:2px solid #000;height:180px;display:flex;flex-direction:column">
    <div class="tr-titlebar"><span>CONTRIBUTION HEATMAP</span><span class="tr-meta">18 WK</span></div>
    <div class="tr-body">${heatmapHtml({ values: days, rows: 7 })}</div>
  </div>
</div></body></html>`;

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 640, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const out = join(ROOT, 'test', '_component-preview.png');
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);

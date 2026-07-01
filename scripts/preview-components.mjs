// One-off: render primitives + the calendar TRMNL agenda through the real
// face stylesheet + Chrome at panel scale (deviceScaleFactor 1) to eyeball
// them. Not wired into npm scripts. Output: test/_component-preview.png
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer';
import { gaugeHtml, heatmapHtml } from '../control-src/widgets/_shared.js';
import { renderWidget } from '../control-src/widgets/_ssr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(join(ROOT, 'public', 'dashboard.css'), 'utf8');

const days = Array.from({ length: 7 * 18 }, (_, i) =>
  Math.max(0, Math.round(6 * Math.sin(i / 7) + (i % 5) + Math.random() * 3)));

// Reproduce the reported case: 2 all-day events, one long title, big card.
const calEvents = [
  { title: 'Independence Day (substitute holiday)', dayLabel: 'FRI', startLabel: 'all day', isAllDay: true },
  { title: 'Independence Day', dayLabel: 'SAT', startLabel: 'all day', isAllDay: true }
];
const calHtml = renderWidget('calendar', {
  events: calEvents, cellW: 26, cellH: 6,
  settings: { variant: 'trmnl', title: 'UPCOMING', icalUrls: ['demo'] }, variant: 'trmnl'
});

// Two more row-widgets, under-full + a long label, to check the shared fit
// ladder (clamp + tr-rows-fill) generalizes past calendar.
const wcHtml = renderWidget('world_clock', {
  now: Date.now(), cellW: 12, cellH: 6,
  settings: {
    variant: 'trmnl', title: 'WORLD CLOCK',
    zones: ['Tokyo Metropolitan Prefecture|Asia/Tokyo', 'NYC|America/New_York']
  }, variant: 'trmnl'
});
const otdHtml = renderWidget('onthisday', {
  cellW: 12, cellH: 6,
  onThisDay: { dateLabel: 'JUL 4', events: [
    { year: 1776, text: 'The United States Declaration of Independence is adopted by the Second Continental Congress in Philadelphia.' },
    { year: 1826, text: 'Thomas Jefferson and John Adams both die.' }
  ] },
  settings: { variant: 'trmnl' }, variant: 'trmnl'
});

const card = (title, body) => `<div style="border:2px solid #000;height:220px;display:flex;flex-direction:column">
  <div class="tr-titlebar"><span>${title}</span></div>
  <div class="tr-body" style="justify-content:center;align-items:center">${body}</div></div>`;

const html = `<!doctype html><html><head><meta charset="utf8"><style>${css}
  body{margin:0;background:#fff;width:820px}
  .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:12px}
  .rowgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 12px}
  .box{height:190px;border:2px solid #000}
</style></head><body>
  <div style="padding:12px"><div style="height:200px;border:2px solid #000">${calHtml}</div></div>
  <div class="rowgrid">
    <div class="box">${wcHtml}</div>
    <div class="box">${otdHtml}</div>
  </div>
  <div class="grid">
    ${card('GAUGE 42/300', gaugeHtml({ value: 42, max: 300, center: 42, label: 'GOOD' }))}
    ${card('GAUGE 168 RED', gaugeHtml({ value: 168, max: 300, center: 168, label: 'UNHEALTHY', red: true, size: 'lg' }))}
    ${card('GAUGE 78%', gaugeHtml({ value: 78, max: 100, center: '78%', label: 'HUMIDITY', size: 'sm' }))}
  </div>
  <div style="padding:0 12px 12px"><div style="border:2px solid #000;height:180px;display:flex;flex-direction:column">
    <div class="tr-titlebar"><span>CONTRIBUTION HEATMAP</span><span class="tr-meta">18 WK</span></div>
    <div class="tr-body">${heatmapHtml({ values: days, rows: 7 })}</div>
  </div></div>
</body></html>`;

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 820, height: 1120, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const out = join(ROOT, 'test', '_component-preview.png');
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);

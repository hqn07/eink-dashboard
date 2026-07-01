// One-off: compare divider styles (dashed vs dotted vs dither band) on the
// calendar TRMNL card. threshold(128) = panel sim.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { renderWidget } from '../control-src/widgets/_ssr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(join(ROOT, 'public', 'dashboard.css'), 'utf8');

const cal = () => renderWidget('calendar', {
  events: [
    { title: 'Coffee with Lia', dayLabel: 'MON', startLabel: '9:00 AM' },
    { title: 'Brand workshop', dayLabel: 'MON', startLabel: '12:30 PM' },
    { title: 'Dentist', dayLabel: 'WED', startLabel: '3:00 PM' }
  ], cellW: 12, cellH: 7, settings: { variant: 'trmnl', title: 'UPCOMING', icalUrls: ['d'] }, variant: 'trmnl'
});

// Divider-style overrides scoped per demo column.
const overrides = `
  /* DOTTED */
  .d-dotted :is(.tr-row,.tr-foot,.tr-cells,.tr-cell,.tr-stats,.tr-stat){border-style:dotted !important}
  .d-dotted .tr-titlebar{border-bottom-style:dotted !important}
  /* DITHER BAND: replace the hairline with a 3px checker strip */
  .d-dither :is(.tr-row,.tr-foot){border-bottom:none !important;position:relative}
  .d-dither :is(.tr-row,.tr-foot)::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:3px;
    background:#fff;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='2' shape-rendering='crispEdges'%3E%3Crect width='1' height='1' x='0' y='0'/%3E%3Crect width='1' height='1' x='1' y='1'/%3E%3C/svg%3E");background-size:2px 2px;image-rendering:pixelated}
  .d-dither .tr-titlebar{border-bottom:none;box-shadow:0 3px 0 -1px #000}
`;

const col = (label, cls) => `<div>
  <div style="font:600 12px var(--face-grotesk);margin:0 0 6px 2px">${label}</div>
  <div class="${cls}" style="width:360px;height:260px;border:2px solid #000">${cal()}</div></div>`;

const html = `<!doctype html><html><head><meta charset="utf8"><style>${css}${overrides}
  body{margin:0;background:#fff;width:1180px}.row{display:flex;gap:18px;padding:16px;flex-wrap:wrap}
</style></head><body><div class="row">
  ${col('DASHED (current)', 'd-dashed')}
  ${col('DOTTED', 'd-dotted')}
  ${col('DITHER BAND', 'd-dither')}
</div></body></html>`;

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1180, height: 340, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const buf = await page.screenshot();
await browser.close();
await sharp(buf).greyscale().threshold(128).toFile(join(ROOT, 'test', '_component-preview.png'));
console.log('wrote 1bit sim');

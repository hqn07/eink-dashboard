// One-off: eyeball components through the real face stylesheet + Chrome at
// panel scale (deviceScaleFactor 1). Not wired into npm scripts.
// Output: test/_component-preview.png
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer';
import { moonSvg, moonInfo } from '../control-src/widgets/moon.js';
import { renderWidget } from '../control-src/widgets/_ssr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(join(ROOT, 'public', 'dashboard.css'), 'utf8');

// Moon discs across the cycle (both limbs).
const phases = [
  ['NEW', 0.0, true], ['WAX CRESC', 0.25, true], ['FIRST Q', 0.5, true],
  ['WAX GIBB', 0.8, true], ['FULL', 0.99, true],
  ['WAN GIBB', 0.8, false], ['LAST Q', 0.5, false], ['WAN CRESC', 0.25, false]
];
const discRow = phases.map(([label, illum, wax]) =>
  `<div style="text-align:center;font-family:var(--face-grotesk);font-size:11px;font-weight:600">
     ${moonSvg(96, illum, wax)}<div style="margin-top:4px">${label}</div>
   </div>`).join('');

// Full-moon card through the widget (now = new-moon ref + half a synodic month).
const SYN = 29.530588853, REF = Date.UTC(2000, 0, 6, 18, 14, 0);
const fullNow = REF + SYN / 2 * 86400000;
const moonCard = renderWidget('moon', {
  now: fullNow, cellW: 12, cellH: 8, settings: { variant: 'trmnl' }, variant: 'trmnl'
});

const html = `<!doctype html><html><head><meta charset="utf8"><style>${css}
  body{margin:0;background:#fff;width:820px}
  .discs{display:flex;justify-content:space-around;flex-wrap:wrap;gap:12px;padding:16px}
</style></head><body>
  <div class="discs">${discRow}</div>
  <div style="padding:16px"><div style="height:320px;border:2px solid #000">${moonCard}</div></div>
</body></html>`;

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 820, height: 760, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const out = join(ROOT, 'test', '_component-preview.png');
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out, '| full illum =', Math.round(moonInfo(fullNow).illum * 100) + '%');

// One-off: code-activity heatmap — live hqn07 + dense demo. 1-bit sim.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { renderWidget } from '../control-src/widgets/_ssr.js';
import { DEMO_CODE_ACTIVITY } from '../control-src/widgets/_pool_demo.js';

const require = createRequire(import.meta.url);
const { fetchCodeActivity } = require('../widgets/codeactivity.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(join(ROOT, 'public', 'dashboard.css'), 'utf8');

const live = await fetchCodeActivity('hqn07');
const card = (data, cw, ch) => renderWidget('codeactivity', {
  codeActivity: data, cellW: cw, cellH: ch,
  settings: { variant: 'trmnl', username: data.user }, variant: 'trmnl'
});

const rows = [
  ['LIVE @hqn07 — 20×6', card(live, 20, 6)],
  ['DEMO (dense) — 20×6', card(DEMO_CODE_ACTIVITY, 20, 6)],
  ['DEMO — 14×5', card(DEMO_CODE_ACTIVITY, 14, 5)]
].map(([label, c], i) => {
  const px = [667, 667, 467][i];
  return `<div><div style="font:600 12px var(--face-grotesk);margin:0 0 6px 2px">${label}</div>
    <div style="width:${px}px;height:${i === 2 ? 200 : 240}px;border:2px solid #000">${c}</div></div>`;
}).join('');

const html = `<!doctype html><meta charset=utf8><style>${css}body{margin:0;background:#fff;width:720px}.w{display:flex;flex-direction:column;gap:16px;padding:16px}</style><div class=w>${rows}</div>`;

const b = await puppeteer.launch({ headless: 'new' });
const p = await b.newPage();
await p.setViewport({ width: 720, height: 820, deviceScaleFactor: 1 });
await p.setContent(html, { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
const buf = await p.screenshot();
await b.close();
await sharp(buf).greyscale().threshold(128).toFile(join(ROOT, 'test', '_component-preview.png'));
console.log('live total:', live && live.total, '| days:', live && live.days.length);

// One-off: moon narrow/wide + code-activity heatmap. 1-bit sim.
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
const SYN = 29.530588853, REF = Date.UTC(2000, 0, 6, 18, 14, 0);
const now = REF + 0.6 * SYN * 86400000;
const live = await fetchCodeActivity('hqn07');

const moon = (cw, ch) => renderWidget('moon', { now, cellW: cw, cellH: ch, settings: { variant: 'flow' }, variant: 'flow' });
const ca = (data, cw, ch) => renderWidget('codeactivity', { codeActivity: data, cellW: cw, cellH: ch, settings: { variant: 'trmnl', username: data.user }, variant: 'trmnl' });

const rows = [
  ['MOON narrow (±1) — 11×8', moon(11, 8), 380, 300],
  ['MOON wide (±3) — 20×8', moon(20, 8), 667, 300],
  ['CODE demo (dense) — 20×6', ca(DEMO_CODE_ACTIVITY, 20, 6), 667, 240],
  ['CODE live @hqn07 — 20×6', ca(live, 20, 6), 667, 240]
].map(([label, c, w, h]) => `<div><div style="font:600 12px var(--face-grotesk);margin:0 0 6px 2px">${label}</div>
  <div style="width:${w}px;height:${h}px;border:2px solid #000">${c}</div></div>`).join('');

const html = `<!doctype html><meta charset=utf8><style>${css}body{margin:0;background:#fff;width:720px}.w{display:flex;flex-direction:column;gap:16px;padding:16px}</style><div class=w>${rows}</div>`;
const b = await puppeteer.launch({ headless: 'new' });
const p = await b.newPage();
await p.setViewport({ width: 720, height: 1160, deviceScaleFactor: 1 });
await p.setContent(html, { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
const buf = await p.screenshot();
await b.close();
await sharp(buf).greyscale().threshold(128).toFile(join(ROOT, 'test', '_component-preview.png'));
console.log('ok');

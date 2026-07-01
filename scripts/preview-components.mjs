// One-off: compare moon strip approaches. threshold(128) = panel sim.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { moonInfo, moonSvg } from '../control-src/widgets/moon.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(join(ROOT, 'public', 'dashboard.css'), 'utf8');
const SYN = 29.530588853, REF = Date.UTC(2000, 0, 6, 18, 14, 0), DAY = 86400000;
const now = REF + 0.55 * SYN * DAY; // waning gibbous-ish

// A: current cover-flow (±1 day, rotateY) — for contrast.
function coverflow() {
  const per = 4, SC = 0.78, base = 96;
  let cells = '';
  for (let o = -per; o <= per; o++) {
    const mi = moonInfo(now + o * DAY);
    const sz = Math.max(28, Math.round(base * SC ** Math.abs(o)));
    const tf = o === 0 ? 'none' : `rotateY(${(o < 0 ? 1 : -1) * 46}deg)`;
    cells += `<div class="moon-flow-cell" style="transform:${tf};z-index:${per + 1 - Math.abs(o)}">${moonSvg(sz, mi.illum, mi.waxing)}</div>`;
  }
  return `<div class="moon-flow" style="gap:12px">${cells}</div>`;
}

// B: flat phase timeline — steps across the WHOLE cycle so each disc is a
// distinct phase; today centred + largest; graduated size; no 3-D.
function timeline() {
  const per = 4, SC = 0.82, base = 104;
  const step = (SYN / (2 * per)) * DAY; // span ≈ one full lunation
  let cells = '';
  for (let o = -per; o <= per; o++) {
    const mi = moonInfo(now + o * step);
    const sz = Math.max(30, Math.round(base * SC ** Math.abs(o)));
    cells += `<div style="flex:none;display:flex;align-items:center">${moonSvg(sz, mi.illum, mi.waxing)}</div>`;
  }
  return `<div style="display:flex;align-items:center;justify-content:center;gap:14px">${cells}</div>`;
}

const box = (label, inner) => `<div>
  <div style="font:600 12px var(--face-grotesk);margin:0 0 6px 2px">${label}</div>
  <div style="width:1120px;height:230px;border:2px solid #000;display:flex;align-items:center;justify-content:center;perspective:900px">${inner}</div></div>`;

const html = `<!doctype html><meta charset=utf8><style>${css}body{margin:0;background:#fff;width:1160px}.w{display:flex;flex-direction:column;gap:16px;padding:16px}</style>
<div class=w>${box('A — current cover-flow (±1 day + rotate)', coverflow())}${box('B — flat phase timeline (steps across the cycle)', timeline())}</div>`;

const b = await puppeteer.launch({ headless: 'new' });
const p = await b.newPage();
await p.setViewport({ width: 1160, height: 560, deviceScaleFactor: 1 });
await p.setContent(html, { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
const buf = await p.screenshot();
await b.close();
await sharp(buf).greyscale().threshold(128).toFile(join(ROOT, 'test', '_component-preview.png'));
console.log('ok');

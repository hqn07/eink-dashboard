// One-off: dither tone/texture swatch sheet. 1-bit sim.
// Renders every .face-tone-* tile as a labelled bar swatch through the real
// face CSS + Chrome, then the same contrast/threshold as lib/image.js
// rgbaToMono to fake the panel. Output: /tmp/dither-swatches.png
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(join(ROOT, 'public', 'dashboard.css'), 'utf8');

const tones = [
  'g15', 'g25', 'g37', 'g50', 'g62', 'g75', 'g87',
  'diag', 'hlines', 'vlines', 'cross', 'r25', 'r50', 'rdiag'
];

const rows = tones.map(t => `
  <div style="display:flex;align-items:center;gap:10px;margin:5px 0">
    <span style="font-family:monospace;font-size:12px;font-weight:700;width:70px;text-align:right">${t}</span>
    <div class="tr-bar" style="width:640px;height:22px">
      <div class="tr-bar-fill face-tone-${t}" style="width:65%"></div>
      <div class="tr-bar-track face-tone-g15"></div>
    </div>
  </div>`).join('');

const html = `<!doctype html><html><head><style>${css}</style></head>
<body style="margin:0;width:800px;height:480px;background:#fff;padding:6px 20px;box-sizing:border-box">
${rows}
</body></html>`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 480, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'domcontentloaded' });
const shot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 800, height: 480 } });
await browser.close();

await sharp(shot).greyscale().linear(1.6, -77).normalise().threshold(128)
  .png().toFile('/tmp/dither-swatches.png');
console.log('wrote /tmp/dither-swatches.png');

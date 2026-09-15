// Contact sheet of widgets as they actually render.
//
// Since the 2026-09-15 simplification the default IS the design — there are no
// per-tile cosmetics left to paper over a weak one — so the useful review is
// "look at every widget the way a new user gets it, side by side".
//
// Clips tiles out of /widgets-matrix rather than rendering each widget alone:
// the matrix is the page the visual-regression guard already trusts, its demo
// data is frozen, and its tiles go through the real SSR + autofit + inverted
// chrome. Rendering widgets standalone skipped autofit and produced nonsense.
//
// Usage:
//   node scripts/contact-sheet.mjs --port 3000 --out sheet.png \
//        [--ids a,b,c] [--token X] [--cols 2] [--per 1]
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const PORT = arg('port', '3000');
const OUT = arg('out', 'contact-sheet.png');
const TOKEN = arg('token', process.env.DEVICE_TOKEN || '');
const COLS = Number(arg('cols', 2));
const PER = Number(arg('per', 1));          // how many tiles per widget to sample
const ids = arg('ids', '').split(',').map(s => s.trim()).filter(Boolean);

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1200 });
const qs = new URLSearchParams({ demo: '1' });
if (TOKEN) qs.set('token', TOKEN);
await page.goto(`http://localhost:${PORT}/widgets-matrix?${qs}`, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);

// Widest tile per widget — the biggest one shows the most design decisions.
const boxes = await page.evaluate((wanted, per) => {
  const out = [];
  const byId = new Map();
  for (const el of document.querySelectorAll('.cell')) {
    const m = [...el.classList].find(c => c.startsWith('cell-') && c !== 'cell-inverted' && c !== 'cell-flush');
    if (!m) continue;
    const id = m.slice(5);
    if (wanted.length && !wanted.includes(id)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 30) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({ id, x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height });
  }
  for (const [, list] of byId) {
    list.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    out.push(...list.slice(0, per));
  }
  return out;
}, ids, PER);

const tiles = [];
for (const b of boxes) {
  const shot = await page.screenshot({
    clip: { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.w), height: Math.round(b.h) },
    captureBeyondViewport: true,
  });
  const label = Buffer.from(
    `<svg width="${Math.round(b.w)}" height="20"><rect width="100%" height="100%" fill="#fff"/>` +
    `<text x="4" y="15" font-family="monospace" font-size="12" fill="#000">${b.id} ${Math.round(b.w)}x${Math.round(b.h)}</text></svg>`
  );
  tiles.push({ id: b.id, w: Math.round(b.w), h: Math.round(b.h),
    buf: await sharp({ create: { width: Math.round(b.w), height: Math.round(b.h) + 20, channels: 3, background: '#fff' } })
      .composite([{ input: shot, top: 0, left: 0 }, { input: label, top: Math.round(b.h), left: 0 }])
      .png().toBuffer() });
}
await browser.close();

const cw = Math.max(...tiles.map(t => t.w)) + 8;
const ch = Math.max(...tiles.map(t => t.h)) + 28;
const rows = Math.ceil(tiles.length / COLS);
await sharp({ create: { width: COLS * cw, height: rows * ch, channels: 3, background: '#888' } })
  .composite(tiles.map((t, i) => ({ input: t.buf, left: (i % COLS) * cw + 4, top: Math.floor(i / COLS) * ch + 4 })))
  .png().toFile(OUT);
console.log(`sheet: ${OUT} (${tiles.length} tiles)`);

// Photo widget — server side. Takes a per-tile image (remote URL or an
// uploaded base64 data URI), Floyd–Steinberg dithers it to 1-bit at the
// tile's own pixel size (so the dot grid maps 1:1 to the panel, no CSS
// upscale blur), and returns a data: URI the render fn drops into an <img>.
//
// Dithering is async (sharp), so it runs here in buildWidgetData rather
// than in the sync render(ctx) template — same pattern as album art.

const { ditherImageToBase64 } = require('./_dither');
const { fetchWithTimeout } = require('./_fetch');

// Grid → pixel mapping (24×12 over the 800×480 panel). Cap the long edge
// so a full-bleed tile doesn't run FS over 384k px on every render; the
// panel is 1-bit so a modest cap is visually lossless.
const CELL_W = 800 / 24;   // ≈ 33.33
const CELL_H = 480 / 12;   // 40
const MAX_EDGE = 480;

function targetDims(item) {
  const cols = Number.isFinite(item && item.w) ? item.w : 8;
  const rows = Number.isFinite(item && item.h) ? item.h : 6;
  let w = Math.round(cols * CELL_W);
  let h = Math.round(rows * CELL_H);
  const longest = Math.max(w, h);
  if (longest > MAX_EDGE) {
    const k = MAX_EDGE / longest;
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

// Pull raw image bytes from either an uploaded data: URI or a remote URL.
// Returns a Buffer or null. Only http(s) is fetched; anything else is
// rejected so a stray file:// / data-of-wrong-type can't be dereferenced.
async function loadBytes(settings) {
  const data = typeof settings.imageData === 'string' ? settings.imageData.trim() : '';
  if (data.startsWith('data:')) {
    const comma = data.indexOf(',');
    if (comma < 0) return null;
    try { return Buffer.from(data.slice(comma + 1), 'base64'); } catch { return null; }
  }
  const url = typeof settings.imageUrl === 'string' ? settings.imageUrl.trim() : '';
  if (/^https?:\/\//i.test(url)) {
    try {
      const res = await fetchWithTimeout(url, {}, 5000);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > 100 ? buf : null;
    } catch { return null; }
  }
  return null;
}

// Returns { src } (a data:image/png;base64 dithered image) or null when the
// tile has no image configured or the fetch/dither failed.
async function fetchPhoto(settings, item) {
  const s = settings || {};
  const bytes = await loadBytes(s);
  if (!bytes) return null;
  const { w, h } = targetDims(item);
  const fit = s.fit === 'contain' ? 'contain' : 'cover';
  const b64 = await ditherImageToBase64(bytes, { width: w, height: h, fit });
  if (!b64) return null;
  return { src: `data:image/png;base64,${b64}`, w, h };
}

module.exports = { fetchPhoto, targetDims };

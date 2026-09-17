// 1-bit / 3-color image pipeline. Pure pixel transforms shared by the
// /display.* routes and the editor previews: RGBA PNG → tuned mono raster
// → MSB-first packed bytes (BW), plus the black/red plane split (3-color
// B panel) and a plane→PNG compositor for a panel-accurate editor preview.
//
// Extracted from server.js (was inline). No Express / cache / Puppeteer
// coupling here — callers own rendering and caching; this only crunches
// buffers. Dimensions are the fixed panel size (see CLAUDE.md: don't
// change 800×480 or the 48000-byte format).

const sharp = require('sharp');

const SCREEN_W = 800;
const SCREEN_H = 480;

// Contrast/threshold prep shared by the mono + plane paths so text
// anti-aliasing collapses to crisp 1-bit the same way everywhere.
function preThreshold(pipe) {
  return pipe.greyscale().linear(1.6, -77).normalise();
}

// Single sharp pipeline that produces (a) the raw 1-bit pixel plane and
// (b) a palette PNG. PNG + BIN derivations share this so we don't run
// the resize/contrast/threshold pipeline twice.
async function rgbaToMono(rgbaPng) {
  const { data, info } = await preThreshold(
    sharp(rgbaPng).resize(SCREEN_W, SCREEN_H, { fit: 'fill' })
  )
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const png = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 1 }
  }).png({ palette: true, colors: 2 }).toBuffer();
  return { rawMono: data, info, png };
}

// Pack 1-bit pixels into bytes, MSB-first, the way GxEPD2 expects.
// Returns SCREEN_W * SCREEN_H / 8 bytes. Works on the shared raw plane
// from rgbaToMono so threshold doesn't run twice.
function packMonoBin(rawMono, info) {
  const bytes = Buffer.alloc((info.width * info.height) / 8);
  // Process one byte (eight pixels) at a time. Threshold output is
  // already 0 or 255, so a simple `>= 128` check is equivalent to a
  // truthiness test on the high bit.
  for (let i = 0, j = 0; i < rawMono.length; i += 8, j++) {
    let b = 0;
    if (rawMono[i]     >= 128) b |= 0x80;
    if (rawMono[i + 1] >= 128) b |= 0x40;
    if (rawMono[i + 2] >= 128) b |= 0x20;
    if (rawMono[i + 3] >= 128) b |= 0x10;
    if (rawMono[i + 4] >= 128) b |= 0x08;
    if (rawMono[i + 5] >= 128) b |= 0x04;
    if (rawMono[i + 6] >= 128) b |= 0x02;
    if (rawMono[i + 7] >= 128) b |= 0x01;
    bytes[j] = b;
  }
  return bytes;
}

// ---------- 3-color (B/W/R) plane split ----------
// The Z08 panel takes two 1-bit planes: black (0=black,1=white) and red
// (0=red,1=white). We reuse the tuned mono pipeline for the black plane
// (so text AA stays crisp), then detect red pixels from the raw RGBA and
// carve them out of the black plane into the red plane. A pixel is red
// when it's strongly R-dominant — tuned to catch the CSS --face-red token
// without misfiring on dark/near-black text.
//
// The g/b ceiling was 110, which only fit the dark --face-red (#d32f2f). On
// an INVERTED tile that red thresholds to black against a black background
// and disappears, so dark cells now use a lighter red (#ff7a7a) that survives
// the mono pipeline as white — and that needs a higher ceiling to still be
// classified red here. Widening it cannot misfire on greys: an unsaturated
// pixel has r ≈ g ≈ b, so it fails the dominance test at any ceiling.
function isRedPixel(r, g, b) {
  return r > 140 && g < 130 && b < 130 && (r - Math.max(g, b)) > 45;
}

// Returns a 96000-byte buffer: black plane (48000) followed by red plane
// (48000), both MSB-first the way GxEPD2's 3-color writeImage expects.
async function rgbaToPlanes(rgbaPng) {
  const { rawMono, info } = await rgbaToMono(rgbaPng);
  const { data: rgba } = await sharp(rgbaPng)
    .resize(SCREEN_W, SCREEN_H, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const ch = rgba.length / n;            // 4 (RGBA)
  const blackRaw = Buffer.from(rawMono); // 0=black, 255=white (copy)
  const redRaw = Buffer.alloc(n, 255);   // default white (no red)
  for (let p = 0, q = 0; p < n; p++, q += ch) {
    if (isRedPixel(rgba[q], rgba[q + 1], rgba[q + 2])) {
      redRaw[p] = 0;        // this pixel is red
      blackRaw[p] = 255;    // and therefore not black
    }
  }
  return Buffer.concat([packMonoBin(blackRaw, info), packMonoBin(redRaw, info)]);
}

// Circular left-rotation of every row in a packed plane buffer, by `px`
// pixels. Compensates the B panel's hardware column offset: the physical
// panel maps RAM column 0 to a source line `px` columns in, so the whole
// image appears rotated right by `px` (rightmost strip wraps to the left
// edge). Pre-rotating the data left by the same amount cancels it out.
// Verified a class-swap doesn't fix it (GDEY075Z08 vs Z08 give the same
// shift — see firmware commits fc1066d / 542482d); it's a panel trait.
// Works on any whole number of 48000-byte planes (so both the 96000-byte
// 3-color pair and a single BW plane). Bit-accurate: px need not be a
// multiple of 8.
function shiftPlanesLeft(binPlanes, px) {
  const s = ((px % SCREEN_W) + SCREEN_W) % SCREEN_W;
  if (!s) return binPlanes;
  const rowBytes = SCREEN_W / 8;   // 100
  const B = s >> 3, b = s & 7;
  const out = Buffer.alloc(binPlanes.length);
  const planeBytes = rowBytes * SCREEN_H;
  for (let plane = 0; plane + planeBytes <= binPlanes.length; plane += planeBytes) {
    for (let y = 0; y < SCREEN_H; y++) {
      const row = plane + y * rowBytes;
      for (let i = 0; i < rowBytes; i++) {
        const j = row + ((i + B) % rowBytes);
        const k = row + ((i + B + 1) % rowBytes);
        out[row + i] = b === 0
          ? binPlanes[j]
          : ((binPlanes[j] << b) | (binPlanes[k] >> (8 - b))) & 0xFF;
      }
    }
  }
  return out;
}

// Composite the two planes into a true-color PNG for a panel-accurate
// editor preview: red plane wins (vermilion), else black plane (black),
// else white. This is exactly what the B panel paints, so the preview
// reflects the classifier — not the editor's CSS approximation.
async function planesToPng(bin3c) {
  const PLANE = (SCREEN_W * SCREEN_H) / 8;
  const black = bin3c.subarray(0, PLANE);
  const red = bin3c.subarray(PLANE, 2 * PLANE);
  const rgb = Buffer.alloc(SCREEN_W * SCREEN_H * 3);
  for (let p = 0; p < SCREEN_W * SCREEN_H; p++) {
    const byte = p >> 3, bit = 7 - (p & 7);
    const isBlack = !((black[byte] >> bit) & 1);
    const isRed = !((red[byte] >> bit) & 1);
    const o = p * 3;
    if (isRed) { rgb[o] = 0xd3; rgb[o + 1] = 0x2f; rgb[o + 2] = 0x2f; }
    else if (isBlack) { rgb[o] = rgb[o + 1] = rgb[o + 2] = 0; }
    else { rgb[o] = rgb[o + 1] = rgb[o + 2] = 255; }
  }
  return sharp(rgb, { raw: { width: SCREEN_W, height: SCREEN_H, channels: 3 } })
    .png().toBuffer();
}

module.exports = {
  SCREEN_W, SCREEN_H,
  preThreshold, rgbaToMono, packMonoBin,
  isRedPixel, rgbaToPlanes, planesToPng, shiftPlanesLeft
};

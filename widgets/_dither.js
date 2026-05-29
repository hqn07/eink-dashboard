// widgets/_dither.js
// Shared image-dithering helpers for widgets that want greyscale
// photos to render as 1-bit Floyd-Steinberg instead of a hard
// threshold. Threshold flattens any greyscale to pure black/white at
// 128, which obliterates photo content; FS dither preserves shading
// by error-diffusing the quantization residual into neighbouring
// pixels, producing the stippled look e-ink panels can actually show.
//
// Callers pass a buffer of arbitrary image bytes (jpeg/png/etc.) plus
// a target square size. We greyscale + resize via sharp, run FS in
// JS, and emit a base64-encoded 1-bit PNG suitable for inlining as a
// data: URI in dashboard HTML.

const sharp = require('sharp');

// Run Floyd-Steinberg over a buffer of bytes already in 8-bit
// greyscale. `data` is read-only; we allocate Int16 working storage
// so error terms can go below zero. Returns a Buffer of 0x00 / 0xFF
// bytes the same length.
function floydSteinberg(data, w, h) {
  const buf = new Int16Array(w * h);
  for (let i = 0; i < buf.length; i++) buf[i] = data[i];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const oldVal = buf[i];
      const newVal = oldVal < 128 ? 0 : 255;
      buf[i] = newVal;
      const err = oldVal - newVal;
      if (x + 1 < w)         buf[i + 1] += (err * 7) >> 4;
      if (y + 1 < h) {
        if (x - 1 >= 0)      buf[i + w - 1] += (err * 3) >> 4;
                             buf[i + w]     += (err * 5) >> 4;
        if (x + 1 < w)       buf[i + w + 1] += (err * 1) >> 4;
      }
    }
  }
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] > 127 ? 255 : 0;
  }
  return out;
}

// Dither a raster image buffer into a 1-bit PNG, base64-encoded.
// `size` controls the output edge length in pixels (square). `fit`
// follows sharp's resize options ('cover', 'contain', 'inside').
//
// Returns the base64 string ready to drop into a `data:image/png;base64,...`
// URI, or null on failure.
async function ditherImageToBase64(rawBuf, { size = 320, fit = 'cover' } = {}) {
  try {
    const { data, info } = await sharp(rawBuf)
      .resize(size, size, { fit })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    const out = floydSteinberg(data, w, h);
    const png = await sharp(out, {
      raw: { width: w, height: h, channels: 1 }
    }).png({ compressionLevel: 9 }).toBuffer();
    return png.toString('base64');
  } catch (_) {
    return null;
  }
}

module.exports = { floydSteinberg, ditherImageToBase64 };

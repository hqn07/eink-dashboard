// Client-side dither preview for the photo settings modal. Mirrors the
// server pipeline (widgets/_dither.js ditherPhotoToBase64) closely enough
// to preview brightness/contrast/algorithm changes instantly, without a
// panel round-trip. Not byte-identical to sharp (canvas greyscale + a
// simple min/max normalize vs sharp's percentile), but visually faithful.
//
// Uploaded images (data: URIs) always work. Remote URLs may taint the
// canvas (no CORS headers) so getImageData throws — the caller shows a
// "preview unavailable" note in that case.

function greyNormalize(data, n) {
  // Luma + track min/max for a histogram stretch.
  const g = new Float32Array(n);
  let min = 255, max = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const y = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    g[i] = y;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const span = (max - min) || 1;
  for (let i = 0; i < n; i++) g[i] = ((g[i] - min) / span) * 255;
  return g;
}

function applyTone(g, n, { gamma, brightness, contrast }) {
  const mul = 1 + Math.max(-100, Math.min(100, contrast)) / 100;
  // 0.7 (not the server's 1.28): canvas linear space + our softened gamma
  // make brightness read stronger here, so scale it down to track the panel.
  const off = Math.max(-100, Math.min(100, brightness)) * 0.7;
  // Sharp's .gamma() lifts midtones far more gently than a naive
  // out=in^(1/g). Soften our exponent to match its observed effect so the
  // preview's baseline brightness tracks the panel.
  const gc = Math.max(1, Math.min(3, gamma));
  const invG = 1 / (1 + (gc - 1) * 0.5);
  for (let i = 0; i < n; i++) {
    let v = 255 * Math.pow(g[i] / 255, invG); // gamma lift (matches sharp g>1)
    v = mul * v + off;                          // linear contrast/brightness
    g[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
}

function ditherInPlace(g, w, h, algorithm) {
  const buf = Float32Array.from(g);
  const push = (i, e) => { buf[i] += e; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const oldV = buf[i];
      const newV = oldV < 128 ? 0 : 255;
      buf[i] = newV;
      if (algorithm === 'threshold') continue;
      const err = oldV - newV;
      if (algorithm === 'atkinson') {
        const e = err / 8;
        if (x + 1 < w) push(i + 1, e);
        if (x + 2 < w) push(i + 2, e);
        if (y + 1 < h) {
          if (x - 1 >= 0) push(i + w - 1, e);
          push(i + w, e);
          if (x + 1 < w) push(i + w + 1, e);
        }
        if (y + 2 < h) push(i + 2 * w, e);
      } else { // floyd-steinberg
        if (x + 1 < w) push(i + 1, (err * 7) / 16);
        if (y + 1 < h) {
          if (x - 1 >= 0) push(i + w - 1, (err * 3) / 16);
          push(i + w, (err * 5) / 16);
          if (x + 1 < w) push(i + w + 1, (err * 1) / 16);
        }
      }
    }
  }
  for (let i = 0; i < g.length; i++) g[i] = buf[i] > 127 ? 255 : 0;
}

// Load an image src and draw a dithered preview into `canvas`. opts:
// { algorithm, brightness, contrast, gamma, fit }. Returns a promise that
// resolves true on success, false if the source couldn't be read (taint /
// decode failure) so the caller can show a fallback.
export function renderDitherPreview(canvas, src, opts = {}) {
  return new Promise((resolve) => {
    if (!src) { resolve(false); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = canvas.width, h = canvas.height;
        const ctx = canvas.getContext('2d');
        const fit = opts.fit === 'contain' ? 'contain' : 'cover';
        // Cover/contain the source into the canvas box.
        const ar = img.width / img.height, cr = w / h;
        let dw, dh;
        if ((fit === 'cover') === (ar > cr)) { dh = h; dw = h * ar; }
        else { dw = w; dh = w / ar; }
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        const id = ctx.getImageData(0, 0, w, h);
        const n = w * h;
        const g = greyNormalize(id.data, n);
        applyTone(g, n, {
          gamma: Number.isFinite(opts.gamma) ? opts.gamma : 1.35,
          brightness: Number.isFinite(opts.brightness) ? opts.brightness : 0,
          contrast: Number.isFinite(opts.contrast) ? opts.contrast : 0
        });
        ditherInPlace(g, w, h, opts.algorithm || 'atkinson');
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          id.data[o] = id.data[o + 1] = id.data[o + 2] = g[i];
          id.data[o + 3] = 255;
        }
        ctx.putImageData(id, 0, 0);
        resolve(true);
      } catch {
        resolve(false); // tainted canvas (CORS) or decode issue
      }
    };
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

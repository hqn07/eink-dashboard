import { escapeHtml, pickTier, placeholder } from './_shared.js';
import QRCode from 'qrcode';

// QR — encodes a link (or any text) into a black/white QR matrix. Zero
// fetch, zero key: everything is computed from settings, which is ideal
// for e-ink (crisp 1-bit, thresholds perfectly). Uses the already-bundled
// `qrcode` package's synchronous `create()` so render() stays sync.
//
// Contract v2 variants —
//   caption — QR + caption text below (default)
//   code    — QR only, centered, no caption
//
// A 4-module quiet zone is baked into the SVG (QR spec) so the code stays
// scannable even when the tile background bleeds to its edge.

export const def = {
  id: 'qr',
  label: 'QR Code',
  minSize: { w: 4, h: 4 },
  sizes: {
    S: { w: 4, h: 4 },
    M: { w: 6, h: 6 },
    L: { w: 8, h: 8 }
  },
  defaultSize: 'M',
  variants: {
    caption: { label: 'Caption — QR + label' },
    code:    { label: 'Code only' }
  },
  defaultVariant: 'caption',
  degrade: {
    tiny: ['caption', 'title']
  },
  defaults: () => ({
    variant: 'caption',
    mode: 'url',         // 'url' = encode `data`; 'wifi' = build WIFI: payload
    data: '',            // URL or text to encode (mode=url)
    ssid: '',            // mode=wifi
    password: '',        // mode=wifi
    auth: 'WPA',         // mode=wifi: WPA / WEP / nopass
    hidden: false,       // mode=wifi: hidden network
    level: 'M',          // L / M / Q / H error-correction
    caption: '',         // shown under the code
    title: '',           // optional tile heading
  })
};

const QUIET = 4;   // quiet-zone modules per QR spec

// Escape the special chars (\ ; , : ") in a WIFI: field per the de-facto
// spec used by iOS/Android camera apps.
function wifiEscape(s) {
  return String(s || '').replace(/([\\;,:"])/g, '\\$1');
}

// Build the WIFI: join payload. nopass networks omit the P field.
function wifiPayload(s) {
  const auth = ['WPA', 'WEP', 'nopass'].includes(s.auth) ? s.auth : 'WPA';
  const ssid = wifiEscape(s.ssid);
  const pass = auth === 'nopass' ? '' : `P:${wifiEscape(s.password)};`;
  const hidden = s.hidden ? 'H:true;' : '';
  return `WIFI:T:${auth};S:${ssid};${pass}${hidden};`;
}

// Resolve the string to encode from settings + mode. Returns '' when the
// required fields are blank so render() can show the placeholder.
function encodedFor(s) {
  if (s.mode === 'wifi') {
    return (s.ssid && String(s.ssid).trim()) ? wifiPayload(s) : '';
  }
  return (typeof s.data === 'string' ? s.data : '').trim();
}

// Build a square SVG from the QR module matrix. One <rect> per dark
// module under a white backing rect; crispEdges keeps it sharp at any
// scale and threshold-clean for the 1-bit pipeline.
function buildSvg(data, level) {
  const qr = QRCode.create(data, { errorCorrectionLevel: level });
  const n = qr.modules.size;
  const d = qr.modules.data;
  const dim = n + QUIET * 2;
  let rects = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (d[y * n + x]) {
        rects += `<rect x="${x + QUIET}" y="${y + QUIET}" width="1" height="1"/>`;
      }
    }
  }
  return `<svg class="qr-svg" viewBox="0 0 ${dim} ${dim}" `
    + `preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" `
    + `xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="${dim}" height="${dim}" fill="#fff"/>`
    + `<g fill="#000">${rects}</g></svg>`;
}

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const data = encodedFor(s);
  if (!data) {
    const hint = s.mode === 'wifi' ? 'Add a network' : 'Add a link';
    return placeholder('QR', hint, 'msg', { cellW, cellH });
  }
  const level = ['L', 'M', 'Q', 'H'].includes(s.level) ? s.level : 'M';

  let svg;
  try {
    svg = buildSvg(data, level);
  } catch (e) {
    // create() throws when the text exceeds the largest version's capacity.
    return placeholder('QR', 'Text too long', 'msg', { cellW, cellH });
  }

  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'caption');
  const tier = pickTier(cellW || 0, cellH || 0, density);

  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : '';
  const title = (titleLabel && tier !== 'tiny')
    ? `<div class="col-title">${escapeHtml(titleLabel)}</div>` : '';
  const caption = (variant !== 'code' && tier !== 'tiny'
    && s.caption && s.caption.trim())
    ? `<div class="qr-caption">${escapeHtml(s.caption.trim())}</div>` : '';

  return `
    <div class="qr qr-${variant}">
      ${title}
      <div class="qr-code">${svg}</div>
      ${caption}
    </div>
  `;
}

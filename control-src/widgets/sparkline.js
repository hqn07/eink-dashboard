import { escapeHtml, pickTier, placeholder, semRed } from './_shared.js';

// Sparkline — a compact trend line over a rolling numeric series. First
// source is the e-ink battery history the server accumulates on every
// push (ctx.batteryHistory = [{ pct, v, at }] oldest→newest). Zero extra
// fetch. Stroke uses vector-effect:non-scaling-stroke so it stays a crisp
// ≥2px line under the non-uniform viewBox stretch (1-bit safe).
//
// Variants:
//   line    — trend line + current value (default)
//   dots    — line with a marker on the latest point
//   minimal — line + big current value only

export const def = {
  id: 'sparkline',
  label: 'Sparkline',
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 6, h: 3 },
    M: { w: 8, h: 4 },
    L: { w: 12, h: 5 }
  },
  defaultSize: 'M',
  variants: {
    line:    { label: 'Line — trend + value' },
    dots:    { label: 'Dots — mark latest point' },
    minimal: { label: 'Minimal — line + value' }
  },
  defaultVariant: 'line',
  degrade: {
    tiny: ['title', 'minmax']
  },
  defaults: () => ({
    variant: 'line',
    source: 'battery_pct',   // battery_pct | battery_v
    title: '',
    fontScale: 1,
    padding: 14,
    semanticRed: true
  })
};

const SOURCES = {
  battery_pct: { label: 'BATTERY', unit: '%', key: 'pct', lowAt: 20, dp: 0 },
  battery_v:   { label: 'VOLTAGE', unit: 'V', key: 'v',  lowAt: 3.4, dp: 2 }
};

// Build the SVG path(s) from values. viewBox is arbitrary (0..100 × 0..H);
// preserveAspectRatio=none stretches to the cell, vector-effect keeps the
// stroke uniform. Exported so other widgets (eink_battery's trend variant)
// can reuse the same crisp line. Returns the SVG string.
export function sparkSvg(values, dot) {
  const W = 100, H = 32, pad = 3;
  const n = values.length;
  const min = Math.min(...values), max = Math.max(...values);
  const span = (max - min) || 1;
  const innerH = H - pad * 2;
  const pts = values.map((v, i) => {
    const x = n === 1 ? W / 2 : (i / (n - 1)) * W;
    const y = pad + innerH - ((v - min) / span) * innerH;
    return [x, y];
  });
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const marker = dot
    ? `<circle class="spark-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.2" vector-effect="non-scaling-stroke"/>`
    : '';
  return `<svg class="spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" `
    + `xmlns="http://www.w3.org/2000/svg">`
    + `<path class="spark-line" d="${d}" fill="none" vector-effect="non-scaling-stroke"/>`
    + `${marker}</svg>`;
}

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const src = SOURCES[s.source] || SOURCES.battery_pct;
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : src.label;

  const hist = Array.isArray(ctx.batteryHistory) ? ctx.batteryHistory : [];
  const values = hist
    .map(p => (p && Number.isFinite(p[src.key])) ? p[src.key] : null)
    .filter(v => v !== null);

  if (values.length < 2) {
    return placeholder(titleLabel.split(/\s+/)[0] || 'TREND', 'Collecting data…', 'msg', { cellW, cellH });
  }

  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'line');
  const tier = pickTier(cellW || 0, cellH || 0, density);
  const cur = values[values.length - 1];
  const min = Math.min(...values), max = Math.max(...values);
  const fmt = (v) => v.toFixed(src.dp);

  // Semantic auto-red: latest reading at/below the low threshold.
  const red = semRed(s, cur <= src.lowAt);
  const svg = sparkSvg(values, variant === 'dots');

  const value = `<span class="spark-value">${fmt(cur)}</span><span class="spark-unit">${src.unit}</span>`;
  const head = (variant !== 'minimal' && tier !== 'tiny')
    ? `<div class="spark-head"><span class="col-title">${escapeHtml(titleLabel)}</span><span class="spark-cur">${value}</span></div>`
    : `<div class="spark-head"><span class="spark-cur">${value}</span></div>`;
  const foot = (variant !== 'minimal' && tier !== 'tiny')
    ? `<div class="spark-foot"><span>${fmt(min)}${src.unit}</span><span>${fmt(max)}${src.unit}</span></div>`
    : '';

  return `
    <div class="spark spark-${variant}${red}">
      ${head}
      <div class="spark-chart">${svg}</div>
      ${foot}
    </div>
  `;
}

import { escapeHtml, pickTier, placeholder, semRed } from './_shared.js';
// niceDomain is defined below and used by render(); kept in this module so
// eink_battery can import the same domain logic.

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
  label: 'Trend',
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 6, h: 3 },
    M: { w: 8, h: 4 },
    L: { w: 12, h: 5 }
  },
  defaultSize: 'M',
  variants: {
    trmnl:   { label: 'TRMNL — title-bar card' },
    line:    { label: 'Line — trend + value' },
    dots:    { label: 'Dots — mark latest point' },
    minimal: { label: 'Minimal — line + value' }
  },
  defaultVariant: 'trmnl',
  degrade: {
    tiny: ['title', 'minmax']
  },
  defaults: () => ({
    variant: 'trmnl',
    source: 'battery_pct',   // battery_pct | battery_v
    title: '',
    fontScale: 1,
    padding: 14,
    semanticRed: true
  })
};

const SOURCES = {
  // minSpan/lo/hi shape the y-domain so flat data reads as flat.
  // `weather` sources chart ctx.weather.hourly; the rest chart batteryHistory.
  battery_pct:    { label: 'BATTERY', unit: '%', key: 'pct',    lowAt: 20,  dp: 0, minSpan: 20,  lo: 0, hi: 100 },
  battery_v:      { label: 'VOLTAGE', unit: 'V', key: 'v',      lowAt: 3.4, dp: 2, minSpan: 0.4, lo: 3.0, hi: 4.3 },
  weather_temp:   { label: 'TEMPERATURE', unit: '°', key: 'temp',   dp: 0, minSpan: 6,  weather: true },
  weather_precip: { label: 'PRECIPITATION', unit: '%', key: 'precip', dp: 0, minSpan: 20, lo: 0, hi: 100, weather: true }
};

// Pick a sensible y-domain so a nearly-flat series (e.g. battery sitting at
// 99–100%) doesn't get min/max-stretched into a fake seismograph. Enforces a
// minimum span and clamps to [lo, hi], shifting the window to keep the data
// inside. Without this, span = max-min = 1 makes a 1-point wiggle fill the
// whole chart. Exported so callers compute it per source (% vs volts).
export function niceDomain(values, minSpan, lo, hi) {
  let dmin = Math.min(...values), dmax = Math.max(...values);
  if (dmax - dmin < minSpan) {
    const mid = (dmin + dmax) / 2;
    dmin = mid - minSpan / 2;
    dmax = mid + minSpan / 2;
  }
  if (hi != null && dmax > hi) { dmin -= (dmax - hi); dmax = hi; }
  if (lo != null && dmin < lo) { dmax += (lo - dmin); dmin = lo; if (hi != null && dmax > hi) dmax = hi; }
  return { min: dmin, max: dmax };
}

// Build the SVG path(s) from values. viewBox is arbitrary (0..100 × 0..H);
// preserveAspectRatio=none stretches to the cell, vector-effect keeps the
// stroke uniform. `domain` ({min,max}) fixes the y-scale; defaults to data
// min/max for backward compatibility. Exported so other widgets
// (eink_battery's trend variant) can reuse the same crisp line.
export function sparkSvg(values, dot, domain) {
  const W = 100, H = 32, pad = 3;
  const n = values.length;
  const min = domain ? domain.min : Math.min(...values);
  const max = domain ? domain.max : Math.max(...values);
  const span = (max - min) || 1;
  const innerH = H - pad * 2;
  const pts = values.map((v, i) => {
    const x = n === 1 ? W / 2 : (i / (n - 1)) * W;
    const frac = Math.max(0, Math.min(1, (v - min) / span)); // clamp outliers
    const y = pad + innerH - frac * innerH;
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

  // Weather sources chart the coming hours (ctx.weather.hourly); battery
  // sources chart the rolling push history (ctx.batteryHistory).
  const rawSeries = src.weather
    ? ((ctx.weather && Array.isArray(ctx.weather.hourly)) ? ctx.weather.hourly : [])
    : (Array.isArray(ctx.batteryHistory) ? ctx.batteryHistory : []);
  const values = rawSeries
    .map(p => (p && Number.isFinite(p[src.key])) ? p[src.key] : null)
    .filter(v => v !== null);

  if (values.length < 2) {
    const hint = src.weather ? 'Set a location' : 'Collecting data…';
    return placeholder(titleLabel.split(/\s+/)[0] || 'TREND', hint, 'msg', { cellW, cellH });
  }

  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'line');
  const tier = pickTier(cellW || 0, cellH || 0, density);
  const cur = values[values.length - 1];
  const min = Math.min(...values), max = Math.max(...values);
  const fmt = (v) => v.toFixed(src.dp);

  // Semantic auto-red: latest reading at/below the low threshold.
  const red = semRed(s, cur <= src.lowAt);
  const domain = niceDomain(values, src.minSpan, src.lo, src.hi);
  const svg = sparkSvg(values, variant === 'dots', domain);

  if (variant === 'trmnl') {
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${fmt(min)}–${fmt(max)}${src.unit}</span></div>
      <div class="tr-body" style="gap:8px">
        <div class="tr-lv tr-lv-md"><div class="tr-v">${fmt(cur)}<span class="tr-deg">${src.unit}</span></div></div>
        <div class="spark-chart" style="flex:1;min-height:0">${svg}</div>
      </div>
    </div>`;
  }

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

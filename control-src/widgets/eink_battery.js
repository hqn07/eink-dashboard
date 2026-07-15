// E-Ink panel battery — shows the LiPo state-of-charge for the device
// running this dashboard. The ESP32 POSTs voltage + percent to
// /api/battery at the start of every refresh cycle; the server persists
// to data/battery.json and injects it as `battery` on the render
// payload. No fetcher needed — purely a display widget.
//
// Contract v2 (widgets-refresh W2): variants —
//   gauge   — stacked readout: title, percent, volts, bar, age
//   inline  — one row: title · bar · percent; for short strip tiles
//   minimal — centered percent only
// Tier gates the gauge extras so a 4×2 tile stops rendering five
// stacked lines into 80px.

import { escapeHtml, placeholder, semRed } from './_shared.js';
import { sparkSvg, niceDomain } from './sparkline.js';

export const def = {
  id: 'eink_battery',
  label: 'Display Battery',
  requires: 'battery',
  minSize: { w: 3, h: 2 },
  sizes: {
    S: { w: 4, h: 2 },
    M: { w: 6, h: 3 },
    L: { w: 8, h: 4 }
  },
  defaultSize: 'S',
  variants: {
    trmnl:   { label: 'TRMNL — card + dithered bar' },
    gauge:   { label: 'Gauge — percent + volts + bar + age' },
    trend:   { label: 'Trend — percent + history sparkline' },
    inline:  { label: 'Inline — one-row strip' },
    minimal: { label: 'Minimal — percent only' }
  },
  defaultVariant: 'trmnl',
  // Gauge drops downward as the tile shrinks. Battery presets all live
  // in the tiny/compact tier band (even L 8×4 is compact), so the
  // render gates on grid rows directly: ≤2 rows ≈ tiny, 3 ≈ compact.
  // Inline and minimal render the same at every size by design.
  degrade: {
    compact: ['volts', 'age'],
    tiny:    ['title', 'volts', 'age']
  },
  defaults: () => ({
    variant: 'trmnl',
    title: '',
    showVoltage: true,
    showAge:     true,
    showBar:     true,
    fontScale: 1,
    padding: 14
  })
};

// Friendly relative age: "2m", "3h", "1d", "5d". Returns null when the
// battery payload has no timestamp.
// Least-squares slope over the rolling history (~2 days) → days until
// empty at the current discharge rate. null when charging, flat, or too
// few points to trust.
function daysLeftEstimate(hist) {
  const pts = (Array.isArray(hist) ? hist : [])
    .filter(p => p && Number.isFinite(p.pct) && Number.isFinite(p.at));
  if (pts.length < 6) return null;
  const t0 = pts[0].at;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) {
    const x = (p.at - t0) / 86400000;
    sx += x; sy += p.pct; sxx += x * x; sxy += x * p.pct;
  }
  const n = pts.length;
  const denom = n * sxx - sx * sx;
  if (!denom) return null;
  const slope = (n * sxy - sx * sy) / denom; // pct per day
  if (slope >= -0.5) return null;            // charging or ~flat
  const days = pts[n - 1].pct / -slope;
  return (Number.isFinite(days) && days > 0 && days <= 365) ? days : null;
}

function ageLabel(at) {
  if (!Number.isFinite(at)) return null;
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function render(ctx) {
  const { battery, settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'E-INK BATTERY';
  if (!battery || !Number.isFinite(battery.pct)) {
    return placeholder(titleLabel.split(/\s+/)[0] || 'BATTERY', 'No data', 'msg', { cellW, cellH }, 'nodata');
  }
  const variant = ctx.variant
    || (def.variants[s.variant] ? s.variant : 'gauge');
  const pct = Math.max(0, Math.min(100, battery.pct));
  const v = Number.isFinite(battery.v) ? battery.v.toFixed(2) : null;

  // Battery bar — single rectangle clipped by an inner fill width =
  // pct%. Threshold-safe at 1-bit; the outline stays crisp because
  // it's a solid stroke at >= 2 px.
  // Floor the fill at 3% so 0-2% still renders a visible sliver — a
  // truly empty bar reads as "no data" rather than "empty battery".
  const fillPct = pct > 0 && pct < 3 ? 3 : pct;
  const bar = (s.showBar !== false) ? `
    <div class="eink-batt-bar">
      <div class="eink-batt-bar-fill" style="width:${fillPct}%"></div>
      <div class="eink-batt-bar-tip"></div>
    </div>` : '';

  // Lightning glyph appears when voltage is above the TP4056 charge
  // threshold (~4.10V). Solid black SVG for threshold + invert safety,
  // same approach as mac_battery's charging indicator.
  const charging = Number.isFinite(battery.v) && battery.v > 4.10;
  const bolt = charging
    ? '<svg class="eink-batt-bolt" viewBox="0 0 24 24" width="0.7em" height="0.7em" aria-hidden="true"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="#000"/></svg>'
    : '';
  // Semantic auto-red: low charge (<20%) and not on the charger.
  const low = semRed(s, pct < 20 && !charging);
  const pctBlock = `<div class="eink-batt-pct autofit${low}" data-min-font="22">${pct}%${bolt}</div>`;
  const title = `<div class="col-title">${escapeHtml(titleLabel)}</div>`;

  if (variant === 'trmnl') {
    // TRMNL card: percent + voltage label/values over a dithered progress
    // bar (image-1 style), with a status/updated stat row on taller tiles.
    const status = charging ? 'Charging' : (pct < 20 ? 'Low' : 'OK');
    const fillTone = low ? 'face-tone-r50' : 'face-tone-g50';
    const ageA = ageLabel(battery.at);
    const barRow = (cellH || 0) >= 3
      ? `<div class="tr-bar" style="height:26px;flex:none">
           <div class="tr-bar-fill ${fillTone}" style="width:${fillPct}%"></div>
           <div class="tr-bar-track face-tone-g15"></div>
         </div>` : '';
    const stats = (cellH || 0) >= 6
      ? `<div class="tr-stats">
           <div class="tr-stat"><div class="tr-sv">${status}</div><div class="tr-sl">Status</div></div>
           ${ageA ? `<div class="tr-stat"><div class="tr-sv">${escapeHtml(ageA.replace(' ago', ''))}</div><div class="tr-sl">Updated</div></div>` : ''}
         </div>` : '';
    return `<div class="tr-card${low}">
      <div class="tr-titlebar"><span>Battery</span><span class="tr-meta${low}">${charging ? 'charging' : status.toLowerCase()}</span></div>
      <div class="tr-body" style="gap:10px">
        <div style="display:flex;align-items:flex-end;gap:18px">
          <div class="tr-lv tr-lv-md"><div class="tr-v">${pct}<span class="tr-deg">%</span></div><div class="tr-l">Charge</div></div>
          ${v ? `<div class="tr-lv tr-lv-sm"><div class="tr-v">${v}<span style="font-size:0.5em">V</span></div><div class="tr-l">Voltage</div></div>` : ''}
        </div>
        ${barRow}
      </div>
      ${stats}
    </div>`;
  }

  if (variant === 'minimal') {
    return `<div class="eink-batt eink-batt-minimal">${pctBlock}</div>`;
  }

  if (variant === 'inline') {
    // Title needs ~8 grid cols beside the bar + percent; narrower
    // strips keep just the bar + percent.
    const wideEnough = (cellW || 0) >= 8;
    return `
      <div class="eink-batt eink-batt-inline">
        ${wideEnough ? title : ''}
        ${bar}
        ${pctBlock}
      </div>
    `;
  }

  if (variant === 'trend') {
    // Current readout + a discharge sparkline from the rolling history
    // the server accumulates (ctx.batteryHistory). Falls back to the bar
    // until there are at least two points to draw a line from.
    const hist = Array.isArray(ctx.batteryHistory) ? ctx.batteryHistory : [];
    const series = hist.map(p => (p && Number.isFinite(p.pct)) ? p.pct : null)
      .filter(x => x !== null);
    const chart = series.length >= 2
      ? `<div class="eink-batt-trend-chart${low}">${sparkSvg(series, false, niceDomain(series, 20, 0, 100))}</div>`
      : bar;
    const eta = daysLeftEstimate(hist);
    const etaHtml = eta != null
      ? `<div class="eink-batt-eta${semRed(s, eta <= 3)}">≈ ${eta < 1 ? '<1' : Math.round(eta)}d left</div>`
      : '';
    return `
      <div class="eink-batt eink-batt-trend">
        <div class="eink-batt-trend-head">
          ${(cellH || 0) >= 3 ? title : ''}
          ${pctBlock}
        </div>
        ${chart}
        ${etaHtml}
      </div>
    `;
  }

  // gauge — row height drops elements from the bottom of the stack up:
  // 2 rows keeps percent + bar, 3 adds the title, 4+ adds volts + age.
  const ch = cellH || 0;
  const showTitle = ch >= 3;
  const showVolts = ch >= 4 && s.showVoltage !== false && v;
  const age = (ch >= 4 && s.showAge !== false) ? ageLabel(battery.at) : null;
  return `
    <div class="eink-batt">
      ${showTitle ? title : ''}
      ${pctBlock}
      ${showVolts ? `<div class="eink-batt-volts">${v} V</div>` : ''}
      ${bar}
      ${age ? `<div class="eink-batt-age">UPDATED ${escapeHtml(age)}</div>` : ''}
    </div>
  `;
}

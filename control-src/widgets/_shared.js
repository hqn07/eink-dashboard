// Shared primitives for per-widget modules under control-src/widgets/.
// Each widget lives in a `<id>.js` (def + render) + `<id>.form.jsx`
// (React form) pair and imports any cross-widget helpers from here.
// Kept React-free so server.js can pull this in via the Node ESM import
// path without dragging JSX into the import graph.

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Format seconds as M:SS — used by the Now Playing progress display.
export function fmtSec(s) {
  if (!Number.isFinite(s) || s < 0) return '--:--';
  const m = Math.floor(s / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${ss}`;
}

// Semantic font-family keys → CSS stacks. Keep in sync with the
// mirror table in public/dashboard.html.
export const FONT_STACKS = {
  serif:  "'DM Serif Display', Georgia, 'Iowan Old Style', serif",
  sans:   "'Oswald', 'Arial Narrow', sans-serif",
  mono:   "'JetBrains Mono', ui-monospace, monospace",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif"
};

// Per-widget placeholder glyphs. Chunky strokes survive 1-bit threshold.
export const PLACEHOLDER_ICONS = {
  weather:  '<img src="/static/icons/sevesalm/cloudy.svg" width="64" height="64" alt="" />',
  calendar: '<svg viewBox="0 0 64 64"><rect x="8" y="14" width="48" height="42" fill="none" stroke="#000" stroke-width="4"/><line x1="8" y1="24" x2="56" y2="24" stroke="#000" stroke-width="4"/><line x1="20" y1="8" x2="20" y2="20" stroke="#000" stroke-width="4" stroke-linecap="round"/><line x1="44" y1="8" x2="44" y2="20" stroke="#000" stroke-width="4" stroke-linecap="round"/></svg>',
  msg:      '<svg viewBox="0 0 64 64"><rect x="8" y="14" width="48" height="36" fill="none" stroke="#000" stroke-width="4"/><line x1="16" y1="26" x2="48" y2="26" stroke="#000" stroke-width="4"/><line x1="16" y1="34" x2="48" y2="34" stroke="#000" stroke-width="4"/><line x1="16" y1="42" x2="36" y2="42" stroke="#000" stroke-width="4"/></svg>'
};

// "Setup needed" placeholder shared by every widget that can render
// in a not-yet-configured state. Pass the render ctx (cellW/cellH) so
// tiny tiles degrade gracefully instead of colliding: a 4×2 battery
// tile can't fit icon + hint + badge, so it gets title-only; small
// tiles keep the icon but drop the hint/badge.
export function placeholder(title, hint, iconKey, ctx) {
  const w = (ctx && Number.isFinite(ctx.cellW)) ? ctx.cellW : 99;
  const h = (ctx && Number.isFinite(ctx.cellH)) ? ctx.cellH : 99;
  const xs = h <= 2 || w <= 4;          // title only
  const sm = !xs && (h <= 3 || w <= 6); // icon + title, no hint/badge
  const cls = xs ? ' ph-xs' : sm ? ' ph-sm' : '';
  const ic = !xs && iconKey && PLACEHOLDER_ICONS[iconKey];
  return `
    <div class="widget widget-placeholder${cls}">
      ${ic ? `<div class="ph-icon">${ic}</div>` : ''}
      <div class="ph-title">${title}</div>
      ${xs || sm ? '' : `<div class="ph-hint">${hint}</div>
      <div class="ph-tag">SETUP NEEDED</div>`}
    </div>
  `;
}

// Semantic auto-red helper. Returns ' face-red' (a leading-space class
// fragment, ready to concat into a class="" list) when `condition` is true
// AND the tile hasn't disabled semantic red (settings.semanticRed === false).
// Reuses the .face-red base utility so no per-widget CSS is needed; widgets
// add it to the element that should ride the red plane by meaning (an
// unhealthy AQI, a low battery, an overdue countdown, today's date, …).
// No-op on BW panels (red greyscales to dark).
export function semRed(s, condition) {
  return (condition && (!s || s.semanticRed !== false)) ? ' face-red' : '';
}

// Minimal inline markdown: caller must escapeHtml first to keep this safe.
export function md(s) {
  return String(s || '')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

// Ring gauge (TRMNL primitive). Emits a bold value arc over a hairline
// track with a big number centered — styled by .tr-gauge* in
// 225-trmnl-gauge-heatmap.css. The SVG renders at natural size (meet), so
// the arc is a crisp solid ink fill; no dither goes inside it. `red` rides
// the arc on the red plane for accent (an alert / danger value). The arc
// length = clamp(value / max, 0..1) of the circle.
//   { value, max=100, label, center, red=false, size='md' }
// `center` overrides the number shown (e.g. a formatted string); defaults
// to Math.round(value).
export function gaugeHtml({ value, max = 100, label = '', center, red = false, size = 'md' } = {}) {
  const num = Number(value);
  const m = Number(max) || 1;
  const frac = Math.max(0, Math.min(1, (Number.isFinite(num) ? num : 0) / m));
  const R = 44, C = 2 * Math.PI * R;
  const on = (frac * C).toFixed(2);
  const off = (C - frac * C).toFixed(2);
  const mid = center != null ? String(center)
    : (Number.isFinite(num) ? String(Math.round(num)) : '--');
  const arcCls = red ? 'tr-gauge-arc tr-gauge-red' : 'tr-gauge-arc';
  return `<div class="tr-gauge tr-gauge-${size}">`
    + `<svg viewBox="0 0 100 100" class="tr-gauge-svg" aria-hidden="true">`
    + `<circle class="tr-gauge-track" cx="50" cy="50" r="${R}"/>`
    + `<circle class="${arcCls}" cx="50" cy="50" r="${R}" `
    + `stroke-dasharray="${on} ${off}" transform="rotate(-90 50 50)"/>`
    + `</svg>`
    + `<div class="tr-gauge-center">`
    + `<div class="tr-gauge-val${red ? ' face-red' : ''}">${escapeHtml(mid)}</div>`
    + (label ? `<div class="tr-gauge-lbl">${escapeHtml(label)}</div>` : '')
    + `</div></div>`;
}

// Contribution heatmap (TRMNL primitive). A weeks×days dot grid; cells are
// HTML blocks toned with the 215-dither-tones utilities (levels 0..3) plus
// solid ink (4). Styled by .tr-heat* in 225-trmnl-gauge-heatmap.css. Values
// fill column-major (grid-auto-flow:column) so the last value lands
// bottom-right = "today", GitHub-style.
//   { values:number[], rows=7, max, level }
// `max` fixes the scale (defaults to the data max); pass a custom
// `level(v)` → 0..4 to override the quartile mapping.
// Level 0 = empty: plain white (just the cell outline) so idle days read as
// blank, not a faint dither dot. 1..4 climb the tones to solid ink. At
// contribution-cell size a 4-step ramp is clearer than the full dither set.
const HEAT_TONE = [
  'tr-heat-empty', 'face-tone-g50', 'face-tone-g75', 'tr-heat-l4', 'tr-heat-l4'
];
export function heatmapHtml({ values, rows = 7, max, level } = {}) {
  const vals = Array.isArray(values) ? values.map(Number) : [];
  const hi = Number.isFinite(max) && max > 0
    ? max
    : Math.max(1, ...vals.filter(Number.isFinite));
  const toLevel = typeof level === 'function' ? level : (v) => {
    if (!Number.isFinite(v) || v <= 0) return 0;
    const f = v / hi;
    if (f > 0.75) return 4;
    if (f > 0.5) return 3;
    if (f > 0.25) return 2;
    return 1;
  };
  const cells = vals.map((v) => {
    const lv = Math.max(0, Math.min(4, toLevel(v)));
    return `<span class="tr-heat-cell ${HEAT_TONE[lv]}"></span>`;
  }).join('');
  const r = Math.max(1, rows | 0);
  const cols = Math.max(1, Math.ceil(vals.length / r));
  // aspect-ratio keeps the cells square when the grid stretches to width.
  return `<div class="tr-heat" style="--heat-rows:${r};aspect-ratio:${cols} / ${r}">${cells}</div>`;
}

// Autofit-grow for under-full agendas: raise row-title font so a few events
// fill a big tile instead of floating as tiny text. Deterministic (no JS
// measurement pass) because the grid is a fixed 24×12 → one cell-row = 40px.
// Returns a px size given the tile height (in grid cells) and row count;
// `chrome` ≈ title bar + body padding to subtract.
export function fillRowFont(cellH, count, { min = 14, max = 26, chrome = 50 } = {}) {
  const tilePx = (Number(cellH) || 0) * 40;
  const avail = Math.max(0, tilePx - chrome);
  const per = avail / Math.max(1, Number(count) || 1);
  return Math.max(min, Math.min(max, Math.round(per * 0.28)));
}

// Resolve a cell size to a layout tier name (matches widgets.js
// pickTier semantics). Imported by per-widget render functions.
export function pickTier(cellW, cellH, density) {
  const w = cellW || 0, h = cellH || 0;
  let byH = 'full';
  if (h < 4)       byH = 'tiny';
  else if (h < 6)  byH = 'compact';
  else if (h < 8)  byH = 'standard';
  else if (h < 12) byH = 'extended';
  let byW = 'full';
  if (w < 6)       byW = 'tiny';
  else if (w < 8)  byW = 'compact';
  else if (w < 12) byW = 'standard';
  else if (w < 18) byW = 'extended';
  const order = ['tiny', 'compact', 'standard', 'extended', 'full'];
  let idx = Math.min(order.indexOf(byH), order.indexOf(byW));
  if (density === 'rich')   idx = Math.min(idx + 1, order.length - 1);
  if (density === 'sparse') idx = Math.max(idx - 1, 0);
  return order[idx];
}

// Build a `style` attribute fragment for the .cell wrapper from a
// tile's per-instance typography settings. Empty string when the user
// hasn't picked anything so the per-widget defaults still win.
export function typographyCss(s) {
  if (!s) return '';
  let css = '';
  const fam = FONT_STACKS[s.fontFamily];
  if (fam) {
    css += `--w-font:${fam};font-family:${fam};`;
  }
  if (Number.isFinite(s.padding)) {
    css += `padding:${s.padding}px;`;
  }
  return css;
}

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
  stocks:   '<svg viewBox="0 0 64 64"><polyline points="6,46 20,32 30,38 44,18 58,24" fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><line x1="6" y1="56" x2="58" y2="56" stroke="#000" stroke-width="4"/></svg>',
  msg:      '<svg viewBox="0 0 64 64"><rect x="8" y="14" width="48" height="36" fill="none" stroke="#000" stroke-width="4"/><line x1="16" y1="26" x2="48" y2="26" stroke="#000" stroke-width="4"/><line x1="16" y1="34" x2="48" y2="34" stroke="#000" stroke-width="4"/><line x1="16" y1="42" x2="36" y2="42" stroke="#000" stroke-width="4"/></svg>'
};

// "Setup needed" placeholder shared by every widget that can render
// in a not-yet-configured state.
export function placeholder(title, hint, iconKey) {
  const ic = iconKey && PLACEHOLDER_ICONS[iconKey];
  return `
    <div class="widget widget-placeholder">
      ${ic ? `<div class="ph-icon">${ic}</div>` : ''}
      <div class="ph-title">${title}</div>
      <div class="ph-hint">${hint}</div>
      <div class="ph-tag">SETUP NEEDED</div>
    </div>
  `;
}

// Minimal inline markdown: caller must escapeHtml first to keep this safe.
export function md(s) {
  return String(s || '')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
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

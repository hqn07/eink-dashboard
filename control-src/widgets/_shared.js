// Shared helpers for per-widget modules under control-src/widgets/.
//
// Phase A of the widget refactor: each widget should own its `def`,
// `render`, and `Form` in a sibling file under this dir and import
// any cross-widget primitives from here. The legacy
// control-src/widget-render.js + control-src/widgets.js still hold
// the unmigrated widgets — they import the same primitives from
// here so nothing has to change as widgets move over.

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

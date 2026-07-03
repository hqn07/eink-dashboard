// Per-tile typography + class helpers. Originally hosted header/footer
// rendering too, but those were removed in favor of the text widget (bar variant)
// + {{token}} system. File name kept to avoid churn across imports.

import { FONT_STACKS } from './_shared.js';

// Extra class names the cell wrapper should carry based on the tile's
// settings. Currently picks up `theme: 'inverted'` so the tile renders
// as black-on-white instead of the default white-on-black.
export function cellClasses(s) {
  const out = [];
  if (s && s.theme === 'inverted') out.push('cell-inverted');
  // Per-widget red accent (3-color B panel). The class drives CSS that
  // tints this tile's heading + key figure onto the red plane; no-op on
  // BW panels (greyscales to dark). Part of the layered red model with
  // the semantic auto-red rules and the .face-red base utilities.
  if (s && s.accent === 'red') out.push('cell-accent-red');
  // Optional per-tile frame around the whole card — reuses the tested
  // .face-frame-* border-image utilities (075-border-styles.css).
  if (s && s.frame === 'dither')      out.push('face-frame', 'face-frame-g50');
  if (s && s.frame === 'dither-pink') out.push('face-frame', 'face-frame-r50');
  if (s && s.frame === 'solid')       out.push('face-frame', 'face-frame-solid');
  return out;
}

// ---- Shared per-tile assembly --------------------------------------
//
// Three surfaces render the same tile: the server SSR (server.js
// buildPageBodyHtml), the editor canvas (EditorGrid.jsx), and the
// preview pane (LiveDashboard.jsx). Each used to hand-build the render
// context and cell class list, and they drifted (commit 193b74b — the
// preview lied because one copy stopped spreading perItem). These two
// helpers are the single source of truth; the call sites may append
// surface-specific extras (selection highlights, absolute positioning)
// but must not re-derive what's here.

// Per-tile render context: page-level data, overlaid with this tile's
// per-item fetch slot, plus the tile's own geometry + settings.
// `def` is optional (contract v2): when given, the resolved layout
// variant rides on ctx.variant so render fns don't each re-derive
// "settings.variant or the def's default".
export function buildTileCtx(item, data, def) {
  const slot = (data && data.perItem && data.perItem[item.id]) || {};
  const s = item.settings;
  const variant = (s && s.variant && def && def.variants && def.variants[s.variant])
    ? s.variant
    : (def && def.defaultVariant) || null;
  return {
    ...data,
    ...slot,
    cellW: item.w,
    cellH: item.h,
    density: item.density,
    settings: item.settings,
    variant
  };
}

// Cell wrapper class list shared by all three surfaces: widget id,
// grid-edge border suppression, flush mode, and settings-derived
// classes (inverted theme etc.).
export function tileCellClasses(item, gridCols = 24, gridRows = 12) {
  const widgetId = item.widgetId || item.id;
  const classes = ['cell', `cell-${widgetId}`];
  if (item.x + item.w >= gridCols) classes.push('cell-edge-right');
  if (item.y + item.h >= gridRows) classes.push('cell-edge-bottom');
  if (item.flush) classes.push('cell-flush');
  classes.push(...cellClasses(item.settings));
  return classes;
}

// Per-tile typography → `style` attribute fragment for the .cell wrapper.
// Empty string when the user hasn't picked anything so the per-widget
// defaults still win. fontScale is applied separately via the inner
// transform wrapper (see scaleWrap) so it can carry a user-picked
// transform-origin instead of behaving like `zoom`.
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

// Map the user-facing anchor token to a CSS `transform-origin` pair.
// Defaults to top-left so scale > 1 grows down-and-right and scale < 1
// pins the top-left corner where text usually starts.
const SCALE_ANCHORS = {
  top_left:     '0% 0%',
  top:          '50% 0%',
  top_right:    '100% 0%',
  left:         '0% 50%',
  center:       '50% 50%',
  right:        '100% 50%',
  bottom_left:  '0% 100%',
  bottom:       '50% 100%',
  bottom_right: '100% 100%'
};

// Returns { open, close } HTML fragments that wrap a widget's inner
// render with a transform: scale + transform-origin pass when the user
// picked a non-1 fontScale. The wrapper is sized inversely so the post-
// transform painted box still fills the cell content area exactly, so
// neighbour cells stay untouched. Returns empty strings when no scale
// is configured so the widget HTML is emitted as-is.
export function scaleWrap(s) {
  const scale = Number.isFinite(s && s.fontScale) ? s.fontScale : 1;
  if (Math.abs(scale - 1) < 0.001) return { open: '', close: '' };
  const anchor = SCALE_ANCHORS[s && s.scaleAnchor] || SCALE_ANCHORS.top_left;
  const inv = (100 / scale).toFixed(3);
  const style = `width:${inv}%;height:${inv}%;transform:scale(${scale});transform-origin:${anchor};`;
  return {
    open: `<div class="cell-scale" style="${style}">`,
    close: '</div>'
  };
}

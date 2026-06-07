// Per-tile typography + class helpers. Originally hosted header/footer
// rendering too, but those were removed in favor of the text_bar widget
// + {{token}} system. File name kept to avoid churn across imports.

import { FONT_STACKS } from './_shared.js';

// Extra class names the cell wrapper should carry based on the tile's
// settings. Currently picks up `theme: 'inverted'` so the tile renders
// as black-on-white instead of the default white-on-black.
export function cellClasses(s) {
  const out = [];
  if (s && s.theme === 'inverted') out.push('cell-inverted');
  return out;
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

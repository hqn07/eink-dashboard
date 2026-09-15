import { escapeHtml, md, pickTier } from './_shared.js';

// Merged text widget (widgets-refresh W0): absorbs the old `text_bar`
// (token strip) and `message` (markdown card) widgets as variants of
// one widget. Saved layouts with either old id migrate forward via
// WIDGET_ID_MIGRATIONS (settings gain `variant: 'bar' | 'card'`).
export const def = {
  id: 'text',
  label: 'Text',
  requires: null,
  minSize: { w: 4, h: 1 },
  sizes: {
    XS: { w: 8,  h: 1 },
    S:  { w: 12, h: 2 },
    M:  { w: 24, h: 1 },
    L:  { w: 24, h: 4 },
    XL: { w: 24, h: 6 }
  },
  defaultSize: 'S',
  // Contract v2 (W1 generalizes the picker UI; declared here already
  // so `text` is the first consumer).
  variants: {
    bar:  { label: 'Bar — single strip, token-driven' },
    card: { label: 'Card — headline + subtitle, scheduled messages' }
  },
  defaultVariant: 'bar',
  defaults: () => ({
    variant: 'bar',
    text: '', subtitle: '', schedule: [],
    align: 'left', upper: false,
    fontFamily: 'serif',
  })
};

const ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' };
const TEXT_ALIGN = { left: 'left', center: 'center', right: 'right' };

// Inline empty state — fits any aspect ratio (the shared placeholder()
// card collapses into a smudge on a 24×1 strip). Pure 1-bit inks only:
// grays here used to threshold into noise on the panel.
function emptyState(isTall) {
  const fz = isTall ? 14 : 11;
  return `
    <div class="widget widget-textbar tb-empty" style="display:flex;align-items:center;justify-content:center;height:100%;width:100%;border:2px dashed #000;color:#000;font-family:'JetBrains Mono',monospace;font-size:${fz}px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
      <span>Text · click to set up</span>
    </div>
  `;
}

function renderBar({ resolvedText, settings, cellH }) {
  const s = settings || {};
  const r = resolvedText || { text: '', subtitle: '' };
  // Single-row tiles auto-shrink the headline; taller tiles keep room
  // for subtitle. Subtitle hidden under 2 grid rows so it doesn't
  // visually compete with the main line on a 40px-tall bar.
  const isTall = (cellH || 0) >= 2;
  if (!r.text && !r.subtitle) return emptyState(isTall);
  const justify = ALIGN[s.align] || ALIGN.left;
  const textAlign = TEXT_ALIGN[s.align] || TEXT_ALIGN.left;
  const baseSize = isTall ? 26 : 18;
  const subSize  = isTall ? 13 : 11;
  const scale = Number.isFinite(s.fontScale) ? s.fontScale : 1;
  const txtPx = Math.round(baseSize * scale);
  const subPx = Math.round(subSize  * scale);
  const txt = s.upper ? String(r.text || '').toUpperCase() : (r.text || '');
  const sub = s.upper ? String(r.subtitle || '').toUpperCase() : (r.subtitle || '');
  return `
    <div class="widget widget-textbar" style="display:flex;flex-direction:column;justify-content:center;align-items:${justify};text-align:${textAlign};height:100%">
      ${txt ? `<div class="tb-text autofit" data-min-font="12" style="font-size:${txtPx}px;line-height:1.1"><span>${md(escapeHtml(txt))}</span></div>` : ''}
      ${isTall && sub ? `<div class="tb-sub" style="font-size:${subPx}px;line-height:1.2;margin-top:2px;font-weight:400">${md(escapeHtml(sub))}</div>` : ''}
    </div>
  `;
}

function renderCard({ resolvedMessage, cellW, cellH, density, settings }) {
  const m = resolvedMessage || {};
  if (!m.text) return emptyState((cellH || 0) >= 2);
  const s = settings || {};
  const tier = pickTier(cellW, cellH, density);
  const matrix = {
    tiny:     { txtSize: 14, subSize: 10, showSub: false },
    compact:  { txtSize: 18, subSize: 11, showSub: true  },
    standard: { txtSize: 22, subSize: 12, showSub: true  },
    extended: { txtSize: 28, subSize: 13, showSub: true  },
    full:     { txtSize: 36, subSize: 14, showSub: true  }
  };
  const t = matrix[tier];
  const scale = Number.isFinite(s.fontScale) ? s.fontScale : 1;
  const txtPx = Math.round(t.txtSize * scale);
  const subPx = Math.round(t.subSize * scale);
  return `
    <div class="widget widget-msg">
      <div class="msg-text" style="font-size:${txtPx}px">${md(escapeHtml(m.text))}</div>
      ${t.showSub && m.subtitle ? `<div class="msg-sub" style="font-size:${subPx}px">${md(escapeHtml(m.subtitle))}</div>` : ''}
    </div>
  `;
}

export function render(ctx) {
  // ctx.variant is resolved by buildTileCtx (contract v2); the settings
  // fallback covers surfaces that render without a def (pool demo).
  const variant = ctx.variant
    || ((ctx.settings && ctx.settings.variant) === 'card' ? 'card' : 'bar');
  return variant === 'card' ? renderCard(ctx) : renderBar(ctx);
}

import { escapeHtml, md } from './_shared.js';

export const def = {
  id: 'text_bar',
  label: 'Text',
  requires: null,
  minSize: { w: 4, h: 1 },
  sizes: {
    XS: { w: 8,  h: 1 },
    S:  { w: 12, h: 2 },
    M:  { w: 24, h: 1 },
    L:  { w: 24, h: 2 },
    XL: { w: 24, h: 3 }
  },
  defaultSize: 'S',
  defaults: () => ({
    text: '',
    subtitle: '',
    align: 'left',
    fontFamily: 'serif',
    fontScale: 1,
    padding: 8,
    upper: false
  })
};

const ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' };
const TEXT_ALIGN = { left: 'left', center: 'center', right: 'right' };

// Inline empty state — fits any aspect ratio. The shared placeholder()
// helper is a tall card with icon + title + hint + tag, which collapses
// into an unreadable smudge on a 24×1 strip. Render a flat dashed
// outline + label centered in the tile so a 1-row bar still reads as
// "set me up" without overflowing.
function emptyState(isTall) {
  const fz = isTall ? 14 : 11;
  return `
    <div class="widget widget-textbar tb-empty" style="display:flex;align-items:center;justify-content:center;height:100%;width:100%;border:1.5px dashed #999;color:#666;font-family:'JetBrains Mono',monospace;font-size:${fz}px;letter-spacing:2px;text-transform:uppercase;">
      <span>Text · click to set up</span>
    </div>
  `;
}

export function render({ resolvedText, settings, cellH }) {
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
      ${txt ? `<div class="tb-text autofit" data-min-font="12" style="font-size:${txtPx}px;line-height:1.1">${md(escapeHtml(txt))}</div>` : ''}
      ${isTall && sub ? `<div class="tb-sub" style="font-size:${subPx}px;line-height:1.2;margin-top:2px;font-weight:400">${md(escapeHtml(sub))}</div>` : ''}
    </div>
  `;
}

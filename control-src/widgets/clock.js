import { escapeHtml, pickTier, placeholder } from './_shared.js';

// Clock — server-rendered time + date line.
//
// Contract v2 (widgets-refresh W2): variants —
//   big    — chunky serif time, date under (the original default)
//   thin   — light weight, looser tracking
//   banner — one horizontal strip: time left, date right; built for
//            wide short tiles (24×2 text-bar replacement, XL 24×6)
// Legacy tiles carry `settings.style: 'big'|'thin'` from before the
// variant system — the render maps that forward when no variant is set.

export const def = {
  id: 'clock',
  label: 'Clock',
  requires: 'clock',
  minSize: { w: 4, h: 2 },
  sizes: {
    S:  { w: 6, h: 3 },
    M:  { w: 8, h: 4 },
    L:  { w: 12, h: 6 },
    XL: { w: 24, h: 6 }
  },
  defaultSize: 'M',
  variants: {
    big:    { label: 'Big — chunky serif' }
  },
  defaultVariant: 'big',
  degrade: {
    tiny: ['date']
  },
  defaults: () => ({
    variant: 'big',
    format: '12h', showDate: true,
    fontScale: 1,
    padding: 14
  })
};

export function render(ctx) {
  const { clockNow, settings, cellW, cellH, density } = ctx;
  if (!clockNow) {
    return placeholder('CLOCK', 'Waiting for time', 'msg', { cellW, cellH }, 'nodata');
  }
  const c = clockNow;
  const s = settings || {};
  const variant = (s.variant && def.variants[s.variant]) ? s.variant
    : (s.style === 'thin' || c.style === 'thin') ? 'thin'  // pre-variant tiles
    : ctx.variant || 'big';
  const tier = pickTier(cellW, cellH, density);
  // Date line is legible from `compact` up; tiny tiles drop it so the
  // time can use the full cell.
  const dateAllowed = tier !== 'tiny';
  const ampm = c.ampm ? `<span class="clock-ampm">${c.ampm}</span>` : '';
  const date = dateAllowed && c.dateLine
    ? `<div class="clock-date">${escapeHtml(c.dateLine)}</div>`
    : '';
  if (variant === 'trmnl') {
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>Clock</span>${(dateAllowed && c.dateLine) ? `<span class="tr-meta">${escapeHtml(c.dateLine)}</span>` : ''}</div>
      <div class="tr-body" style="justify-content:center;align-items:center">
        <div class="tr-lv" style="text-align:center"><div class="tr-v autofit" data-min-font="28" style="font-size:80px">${c.timeStr}${c.ampm ? `<span class="tr-deg">${c.ampm}</span>` : ''}</div></div>
      </div>
    </div>`;
  }

  if (variant === 'banner') {
    return `
      <div class="clock clock-banner clock-big">
        <div class="clock-time autofit" data-min-font="22">${c.timeStr}${ampm}</div>
        ${date}
      </div>
    `;
  }
  const cls = variant === 'thin' ? 'clock-thin' : 'clock-big';
  return `
    <div class="clock ${cls}">
      <div class="clock-time autofit" data-min-font="22">${c.timeStr}${ampm}</div>
      ${date}
    </div>
  `;
}

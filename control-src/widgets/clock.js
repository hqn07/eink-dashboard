import { escapeHtml, pickTier, placeholder } from './_shared.js';

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
  defaults: () => ({
    format: '12h', showDate: true, style: 'big',
    fontScale: 1,
    padding: 14
  })
};

export function render({ clockNow, cellW, cellH, density }) {
  if (!clockNow) {
    return placeholder('CLOCK', 'Waiting for time', 'msg');
  }
  const c = clockNow;
  const tier = pickTier(cellW, cellH, density);
  // Date line is legible from `compact` up; tiny tiles drop it so the
  // time can use the full cell.
  const dateAllowed = tier !== 'tiny';
  const cls = c.style === 'thin' ? 'clock-thin' : 'clock-big';
  const ampm = c.ampm ? `<span class="clock-ampm">${c.ampm}</span>` : '';
  const date = dateAllowed && c.dateLine
    ? `<div class="clock-date">${escapeHtml(c.dateLine)}</div>`
    : '';
  return `
    <div class="clock ${cls}">
      <div class="clock-time autofit" data-min-font="22">${c.timeStr}${ampm}</div>
      ${date}
    </div>
  `;
}

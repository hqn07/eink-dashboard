import { escapeHtml } from './_shared.js';

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

export function render({ clockNow }) {
  if (!clockNow) {
    return `<div class="empty" style="border:0;padding:14px 0">NO TIME</div>`;
  }
  const c = clockNow;
  const cls = c.style === 'thin' ? 'clock-thin' : 'clock-big';
  const ampm = c.ampm ? `<span class="clock-ampm">${c.ampm}</span>` : '';
  const date = c.dateLine
    ? `<div class="clock-date">${escapeHtml(c.dateLine)}</div>`
    : '';
  return `
    <div class="clock ${cls}">
      <div class="clock-time autofit" data-min-font="22">${c.timeStr}${ampm}</div>
      ${date}
    </div>
  `;
}

import { escapeHtml, md, pickTier, placeholder } from './_shared.js';

export const def = {
  id: 'message',
  label: 'Custom Message',
  requires: 'message',
  minSize: { w: 6, h: 2 },
  sizes: {
    XS: { w: 8, h: 3 },
    S:  { w: 8, h: 4 },
    M:  { w: 10, h: 4 },
    L:  { w: 24, h: 4 },
    XL: { w: 24, h: 6 }
  },
  defaultSize: 'M',
  defaults: () => ({
    text: '', subtitle: '', schedule: [],
    fontScale: 1,
    padding: 14
  })
};

export function render({ cfg, resolvedMessage, cellW, cellH, density, settings }) {
  const m = resolvedMessage || (cfg && cfg.message) || {};
  if (!m.text) return placeholder('MESSAGE', 'Set a headline in settings', 'msg', { cellW, cellH });
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

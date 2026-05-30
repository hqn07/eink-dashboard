// Custom Message widget — headline + subtitle with optional time-of-
// day schedule of swap-in messages. Inline markdown for **bold** and
// *italic*.

import React from 'react';
import { escapeHtml, md, pickTier } from './_shared.js';

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
  const s = settings || {};
  const text = m.text || 'Custom message';
  const sub  = m.subtitle || '';
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
      <div class="msg-text" style="font-size:${txtPx}px">${md(escapeHtml(text))}</div>
      ${t.showSub && sub ? `<div class="msg-sub" style="font-size:${subPx}px">${md(escapeHtml(sub))}</div>` : ''}
    </div>
  `;
}

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, ListEditor, TypographyFields } = fields;
  return (
    <>
      <TextField
        label="Default headline"
        value={v.text}
        onChange={(x) => patch({ text: x })}
        placeholder="Today's message…"
        help="Markdown supported: **bold**, *italic*."
      />
      <TextField
        label="Default subtitle"
        value={v.subtitle}
        onChange={(x) => patch({ subtitle: x })}
        placeholder="Optional second line"
      />
      <TypographyFields values={v} onChange={onChange} />
      <ListEditor
        label="Scheduled messages (override default in their window)"
        items={v.schedule}
        onChange={(schedule) => patch({ schedule })}
        blank={{ from: '06:00', to: '12:00', text: '', subtitle: '' }}
        addLabel="Add scheduled message"
        help="First match wins. Windows wrap midnight if `to` < `from`."
        renderRow={(it, set) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="time" value={it.from || ''} onChange={e => set({ from: e.target.value })}
                style={{ width: 110 }} />
              <span style={{ fontSize: 11 }}>→</span>
              <input type="time" value={it.to || ''} onChange={e => set({ to: e.target.value })}
                style={{ width: 110 }} />
            </div>
            <input type="text" value={it.text || ''} placeholder="Headline (this slot)"
              onChange={e => set({ text: e.target.value })} />
            <input type="text" value={it.subtitle || ''} placeholder="Subtitle (optional)"
              onChange={e => set({ subtitle: e.target.value })} />
          </div>
        )}
      />
    </>
  );
}

// Calendar widget — fans out to all configured iCal feeds and merges
// upcoming events. Sized via the standard tier matrix.

import React from 'react';
import { escapeHtml, pickTier } from './_shared.js';

export const def = {
  id: 'calendar',
  label: 'Calendar',
  requires: 'calendar',
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 8, h: 4 },
    M: { w: 10, h: 4 },
    L: { w: 24, h: 4 },
    XL: { w: 24, h: 8 }
  },
  defaultSize: 'M',
  defaults: () => ({ icalUrls: [], fontScale: 1, padding: 14 })
};

export function render({ events, cellW, cellH, density }) {
  const all = (events || []);
  if (!all.length) {
    return `<div class="widget widget-cal"><div class="widget-title">UPCOMING</div><div class="cal-row"><div class="cal-info"><div class="cal-title">No events</div></div></div></div>`;
  }
  const tier = pickTier(cellW, cellH, density);
  const matrix = {
    tiny:     { events: 1, sections: false },
    compact:  { events: 2, sections: false },
    standard: { events: 4, sections: false },
    extended: { events: 5, sections: true  },
    full:     { events: 8, sections: true  }
  };
  const t = matrix[tier];
  const list = all.slice(0, t.events);
  const row = ev => `
    <div class="cal-row ${ev.isAllDay ? 'allday' : ''}">
      <div class="cal-day">${escapeHtml(ev.dayLabel || '')}</div>
      <div class="cal-info">
        <div class="cal-title">${escapeHtml(ev.title || '')}</div>
        <div class="cal-time">${escapeHtml(ev.startLabel || '')}</div>
      </div>
    </div>`;
  if (!t.sections) {
    return `
      <div class="widget widget-cal">
        <div class="widget-title">UPCOMING</div>
        ${list.map(row).join('')}
      </div>
    `;
  }
  const groups = {};
  const order = [];
  for (const ev of list) {
    const s = ev.section || 'LATER';
    if (!groups[s]) { groups[s] = []; order.push(s); }
    groups[s].push(ev);
  }
  return `
    <div class="widget widget-cal">
      <div class="widget-title">UPCOMING</div>
      ${order.map(s => `
        <div class="cal-section-title">${s}</div>
        ${groups[s].map(row).join('')}
      `).join('')}
    </div>
  `;
}

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { ListEditor, TypographyFields } = fields;
  return (
    <>
      <TypographyFields values={v} onChange={onChange} />
      <ListEditor
        label="iCal feed URLs"
        items={v.icalUrls}
        onChange={(items) => patch({ icalUrls: items })}
        blank=""
        replaceRow
        addLabel="Add feed"
        help={
          <>
            Events merge + dedupe.{' '}
            <a href="https://support.google.com/calendar/answer/37648?hl=en#zippy=%2Cget-your-calendar-view-only"
              target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--mute)', textDecoration: 'underline' }}>
              Where do I get this? →
            </a>
          </>
        }
        renderRow={(it, set) => (
          <input type="url"
            value={typeof it === 'string' ? it : ''}
            placeholder="https://calendar.google.com/calendar/ical/..."
            onChange={e => set(e.target.value)}
            style={{ flex: 1 }} />
        )}
      />
    </>
  );
}

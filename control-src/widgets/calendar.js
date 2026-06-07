import { escapeHtml, pickTier, placeholder } from './_shared.js';

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
  defaults: () => ({
    icalUrls: [],
    disabledFeeds: [],   // URL strings currently muted (server skips fetch)
    title: '',
    density: 'auto',     // 'auto' | 'compact' | 'standard' | 'rich'
    showDayLabel: true,
    showTime:     true,
    fontScale: 1,
    padding: 14
  })
};

export function render({ events, cfg, settings, cellW, cellH, density }) {
  const urls = collectUrls(settings, cfg);
  const titleLabel = (settings && typeof settings.title === 'string' && settings.title.trim())
    ? settings.title.trim()
    : 'UPCOMING';
  if (!urls.length) return placeholder(titleLabel, 'Paste an iCal URL in settings', 'calendar');
  const all = events || [];
  if (!all.length) return placeholder(titleLabel, 'No events in the next 14 days', 'calendar');
  // Per-tile density override wins over the layout-item density that
  // the editor's grid passes through. 'auto' (or missing) keeps the
  // pickTier behavior we had before.
  const overrideDensity = settings && settings.density;
  const effDensity =
    overrideDensity === 'compact' ? 'sparse' :
    overrideDensity === 'rich'    ? 'rich'   :
    overrideDensity === 'standard'? undefined :
                                    density;
  const tier = pickTier(cellW, cellH, effDensity);
  const matrix = {
    tiny:     { events: 1, sections: false },
    compact:  { events: 2, sections: false },
    standard: { events: 4, sections: false },
    extended: { events: 5, sections: true  },
    full:     { events: 8, sections: true  }
  };
  const t = matrix[tier];
  const list = all.slice(0, t.events);
  const showDayLabel = !settings || settings.showDayLabel !== false;
  const showTime     = !settings || settings.showTime     !== false;
  // Uses the shared `.item` primitive (TRMNL-inspired) so list-shaped
  // widgets stay visually consistent. Day label fills the `meta` slot;
  // title + time fill `content`. All-day events get the `--allday`
  // modifier which renders the time slot as an inverted pill.
  const row = ev => {
    const desc = showTime && ev.startLabel ? escapeHtml(ev.startLabel) : '';
    return `
    <div class="item ${ev.isAllDay ? 'item--allday' : ''}">
      <div class="meta">${showDayLabel ? escapeHtml(ev.dayLabel || '') : ''}</div>
      <div class="content">
        <span class="title">${escapeHtml(ev.title || '')}</span>
        ${desc ? `<span class="description">${desc}</span>` : ''}
      </div>
    </div>`;
  };
  if (!t.sections) {
    return `
      <div class="widget widget-cal">
        <div class="widget-title">${escapeHtml(titleLabel)}</div>
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
      <div class="widget-title">${escapeHtml(titleLabel)}</div>
      ${order.map(s => `
        <div class="cal-section-title">${s}</div>
        ${groups[s].map(row).join('')}
      `).join('')}
    </div>
  `;
}

function collectUrls(settings, cfg) {
  const fromSettings = settings && Array.isArray(settings.icalUrls)
    ? settings.icalUrls.filter(Boolean) : [];
  if (fromSettings.length) return fromSettings;
  const c = (cfg && cfg.calendar) || {};
  if (Array.isArray(c.icalUrls) && c.icalUrls.filter(Boolean).length) {
    return c.icalUrls.filter(Boolean);
  }
  if (c.icalUrl) return [c.icalUrl];
  return [];
}

import { escapeHtml, pickTier, placeholder, semRed } from './_shared.js';

// Calendar — three layout variants (contract v2, widgets-refresh W2):
//   list  — agenda rows (universal; the fallback when a tile is too
//           small for a 7-column grid)
//   strip — 7-day horizontal week
//   month — full month grid
// Pre-variant tiles carry `settings.viewMode` from before the variant
// system — the render maps that forward when no variant is set.

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
  variants: {
    list:  { label: 'List — agenda rows' },
    strip: { label: 'Strip — 7-day horizontal' },
    month: { label: 'Month — full grid' }
  },
  defaultVariant: 'list',
  // Advisory. strip needs ≥7 cols × 2 rows, month ≥7 × 4; under that
  // the render falls back to the list view regardless of variant.
  degrade: {
    compact: ['month'],
    tiny:    ['month', 'strip']
  },
  defaults: () => ({
    icalUrls: [],
    disabledFeeds: [],   // URL strings currently muted (server skips fetch)
    title: '',
    variant: 'list',     // 'list' | 'strip' | 'month'
    density: 'auto',     // 'auto' | 'compact' | 'standard' | 'rich'
    showDayLabel: true,
    showTime:     true,
    fontScale: 1,
    padding: 14
  })
};

export function render(ctx) {
  const { events, cfg, settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const urls = collectUrls(settings, cfg);
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim()
    : 'UPCOMING';
  if (!urls.length) return placeholder(titleLabel, 'Paste an iCal URL in settings', 'calendar', { cellW, cellH });
  const all = events || [];
  if (!all.length) return placeholder(titleLabel, 'No events in the next 14 days', 'calendar', { cellW, cellH });
  // variant wins; legacy tiles fall back to settings.viewMode, then the
  // ctx-resolved default. (buildTileCtx already maps settings.variant →
  // ctx.variant, but viewMode-only tiles need the explicit forward map.)
  const mode = (s.variant && def.variants[s.variant]) ? s.variant
    : (s.viewMode && def.variants[s.viewMode]) ? s.viewMode
    : ctx.variant || 'list';
  // Both alternative views auto-size a 7-column grid, so the only
  // hard floor is "enough rows to read". Thresholds kept low so a
  // tile the user explicitly picked Month / Strip for still renders
  // that view, just compact. List remains the universal fallback
  // when the tile is too short to fit any grid row at all.
  if (mode === 'month' && cellW >= 7 && cellH >= 4) return renderMonth(all, titleLabel, settings);
  if (mode === 'strip' && cellW >= 7 && cellH >= 2) return renderStrip(all, titleLabel, cellH, settings);
  return renderList(all, settings, titleLabel, cellW, cellH, density);
}

// ---------- list view (the original) ---------------------------------

function renderList(all, settings, titleLabel, cellW, cellH, density) {
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

// ---------- strip view (7 days horizontal) ---------------------------

function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
}
function eventDate(ev) {
  // server may serialize start to ISO string; reconstruct.
  if (ev.startISO) return new Date(ev.startISO);
  if (ev.start instanceof Date) return ev.start;
  return new Date(ev.start);
}

const DAY_INITIALS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function renderStrip(events, titleLabel, cellH, settings) {
  const s = settings || {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  // Bucket events per day key.
  const byDay = {};
  for (const ev of events) {
    const k = dayKey(eventDate(ev));
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(ev);
  }
  // How many event lines fit per cell depends on cell height.
  const linesPer = cellH < 5 ? 1 : cellH < 8 ? 2 : 3;
  const cell = (d, i) => {
    const k = dayKey(d);
    const evs = byDay[k] || [];
    const isToday = i === 0;
    const dayNum = d.getDate();
    const dayName = DAY_INITIALS[d.getDay()];
    const lines = evs.slice(0, linesPer).map(ev => `
      <div class="strip-event ${ev.isAllDay ? 'strip-allday' : ''}">${escapeHtml(ev.title)}</div>
    `).join('');
    const more = evs.length > linesPer ? `<div class="strip-more">+${evs.length - linesPer}</div>` : '';
    return `
      <div class="strip-day ${isToday ? 'strip-today' + semRed(s, true) : ''}">
        <div class="strip-day-head">
          <span class="strip-day-name">${dayName}</span>
          <span class="strip-day-num">${dayNum}</span>
        </div>
        <div class="strip-day-events">${lines}${more}</div>
      </div>`;
  };
  return `
    <div class="widget widget-cal widget-cal-strip">
      <div class="widget-title">${escapeHtml(titleLabel)}</div>
      <div class="cal-strip">
        ${days.map(cell).join('')}
      </div>
    </div>
  `;
}

// ---------- month grid view -----------------------------------------

const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function renderMonth(events, titleLabel, settings) {
  const s = settings || {};
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const firstDow = firstOfMonth.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // 6-week grid covers any month — trim trailing fully-empty rows after
  // filling so we don't render a dashed wasteland past month end.
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const dayNum = i - firstDow + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push(null);
    } else {
      cells.push(new Date(year, month, dayNum));
    }
  }
  let lastFilled = -1;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i]) { lastFilled = i; break; }
  }
  const rowCount = Math.max(1, Math.ceil((lastFilled + 1) / 7));
  const trimmed = cells.slice(0, rowCount * 7);
  // Bucket events per day, keeping titles so the cell can actually
  // show what's happening instead of a bare dot.
  const byDay = {};
  for (const ev of events) {
    const d = eventDate(ev);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const k = d.getDate();
      if (!byDay[k]) byDay[k] = [];
      byDay[k].push(ev);
    }
  }
  const todayNum = today.getDate();
  const cellHtml = trimmed.map(d => {
    if (!d) return `<div class="month-cell month-cell-empty"></div>`;
    const num = d.getDate();
    const isToday = num === todayNum;
    const evs = byDay[num] || [];
    const firstTitle = evs[0] ? escapeHtml(evs[0].title || '') : '';
    const moreCount = evs.length - 1;
    return `
      <div class="month-cell ${isToday ? 'month-cell-today' + semRed(s, true) : ''}">
        <div class="month-cell-top">
          <span class="month-num">${num}</span>
          ${moreCount > 0 ? `<span class="month-more">+${moreCount}</span>` : ''}
        </div>
        ${firstTitle ? `<span class="month-event">${firstTitle}</span>` : ''}
      </div>`;
  }).join('');
  const titleStr = `${MONTH_NAMES[month]} ${year}`;
  // Display title prefers the user's custom title if set, otherwise the
  // month/year header reads naturally for a grid view.
  const heading = (titleLabel && titleLabel !== 'UPCOMING') ? titleLabel : titleStr;
  return `
    <div class="widget widget-cal widget-cal-month">
      <div class="widget-title">${escapeHtml(heading)}</div>
      <div class="month-head">
        ${DAY_INITIALS.map(d => `<span>${d[0]}</span>`).join('')}
      </div>
      <div class="month-grid" style="grid-template-rows:repeat(${rowCount}, 1fr)">${cellHtml}</div>
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

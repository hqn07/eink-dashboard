import { escapeHtml, pickTier, placeholder, semRed, fillRowFont } from './_shared.js';

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
    tiny:    ['month', 'strip', 'strip5']
  },
  defaults: () => ({
    icalUrls: [],
    disabledFeeds: [],   // URL strings currently muted (server skips fetch)
    localEvents: [],     // quick events typed into the tile: {title, date, time?}
    title: '',
    variant: 'list',    // 'list' | 'strip' | 'strip5' | 'month' | 'trmnl'
    density: 'auto',     // 'auto' | 'compact' | 'standard' | 'rich'
    showDayLabel: true,
    showTime:     true,
  })
};

// ---- Quick events (settings.localEvents) ----------------------------
// Expanded at render time on every surface, so the editor's modal
// preview shows an event the moment it's typed — no save/refetch lag.
// Rows: { title, date: 'YYYY-MM-DD', time?: 'HH:MM', repeat? }.

function fmtLocalTime(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}
function fmtLocalDay(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const evDay = new Date(d); evDay.setHours(0, 0, 0, 0);
  const diff = Math.round((evDay - today) / 86400000);
  if (diff === 0) return 'TODAY';
  if (diff === 1) return 'TMRW';
  return DAY_INITIALS[d.getDay()];
}
function localSection(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const evDay = new Date(d); evDay.setHours(0, 0, 0, 0);
  const diff = Math.round((evDay - today) / 86400000);
  if (diff === 0) return 'TODAY';
  if (diff === 1) return 'TOMORROW';
  if (diff < 7)   return 'THIS WEEK';
  return 'LATER';
}

export function expandLocalEvents(list) {
  const out = [];
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const horizon = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
  for (const row of Array.isArray(list) ? list : []) {
    if (!row || typeof row.title !== 'string' || !row.title.trim()) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(row.date || '').trim());
    if (!m) continue;
    const t = /^(\d{1,2}):(\d{2})$/.exec(String(row.time || '').trim());
    const isAllDay = !t;
    const anchor = new Date(+m[1], +m[2] - 1, +m[3], t ? +t[1] : 0, t ? +t[2] : 0);
    if (isNaN(anchor.getTime())) continue;
    const repeat = String(row.repeat || 'none');
    const cutoff = isAllDay ? startOfToday : now;
    const d = new Date(anchor);
    const periodDays = { daily: 1, weekdays: 1, weekly: 7, biweekly: 14 }[repeat];
    if (periodDays && d < cutoff) {
      const behind = Math.floor((cutoff - d) / (periodDays * 86400000));
      if (behind > 0) d.setDate(d.getDate() + behind * periodDays);
    }
    const occurrences = [];
    for (let i = 0; i < 800 && d <= horizon; i++) {
      const weekdayOk = repeat !== 'weekdays' || (d.getDay() >= 1 && d.getDay() <= 5);
      if (d >= cutoff && weekdayOk) occurrences.push(new Date(d));
      if (repeat === 'none') break;
      if (repeat === 'daily' || repeat === 'weekdays') d.setDate(d.getDate() + 1);
      else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
      else if (repeat === 'biweekly') d.setDate(d.getDate() + 14);
      else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
      else if (repeat === 'yearly') d.setFullYear(d.getFullYear() + 1);
      if (occurrences.length >= 20) break;
    }
    for (const start of occurrences) {
      out.push({
        title: row.title.trim(),
        startISO: start.toISOString(),
        endISO: null,
        startLabel: isAllDay ? 'ALL DAY' : fmtLocalTime(start),
        dayLabel: fmtLocalDay(start),
        section: localSection(start),
        isAllDay
      });
    }
  }
  return out;
}

export function render(ctx) {
  const { events, cfg, settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const urls = collectUrls(settings, cfg);
  const locals = expandLocalEvents(s.localEvents);
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim()
    : 'UPCOMING';
  if (!urls.length && !locals.length) return placeholder(titleLabel, 'Add a feed or a quick event', 'calendar', { cellW, cellH }, 'setup');
  const all = [...(events || []), ...locals]
    .sort((a, b) => String(a.startISO || '').localeCompare(String(b.startISO || '')));
  if (!all.length) return placeholder(titleLabel, 'No events in the next 14 days', 'calendar', { cellW, cellH }, 'empty');
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
  if (mode === 'trmnl') return renderTrmnl(all, settings, titleLabel, cellW, cellH, density);
  if (mode === 'month' && cellW >= 7 && cellH >= 4) return renderMonth(all, titleLabel, settings, cellH);
  if (mode === 'strip' && cellW >= 7 && cellH >= 2) return renderStrip(all, titleLabel, cellW, cellH, settings, 7);
  if (mode === 'strip5' && cellW >= 5 && cellH >= 2) return renderStrip(all, titleLabel, cellW, cellH, settings, 5);
  return renderList(all, settings, titleLabel, cellW, cellH, density);
}

// ---------- TRMNL agenda (title-bar card, time/title/day rows) --------

function renderTrmnl(all, settings, titleLabel, cellW, cellH, density) {
  const s = settings || {};
  const tier = pickTier(cellW, cellH, density);
  // Each event is a two-line row (day + title over time), so the budget is
  // lower than a single-line list's at the same tier.
  const maxRows = { tiny: 1, compact: 2, standard: 4, extended: 6, full: 8 }[tier] || 4;
  const showTime = s.showTime !== false;
  const showDay  = s.showDayLabel !== false;
  const list = all.slice(0, maxRows);
  const soonCutoff = Date.now() + 24 * 3600 * 1000;
  const rows = list.map((ev, i) => {
    const time = ev.isAllDay ? 'ALL&nbsp;DAY' : escapeHtml(ev.startLabel || '');
    const day  = showDay ? escapeHtml(ev.dayLabel || '') : '';
    // Mark the soonest event "now/next" with a solid left accent bar
    // (see .tr-row-now — no dither behind text; keeps 1-bit legibility).
    const isNext = i === 0;
    // Timed events inside 24h: time goes red (semantic red).
    const soon = !ev.isAllDay && ev.startISO && Date.parse(ev.startISO) < soonCutoff;
    return `<div class="tr-row${isNext ? ' tr-row-now' : ''}"><div class="tr-row-inner">
      ${showTime ? `<div class="tr-row-time${soon ? semRed(s, true) : ''}">${time}</div>` : ''}
      <div class="tr-row-main">
        <div class="tr-row-title">${escapeHtml(ev.title || '')}</div>
        ${day ? `<div class="tr-row-sub">${day}</div>` : ''}
      </div>
    </div></div>`;
  }).join('');
  // Fewer events than the tier allows → rows grow to fill the card (no big
  // gap below) and the title text grows with the space (autofit-grow).
  const under = list.length < maxRows;
  const fill = under ? ' tr-rows-fill' : '';
  const rowsStyle = under ? `--row-font:${fillRowFont(cellH, list.length)}px` : '';
  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${all.length} event${all.length === 1 ? '' : 's'}</span></div>
    <div class="tr-body" style="padding:6px 14px;gap:0"><div class="tr-rows${fill}" style="${rowsStyle}">${rows}</div></div>
  </div>`;
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
  // Section headings (TODAY / LATER) take a row's worth of height each, but
  // the budget above counts events only — so at the tiers that show sections
  // the last event was pushed past the tile edge. Pay for the headings out of
  // the same budget.
  const sectionCount = t.sections
    ? new Set(all.slice(0, t.events).map(ev => ev.section || 'LATER')).size
    : 0;
  const list = all.slice(0, Math.max(1, t.events - sectionCount));
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
        <div class="cal-section-title${s === 'TODAY' ? semRed(settings, true) : ''}">${s}</div>
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

function renderStrip(events, titleLabel, cellW, cellH, settings, dayCount = 7) {
  const s = settings || {};
  const showTime = s.showTime !== false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  const soonCutoff = Date.now() + 24 * 3600 * 1000;
  // Bucket events per day key. Multi-day events (endISO) land in every
  // day they span, capped at the strip's 7-day window.
  const byDay = {};
  const put = (d, ev) => {
    const k = dayKey(d);
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(ev);
  };
  const windowEnd = new Date(today); windowEnd.setDate(today.getDate() + dayCount);
  for (const ev of events) {
    const start = eventDate(ev);
    put(start, ev);
    if (ev.endISO) {
      const end = new Date(ev.endISO);
      const d = new Date(start); d.setHours(0, 0, 0, 0);
      for (d.setDate(d.getDate() + 1); d <= end && d < windowEnd; d.setDate(d.getDate() + 1)) {
        put(new Date(d), { ...ev, _cont: true });
      }
    }
  }
  // Wider 5-day columns wrap less, so titles need fewer clamped lines —
  // but each event can safely show one more line of text.
  const clampLines = (cellH < 5 ? 1 : cellH < 8 ? 2 : 4) + (dayCount <= 5 ? 1 : 0);
  // Per-day fill budget from real pixels. Estimating every event at the
  // full clamp height under-filled columns of short titles (+1 above
  // inches of white), so estimate each event from its own title length
  // and greedy-fill until the column is actually out of room.
  const availPx = (cellH || 2) * 40 - 64;
  const colPx = Math.max(40, (cellW || 24) * (800 / 24) / dayCount - 14);
  const charsPerLine = Math.max(6, Math.floor(colPx / 7.2)); // 11px mono + tracking
  const estPx = (ev) => {
    const timeLen = ev.isAllDay || !ev.startLabel ? 0 : ev.startLabel.length + 1;
    const lines = Math.min(clampLines, Math.max(1, Math.ceil((timeLen + (ev.title || '').length) / charsPerLine)));
    return lines * 13 + 12; // line-height + gap/padding
  };
  const fitCount = (evs) => {
    let used = 0;
    for (let i = 0; i < evs.length; i++) {
      const h = estPx(evs[i]);
      // Reserve one text line for the +N marker if anything would remain.
      const reserve = i < evs.length - 1 ? 14 : 0;
      if (used + h + reserve > availPx) return Math.max(1, i);
      used += h;
    }
    return evs.length;
  };
  const cell = (d, i) => {
    const k = dayKey(d);
    const evs = byDay[k] || [];
    const isToday = i === 0;
    const dayNum = d.getDate();
    const dayName = DAY_INITIALS[d.getDay()];
    const linesPer = fitCount(evs);
    const lines = evs.slice(0, linesPer).map(ev => {
      // Timed events starting inside 24h ride the red plane (semantic
      // red — greyscales to dark on the BW panel). Continuation days of
      // a multi-day event show an arrow instead of repeating the time.
      const soon = !ev._cont && !ev.isAllDay && ev.startISO
        && Date.parse(ev.startISO) < soonCutoff;
      const time = ev._cont
        ? '<span class="strip-event-time">↳</span> '
        : (showTime && !ev.isAllDay && ev.startLabel
          ? `<span class="strip-event-time">${escapeHtml(ev.startLabel)}</span> `
          : '');
      return `
      <div class="strip-event ${ev.isAllDay ? 'strip-allday' : ''}${soon ? semRed(s, true) : ''}">${time}${escapeHtml(ev.title)}</div>
    `;
    }).join('');
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
      <div class="cal-strip" style="--strip-clamp:${clampLines};--strip-days:${dayCount}">
        ${days.map(cell).join('')}
      </div>
    </div>
  `;
}

// ---------- month grid view -----------------------------------------

const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function renderMonth(events, titleLabel, settings, cellH) {
  const s = settings || {};
  // Tall tiles have room for the event title to wrap inside a day cell;
  // short ones keep the single-line ellipsis (--month-clamp default 1).
  const clampLines = cellH >= 6 ? 2 : 1;
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
      <div class="month-grid" style="grid-template-rows:repeat(${rowCount}, 1fr);--month-clamp:${clampLines}">${cellHtml}</div>
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

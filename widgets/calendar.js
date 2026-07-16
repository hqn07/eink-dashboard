// widgets/calendar.js
// Fetches an iCal feed (Google Calendar, iCloud, etc.) and returns upcoming
// events. Recurring events (RRULE) are expanded into individual occurrences
// within the 14-day window, honoring EXDATE exclusions and RECURRENCE-ID
// overrides (moved/renamed instances).

const ical = require('node-ical');
const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // url → { at, events }

// Safety cap per recurring event. The window is only 14 days, but a
// pathological FREQ=MINUTELY rule could still explode into thousands of
// occurrences and stall the render.
const MAX_OCCURRENCES = 100;

// node-ical keys `exdate` and `recurrences` by local calendar date
// ("YYYY-MM-DD") in the event's own timezone. Format an occurrence the
// same way so lookups match even when the event's local date differs
// from the UTC date (e.g. a 10 PM New York event is already "tomorrow"
// in UTC).
const _dayKeyFormatters = new Map();
function occurrenceDayKey(date, tzid) {
  if (tzid) {
    let f = _dayKeyFormatters.get(tzid);
    if (f === undefined) {
      try {
        // en-CA formats as YYYY-MM-DD directly.
        f = new Intl.DateTimeFormat('en-CA', {
          timeZone: tzid, year: 'numeric', month: '2-digit', day: '2-digit'
        });
      } catch {
        f = null; // unknown tz string in the feed — fall through to UTC
      }
      _dayKeyFormatters.set(tzid, f);
    }
    if (f) return f.format(date);
  }
  return date.toISOString().slice(0, 10);
}

// Expand one VEVENT into its occurrence list within [windowStart, horizon].
// Non-recurring events yield themselves; recurring events yield each
// rrule hit, swapped for the override instance when one exists for that
// date. Returns [{ start, summary }].
function expandEvent(ev, windowStart, horizon) {
  if (!ev.rrule) {
    return ev.start ? [{ start: ev.start, summary: ev.summary }] : [];
  }
  const tzid = (ev.rrule.origOptions && ev.rrule.origOptions.tzid)
    || (ev.start && ev.start.tz) || null;
  const out = [];
  const seenKeys = new Set();
  const dates = ev.rrule.between(windowStart, horizon, true).slice(0, MAX_OCCURRENCES);
  for (const d of dates) {
    const key = occurrenceDayKey(d, tzid);
    seenKeys.add(key);
    if (ev.exdate && ev.exdate[key]) continue;
    const override = ev.recurrences && ev.recurrences[key];
    if (override) {
      if (override.start) out.push({ start: override.start, summary: override.summary || ev.summary });
    } else {
      out.push({ start: d, summary: ev.summary });
    }
  }
  // Overrides can move an occurrence INTO the window from a source date
  // outside it (e.g. last week's session rescheduled to tomorrow). Those
  // keys never come back from rrule.between above, so sweep them too.
  if (ev.recurrences) {
    for (const key of Object.keys(ev.recurrences)) {
      if (seenKeys.has(key)) continue;
      const o = ev.recurrences[key];
      if (o && o.start && o.start >= windowStart && o.start <= horizon) {
        out.push({ start: o.start, summary: o.summary || ev.summary });
      }
    }
  }
  return out;
}

// limit guards against pathological feeds, not display — each view caps
// its own rows. 5 used to starve the 7-day strip (five nearest events =
// ~3 days, the rest of the week rendered empty).
async function fetchEvents(icalUrl, limit = 50) {
  if (!icalUrl) return [];
  // Apple's "Subscribe" links use webcal:// — plain HTTP(S) underneath.
  icalUrl = String(icalUrl).replace(/^webcal:\/\//i, 'https://');

  const now = Date.now();
  const hit = cache.get(icalUrl);
  if (hit && (now - hit.at) < CACHE_MS) { status.cacheHit('calendar'); return hit.events; }

  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout(icalUrl, { headers: { 'User-Agent': 'eink-dashboard/1.0' } });
    if (!r.ok) {
      status.record('calendar', { ok: false, ms: Date.now() - t0, err: `HTTP ${r.status}` });
      return hit?.events || [];
    }
    const text = await r.text();
    const data = ical.sync.parseICS(text);
    const upcoming = [];
    const nowDate = new Date();
    const horizon = new Date(nowDate.getTime() + 14 * 24 * 3600 * 1000);

    const startOfToday = new Date(nowDate);
    startOfToday.setHours(0, 0, 0, 0);

    for (const k in data) {
      const ev = data[k];
      if (ev.type !== 'VEVENT') continue;
      if (!ev.start) continue;

      // iCal all-day events arrive with start.dateOnly === true or
      // datetype === 'date' depending on parser version. The flag lives
      // on the parent event; occurrences inherit it.
      const isAllDay = !!(ev.start.dateOnly || ev.datetype === 'date');

      // All-day events start at midnight, so a plain `start < now`
      // check would hide today's all-day events for the whole day.
      // Keep them until the day rolls over.
      const cutoff = isAllDay ? startOfToday : nowDate;

      // Duration from the parent event so multi-day events can render on
      // every day they span. iCal DTEND is exclusive for all-day events
      // (a Mon–Wed event carries DTEND Thu) — subtract a tick so the
      // computed end lands inside the last real day.
      let durMs = 0;
      if (ev.end && ev.start) {
        durMs = new Date(ev.end).getTime() - new Date(ev.start).getTime();
        if (isAllDay && durMs > 0) durMs -= 1;
      }

      for (const occ of expandEvent(ev, startOfToday, horizon)) {
        const start = occ.start;
        if (start < cutoff || start > horizon) continue;
        const startMs = start.toISOString ? start.getTime() : new Date(start).getTime();
        upcoming.push({
          title: (occ.summary || 'Untitled').toString(),
          start,
          startISO: start.toISOString ? start.toISOString() : new Date(start).toISOString(),
          endISO: durMs > 0 ? new Date(startMs + durMs).toISOString() : null,
          startLabel: isAllDay ? 'ALL DAY' : formatEventTime(start),
          dayLabel: formatEventDay(start),
          section: sectionFor(start),
          isAllDay
        });
      }
    }

    upcoming.sort((a, b) => a.start - b.start);
    const trimmed = upcoming.slice(0, limit);
    cache.set(icalUrl, { at: now, events: trimmed });
    status.record('calendar', { ok: true, ms: Date.now() - t0 });
    return trimmed;
  } catch (err) {
    status.record('calendar', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    return hit?.events || [];
  }
}

function formatEventTime(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

const DAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
function formatEventDay(d) {
  const today = new Date(); today.setHours(0,0,0,0);
  const evDay = new Date(d); evDay.setHours(0,0,0,0);
  const diff = Math.round((evDay - today) / (24 * 3600 * 1000));
  if (diff === 0) return 'TODAY';
  if (diff === 1) return 'TMRW';
  return DAYS[d.getDay()];
}

function sectionFor(d) {
  const today = new Date(); today.setHours(0,0,0,0);
  const evDay = new Date(d); evDay.setHours(0,0,0,0);
  const diff = Math.round((evDay - today) / (24 * 3600 * 1000));
  if (diff === 0) return 'TODAY';
  if (diff === 1) return 'TOMORROW';
  if (diff < 7)   return 'THIS WEEK';
  return 'LATER';
}

module.exports = { fetchEvents };

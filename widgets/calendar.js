// widgets/calendar.js
// Fetches an iCal feed (Google Calendar, iCloud, etc.) and returns upcoming events.

const ical = require('node-ical');
const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // url → { at, events }

async function fetchEvents(icalUrl, limit = 5) {
  if (!icalUrl) return [];

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

    for (const k in data) {
      const ev = data[k];
      if (ev.type !== 'VEVENT') continue;
      const start = ev.start;
      if (!start) continue;
      if (start < nowDate || start > horizon) continue;

      // iCal all-day events arrive with start.dateOnly === true or
      // datetype === 'date' depending on parser version.
      const isAllDay = !!(start.dateOnly || ev.datetype === 'date');

      upcoming.push({
        title: (ev.summary || 'Untitled').toString(),
        start,
        startISO: start.toISOString ? start.toISOString() : new Date(start).toISOString(),
        startLabel: isAllDay ? 'ALL DAY' : formatEventTime(start),
        dayLabel: formatEventDay(start),
        section: sectionFor(start),
        isAllDay
      });
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

// widgets/calendar.js
// Fetches an iCal feed (Google Calendar, iCloud, etc.) and returns upcoming events.

const ical = require('node-ical');

const CACHE_MS = 10 * 60 * 1000;
let cache = { at: 0, url: null, events: [] };

async function fetchEvents(icalUrl, limit = 5) {
  if (!icalUrl) return [];

  const now = Date.now();
  if (cache.url === icalUrl && (now - cache.at) < CACHE_MS) {
    return cache.events;
  }

  try {
    const data = await ical.async.fromURL(icalUrl);
    const upcoming = [];
    const nowDate = new Date();
    const horizon = new Date(nowDate.getTime() + 14 * 24 * 3600 * 1000);

    for (const k in data) {
      const ev = data[k];
      if (ev.type !== 'VEVENT') continue;
      const start = ev.start;
      if (!start) continue;
      if (start < nowDate || start > horizon) continue;

      upcoming.push({
        title: (ev.summary || 'Untitled').toString(),
        start,
        startLabel: formatEventTime(start),
        dayLabel: formatEventDay(start)
      });
    }

    upcoming.sort((a, b) => a.start - b.start);
    const trimmed = upcoming.slice(0, limit);
    cache = { at: now, url: icalUrl, events: trimmed };
    return trimmed;
  } catch (err) {
    console.error('Calendar error:', err.message);
    return cache.events;
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

module.exports = { fetchEvents };

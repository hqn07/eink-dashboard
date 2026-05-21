// Recurring chore reminder. cfg.chores = [{ label, weekday: 0..6, time }].
// Computes the next occurrence (today if matching weekday + still ahead,
// otherwise the next match in the rolling week).
const DAY_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function nowInTz(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short'
    }).formatToParts(new Date());
    const get = (t) => (parts.find(p => p.type === t) || {}).value;
    return {
      year: parseInt(get('year'), 10),
      month: parseInt(get('month'), 10),
      day: parseInt(get('day'), 10),
      hour: parseInt(get('hour'), 10) % 24,
      minute: parseInt(get('minute'), 10),
      weekday: DAY_NAMES.indexOf((get('weekday') || '').toUpperCase().slice(0, 3))
    };
  } catch {
    const d = new Date();
    return {
      year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
      hour: d.getHours(), minute: d.getMinutes(), weekday: d.getDay()
    };
  }
}

function parseHHMM(s) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function buildChores(list, tz) {
  if (!Array.isArray(list) || !list.length) return [];
  const now = nowInTz(tz);
  const nowMin = now.hour * 60 + now.minute;
  return list.map(c => {
    const wd = Number.isFinite(c.weekday) ? Math.max(0, Math.min(6, c.weekday | 0)) : null;
    const timeMin = parseHHMM(c.time);
    let dayDelta;
    let label;
    if (wd == null) {
      dayDelta = null;
      label = '—';
    } else if (wd === now.weekday) {
      if (timeMin != null && timeMin > nowMin) {
        dayDelta = 0;
        label = 'TODAY';
      } else {
        dayDelta = 7;
        label = `NEXT ${DAY_NAMES[wd]}`;
      }
    } else {
      dayDelta = (wd - now.weekday + 7) % 7;
      label = dayDelta === 1 ? 'TOMORROW' : DAY_NAMES[wd];
    }
    return {
      label: c.label || '',
      weekday: wd != null ? DAY_NAMES[wd] : '—',
      time: c.time || '',
      dueLabel: label,
      dayDelta
    };
  }).sort((a, b) => {
    const da = a.dayDelta == null ? 999 : a.dayDelta;
    const db = b.dayDelta == null ? 999 : b.dayDelta;
    return da - db;
  });
}

module.exports = { buildChores };

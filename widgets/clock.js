// widgets/clock.js
// Server-side time formatter for the clock widget. Refreshed once per
// dashboard cycle, so the displayed time is accurate to the panel's
// refresh interval (typically 30 min) — not a real second-ticker. The
// alarm system runs separately and uses an NTP-synced wake on the
// device, independent of this widget.
//
// Settings shape (per-tile):
//   { format: '12h' | '24h', showDate: boolean, style: 'big' | 'thin' }

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAYS   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function partsInTz(tz) {
  // formatToParts gives us numeric Y/M/D/h/m + weekday in the target
  // timezone without parsing strings.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'UTC',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    weekday: 'short'
  });
  const parts = fmt.formatToParts(new Date());
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  return {
    year:    parseInt(out.year, 10),
    month:   parseInt(out.month, 10),
    day:     parseInt(out.day, 10),
    hour:    parseInt(out.hour, 10),
    minute:  parseInt(out.minute, 10),
    weekday: (out.weekday || '').toUpperCase()
  };
}

function buildClock(settings, tz) {
  const s = settings || {};
  const use24 = s.format === '24h';
  const showDate = s.showDate !== false;  // default on
  const style = s.style === 'thin' ? 'thin' : 'big';

  const p = partsInTz(tz);
  let hh, ampm = '';
  if (use24) {
    hh = String(p.hour).padStart(2, '0');
  } else {
    let h = p.hour % 12; if (h === 0) h = 12;
    hh = String(h);
    ampm = p.hour >= 12 ? 'PM' : 'AM';
  }
  const mm = String(p.minute).padStart(2, '0');
  const timeStr = use24 ? `${hh}:${mm}` : `${hh}:${mm}`;
  const dateLine = showDate
    ? `${p.weekday} ${MONTHS[p.month - 1]} ${p.day}`
    : null;

  return {
    timeStr,
    ampm,
    dateLine,
    style,
    use24
  };
}

module.exports = { buildClock };

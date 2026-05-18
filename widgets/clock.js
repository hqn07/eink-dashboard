// Server-side current-time payload for the clock widget. Resolves to
// the configured tz so the dashboard render = wall clock in that zone.
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAYS   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function buildClockNow(tz) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC',
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short'
    }).formatToParts(new Date());
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short'
    }).formatToParts(new Date());
  }
  const get = (t) => (parts.find(p => p.type === t) || {}).value;
  const hour = parseInt(get('hour'), 10) % 24;
  const minute = parseInt(get('minute'), 10);
  const second = parseInt(get('second'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  const year = parseInt(get('year'), 10);
  const dow = (get('weekday') || '').toUpperCase().slice(0, 3);
  return {
    hour, minute, second,
    dateLabel: `${dow} ${MONTHS[month - 1]} ${day}, ${year}`
  };
}

module.exports = { buildClockNow };

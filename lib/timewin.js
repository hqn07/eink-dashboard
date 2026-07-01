// Time-window helpers: HH:MM parsing, timezone-aware "minutes since local
// midnight", and schedule → [a,b) interval expansion. Pure (aside from a
// per-tz Intl.DateTimeFormat cache); used by screen scheduling, widget
// visibility windows, and the weather-check route. Named timewin to avoid
// clashing with any future date/time-formatting module.

function parseHHMM(s) {
  if (typeof s !== 'string') return NaN;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return NaN;
  return h * 60 + mm;
}

// Intl.DateTimeFormat construction is surprisingly costly (~ms per call).
// Cache one formatter per tz string so the per-request hot path is just a
// `formatToParts(new Date())`.
const _hmFormatters = new Map();
function hmFormatter(tz) {
  let f = _hmFormatters.get(tz);
  if (f) return f;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit'
    });
  } catch {
    f = null;
  }
  _hmFormatters.set(tz, f);
  return f;
}

function localMinutesNow(tz) {
  const f = hmFormatter(tz);
  if (!f) {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
  const parts = f.formatToParts(new Date());
  let h = 0, m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
    if (p.type === 'minute') m = parseInt(p.value, 10);
  }
  return h * 60 + m;
}

// Each enabled schedule becomes one or two [a,b) minute intervals.
function scheduleIntervals(sch) {
  if (!sch || !sch.enabled) return [];
  const a = parseHHMM(sch.from);
  const b = parseHHMM(sch.to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return [];
  if (a < b) return [[a, b]];
  return [[a, 1440], [0, b]];
}

module.exports = { parseHHMM, hmFormatter, localMinutesNow, scheduleIntervals };

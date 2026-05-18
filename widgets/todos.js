// Server-side todo prep: resets recurring=daily items at local midnight,
// hides done items older than HIDE_HOURS, sorts dueDate ascending.
const HIDE_HOURS = 4;

function localStartOfTodayMs(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const tp = (t) => parseInt((parts.find(p => p.type === t) || {}).value, 10);
    // Use Date.UTC for a stable reference; we only need this for "did the
    // calendar day change since completedAt?" comparisons.
    return Date.UTC(tp('year'), tp('month') - 1, tp('day'));
  } catch {
    const d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
}

function prepTodos(raw, tz) {
  if (!Array.isArray(raw)) return [];
  const todayMs = localStartOfTodayMs(tz);
  const nowMs = Date.now();
  return raw
    .map(t => ({ ...t }))
    .map(t => {
      // Reset recurring=daily items if completedAt is from a prior local day.
      if (t.recurring === 'daily' && t.done && t.completedAt) {
        const cMs = new Date(t.completedAt).getTime();
        if (Number.isFinite(cMs) && cMs < todayMs) {
          t.done = false;
          t.completedAt = null;
        }
      }
      return t;
    })
    .filter(t => {
      // Hide non-recurring done items older than HIDE_HOURS.
      if (!t.done) return true;
      if (t.recurring === 'daily') return true; // keep visible (struck) until midnight
      if (!t.completedAt) return true;
      const age = (nowMs - new Date(t.completedAt).getTime()) / 3600000;
      return age < HIDE_HOURS;
    })
    .sort((a, b) => {
      // Order: not-done first (by dueDate asc, undated last), then done.
      if (a.done !== b.done) return a.done ? 1 : -1;
      const ad = a.dueDate || '9999';
      const bd = b.dueDate || '9999';
      return ad.localeCompare(bd);
    });
}

module.exports = { prepTodos };

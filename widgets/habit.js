// Habit tracker. cfg.habits = [{ label, doneDates: ['YYYY-MM-DD', ...] }].
// Pure compute: builds the last N days (default 14) of completion bits +
// current and longest streaks per habit.
const WINDOW_DAYS = 14;

function ymd(dateMs) {
  const d = new Date(dateMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayUtcMsFromTz(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const tp = (t) => parseInt((parts.find(p => p.type === t) || {}).value, 10);
    return Date.UTC(tp('year'), tp('month') - 1, tp('day'));
  } catch {
    const d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
}

function buildHabits(list, tz) {
  if (!Array.isArray(list) || !list.length) return [];
  const today = todayUtcMsFromTz(tz);
  return list.map(h => {
    const doneSet = new Set(Array.isArray(h.doneDates) ? h.doneDates : []);
    const days = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      const ms = today - i * 86400000;
      const key = ymd(ms);
      days.push({ date: key, done: doneSet.has(key) });
    }
    // Current streak = consecutive done days walking back from today.
    let cur = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].done) cur += 1;
      else break;
    }
    // Longest streak inside the visible window.
    let longest = 0, run = 0;
    for (const d of days) {
      if (d.done) { run += 1; longest = Math.max(longest, run); }
      else { run = 0; }
    }
    return {
      label: h.label || '',
      days,
      currentStreak: cur,
      longestStreak: longest
    };
  });
}

module.exports = { buildHabits };

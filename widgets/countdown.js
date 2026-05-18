// Compute days/hours remaining for each cfg.countdowns entry.
// Each entry: { label: string, date: 'YYYY-MM-DD' or ISO }
function buildCountdowns(list, tz) {
  if (!Array.isArray(list) || !list.length) return [];
  const now = new Date();
  // Anchor "today" to local midnight in tz.
  let todayParts;
  try {
    todayParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
  } catch {
    todayParts = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
  }
  const tp = (t) => parseInt((todayParts.find(p => p.type === t) || {}).value, 10);
  const todayUTC = Date.UTC(tp('year'), tp('month') - 1, tp('day'));

  return list.map(c => {
    const m = String(c.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return { label: c.label || '', days: '--', unit: 'DAYS' };
    const targetUTC = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const diffMs = targetUTC - todayUTC;
    const days = Math.round(diffMs / 86400000);
    if (days === 0) return { label: c.label || '', days: 0, unit: 'TODAY' };
    if (days < 0) return { label: c.label || '', days: Math.abs(days), unit: 'DAYS AGO' };
    return { label: c.label || '', days, unit: days === 1 ? 'DAY' : 'DAYS' };
  });
}

module.exports = { buildCountdowns };

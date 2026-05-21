// Days-since-date counters. Mirror of countdown but counts UP from a
// past anchor. Each entry: { label, since: 'YYYY-MM-DD', unit }.
function buildCounters(list, tz) {
  if (!Array.isArray(list) || !list.length) return [];
  let todayParts;
  try {
    todayParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
  } catch {
    todayParts = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
  }
  const tp = (t) => parseInt((todayParts.find(p => p.type === t) || {}).value, 10);
  const todayUTC = Date.UTC(tp('year'), tp('month') - 1, tp('day'));

  return list.map(c => {
    const m = String(c.since || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    const unit = (c.unit || 'DAYS').toString().toUpperCase();
    if (!m) return { label: c.label || '', count: '--', unit };
    const sinceUTC = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const days = Math.max(0, Math.floor((todayUTC - sinceUTC) / 86400000));
    return { label: c.label || '', count: days, unit };
  });
}

module.exports = { buildCounters };

// GitHub contributions grid scraper. Uses the public profile-contributions
// HTML page (no auth). Returns weeks[][] of intensity levels 0-4 + total count.
// 1-hour cache.
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map();

async function fetchGithub(user) {
  if (!user) return null;
  const hit = cache.get(user);
  if (hit && (Date.now() - hit.at) < CACHE_MS) return hit.data;
  try {
    const url = `https://github.com/users/${encodeURIComponent(user)}/contributions`;
    const r = await fetch(url, { headers: { 'User-Agent': 'eink-dashboard/1.0' } });
    if (!r.ok) return hit?.data || null;
    const html = await r.text();

    const totalMatch = html.match(/(\d[\d,]*)\s+contribution/i);
    const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) : 0;

    // GitHub orders attributes inconsistently (data-date sometimes
    // before data-level, class sometimes last). Pull each
    // ContributionCalendar-day <td> as a whole, then extract attrs
    // attribute-order-agnostic.
    const tdRegex = /<td\b[^>]*ContributionCalendar-day[^>]*>/g;
    const days = [];
    for (const m of html.matchAll(tdRegex)) {
      const tag = m[0];
      const levelMatch = tag.match(/data-level="(\d)"/);
      const dateMatch  = tag.match(/data-date="(\d{4}-\d{2}-\d{2})"/);
      if (!dateMatch) continue;
      days.push({
        date: dateMatch[1],
        level: levelMatch ? parseInt(levelMatch[1], 10) : 0
      });
    }
    if (!days.length) return hit?.data || null;
    days.sort((a, b) => a.date.localeCompare(b.date));

    // Group into calendar weeks. GitHub starts each week on Sunday, so
    // we slot each day by its day-of-week into the corresponding 7-day
    // bucket — gives a stable rectangle even when the first week is
    // partial.
    const weeks = [];
    let currentWeek = null;
    let lastDow = -1;
    for (const d of days) {
      const dow = new Date(d.date + 'T00:00:00Z').getUTCDay();
      if (!currentWeek || dow <= lastDow) {
        currentWeek = [0, 0, 0, 0, 0, 0, 0];
        weeks.push(currentWeek);
      }
      currentWeek[dow] = d.level;
      lastDow = dow;
    }

    const result = { user, total, weeks };
    cache.set(user, { at: Date.now(), data: result });
    return result;
  } catch {
    return hit?.data || null;
  }
}

module.exports = { fetchGithub };

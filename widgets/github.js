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

    // Each <td class="ContributionCalendar-day" data-level="N"> is one day.
    // Group into weeks by parent <tr>.
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    const dayRegex = /data-level="(\d)"/g;
    const totalMatch = html.match(/(\d[\d,]*)\s+contribution/i);
    const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) : 0;

    // GitHub renders rows as days-of-week (7 rows), cols as weeks.
    // Easier: pull each ContributionCalendar-day in document order — they
    // come week-by-week.
    const weeks = [];
    let week = [];
    const dayAll = [...html.matchAll(/<td[^>]*class="[^"]*ContributionCalendar-day[^"]*"[^>]*data-level="(\d)"[^>]*data-date="(\d{4}-\d{2}-\d{2})"/g)];
    // Group by week: a new week starts every 7 days OR when the date jumps backward (Sun → Sat).
    // Simpler: sort by date, group every 7.
    const sorted = dayAll
      .map(m => ({ level: parseInt(m[1], 10), date: m[2] }))
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const d of sorted) {
      week.push(d.level);
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length) weeks.push(week);

    const result = { user, total, weeks };
    cache.set(user, { at: Date.now(), data: result });
    return result;
  } catch {
    return hit?.data || null;
  }
}

module.exports = { fetchGithub };

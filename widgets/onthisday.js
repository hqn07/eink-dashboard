// "On This Day" — historical events for today's date, from Wikipedia's
// free REST feed (no key; a descriptive User-Agent is required or it
// 403s). Same no-key + cache + stale-fallback model as widgets/aqi.js.
//
// Reference: https://api.wikimedia.org/wiki/Feed_API/Reference/On_this_day

const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 6 * 60 * 60 * 1000;  // events for a date don't change.
const cacheMap = new Map();           // key: "MM-DD" → { at, data }
const UA = 'eink-dashboard/1.0 (https://github.com/hqn07/eink-dashboard; personal e-ink project)';
const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

async function fetchOnThisDay(now) {
  const d = new Date(Number.isFinite(now) ? now : Date.now());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const key = `${mm}-${dd}`;
  const cached = cacheMap.get(key);
  if (cached && (Date.now() - cached.at) < CACHE_MS) {
    status.record('onthisday', { ok: true, ms: 0, cacheHit: true });
    return cached.data;
  }
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`;
  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) {
      status.record('onthisday', { ok: false, ms: Date.now() - t0, err: `HTTP ${r.status}` });
      return cached?.data ? { ...cached.data, stale: true } : null;
    }
    const j = await r.json();
    const events = (Array.isArray(j.events) ? j.events : [])
      .filter(e => Number.isFinite(e.year) && typeof e.text === 'string' && e.text.trim())
      .sort((a, b) => b.year - a.year)   // most recent first
      .slice(0, 8)
      .map(e => ({ year: e.year, text: e.text.trim() }));
    if (!events.length) {
      status.record('onthisday', { ok: false, ms: Date.now() - t0, err: 'no events' });
      return cached?.data ? { ...cached.data, stale: true } : null;
    }
    const data = { dateLabel: `${MONTHS[d.getMonth()]} ${d.getDate()}`.toUpperCase(), events, stale: false };
    cacheMap.set(key, { at: Date.now(), data });
    status.record('onthisday', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('onthisday', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    return cached?.data ? { ...cached.data, stale: true } : null;
  }
}

module.exports = { fetchOnThisDay };

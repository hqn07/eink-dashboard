// Code Activity — GitHub contribution calendar, no token. Uses the public
// third-party github-contributions-api (jogruber), which returns the real
// green-square calendar as JSON (date/count/level 0-4). Same no-key model
// as widgets/aqi.js. The client widget (control-src/widgets/codeactivity.js)
// renders it via the shared heatmap primitive.
//
// Reference: https://github-contributions-api.jogruber.de

const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 60 * 60 * 1000;  // contributions change slowly; 1h is plenty.
const cacheMap = new Map();       // key: username → { at, data }

async function fetchCodeActivity(username) {
  const user = (typeof username === 'string' ? username.trim() : '');
  if (!user) return null;

  const cached = cacheMap.get(user);
  if (cached && (Date.now() - cached.at) < CACHE_MS) {
    status.record('codeactivity', { ok: true, ms: 0, cacheHit: true });
    return cached.data;
  }

  const t0 = Date.now();
  try {
    const url = `https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(user)}?y=last`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) {
      status.record('codeactivity', { ok: false, ms: Date.now() - t0, err: `HTTP ${r.status}` });
      return cached?.data ? { ...cached.data, stale: true } : null;
    }
    const j = await r.json();
    const all = Array.isArray(j.contributions) ? j.contributions : [];
    if (!all.length) {
      status.record('codeactivity', { ok: false, ms: Date.now() - t0, err: 'no contributions' });
      return cached?.data ? { ...cached.data, stale: true } : null;
    }
    // Flat, render-ready: oldest→newest days with the API's own 0-4 level.
    const days = all.map(d => ({ date: d.date, count: d.count | 0, level: d.level | 0 }));
    const total = days.reduce((s, d) => s + d.count, 0);
    const data = { user, days, total, stale: false };
    cacheMap.set(user, { at: Date.now(), data });
    status.record('codeactivity', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('codeactivity', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    return cached?.data ? { ...cached.data, stale: true } : null;
  }
}

module.exports = { fetchCodeActivity };

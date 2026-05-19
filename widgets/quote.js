const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');
// Pick the current quote payload. Three modes:
//   - static: use cfg.quote.text + attribution
//   - list:   rotate cfg.quote.list[] by day-of-year
//   - api:    pull from zenquotes.io 'today' endpoint, 6h cache
const CACHE_MS = 6 * 60 * 60 * 1000;
let apiCache = { at: 0, data: null };

function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

async function resolveQuote(cfg) {
  const q = cfg && cfg.quote ? cfg.quote : {};
  const source = q.source || 'static';
  if (source === 'list' && Array.isArray(q.list) && q.list.length) {
    const pick = q.list[dayOfYear() % q.list.length] || {};
    return { text: pick.text || '', attribution: pick.attribution || '', align: q.align || 'center' };
  }
  if (source === 'api') {
    const now = Date.now();
    if (apiCache.data && (now - apiCache.at) < CACHE_MS) { status.cacheHit('quote'); return apiCache.data; }
    const t0 = Date.now();
    try {
      const r = await fetchWithTimeout('https://zenquotes.io/api/today');
      if (r.ok) {
        const arr = await r.json();
        const item = Array.isArray(arr) && arr[0];
        if (item && item.q) {
          const result = { text: item.q, attribution: item.a || '', align: q.align || 'center' };
          apiCache = { at: now, data: result };
          status.record('quote', { ok: true, ms: Date.now() - t0 });
          return result;
        }
      }
      status.record('quote', { ok: false, ms: Date.now() - t0, err: r.ok ? 'empty payload' : `HTTP ${r.status}` });
    } catch (e) {
      status.record('quote', { ok: false, ms: Date.now() - t0, err: e.message || String(e) });
    }
    return apiCache.data || { text: q.text || '', attribution: q.attribution || '', align: q.align || 'center' };
  }
  return { text: q.text || '', attribution: q.attribution || '', align: q.align || 'center' };
}

module.exports = { resolveQuote };

// Currency / FX rates — frankfurter.app (free, no API key, ECB data).
// Returns a render-ready { base, date, rates:[{code, rate}] }. Cached per
// base+targets so multiple tiles / refreshes don't re-hit the source.
// Fiat only (no crypto — see widgets/crypto.js for that).

const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 30 * 60 * 1000; // ECB publishes ~once/day; 30 min is plenty.
const cache = new Map();          // key: "BASE|A,B,C" → { at, data }

async function fetchFx(settings) {
  const s = settings || {};
  const base = (typeof s.base === 'string' && s.base.trim())
    ? s.base.trim().toUpperCase() : 'USD';
  let targets = Array.isArray(s.targets)
    ? s.targets.map(t => String(t).toUpperCase()).filter(Boolean)
    : ['EUR', 'GBP'];
  // Frankfurter rejects base===target; drop any target equal to the base.
  targets = targets.filter(t => t !== base);
  if (!targets.length) targets = base === 'EUR' ? ['USD'] : ['EUR'];

  const key = `${base}|${targets.join(',')}`;
  const hit = cache.get(key);
  if (hit && (Date.now() - hit.at) < CACHE_MS) { status.cacheHit('fx'); return hit.data; }

  const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`
    + `&to=${encodeURIComponent(targets.join(','))}`;
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, 6000);
    if (!res.ok) {
      status.record('fx', { ok: false, ms: Date.now() - t0, err: `HTTP ${res.status}` });
      return hit ? { ...hit.data, stale: true } : null;
    }
    const j = await res.json();
    const rates = targets
      .map(code => ({ code, rate: j && j.rates ? j.rates[code] : undefined }))
      .filter(r => Number.isFinite(r.rate));
    const data = { base, date: (j && j.date) || '', rates, stale: false };
    cache.set(key, { at: Date.now(), data });
    status.record('fx', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('fx', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    return hit ? { ...hit.data, stale: true } : null;
  }
}

module.exports = { fetchFx };

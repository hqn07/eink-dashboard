// FX rates via api.frankfurter.app (ECB reference rates, no key).
// cfg.fx.pairs: ['USD/EUR', 'USD/JPY', ...]. Cached 1h per base.
const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map(); // base → { at, rates }

async function fetchRatesForBase(base) {
  const hit = cache.get(base);
  if (hit && (Date.now() - hit.at) < CACHE_MS) return hit;
  const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const entry = { at: Date.now(), rates: j.rates || {}, date: j.date || '' };
  cache.set(base, entry);
  return entry;
}

function formatRate(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toFixed(0);
  if (v >= 10)   return v.toFixed(2);
  if (v >= 1)    return v.toFixed(3);
  return v.toFixed(4);
}

async function fetchFx(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return [];
  const t0 = Date.now();
  try {
    // Group pairs by base so we hit the API at most once per base.
    const byBase = new Map();
    for (const raw of pairs) {
      const m = String(raw || '').toUpperCase().match(/^([A-Z]{3})\s*\/\s*([A-Z]{3})$/);
      if (!m) continue;
      const [, base, quote] = m;
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(quote);
    }
    const results = [];
    for (const [base, quotes] of byBase) {
      try {
        const entry = await fetchRatesForBase(base);
        for (const q of quotes) {
          const rate = entry.rates[q];
          results.push({
            pair: `${base}/${q}`,
            base,
            quote: q,
            rate: Number.isFinite(rate) ? rate : null,
            rateLabel: formatRate(rate),
            date: entry.date
          });
        }
      } catch (e) {
        for (const q of quotes) {
          results.push({ pair: `${base}/${q}`, base, quote: q, rate: null, rateLabel: '—', date: '' });
        }
      }
    }
    status.record('fx', { ok: results.some(r => r.rate != null), ms: Date.now() - t0, err: undefined });
    return results;
  } catch (e) {
    status.record('fx', { ok: false, ms: Date.now() - t0, err: e.message || String(e) });
    return [];
  }
}

module.exports = { fetchFx };

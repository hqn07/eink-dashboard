// Stocks — quotes via Yahoo Finance's public chart endpoint (keyless;
// 15-min delayed, fine for a panel that refreshes every 30). One request
// per symbol, cached 15 minutes, partial failures keep the rest of the
// tile alive.
const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');
const { BoundedMap } = require('./_cache');

const CACHE_MS = 15 * 60 * 1000;
const cache = new BoundedMap(128); // symbol → { at, quote }

const SYM_RE = /^[A-Z0-9.^=-]{1,12}$/;

async function fetchQuote(symbol) {
  const hit = cache.get(symbol);
  if (hit && (Date.now() - hit.at) < CACHE_MS) return hit.quote;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', accept: 'application/json' }
  }, 6000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  if (!m || !Number.isFinite(m.regularMarketPrice)) throw new Error('no quote');
  const prev = Number.isFinite(m.chartPreviousClose) ? m.chartPreviousClose : null;
  const quote = {
    symbol: m.symbol || symbol,
    price: m.regularMarketPrice,
    changePct: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : null,
    currency: m.currency || 'USD'
  };
  cache.set(symbol, { at: Date.now(), quote });
  return quote;
}

// settings: { symbols: ['AAPL', 'VOO', ...] }
async function fetchStocks(settings) {
  const s = settings || {};
  const symbols = (Array.isArray(s.symbols) ? s.symbols : [])
    .map(x => String(x || '').toUpperCase().trim())
    .filter(x => SYM_RE.test(x))
    .slice(0, 8);
  if (!symbols.length) return null;
  const t0 = Date.now();
  const results = await Promise.allSettled(symbols.map(fetchQuote));
  const quotes = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
  const failed = results.length - quotes.length;
  status.record('stocks', failed
    ? { ok: quotes.length > 0, ms: Date.now() - t0, err: `${failed}/${results.length} symbols failed` }
    : { ok: true, ms: Date.now() - t0 });
  if (!quotes.length) return null;
  return { quotes, stale: false };
}

module.exports = { fetchStocks };

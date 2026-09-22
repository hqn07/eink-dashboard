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

// Batch quotes for the heatmap, which wants 20-60 symbols rather than the
// row view's handful. Yahoo's spark endpoint takes up to **20 symbols per
// request** and answers with the day's change already computed, so 60 symbols
// is 3 requests instead of 60.
//
// Why not use it for the row view too: spark does not report a currency, and a
// row that prints a number without one is wrong for anything not listed in
// USD. The heatmap only draws a percentage, so it does not care.
//
// Shares the same 15-minute per-symbol cache as fetchQuote, so a symbol that
// appears in both a row tile and a heatmap tile is fetched once.
const SPARK_CHUNK = 20;

async function fetchSparkChunk(symbols) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/spark'
    + `?symbols=${encodeURIComponent(symbols.join(','))}&range=1d&interval=1d`;
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', accept: 'application/json' }
  }, 8000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  // The payload is keyed by symbol. An error response is an object with a
  // `spark` key instead, which has no symbols in it and so yields nothing.
  const out = [];
  for (const sym of symbols) {
    const row = j && j[sym];
    if (!row || !Number.isFinite(row.fulldayChangePercent)) continue;
    out.push({
      symbol: row.symbol || sym,
      price: Number.isFinite(row.fulldayPrice) ? row.fulldayPrice : null,
      changePct: row.fulldayChangePercent,
      currency: null
    });
  }
  return out;
}

// settings: { symbols: [...], limit } — returns { quotes, stale } like
// fetchStocks, minus the currency.
async function fetchStockPcts(settings) {
  const s = settings || {};
  const limit = Number.isFinite(s.limit) ? Math.max(1, Math.min(120, s.limit)) : 60;
  const symbols = (Array.isArray(s.symbols) ? s.symbols : [])
    .map(x => String(x || '').toUpperCase().trim())
    .filter(x => SYM_RE.test(x))
    .slice(0, limit);
  if (!symbols.length) return null;

  const fresh = [];
  const need = [];
  for (const sym of symbols) {
    const hit = cache.get(sym);
    if (hit && (Date.now() - hit.at) < CACHE_MS) fresh.push(hit.quote);
    else need.push(sym);
  }

  const t0 = Date.now();
  const chunks = [];
  for (let i = 0; i < need.length; i += SPARK_CHUNK) {
    chunks.push(need.slice(i, i + SPARK_CHUNK));
  }
  // allSettled per chunk: one bad chunk must not empty the other forty
  // symbols, same rule the row view follows per symbol.
  const results = await Promise.allSettled(chunks.map(fetchSparkChunk));
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const q of r.value) {
      cache.set(String(q.symbol).toUpperCase(), { at: Date.now(), quote: q });
      fresh.push(q);
    }
  }

  const failedChunks = results.filter(r => r.status === 'rejected').length;
  status.record('stocks', failedChunks
    ? { ok: fresh.length > 0, ms: Date.now() - t0, err: `${failedChunks}/${chunks.length} batches failed` }
    : { ok: true, ms: Date.now() - t0 });
  if (!fresh.length) return null;

  // Back into the order the user wrote them.
  const bySym = new Map(fresh.map(q => [String(q.symbol).toUpperCase(), q]));
  const quotes = symbols.map(sym => bySym.get(sym)).filter(Boolean);
  return { quotes, stale: false };
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

module.exports = { fetchStocks, fetchStockPcts };

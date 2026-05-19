// Stocks/crypto via Yahoo Finance unofficial quote endpoint.
// Symbols like 'AAPL', 'GOOG', 'BTC-USD', 'ETH-USD'.
// 15-min cache.
const { fetchWithTimeout } = require('./_fetch');
const CACHE_MS = 15 * 60 * 1000;
const cache = new Map();

function formatPrice(p) {
  if (!Number.isFinite(p)) return '—';
  if (p >= 1000) return p.toFixed(0);
  if (p >= 10)   return p.toFixed(2);
  return p.toFixed(4);
}

async function fetchOneSymbol(sym) {
  // Use the 1d range with 1h interval — gives ~24 hourly closes for a
  // sparkline + the latest meta for price/previousClose.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1h&range=1d`;
  const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 eink-dashboard' } });
  if (!r.ok) return null;
  const j = await r.json();
  const result = j.chart && j.chart.result && j.chart.result[0];
  if (!result) return null;
  const meta = result.meta || {};
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  if (!Number.isFinite(price)) return null;
  const change = Number.isFinite(prev) ? (price - prev) : 0;
  const changePct = Number.isFinite(prev) && prev !== 0 ? (change / prev) * 100 : 0;

  // Pull the close series for a sparkline. Filter out null gaps.
  const closes = ((result.indicators
    && result.indicators.quote
    && result.indicators.quote[0]
    && result.indicators.quote[0].close) || [])
    .filter(v => Number.isFinite(v));
  // Cap to ~20 points so the SVG isn't enormous.
  let points = closes;
  if (points.length > 24) {
    const step = points.length / 24;
    const sampled = [];
    for (let i = 0; i < 24; i++) sampled.push(points[Math.floor(i * step)]);
    points = sampled;
  }

  return {
    symbol: sym.toUpperCase(),
    price: formatPrice(price),
    change,
    changePct,
    spark: points
  };
}

async function fetchStocks(symbols) {
  if (!Array.isArray(symbols) || !symbols.length) return [];
  const key = symbols.join(',');
  const hit = cache.get(key);
  if (hit && (Date.now() - hit.at) < CACHE_MS) return hit.data;
  try {
    const results = await Promise.all(symbols.slice(0, 8).map(s => fetchOneSymbol(s).catch(() => null)));
    const filtered = results.filter(Boolean);
    if (filtered.length) cache.set(key, { at: Date.now(), data: filtered });
    return filtered;
  } catch {
    return hit?.data || [];
  }
}

module.exports = { fetchStocks };

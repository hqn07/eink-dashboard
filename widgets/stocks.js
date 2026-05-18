// Stocks/crypto via Yahoo Finance unofficial quote endpoint.
// Symbols like 'AAPL', 'GOOG', 'BTC-USD', 'ETH-USD'.
// 15-min cache.
const CACHE_MS = 15 * 60 * 1000;
const cache = new Map();

function formatPrice(p) {
  if (!Number.isFinite(p)) return '—';
  if (p >= 1000) return p.toFixed(0);
  if (p >= 10)   return p.toFixed(2);
  return p.toFixed(4);
}

async function fetchOneSymbol(sym) {
  // Use the chart endpoint with 1d interval — gives close + previousClose.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 eink-dashboard' } });
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
  return {
    symbol: sym.toUpperCase(),
    price: formatPrice(price),
    change,
    changePct
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

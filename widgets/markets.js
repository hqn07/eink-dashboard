// Markets — one tile for stocks, crypto and currency pairs.
//
// Replaces three widgets (stocks / crypto / fx) that rendered the SAME row —
// label, value, optional change — from three providers. Keeping them apart
// meant a tile could show equities or coins, never both, and three palette
// entries competed for the same job.
//
// No new network code: this parses the symbol list into buckets and calls the
// three existing fetchers, so their caching, timeouts, SSRF guard and partial-
// failure behaviour are unchanged. What is new is the ordering — rows come
// back in the order the user listed them, not grouped by provider, because
// the list is the user's own priority order.
const { fetchStocks, fetchStockPcts } = require('./stocks');
const { fetchCrypto, SYMBOLS } = require('./crypto');
const { fetchFx } = require('./fx');

// ticker -> CoinGecko id, from the map crypto.js already maintains.
const CRYPTO_ID_BY_TICKER = Object.create(null);
for (const [id, ticker] of Object.entries(SYMBOLS)) CRYPTO_ID_BY_TICKER[ticker] = id;

// What kind of thing is "BTC"? Ambiguity is real (tickers collide across
// asset classes), so the rules are declared, in order, and an explicit
// prefix always wins:
//   stock:VOO / crypto:BTC / fx:EUR/USD
//   anything with a slash            -> a currency pair
//   a known crypto ticker or a       -> crypto
//   lower-case CoinGecko id
//   everything else                  -> a stock symbol
function classify(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const m = /^(stock|crypto|fx)\s*:\s*(.+)$/i.exec(text);
  if (m) return { kind: m[1].toLowerCase(), symbol: m[2].trim() };
  if (text.includes('/')) return { kind: 'fx', symbol: text };
  const upper = text.toUpperCase();
  if (CRYPTO_ID_BY_TICKER[upper]) return { kind: 'crypto', symbol: upper };
  // A CoinGecko id is lower-case and may contain hyphens ("avalanche-2");
  // a stock symbol is upper-case. Treat a typed-lowercase entry that is a
  // known id as crypto, so migrated tiles keep working verbatim.
  if (SYMBOLS[text.toLowerCase()]) return { kind: 'crypto', symbol: text.toLowerCase() };
  return { kind: 'stock', symbol: upper };
}

function parseSymbols(list, limit = 10) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const c = classify(raw);
    if (c) out.push(c);
    if (out.length >= limit) break;   // a panel budget, not an API limit
  }
  return out;
}

function pct(n) { return Number.isFinite(n) ? n : null; }

// settings: { symbols: ['AAPL', 'BTC', 'EUR/USD'], vs: 'usd' }
async function fetchMarkets(settings) {
  const s = settings || {};
  // The heatmap is the same data at a different budget: a grid wants 20-60
  // symbols where a row list wants a handful, and the stock side switches to
  // the batch endpoint so that costs 3 requests rather than 60.
  const heat = s.variant === 'heat';
  const wanted = parseSymbols(s.symbols, heat ? 60 : 10);
  if (!wanted.length) return null;
  const vs = (typeof s.vs === 'string' && s.vs.trim()) ? s.vs.trim().toLowerCase() : 'usd';

  const stockSyms = wanted.filter(w => w.kind === 'stock').map(w => w.symbol);
  const cryptoIds = wanted.filter(w => w.kind === 'crypto')
    .map(w => CRYPTO_ID_BY_TICKER[w.symbol] || w.symbol.toLowerCase());
  const fxPairs = wanted.filter(w => w.kind === 'fx').map(w => w.symbol);

  // One fetch per provider regardless of how many symbols of that kind, and
  // all three in parallel. allSettled: a provider being down must not empty
  // the rows the other two returned.
  const fxByBase = new Map();      // base -> [targets]
  for (const p of fxPairs) {
    const [base, target] = p.split('/').map(x => (x || '').trim().toUpperCase());
    if (!base || !target) continue;
    if (!fxByBase.has(base)) fxByBase.set(base, []);
    fxByBase.get(base).push(target);
  }
  const [stocksRes, cryptoRes, ...fxRes] = await Promise.allSettled([
    stockSyms.length
      ? (heat ? fetchStockPcts({ symbols: stockSyms, limit: 60 })
              : fetchStocks({ symbols: stockSyms }))
      : Promise.resolve(null),
    cryptoIds.length ? fetchCrypto({ coins: cryptoIds, vs }) : Promise.resolve(null),
    ...[...fxByBase.entries()].map(([base, targets]) => fetchFx({ base, targets })),
  ]);
  const val = r => (r && r.status === 'fulfilled' ? r.value : null);

  const stocks = val(stocksRes);
  const crypto = val(cryptoRes);
  const quoteBySym = new Map();
  for (const q of (stocks && stocks.quotes) || []) quoteBySym.set(String(q.symbol).toUpperCase(), q);
  const coinById = new Map();
  for (const c of (crypto && crypto.coins) || []) coinById.set(c.id, c);
  const rateByPair = new Map();
  for (const r of fxRes.map(val)) {
    if (!r || !Array.isArray(r.rates)) continue;
    for (const row of r.rates) rateByPair.set(`${r.base}/${row.code}`, row.rate);
  }

  // Rebuild in the user's order. A symbol whose provider failed is dropped
  // rather than rendered blank — a row that says nothing is worse than one
  // fewer row on a wall panel.
  const rows = [];
  for (const w of wanted) {
    if (w.kind === 'stock') {
      const q = quoteBySym.get(w.symbol);
      if (q) rows.push({ label: q.symbol, value: q.price, change: pct(q.changePct), kind: 'stock' });
    } else if (w.kind === 'crypto') {
      const id = CRYPTO_ID_BY_TICKER[w.symbol] || w.symbol.toLowerCase();
      const c = coinById.get(id);
      if (c) rows.push({ label: c.symbol, value: c.price, change: pct(c.change24h), kind: 'crypto' });
    } else {
      const pair = w.symbol.toUpperCase();
      const rate = rateByPair.get(pair);
      if (Number.isFinite(rate)) rows.push({ label: pair, value: rate, change: null, kind: 'fx' });
    }
  }
  if (!rows.length) return null;

  const anyStale = [stocks, crypto, ...fxRes.map(val)].some(d => d && d.stale);
  return { rows, vs, stale: !!anyStale };
}

module.exports = { fetchMarkets, classify, parseSymbols };

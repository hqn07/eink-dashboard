// Crypto prices — CoinGecko simple/price (free, no API key). Returns a
// render-ready { vs, coins:[{ id, symbol, price, change24h }] }. Cached per
// ids+vs so multiple tiles / refreshes don't hit CoinGecko's rate limit.

const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');
const { BoundedMap } = require('./_cache');

const CACHE_MS = 5 * 60 * 1000; // 5 min — well under CoinGecko's free limit.
const cache = new BoundedMap(32);         // key: "ids|vs" → { at, data }

// Common CoinGecko id → ticker symbol. Falls back to the upper-cased id when
// unmapped, so any valid CoinGecko id still renders (just less pretty).
const SYMBOLS = {
  bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', cardano: 'ADA',
  dogecoin: 'DOGE', ripple: 'XRP', litecoin: 'LTC', polkadot: 'DOT',
  chainlink: 'LINK', 'avalanche-2': 'AVAX', 'matic-network': 'MATIC',
  tron: 'TRX', binancecoin: 'BNB', monero: 'XMR', 'usd-coin': 'USDC',
  tether: 'USDT', stellar: 'XLM', cosmos: 'ATOM'
};

function symbolFor(id) {
  return SYMBOLS[id] || String(id).replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
}

async function fetchCrypto(settings) {
  const s = settings || {};
  let ids = Array.isArray(s.coins)
    ? s.coins.map(c => String(c).trim().toLowerCase()).filter(Boolean)
    : ['bitcoin', 'ethereum'];
  if (!ids.length) ids = ['bitcoin'];
  const vs = (typeof s.vs === 'string' && s.vs.trim()) ? s.vs.trim().toLowerCase() : 'usd';

  const key = `${ids.join(',')}|${vs}`;
  const hit = cache.get(key);
  if (hit && (Date.now() - hit.at) < CACHE_MS) { status.cacheHit('crypto'); return hit.data; }

  const url = 'https://api.coingecko.com/api/v3/simple/price'
    + `?ids=${encodeURIComponent(ids.join(','))}`
    + `&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`;
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, 6000);
    if (!res.ok) {
      status.record('crypto', { ok: false, ms: Date.now() - t0, err: `HTTP ${res.status}` });
      return hit ? { ...hit.data, stale: true } : null;
    }
    const j = await res.json();
    // Preserve the user's ordering; drop ids CoinGecko didn't recognize.
    const coins = ids
      .map(id => {
        const row = j && j[id];
        if (!row || !Number.isFinite(row[vs])) return null;
        return { id, symbol: symbolFor(id), price: row[vs], change24h: row[`${vs}_24h_change`] };
      })
      .filter(Boolean);
    const data = { vs, coins, stale: false };
    cache.set(key, { at: Date.now(), data });
    status.record('crypto', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('crypto', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    return hit ? { ...hit.data, stale: true } : null;
  }
}

// SYMBOLS is exported so widgets/markets.js can build the reverse map and
// accept the tickers people actually type (BTC) rather than CoinGecko ids.
module.exports = { fetchCrypto, SYMBOLS };

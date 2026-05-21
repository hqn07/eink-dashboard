// ISS current position via api.wheretheiss.at (no key). Reverse-geocodes
// the lat/lon back to a country name via OpenStreetMap Nominatim so the
// widget can show "ISS over: Argentina" instead of raw coords.
// 60-second cache (position changes fast).
const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 60 * 1000;
let cache = null; // { at, data }

async function fetchIss() {
  if (cache && (Date.now() - cache.at) < CACHE_MS) { status.cacheHit('iss'); return cache.data; }
  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout('https://api.wheretheiss.at/v1/satellites/25544');
    if (!r.ok) {
      status.record('iss', { ok: false, ms: Date.now() - t0, err: `HTTP ${r.status}` });
      return cache ? cache.data : null;
    }
    const j = await r.json();
    const lat = j.latitude;
    const lon = j.longitude;
    const altKm = j.altitude;
    const velKmh = j.velocity;
    let place = '';
    // Best-effort reverse-geocode. Failure here is non-fatal: the
    // widget still renders coords + altitude.
    try {
      const rg = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=3`,
        { headers: { 'User-Agent': 'eink-dashboard/1.0 (https://github.com/hqn07/eink-dashboard)' } }
      );
      if (rg.ok) {
        const rj = await rg.json();
        const addr = rj.address || {};
        place = addr.country || addr.ocean || addr.sea || '';
      }
    } catch {}
    if (!place) {
      // Crude ocean guess if reverse-geocode failed entirely.
      place = 'OPEN OCEAN';
    }
    const data = {
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      altKm: Number.isFinite(altKm) ? Math.round(altKm) : null,
      velKmh: Number.isFinite(velKmh) ? Math.round(velKmh) : null,
      place: place.toUpperCase()
    };
    cache = { at: Date.now(), data };
    status.record('iss', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (e) {
    status.record('iss', { ok: false, ms: Date.now() - t0, err: e.message || String(e) });
    return cache ? cache.data : null;
  }
}

module.exports = { fetchIss };

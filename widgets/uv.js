// UV index — Open-Meteo forecast API (free, no key). Returns the current
// UV index plus today's forecast peak for the resolved location. Same
// provider + geocoder as widgets/weather.js / sun.js. Cached per lat/lon;
// UV moves slowly, so 30 min is plenty.

const { fetchWithTimeout } = require('./_fetch');
const { geocodeCity } = require('./weather');
const status = require('./_status');
const { BoundedMap } = require('./_cache');

const CACHE_MS = 30 * 60 * 1000;
const cache = new BoundedMap(64);          // key: "lat,lon" → { at, data }

async function fetchUv(cityOrCoords) {
  let lat, lon;
  if (cityOrCoords && typeof cityOrCoords === 'object'
      && Number.isFinite(cityOrCoords.lat) && Number.isFinite(cityOrCoords.lon)) {
    lat = cityOrCoords.lat; lon = cityOrCoords.lon;
  } else if (typeof cityOrCoords === 'string' && cityOrCoords.trim()) {
    const geo = await geocodeCity(cityOrCoords);
    if (!geo) return null;
    lat = geo.lat; lon = geo.lon;
  } else {
    return null;
  }

  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = cache.get(cacheKey);
  if (hit && (Date.now() - hit.at) < CACHE_MS) { status.cacheHit('uv'); return hit.data; }

  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    current: 'uv_index', daily: 'uv_index_max', timezone: 'auto'
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, 6000);
    if (!res.ok) {
      status.record('uv', { ok: false, ms: Date.now() - t0, err: `HTTP ${res.status}` });
      return hit ? { ...hit.data, stale: true } : null;
    }
    const j = await res.json();
    const cur = j && j.current;
    if (!cur || !Number.isFinite(+cur.uv_index)) {
      status.record('uv', { ok: false, ms: Date.now() - t0, err: 'no data' });
      return hit ? { ...hit.data, stale: true } : null;
    }
    const data = {
      uv: Math.max(0, +cur.uv_index),
      uvMax: (j.daily && Array.isArray(j.daily.uv_index_max) && Number.isFinite(+j.daily.uv_index_max[0]))
        ? Math.max(0, +j.daily.uv_index_max[0]) : null,
      stale: false
    };
    cache.set(cacheKey, { at: Date.now(), data });
    status.record('uv', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('uv', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    return hit ? { ...hit.data, stale: true } : null;
  }
}

module.exports = { fetchUv };

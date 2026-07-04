// Sunrise / sunset / daylight length — Open-Meteo forecast API (free, no key).
// Same provider + geocoder as widgets/weather.js and widgets/aqi.js. Returns
// today's { sunrise, sunset, daylightSec } as local ISO strings for the
// resolved location. Cached per lat/lon.

const { fetchWithTimeout } = require('./_fetch');
const { geocodeCity } = require('./weather');
const status = require('./_status');

const CACHE_MS = 30 * 60 * 1000; // sun times are fixed for the day
const cache = new Map();          // key: "lat,lon" → { at, data }

async function fetchSun(cityOrCoords) {
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
  if (hit && (Date.now() - hit.at) < CACHE_MS) { status.cacheHit('sun'); return hit.data; }

  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    daily: 'sunrise,sunset,daylight_duration', timezone: 'auto'
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, 6000);
    if (!res.ok) {
      status.record('sun', { ok: false, ms: Date.now() - t0, err: `HTTP ${res.status}` });
      return hit ? { ...hit.data, stale: true } : null;
    }
    const j = await res.json();
    const d = j && j.daily;
    if (!d || !Array.isArray(d.sunrise) || !d.sunrise.length) {
      status.record('sun', { ok: false, ms: Date.now() - t0, err: 'no data' });
      return hit ? { ...hit.data, stale: true } : null;
    }
    const data = {
      sunrise: d.sunrise[0],
      sunset: d.sunset[0],
      daylightSec: Array.isArray(d.daylight_duration) ? d.daylight_duration[0] : null,
      tz: j.timezone || 'UTC',
      stale: false
    };
    cache.set(cacheKey, { at: Date.now(), data });
    status.record('sun', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('sun', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    return hit ? { ...hit.data, stale: true } : null;
  }
}

module.exports = { fetchSun };

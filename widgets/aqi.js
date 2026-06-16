// Air Quality (US AQI) data fetcher — Open-Meteo Air-Quality API.
// Same provider + no-key model as widgets/weather.js; reuses that
// module's geocoder so a city string resolves the same way. Returns a
// flat, render-ready shape; the client widget (control-src/widgets/
// aqi.js) only formats it.
//
// Reference: https://open-meteo.com/en/docs/air-quality-api

const { fetchWithTimeout } = require('./_fetch');
const { geocodeCity } = require('./weather');
const status = require('./_status');

const CACHE_MS = 30 * 60 * 1000; // AQI moves slowly; 30 min is plenty.
const cacheMap = new Map();      // key: "lat,lon" → { at, data }

// EPA US AQI bands. `band` is the 0-based index used to position the
// scale marker; `label` is the short panel word (mono-cap legible).
const BANDS = [
  { max: 50,  label: 'GOOD' },
  { max: 100, label: 'MODERATE' },
  { max: 150, label: 'SENSITIVE' },   // Unhealthy for Sensitive Groups
  { max: 200, label: 'UNHEALTHY' },
  { max: 300, label: 'VERY UNHEALTHY' },
  { max: Infinity, label: 'HAZARDOUS' }
];

function classify(aqi) {
  for (let i = 0; i < BANDS.length; i++) {
    if (aqi <= BANDS[i].max) return { band: i, label: BANDS[i].label };
  }
  return { band: BANDS.length - 1, label: 'HAZARDOUS' };
}

async function fetchAqi(cityOrCoords) {
  // Resolve to lat/lon (object wins; string geocodes).
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
  const cached = cacheMap.get(cacheKey);
  if (cached && (Date.now() - cached.at) < CACHE_MS) {
    status.record('aqi', { ok: true, ms: 0, cacheHit: true });
    return cached.data;
  }

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide',
    timezone: 'auto'
  });
  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
    if (!r.ok) {
      status.record('aqi', { ok: false, ms: Date.now() - t0, err: `HTTP ${r.status}` });
      return cached?.data ? { ...cached.data, stale: true } : null;
    }
    const j = await r.json();
    const cur = j.current || {};
    const aqi = Math.round(Number(cur.us_aqi));
    if (!Number.isFinite(aqi)) {
      status.record('aqi', { ok: false, ms: Date.now() - t0, err: 'no us_aqi' });
      return cached?.data ? { ...cached.data, stale: true } : null;
    }
    const { band, label } = classify(aqi);
    const round1 = (x) => Number.isFinite(Number(x)) ? Math.round(Number(x)) : null;
    const data = {
      aqi,
      band,                 // 0..5 → scale marker position
      bands: BANDS.length,  // 6 → scale segment count
      label,                // GOOD / MODERATE / …
      pm25: round1(cur.pm2_5),
      pm10: round1(cur.pm10),
      o3:   round1(cur.ozone),
      no2:  round1(cur.nitrogen_dioxide),
      stale: false
    };
    cacheMap.set(cacheKey, { at: Date.now(), data });
    status.record('aqi', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('aqi', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    return cached?.data ? { ...cached.data, stale: true } : null;
  }
}

module.exports = { fetchAqi };

// Air quality fetcher via Open-Meteo air-quality-api. Same {lat,lon}
// contract as the weather fetcher. 30-min cache.
const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');
const CACHE_MS = 30 * 60 * 1000;
const cache = new Map();

const CATEGORIES = [
  { max: 50,  label: 'GOOD' },
  { max: 100, label: 'MODERATE' },
  { max: 150, label: 'UNHEALTHY FOR SENSITIVE' },
  { max: 200, label: 'UNHEALTHY' },
  { max: 300, label: 'VERY UNHEALTHY' },
  { max: 500, label: 'HAZARDOUS' }
];

function category(aqi) {
  if (!Number.isFinite(aqi)) return '—';
  for (const c of CATEGORIES) if (aqi <= c.max) return c.label;
  return 'HAZARDOUS';
}

async function fetchAqi({ lat, lon }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const key = `${lat},${lon}`;
  const hit = cache.get(key);
  if (hit && (Date.now() - hit.at) < CACHE_MS) { status.cacheHit('aqi'); return hit.data; }
  const t0 = Date.now();
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'us_aqi,pm2_5,pm10,ozone',
      timezone: 'auto'
    });
    const r = await fetchWithTimeout(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
    if (!r.ok) {
      status.record('aqi', { ok: false, ms: Date.now() - t0, err: `HTTP ${r.status}` });
      return hit?.data || null;
    }
    const data = await r.json();
    const c = data.current || {};
    const result = {
      aqi: Math.round(c.us_aqi ?? 0),
      pm25: c.pm2_5 != null ? Math.round(c.pm2_5) : null,
      pm10: c.pm10 != null ? Math.round(c.pm10) : null,
      o3:   c.ozone != null ? Math.round(c.ozone) : null,
      category: category(c.us_aqi),
      stale: false
    };
    cache.set(key, { at: Date.now(), data: result });
    status.record('aqi', { ok: true, ms: Date.now() - t0 });
    return result;
  } catch (e) {
    status.record('aqi', { ok: false, ms: Date.now() - t0, err: e.message || String(e) });
    return hit?.data ? { ...hit.data, stale: true } : null;
  }
}

module.exports = { fetchAqi };

// NWS severe-weather alerts for US points. Free, no auth. Graceful no-op
// for non-US locations.
const { fetchWithTimeout } = require('./_fetch');
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

async function fetchAlerts({ lat, lon }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && (Date.now() - hit.at) < CACHE_MS) return hit.data;
  try {
    const url = `https://api.weather.gov/alerts/active?point=${lat},${lon}`;
    const r = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'eink-dashboard (github.com/hqn07/eink-dashboard)',
        'Accept': 'application/geo+json'
      }
    });
    if (!r.ok) return hit?.data || [];
    const j = await r.json();
    const list = (j.features || []).map(f => {
      const p = f.properties || {};
      return {
        event: p.event || '',
        severity: (p.severity || '').toUpperCase(),
        headline: (p.headline || '').replace(/\s+/g, ' ').trim(),
        urgency: p.urgency || ''
      };
    }).filter(a => a.event);
    cache.set(key, { at: Date.now(), data: list });
    return list;
  } catch {
    return hit?.data || [];
  }
}

module.exports = { fetchAlerts };

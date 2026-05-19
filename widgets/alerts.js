// NWS severe-weather alerts for US points. Free, no auth. Graceful no-op
// for non-US locations.
const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

async function fetchAlerts({ lat, lon }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && (Date.now() - hit.at) < CACHE_MS) { status.cacheHit('alerts'); return hit.data; }
  const t0 = Date.now();
  try {
    const url = `https://api.weather.gov/alerts/active?point=${lat},${lon}`;
    const r = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'eink-dashboard (github.com/hqn07/eink-dashboard)',
        'Accept': 'application/geo+json'
      }
    });
    if (!r.ok) {
      status.record('alerts', { ok: false, ms: Date.now() - t0, err: `HTTP ${r.status}` });
      return hit?.data || [];
    }
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
    status.record('alerts', { ok: true, ms: Date.now() - t0 });
    return list;
  } catch (e) {
    status.record('alerts', { ok: false, ms: Date.now() - t0, err: e.message || String(e) });
    return hit?.data || [];
  }
}

module.exports = { fetchAlerts };

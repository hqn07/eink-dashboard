// Location + weather-check helpers for the control panel's setup UI. Proxied
// server-side so responses can be cached and the provider can change without a
// client edit. Owns a small LRU geocode cache.
const router = require('express').Router();
const { checkAdminAuth } = require('../lib/auth');
const { jsonFetch } = require('../lib/geo');
const { fetchWeather } = require('../widgets/weather');
const { safeError } = require('../lib/http');

const geocodeCache = new Map(); // key: q-lower → { at, data }
const GEO_CACHE_MS = 24 * 60 * 60 * 1000;
const GEO_CACHE_MAX = 500;

function trimGeoCache() {
  while (geocodeCache.size > GEO_CACHE_MAX) {
    // Map preserves insertion order — oldest key is first.
    const oldest = geocodeCache.keys().next().value;
    geocodeCache.delete(oldest);
  }
}

router.get('/api/geocode', checkAdminAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);
  const cacheKey = q.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached && (Date.now() - cached.at) < GEO_CACHE_MS) {
    return res.json(cached.data);
  }
  try {
    const data = await jsonFetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`
    );
    const shaped = ((data && data.results) || []).map(d => ({
      name: d.name,
      state: d.admin1 || null,
      country: (d.country_code || '').toUpperCase() || null,
      lat: d.latitude,
      lon: d.longitude
    }));
    geocodeCache.set(cacheKey, { at: Date.now(), data: shaped });
    trimGeoCache();
    res.json(shaped);
  } catch (err) {
    res.status(500).json(safeError(err));
  }
});

router.get('/api/reverse-geocode', checkAdminAuth, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'bad coords' });
  }
  try {
    // Nominatim (OpenStreetMap) is the only reliable free reverse geocoder.
    // Their usage policy requires a clear User-Agent.
    const data = await jsonFetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`,
      { headers: { 'User-Agent': 'eink-dashboard/1.0 (https://github.com/hqn07/eink-dashboard)' } }
    );
    const addr = (data && data.address) || {};
    const name = addr.city || addr.town || addr.village || addr.municipality || addr.county || data.name || '';
    res.json({
      name: name,
      state: addr.state || null,
      country: (addr.country_code || '').toUpperCase() || null,
      lat: parseFloat(data.lat) || lat,
      lon: parseFloat(data.lon) || lon
    });
  } catch (err) {
    res.status(500).json(safeError(err));
  }
});

router.get('/api/weather-check', checkAdminAuth, async (req, res) => {
  const city = (req.query.city || '').trim();
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const units = req.query.units === 'C' ? 'C' : 'F';
  try {
    // Reuse the weather widget so the result matches what the dashboard will
    // actually render. fetchWeather handles the geocode-then-fetch dance
    // internally for city-only queries.
    const loc = (Number.isFinite(lat) && Number.isFinite(lon))
      ? { lat, lon }
      : city;
    const w = await fetchWeather(loc, null, units);
    if (w.stale) return res.json({ ok: false, error: 'not found' });
    res.json({
      ok: true,
      temp: w.temp,
      desc: w.desc,
      country: w.country || null
    });
  } catch (err) {
    res.json({ ok: false, ...safeError(err) });
  }
});

module.exports = router;

// Read helper for cfg.home — stage 2 of docs/setup-architecture.md.
//
// Shared facts (where you live, your timezone, your calendars) used to be
// read straight off the top level: cfg.city, cfg.lat, cfg.lon, cfg.githubUser.
// Those keys were never declared in the defaults — they existed only in live
// configs, written by SetupWizard and read by six fetchers, documented
// nowhere. cfg.home declares them.
//
// READ-TIME ONLY. Nothing here rewrites a config: an old one keeps working
// through the legacy fallback, and only new writes use the home shape. That
// is what makes this safe to ship without a migration.
//
// `??` is deliberately NOT the fallback operator. The defaults ship
// `home: { city: "", lat: null, ... }`, so a real config carrying a
// top-level `city` alongside that empty block would resolve to "" and the
// weather would silently go NO DATA. Absent means empty, not just null.

const HOME_KEYS = ['city', 'lat', 'lon', 'timezone', 'icalUrls', 'githubUser', 'tickers', 'about'];

function present(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'number') return Number.isFinite(v);
  return true;
}

// cfg.home.<key>, falling back to the legacy top-level key. Returns
// undefined when neither is set, so callers can use their own default.
function homeValue(cfg, key) {
  const home = cfg && cfg.home;
  const v = home ? home[key] : undefined;
  if (present(v)) return v;
  const legacy = cfg ? cfg[key] : undefined;
  return present(legacy) ? legacy : undefined;
}

// { lat, lon } when both are real numbers, else null. Coordinates are only
// meaningful as a pair — half of one is worse than none, because it reads as
// configured and geocodes to the wrong hemisphere.
function homeCoords(cfg) {
  const lat = homeValue(cfg, 'lat');
  const lon = homeValue(cfg, 'lon');
  return (Number.isFinite(lat) && Number.isFinite(lon)) ? { lat, lon } : null;
}

// The shape the weather/aqi fetchers take: coordinates when we have them,
// otherwise the city string for OpenWeather to resolve. One rule, so weather
// and aqi cannot disagree about where the user lives.
function homeLoc(cfg) {
  return homeCoords(cfg) || homeValue(cfg, 'city') || '';
}

module.exports = { HOME_KEYS, homeValue, homeCoords, homeLoc, present };

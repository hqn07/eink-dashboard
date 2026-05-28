// widgets/icons.js
// Map Open-Meteo WMO weather codes to vendored sevesalm SVG filenames.
// Filenames (no extension) live under public/icons/sevesalm/ and are
// served at /static/icons/sevesalm/<name>.svg.
//
// The browser side (control-src/widget-render.js, public/dashboard.html)
// inlines the same lookup table verbatim because it can't `require` this
// CommonJS module. Keep the two in sync when changing the mapping.

// Lookup keyed by WMO code. Day/night split is applied later for the
// clear / partially_cloudy variants.
const WMO_ICON = {
  0:  'clear',                // clear sky
  1:  'clear',                // mainly clear
  2:  'partially_cloudy',     // partly cloudy
  3:  'cloudy',               // overcast
  45: 'fog',
  48: 'fog',
  51: 'drizzle_mild',         // light drizzle
  53: 'drizzle_mild',         // moderate drizzle
  55: 'drizzle_strong',       // dense drizzle
  56: 'drizzle_icing',        // freezing drizzle light
  57: 'drizzle_icing',        // freezing drizzle dense
  61: 'rain',
  63: 'rain',
  65: 'rain',
  66: 'sleet',                // freezing rain (light)
  67: 'sleet',                // freezing rain (heavy)
  71: 'snow',
  73: 'snow',
  75: 'snow',
  77: 'snow',                 // snow grains
  80: 'rain',                 // rain showers
  81: 'rain',
  82: 'rain',
  85: 'snow',                 // snow showers
  86: 'snow',
  95: 'thunder',              // thunderstorm
  96: 'ice_pellets',          // thunderstorm w/ slight hail (closest upstream icon)
  99: 'ice_pellets'           // thunderstorm w/ heavy hail
};

// Codes whose icon name has a *_night variant in the upstream set.
const NIGHTABLE = new Set(['clear', 'partially_cloudy']);

function isNightFromTimes(sunriseMin, sunsetMin, nowMin) {
  if (!Number.isFinite(nowMin)) return false;
  if (!Number.isFinite(sunriseMin) || !Number.isFinite(sunsetMin)) return false;
  return nowMin < sunriseMin || nowMin >= sunsetMin;
}

// Resolve a WMO code + isNight flag to a sevesalm filename (no .svg).
function wmoToIcon(code, isNight) {
  const base = WMO_ICON[code] || 'cloudy';
  if (isNight && NIGHTABLE.has(base)) return base + '_night';
  return base;
}

// Higher-level: takes the weather payload (as produced by widgets/weather.js)
// and picks the right filename, handling night detection internally.
function pickIcon(weather) {
  if (!weather) return 'cloudy';
  // Prefer the raw WMO code if the fetcher passes one; otherwise fall back
  // to a coarse mapping from `main`. The current fetcher doesn't expose
  // `code` but we accept it for future-proofing.
  const code = Number.isFinite(weather.code) ? weather.code : null;
  const night = isNightFromTimes(weather.sunriseMin, weather.sunsetMin, weather.nowMin);
  if (code != null) return wmoToIcon(code, night);
  // Fallback by `main` bucket — same vocabulary as the old icon set.
  const main = (weather.main || '').toLowerCase();
  if (main === 'clear')        return night ? 'clear_night' : 'clear';
  if (main === 'clouds')       return night ? 'partially_cloudy_night' : 'partially_cloudy';
  if (main === 'rain')         return 'rain';
  if (main === 'drizzle')      return 'drizzle_mild';
  if (main === 'snow')         return 'snow';
  if (main === 'thunderstorm') return 'thunder';
  if (main === 'mist' || main === 'fog' || main === 'haze') return 'fog';
  return 'cloudy';
}

module.exports = { wmoToIcon, pickIcon, WMO_ICON, NIGHTABLE };

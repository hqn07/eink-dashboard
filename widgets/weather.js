// widgets/weather.js
// Open-Meteo weather fetcher. No API key, no signup. Caches each
// resolved {lat, lon, units} tuple for 10 minutes.

const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');
const CACHE_MS = 10 * 60 * 1000;
const cacheMap = new Map(); // key: "lat,lon|F" → { at, data }

const WIND_DIRS = ['N','NE','E','SE','S','SW','W','NW'];
function windDir(deg) {
  if (!Number.isFinite(deg)) return 'N';
  return WIND_DIRS[Math.round(((deg % 360) / 45)) % 8];
}

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAYS   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

// Open-Meteo's `timezone=auto` returns times like "2026-05-17T15:30"
// in the location's local time (no offset suffix). We parse manually
// so JS doesn't reinterpret in the server's own zone.
function parseOMTime(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  return {
    year: +m[1], month: +m[2], day: +m[3],
    hour: m[4] ? +m[4] : 0, minute: m[5] ? +m[5] : 0
  };
}

function formatTimeOM(s) {
  const t = parseOMTime(s);
  if (!t) return '--:--';
  let h = t.hour;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(t.minute).padStart(2, '0')} ${ampm}`;
}

// Minutes-since-midnight from an Open-Meteo local timestamp string.
function minutesOM(s) {
  const t = parseOMTime(s);
  if (!t) return null;
  return t.hour * 60 + t.minute;
}

function dayLabel(s) {
  const t = parseOMTime(s);
  if (!t) return '???';
  const dow = (new Date(Date.UTC(t.year, t.month - 1, t.day))).getUTCDay();
  return DAYS[dow];
}

function formatDateOM(s) {
  const t = parseOMTime(s);
  if (!t) return 'NO DATA';
  const dow = (new Date(Date.UTC(t.year, t.month - 1, t.day))).getUTCDay();
  return `${DAYS[dow]} ${MONTHS[t.month - 1]} ${t.day}, ${t.year}`;
}

// WMO weather interpretation codes → {desc, main}. `main` maps to our
// existing icon set (Clear/Clouds/Rain/Snow/Thunderstorm/Mist/Drizzle).
// Reference: https://open-meteo.com/en/docs (Weather Variables section).
const WMO = {
  0:  { desc: 'CLEAR SKY',                main: 'Clear' },
  1:  { desc: 'MAINLY CLEAR',             main: 'Clear' },
  2:  { desc: 'PARTLY CLOUDY',            main: 'Clouds' },
  3:  { desc: 'OVERCAST',                 main: 'Clouds' },
  45: { desc: 'FOG',                      main: 'Mist' },
  48: { desc: 'RIME FOG',                 main: 'Mist' },
  51: { desc: 'LIGHT DRIZZLE',            main: 'Drizzle' },
  53: { desc: 'DRIZZLE',                  main: 'Drizzle' },
  55: { desc: 'HEAVY DRIZZLE',            main: 'Drizzle' },
  56: { desc: 'FREEZING DRIZZLE',         main: 'Drizzle' },
  57: { desc: 'HEAVY FREEZING DRIZZLE',   main: 'Drizzle' },
  61: { desc: 'LIGHT RAIN',               main: 'Rain' },
  63: { desc: 'RAIN',                     main: 'Rain' },
  65: { desc: 'HEAVY RAIN',               main: 'Rain' },
  66: { desc: 'FREEZING RAIN',            main: 'Rain' },
  67: { desc: 'HEAVY FREEZING RAIN',      main: 'Rain' },
  71: { desc: 'LIGHT SNOW',               main: 'Snow' },
  73: { desc: 'SNOW',                     main: 'Snow' },
  75: { desc: 'HEAVY SNOW',               main: 'Snow' },
  77: { desc: 'SNOW GRAINS',              main: 'Snow' },
  80: { desc: 'LIGHT SHOWERS',            main: 'Rain' },
  81: { desc: 'SHOWERS',                  main: 'Rain' },
  82: { desc: 'VIOLENT SHOWERS',          main: 'Rain' },
  85: { desc: 'LIGHT SNOW SHOWERS',       main: 'Snow' },
  86: { desc: 'HEAVY SNOW SHOWERS',       main: 'Snow' },
  95: { desc: 'THUNDERSTORM',             main: 'Thunderstorm' },
  96: { desc: 'STORM WITH HAIL',          main: 'Thunderstorm' },
  99: { desc: 'STORM WITH HEAVY HAIL',    main: 'Thunderstorm' }
};
function wmo(code) {
  return WMO[code] || { desc: 'UNKNOWN', main: 'Clear' };
}

// Geocoding cache keyed by lower-case city query.
const geoCache = new Map();
const GEO_CACHE_MS = 24 * 60 * 60 * 1000;

async function geocodeCity(city) {
  const key = city.toLowerCase().trim();
  const cached = geoCache.get(key);
  if (cached && (Date.now() - cached.at) < GEO_CACHE_MS) return cached.data;
  try {
    // Open-Meteo's geocoder expects a single name token, not the
    // "City,Region,Country" format OpenWeather accepted. Strip to the
    // first segment so legacy configs ("Gainesville,FL,US") still
    // resolve. Picks the first match — may pick the wrong city if
    // multiple share the name. Users should re-pick from autocomplete
    // to nail it down with lat/lon.
    const cleanName = city.split(',')[0].trim();
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanName)}&count=1&language=en&format=json`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return null;
    const data = await r.json();
    const first = data && data.results && data.results[0];
    if (!first) return null;
    const out = {
      lat: first.latitude,
      lon: first.longitude,
      country: (first.country_code || '').toUpperCase() || null,
      name: first.name
    };
    geoCache.set(key, { at: Date.now(), data: out });
    return out;
  } catch {
    return null;
  }
}

// Accepts either:
//   - a city query string ("Gainesville,FL,US"), or
//   - { lat, lon } if precise coords are configured.
// The second arg (apiKey) is ignored — Open-Meteo doesn't need one.
// Kept in the signature so old callers don't break.
async function fetchWeather(cityOrCoords, _apiKey, units = 'F') {
  const u = units === 'C' ? 'C' : 'F';

  // Resolve to lat/lon.
  let lat, lon, country = null;
  if (cityOrCoords && typeof cityOrCoords === 'object'
      && Number.isFinite(cityOrCoords.lat) && Number.isFinite(cityOrCoords.lon)) {
    lat = cityOrCoords.lat;
    lon = cityOrCoords.lon;
  } else if (typeof cityOrCoords === 'string' && cityOrCoords.trim()) {
    const geo = await geocodeCity(cityOrCoords);
    if (!geo) return stubData(u);
    lat = geo.lat; lon = geo.lon; country = geo.country;
  } else {
    return stubData(u);
  }

  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}|${u}`;
  const cached = cacheMap.get(cacheKey);
  if (cached && (Date.now() - cached.at) < CACHE_MS) {
    status.cacheHit('weather');
    return cached.data;
  }
  const t0 = Date.now();

  const tempUnit = u === 'C' ? 'celsius' : 'fahrenheit';
  const windUnitParam = u === 'C' ? 'ms' : 'mph';
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover',
    hourly: 'temperature_2m,weather_code,precipitation_probability,cloud_cover',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '7',
    temperature_unit: tempUnit,
    wind_speed_unit: windUnitParam
  });

  try {
    const r = await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!r.ok) {
      console.warn('Open-Meteo fetch non-OK:', r.status);
      status.record('weather', { ok: false, ms: Date.now() - t0, err: `HTTP ${r.status}` });
      // Same stale-marking as the catch path below — expired cache is
      // better than NO DATA, but renderers should know it's old.
      return cached?.data ? { ...cached.data, stale: true } : stubData(u);
    }
    const data = await r.json();
    const cur = data.current || {};
    const daily = data.daily || {};
    const curWmo = wmo(cur.weather_code);

    // Hourly: pick next 6 hours starting from the current local time.
    const hourly = [];
    const hr = data.hourly || {};
    const htimes = hr.time || [];
    const nowM = minutesOM(cur.time);
    if (nowM != null && htimes.length) {
      let startIdx = 0;
      for (let i = 0; i < htimes.length; i++) {
        const m = minutesOM(htimes[i]);
        if (htimes[i].slice(0, 10) === (cur.time || '').slice(0, 10) && m >= nowM) {
          startIdx = i;
          break;
        }
      }
      for (let i = startIdx + 1; i < Math.min(startIdx + 7, htimes.length); i++) {
        const t = parseOMTime(htimes[i]);
        if (!t) continue;
        let h = t.hour;
        const ampm = h >= 12 ? 'p' : 'a';
        h = h % 12; if (h === 0) h = 12;
        const wf = wmo(hr.weather_code?.[i]);
        const hTemp = hr.temperature_2m?.[i];
        const hPrecip = hr.precipitation_probability?.[i];
        hourly.push({
          label: `${h}${ampm}`,
          temp: Number.isFinite(hTemp) ? Math.round(hTemp) : '--',
          main: wf.main,
          precip: Number.isFinite(hPrecip) ? Math.round(hPrecip) : 0
        });
        if (hourly.length >= 6) break;
      }
    }

    // Full 7-day forecast (some renderers only show 3; widget can decide).
    const forecast = [];
    const dlen = (daily.time || []).length;
    for (let i = 1; i < Math.min(dlen, 8); i++) {
      const f = wmo(daily.weather_code?.[i]);
      const dHi = daily.temperature_2m_max?.[i];
      const dLo = daily.temperature_2m_min?.[i];
      const dPrecip = daily.precipitation_probability_max?.[i];
      forecast.push({
        name: dayLabel(daily.time[i]),
        hi: Number.isFinite(dHi) ? Math.round(dHi) : '--',
        lo: Number.isFinite(dLo) ? Math.round(dLo) : '--',
        precip: Number.isFinite(dPrecip) ? Math.round(dPrecip) : 0,
        main: f.main,
        desc: f.desc
      });
    }

    const safeRound = (v, fallback = '--') => Number.isFinite(v) ? Math.round(v) : fallback;
    const result = {
      temp: safeRound(cur.temperature_2m),
      feelsLike: safeRound(cur.apparent_temperature),
      tempMin: safeRound(daily.temperature_2m_min?.[0] ?? cur.temperature_2m),
      tempMax: safeRound(daily.temperature_2m_max?.[0] ?? cur.temperature_2m),
      humidity: safeRound(cur.relative_humidity_2m),
      windSpeed: safeRound(cur.wind_speed_10m),
      windGust: Number.isFinite(cur.wind_gusts_10m) ? Math.round(cur.wind_gusts_10m) : null,
      windDir: windDir(cur.wind_direction_10m),
      cloudCover: Number.isFinite(cur.cloud_cover) ? Math.round(cur.cloud_cover) : null,
      desc: curWmo.desc,
      main: curWmo.main,
      sunrise: formatTimeOM(daily.sunrise && daily.sunrise[0]),
      sunset:  formatTimeOM(daily.sunset  && daily.sunset[0]),
      sunriseMin: minutesOM(daily.sunrise && daily.sunrise[0]),
      sunsetMin:  minutesOM(daily.sunset  && daily.sunset[0]),
      nowMin:     minutesOM(cur.time),
      currentTime: formatTimeOM(cur.time),
      currentDate: formatDateOM(cur.time),
      forecast,
      hourly,
      stale: false,
      units: u,
      windUnit: u === 'C' ? 'm/s' : 'mph',
      country
    };

    cacheMap.set(cacheKey, { at: Date.now(), data: result });
    status.record('weather', { ok: true, ms: Date.now() - t0 });
    return result;
  } catch (err) {
    console.error('Open-Meteo error:', err.message);
    status.record('weather', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    return cached?.data ? { ...cached.data, stale: true } : stubData(u);
  }
}

function stubData(units = 'F') {
  return {
    temp: '--', feelsLike: '--', tempMin: '--', tempMax: '--',
    humidity: '--', windSpeed: '--', windDir: '--',
    desc: 'NO DATA', main: 'Clear',
    sunrise: '--:--', sunset: '--:--',
    currentTime: '--:--', currentDate: 'NO DATA',
    forecast: [],
    hourly: [],
    stale: true,
    units,
    windUnit: units === 'C' ? 'm/s' : 'mph',
    country: null
  };
}

module.exports = { fetchWeather, geocodeCity };

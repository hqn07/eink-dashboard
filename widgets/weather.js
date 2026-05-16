// widgets/weather.js
// Fetches weather data from OpenWeatherMap. Caches for 10 minutes to avoid hammering the API.

const CACHE_MS = 10 * 60 * 1000;
let cache = { at: 0, city: null, data: null };

const WIND_DIRS = ['N','NE','E','SE','S','SW','W','NW'];
function windDir(deg) {
  return WIND_DIRS[Math.round(((deg % 360) / 45)) % 8];
}

function formatTime(unixSec, tzOffsetSec) {
  const d = new Date((unixSec + tzOffsetSec) * 1000);
  // Use UTC getters since we've already shifted by offset
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2,'0')} ${ampm}`;
}

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function formatDate(unixSec, tzOffsetSec) {
  const d = new Date((unixSec + tzOffsetSec) * 1000);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

async function fetchWeather(city, apiKey) {
  const now = Date.now();
  if (cache.city === city && cache.data && (now - cache.at) < CACHE_MS) {
    return cache.data;
  }
  if (!apiKey) {
    return stubData();
  }

  const base = 'https://api.openweathermap.org/data/2.5';
  const q = encodeURIComponent(city);

  try {
    const [curRes, fcRes] = await Promise.all([
      fetch(`${base}/weather?q=${q}&appid=${apiKey}&units=imperial`),
      fetch(`${base}/forecast?q=${q}&appid=${apiKey}&units=imperial&cnt=24`)
    ]);

    if (!curRes.ok || !fcRes.ok) {
      console.warn('Weather fetch non-OK:', curRes.status, fcRes.status);
      return cache.data || stubData();
    }

    const cur = await curRes.json();
    const fc = await fcRes.json();

    const tz = cur.timezone || 0;

    // Build 3-day forecast
    const dayBuckets = {};
    for (const item of fc.list || []) {
      const localSec = item.dt + tz;
      const dayKey = Math.floor(localSec / 86400);
      if (!dayBuckets[dayKey]) {
        dayBuckets[dayKey] = {
          hi: -Infinity, lo: Infinity,
          name: DAYS[new Date(localSec * 1000).getUTCDay()],
          main: item.weather[0].main,
          desc: item.weather[0].description
        };
      }
      dayBuckets[dayKey].hi = Math.max(dayBuckets[dayKey].hi, item.main.temp);
      dayBuckets[dayKey].lo = Math.min(dayBuckets[dayKey].lo, item.main.temp);
    }

    const todayKey = Math.floor((cur.dt + tz) / 86400);
    const forecast = [];
    for (let offset = 1; offset <= 3; offset++) {
      const b = dayBuckets[todayKey + offset];
      if (b) forecast.push({
        name: b.name,
        hi: Math.round(b.hi),
        lo: Math.round(b.lo),
        main: b.main,
        desc: b.desc.toUpperCase()
      });
    }

    const data = {
      temp: Math.round(cur.main.temp),
      feelsLike: Math.round(cur.main.feels_like),
      tempMin: Math.round(cur.main.temp_min),
      tempMax: Math.round(cur.main.temp_max),
      humidity: cur.main.humidity,
      windSpeed: Math.round(cur.wind.speed),
      windDir: windDir(cur.wind.deg || 0),
      desc: (cur.weather[0].description || '').toUpperCase(),
      main: cur.weather[0].main,
      sunrise: formatTime(cur.sys.sunrise, tz),
      sunset: formatTime(cur.sys.sunset, tz),
      currentTime: formatTime(cur.dt, tz),
      currentDate: formatDate(cur.dt, tz),
      forecast,
      stale: false
    };

    cache = { at: now, city, data };
    return data;
  } catch (err) {
    console.error('Weather error:', err.message);
    return cache.data ? { ...cache.data, stale: true } : stubData();
  }
}

function stubData() {
  return {
    temp: '--', feelsLike: '--', tempMin: '--', tempMax: '--',
    humidity: '--', windSpeed: '--', windDir: '--',
    desc: 'NO DATA', main: 'Clear',
    sunrise: '--:--', sunset: '--:--',
    currentTime: '--:--', currentDate: 'NO DATA',
    forecast: [],
    stale: true
  };
}

module.exports = { fetchWeather };

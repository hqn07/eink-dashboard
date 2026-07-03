// Weather helpers shared between weather_hero + weather_forecast.
//
// Weather icons are vendored from sevesalm/eInk-weather-display
// (BSD-3-Clause) under public/icons/sevesalm/. We pull them via
// /static/icons/sevesalm/<name>.svg so the bundle stays tiny.
// Keep this WMO_ICON map in lockstep with widgets/icons.js (server)
// and the inline copy in public/dashboard.html.

export const WMO_ICON = {
  0:'clear',1:'clear',2:'partially_cloudy',3:'cloudy',
  45:'fog',48:'fog',
  51:'drizzle_mild',53:'drizzle_mild',55:'drizzle_strong',
  56:'drizzle_icing',57:'drizzle_icing',
  61:'rain',63:'rain',65:'rain',66:'sleet',67:'sleet',
  71:'snow',73:'snow',75:'snow',77:'snow',
  80:'rain',81:'rain',82:'rain',85:'snow',86:'snow',
  95:'thunder',96:'ice_pellets',99:'ice_pellets'
};
const NIGHTABLE = new Set(['clear', 'partially_cloudy']);

function _isNight(w) {
  if (!w) return false;
  const sr = w.sunriseMin, ss = w.sunsetMin, nm = w.nowMin;
  if (!Number.isFinite(sr) || !Number.isFinite(ss) || !Number.isFinite(nm)) return false;
  return nm < sr || nm >= ss;
}

function _mainToIcon(main, night) {
  const m = String(main || '').toLowerCase();
  if (m === 'clear')        return night ? 'clear_night' : 'clear';
  if (m === 'clouds')       return night ? 'partially_cloudy_night' : 'partially_cloudy';
  if (m === 'rain')         return 'rain';
  if (m === 'drizzle')      return 'drizzle_mild';
  if (m === 'snow')         return 'snow';
  if (m === 'thunderstorm') return 'thunder';
  if (m === 'mist' || m === 'fog' || m === 'haze') return 'fog';
  return 'cloudy';
}

function _pickIconName(arg) {
  if (typeof arg === 'string') return _mainToIcon(arg, false);
  if (!arg || typeof arg !== 'object') return 'cloudy';
  const night = _isNight(arg);
  const code = Number.isFinite(arg.code) ? arg.code : null;
  if (code != null) {
    const base = WMO_ICON[code] || 'cloudy';
    return night && NIGHTABLE.has(base) ? base + '_night' : base;
  }
  return _mainToIcon(arg.main, night);
}

export function icon(arg, size) {
  const name = _pickIconName(arg);
  return `<img class="icon" src="/static/icons/sevesalm/${name}.svg" width="${size}" height="${size}" alt="" />`;
}

export function fakeWeather(units) {
  return {
    temp: '--', feelsLike: '--', tempMin: '--', tempMax: '--',
    humidity: '--', windSpeed: '--', windDir: '--', windUnit: units === 'C' ? 'm/s' : 'mph',
    desc: 'NO DATA', main: 'Clear',
    sunrise: '--:--', sunset: '--:--',
    sunriseMin: null, sunsetMin: null, nowMin: null,
    forecast: [], hourly: []
  };
}

export function sunBar(w) {
  if (!w || !Number.isFinite(w.sunriseMin) || !Number.isFinite(w.sunsetMin)) return '';
  const sr = w.sunriseMin, ss = w.sunsetMin;
  const nowM = Number.isFinite(w.nowMin) ? w.nowMin : sr;
  let pct;
  if (nowM < sr) pct = 0;
  else if (nowM > ss) pct = 100;
  else pct = ((nowM - sr) / (ss - sr)) * 100;
  return `
    <div class="sun-bar">
      <div class="sun-track">
        <div class="sun-fill" style="width:${pct.toFixed(1)}%"></div>
        <div class="sun-dot" style="left:${pct.toFixed(1)}%"></div>
      </div>
      <div class="sun-labels">
        <span>↑ ${w.sunrise}</span>
        <span>↓ ${w.sunset}</span>
      </div>
    </div>
  `;
}

export function alertBanner(w) {
  if (!w || !Array.isArray(w.alerts) || !w.alerts.length) return '';
  const a = w.alerts[0];
  return `
    <div class="weather-alert">
      <span class="alert-tag">⚠ ${a.severity || 'ALERT'}</span>
      <span class="alert-text">${a.event}</span>
    </div>
  `;
}

export function hourlyStrip(w) {
  if (!w || !Array.isArray(w.hourly) || !w.hourly.length) return '';
  return `
    <div class="hourly-strip">
      ${w.hourly.map(h => `
        <div class="hr-cell">
          <div class="hr-time">${h.label}</div>
          ${icon(h.main, 22)}
          <div class="hr-temp">${h.temp}°</div>
          ${Number.isFinite(h.precip) && h.precip >= 10
            ? `<div class="hr-precip-pct${h.precip >= 60 ? ' face-red' : ''}">${h.precip}%</div>`
            : ''}
        </div>
      `).join('')}
    </div>
  `;
}

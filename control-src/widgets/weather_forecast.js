// Weather · Forecast — N-day high/low strip. Day count auto-scales
// with tile height; explicit setting wins.

import { escapeHtml, placeholder } from './_shared.js';
import { icon } from './_weather_shared.js';

export const def = {
  id: 'weather_forecast',
  label: 'Weather · Forecast',
  requires: 'weather',
  minSize: { w: 6, h: 6 },
  sizes: {
    S:  { w: 6, h: 8 },
    M:  { w: 6, h: 12 },
    L:  { w: 12, h: 12 },
    XL: { w: 24, h: 6 }
  },
  defaultSize: 'M',
  defaults: (ctx) => ({
    city: (ctx && ctx.city) || '',
    lat:  (ctx && Number.isFinite(ctx.lat)) ? ctx.lat : null,
    lon:  (ctx && Number.isFinite(ctx.lon)) ? ctx.lon : null,
    unitsOverride: 'inherit',
    forecastDays: null,
    title: '',
    precipMode: 'auto',     // 'auto' | 'always' | 'never'
    hiloStyle:  'stack',    // 'stack' | 'inline' | 'arrows'
    showIcons:  true,
    showDayName: true,
    fontScale: 1,
    padding: 14
  })
};

export function render({ weather, cfg, settings, cellW, cellH }) {
  const w = weather;
  if (!w || !w.forecast || !w.forecast.length) {
    const hasLoc =
      (settings && Number.isFinite(settings.lat) && Number.isFinite(settings.lon)) ||
      (cfg && Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon));
    return placeholder('FORECAST', hasLoc ? 'Data unavailable' : 'Set your location in settings', 'weather', { cellW, cellH });
  }
  const s = settings || {};
  const ch = cellH || 0, cw = cellW || 0;
  const userDays = parseInt(
    Number.isFinite(w.forecastDays)
      ? w.forecastDays
      : (cfg && cfg.weather && cfg.weather.forecastDays),
    10
  );
  const autoDays = ch < 4 ? 1
                 : ch < 6 ? 2
                 : ch < 8 ? 3
                 : ch < 10 ? 4
                 : ch < 12 ? 5
                 : 7;
  const days = Number.isFinite(userDays)
    ? Math.max(1, Math.min(7, userDays))
    : autoDays;
  const iconPx = ch < 4 ? 26 : ch < 6 ? 28 : ch < 8 ? 32 : ch < 12 ? 34 : 38;
  const precipMode = s.precipMode || 'auto';
  const showPrecip = precipMode === 'always' ? true
                   : precipMode === 'never'  ? false
                   :                            cw >= 8;
  const hiloStyle = s.hiloStyle || 'stack';
  const list = w.forecast.slice(0, days);
  const hiloBlock = (f) => {
    if (hiloStyle === 'inline') {
      return `<div class="fc-hilo fc-hilo-inline"><span class="fc-hi">${f.hi}°</span><span class="fc-hilo-sep"> / </span><span class="fc-lo">${f.lo}°</span></div>`;
    }
    if (hiloStyle === 'arrows') {
      return `<div class="fc-hilo fc-hilo-arrows"><span class="fc-hi">↑${f.hi}°</span><span class="fc-lo">↓${f.lo}°</span></div>`;
    }
    return `<div class="fc-hilo"><div class="fc-hi">${f.hi}°</div><div class="fc-lo">${f.lo}°</div></div>`;
  };
  const showIcons   = s.showIcons   !== false;
  const showDayName = s.showDayName !== false;
  const titleLabel = (s.title && String(s.title).trim())
    ? String(s.title).trim()
    : `${list.length}-DAY OUTLOOK`;
  return `
    <div class="col-title">${escapeHtml(titleLabel)}</div>
    ${list.map(f => `
      <div class="fc-row fc-hilo-${hiloStyle}">
        ${showDayName ? `<div class="fc-day">${f.name}</div>` : ''}
        ${showIcons   ? `<div class="fc-icon">${icon(f.main, iconPx)}</div>` : ''}
        ${hiloBlock(f)}
        ${showPrecip && Number.isFinite(f.precip) && f.precip > 0
          ? `<div class="fc-precip">${f.precip}%</div>` : ''}
      </div>
    `).join('')}
  `;
}

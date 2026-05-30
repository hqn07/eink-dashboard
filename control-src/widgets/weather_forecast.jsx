// Weather · Forecast — N-day high/low strip. Day count auto-scales
// with tile height; explicit setting wins.

import React from 'react';
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
    forecastDays: null,
    fontScale: 1,
    padding: 14
  })
};

export function render({ weather, cfg, cellW, cellH }) {
  const w = weather;
  if (!w || !w.forecast || !w.forecast.length) {
    return `<div class="col-title">FORECAST</div><div class="empty" style="border:0;padding:14px 0">NO DATA</div>`;
  }
  // Day count is per-tile (slot.weather.forecastDays); fall back to
  // legacy cfg.weather.forecastDays for tiles not yet re-saved.
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
  const showPrecip = cw >= 8;
  const max = days;
  const list = w.forecast.slice(0, max);
  return `
    <div class="col-title">${list.length}-DAY OUTLOOK</div>
    ${list.map(f => `
      <div class="fc-row">
        <div class="fc-day">${f.name}</div>
        <div class="fc-icon">${icon(f.main, iconPx)}</div>
        <div class="fc-hilo">
          <div class="fc-hi">${f.hi}°</div>
          <div class="fc-lo">${f.lo}°</div>
        </div>
        ${showPrecip && Number.isFinite(f.precip) && f.precip > 0
          ? `<div class="fc-precip">${f.precip}%</div>` : '<div class="fc-precip"></div>'}
      </div>
    `).join('')}
  `;
}

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { LocationFields, TextField, TypographyFields } = fields;
  return (
    <>
      <LocationFields
        values={v}
        onChange={(loc) => onChange({ ...v, ...loc })}
      />
      <TextField
        label="Days to show (1–7 · blank = auto by tile height)"
        type="number"
        value={v.forecastDays ?? ''}
        onChange={(x) => patch({
          forecastDays: Number.isFinite(x) ? Math.max(1, Math.min(7, x)) : null
        })}
        help="Open-Meteo returns up to 7 days; larger tiles fit more."
      />
      <TypographyFields values={v} onChange={onChange} />
    </>
  );
}

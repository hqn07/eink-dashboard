// Weather · Current — hero tile with big temperature + icon + sunbar
// + hourly strip on larger tiers.

import React from 'react';
import { pickTier } from './_shared.js';
import { icon, fakeWeather, sunBar, hourlyStrip } from './_weather_shared.js';

export const def = {
  id: 'weather_hero',
  label: 'Weather · Current',
  requires: 'weather',
  minSize: { w: 6, h: 4 },
  sizes: {
    XS: { w: 8, h: 4 },
    S:  { w: 8, h: 6 },
    M:  { w: 8, h: 12 },
    L:  { w: 12, h: 12 },
    XL: { w: 24, h: 12 }
  },
  defaultSize: 'M',
  // ctx is the one-time seed (from setup wizard's saved location) so
  // a freshly-dropped tile starts with the user's home location.
  defaults: (ctx) => ({
    city: (ctx && ctx.city) || '',
    lat:  (ctx && Number.isFinite(ctx.lat)) ? ctx.lat : null,
    lon:  (ctx && Number.isFinite(ctx.lon)) ? ctx.lon : null,
    fontScale: 1,
    padding: 14
  })
};

export function render({ weather, units, cellW, cellH, density }) {
  const w = weather || fakeWeather(units);
  const tier = pickTier(cellW, cellH, density);
  const staleClass = w.stale ? ' weather-stale' : '';
  const staleBadge = w.stale ? '<div class="stale-pill">CACHED</div>' : '';
  const tempBlock = (size) => `
    <div class="weather-temp" style="font-size:${size}px">
      <span class="temp-num">${w.temp}</span><span class="temp-deg" style="font-size:${Math.round(size*0.6)}px">°${units}</span>
    </div>`;
  const heroIcon = (px) => `<div class="weather-icon" style="height:${px}px">${icon(w, px)}</div>`;
  const descLine = () => `<div class="weather-desc">${w.desc}</div>`;
  const hiloLine = () => `<div class="weather-hilo">HIGH ${w.tempMax}° &nbsp;·&nbsp; LOW ${w.tempMin}°</div>`;
  const statsBlock = () => `
    <div class="weather-stats">
      <div class="stat"><span class="stat-k">FEELS</span><span class="stat-v">${w.feelsLike}°</span></div>
      <div class="stat"><span class="stat-k">HUMID</span><span class="stat-v">${w.humidity}%</span></div>
      <div class="stat"><span class="stat-k">WIND</span><span class="stat-v">${w.windDir} ${w.windSpeed}${w.windGust ? ` (G${w.windGust})` : ''} ${w.windUnit || ''}</span></div>
      <div class="stat"><span class="stat-k">${Number.isFinite(w.cloudCover) ? 'CLOUD' : 'RISE'}</span><span class="stat-v">${Number.isFinite(w.cloudCover) ? w.cloudCover + '%' : w.sunrise}</span></div>
    </div>`;
  switch (tier) {
    case 'tiny':
      return `<div class="weather-hero hero-tier-tiny${staleClass}">${staleBadge}${tempBlock(54)}</div>`;
    case 'compact':
      return `<div class="weather-hero hero-tier-compact${staleClass}">
        ${staleBadge}
        <div class="hero-row">${heroIcon(60)}${tempBlock(72)}</div>
        ${hiloLine()}
      </div>`;
    case 'standard':
      return `<div class="weather-hero hero-tier-standard${staleClass}">
        ${staleBadge}${heroIcon(90)}${tempBlock(86)}${descLine()}${hiloLine()}
      </div>${statsBlock()}`;
    case 'extended':
      return `<div class="weather-hero hero-tier-extended${staleClass}">
        ${staleBadge}${heroIcon(110)}${tempBlock(96)}${descLine()}${hiloLine()}
      </div>${statsBlock()}`;
    case 'full':
    default:
      return `<div class="weather-hero hero-tier-full${staleClass}">
        ${staleBadge}${heroIcon(130)}${tempBlock(96)}${descLine()}${hiloLine()}
      </div>${statsBlock()}${sunBar(w)}${hourlyStrip(w)}`;
  }
}

export function Form({ values, onChange, fields }) {
  const v = values || {};
  const { LocationFields, TypographyFields } = fields;
  return (
    <>
      <LocationFields
        values={v}
        onChange={(loc) => onChange({ ...v, ...loc })}
      />
      <TypographyFields values={v} onChange={onChange} />
    </>
  );
}

// Weather · Current — hero tile with big temperature + icon. Larger
// tiers add stats, alert banner, sun-bar, and hourly strip.
//
// `settings.stats` (length-4 array) picks which fields fill the stats
// grid on standard+ tiers. Each entry is one of: feels, humid, wind,
// cloud, rise, set, gust, dew (dew falls back to humid if upstream
// doesn't expose it). Default keeps the original feels/humid/wind/
// cloud-or-rise behavior so old tiles look unchanged.

import { pickTier, placeholder } from './_shared.js';
import { icon, alertBanner, sunBar, hourlyStrip } from './_weather_shared.js';

const DEFAULT_STATS = ['feels', 'humid', 'wind', 'cloud_or_rise'];

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
  defaults: (ctx) => ({
    city: (ctx && ctx.city) || '',
    lat:  (ctx && Number.isFinite(ctx.lat)) ? ctx.lat : null,
    lon:  (ctx && Number.isFinite(ctx.lon)) ? ctx.lon : null,
    unitsOverride: 'inherit',
    stats: DEFAULT_STATS.slice(),
    showStats:  true,
    showHourly: true,
    showSunbar: true,
    showAlerts: true,
    showDesc:   true,
    fontScale: 1,
    padding: 14
  })
};

// Resolve a stat key to a { label, value } pair. Returns null when the
// upstream payload doesn't expose the requested field — the caller
// drops null entries so the grid doesn't render an empty cell.
function statForKey(key, w) {
  switch (key) {
    case 'feels':
      return { k: 'FEELS', v: `${w.feelsLike}°` };
    case 'humid':
      return { k: 'HUMID', v: `${w.humidity}%` };
    case 'wind':
      return {
        k: 'WIND',
        v: `${w.windDir} ${w.windSpeed}${w.windGust ? ` (G${w.windGust})` : ''} ${w.windUnit || ''}`.trim()
      };
    case 'gust':
      if (!Number.isFinite(w.windGust)) return null;
      return { k: 'GUST', v: `${w.windGust} ${w.windUnit || ''}`.trim() };
    case 'cloud':
      if (!Number.isFinite(w.cloudCover)) return null;
      return { k: 'CLOUD', v: `${w.cloudCover}%` };
    case 'rise':
      return { k: 'RISE', v: w.sunrise || '—' };
    case 'set':
      return { k: 'SET',  v: w.sunset || '—' };
    case 'cloud_or_rise':
      // Legacy default: prefer cloud cover when present, fall back to
      // sunrise so single-data installs still see something useful.
      return Number.isFinite(w.cloudCover)
        ? { k: 'CLOUD', v: `${w.cloudCover}%` }
        : { k: 'RISE',  v: w.sunrise || '—' };
    default:
      return null;
  }
}

export function render({ weather, units, cfg, settings, cellW, cellH, density }) {
  if (!weather) {
    const hasLoc =
      (settings && Number.isFinite(settings.lat) && Number.isFinite(settings.lon)) ||
      (cfg && Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon));
    return placeholder('WEATHER', hasLoc ? 'Data unavailable' : 'Set your location in settings', 'weather');
  }
  const w = weather;
  const s = settings || {};
  const tier = pickTier(cellW, cellH, density);
  const staleClass = w.stale ? ' weather-stale' : '';
  const staleBadge = w.stale ? '<div class="stale-pill">CACHED</div>' : '';
  const tempBlock = (size) => `
    <div class="weather-temp" style="font-size:${size}px">
      <span class="temp-num">${w.temp}</span><span class="temp-deg" style="font-size:${Math.round(size*0.6)}px">°${units}</span>
    </div>`;
  const heroIcon = (px) => `<div class="weather-icon" style="height:${px}px">${icon(w, px)}</div>`;
  const descLine = () => (s.showDesc !== false) ? `<div class="weather-desc">${w.desc}</div>` : '';
  const hiloLine = () => `<div class="weather-hilo">HIGH ${w.tempMax}° &nbsp;·&nbsp; LOW ${w.tempMin}°</div>`;
  const statsKeys = Array.isArray(s.stats) && s.stats.length ? s.stats : DEFAULT_STATS;
  const statsBlock = () => {
    if (s.showStats === false) return '';
    const cells = statsKeys.map(k => statForKey(k, w)).filter(Boolean).slice(0, 4);
    if (!cells.length) return '';
    return `<div class="weather-stats">
      ${cells.map(c => `<div class="stat"><span class="stat-k">${c.k}</span><span class="stat-v">${c.v}</span></div>`).join('')}
    </div>`;
  };
  const alerts = s.showAlerts !== false ? alertBanner(w) : '';
  const sunBlock = s.showSunbar !== false ? sunBar(w) : '';
  const hourly   = s.showHourly !== false ? hourlyStrip(w) : '';
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
      </div>${alerts}${statsBlock()}`;
    case 'full':
    default:
      return `<div class="weather-hero hero-tier-full${staleClass}">
        ${staleBadge}${heroIcon(130)}${tempBlock(96)}${descLine()}${hiloLine()}
      </div>${alerts}${statsBlock()}${sunBlock}${hourly}`;
  }
}

export const STAT_OPTIONS = [
  { value: 'feels',         label: 'Feels-like temp' },
  { value: 'humid',         label: 'Humidity' },
  { value: 'wind',          label: 'Wind direction · speed' },
  { value: 'gust',          label: 'Wind gust' },
  { value: 'cloud',         label: 'Cloud cover %' },
  { value: 'rise',          label: 'Sunrise' },
  { value: 'set',           label: 'Sunset' },
  { value: 'cloud_or_rise', label: 'Cloud → fallback to Sunrise' }
];

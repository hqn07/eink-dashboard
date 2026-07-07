// Weather · Current — hero tile with big temperature + icon. Larger
// tiers add stats, alert banner, sun-bar, and hourly strip.
//
// Contract v2 (widgets-refresh W2): three layout variants —
//   classic — centered stack (icon over temp), the original editorial look
//   split   — icon left, readings right; uses the side space on wide tiles
//   minimal — temperature + high/low only, no icon, no extras
// Tier still decides which extras attach (stats/alerts/sunbar/hourly)
// and the type/icon scale; variant only re-arranges the hero core.
//
// `settings.stats` (length-4 array) picks which fields fill the stats
// grid on standard+ tiers. Each entry is one of: feels, humid, wind,
// cloud, rise, set, gust, dew (dew falls back to humid if upstream
// doesn't expose it). Default keeps the original feels/humid/wind/
// cloud-or-rise behavior so old tiles look unchanged.

import { pickTier, placeholder, tidyPlace } from './_shared.js';
import { icon, alertBanner, sunBar, hourlyStrip } from './_weather_shared.js';

const DEFAULT_STATS = ['feels', 'humid', 'wind', 'cloud_or_rise'];

export const def = {
  id: 'weather_hero',
  label: 'Current Weather',
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
  variants: {
    trmnl:   { label: 'TRMNL — title-bar card' },
    classic: { label: 'Classic — centered stack' },
    split:   { label: 'Split — icon left, readings right' },
    minimal: { label: 'Minimal — temperature + high/low only' }
  },
  defaultVariant: 'trmnl',
  // What each tier drops relative to `full` (advisory; the render below
  // is the source of truth). Stats additionally need ≥8 grid rows of
  // height even at standard+. `minimal` drops everything but temp +
  // hilo at every tier by design.
  degrade: {
    extended: ['sunbar', 'hourly'],
    standard: ['alerts', 'sunbar', 'hourly'],
    compact:  ['desc', 'stats', 'alerts', 'sunbar', 'hourly'],
    tiny:     ['icon', 'desc', 'hilo', 'stats', 'alerts', 'sunbar', 'hourly']
  },
  defaults: (ctx) => ({
    variant: 'trmnl',
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

// Per-tier scale for the hero core. Icon px is real now — the fixed
// 90px !important CSS override is gone, so big tiles actually get the
// bigger art these numbers always promised.
const TIER_SIZE = {
  tiny:     { icon: 0,   temp: 54 },
  compact:  { icon: 60,  temp: 72 },
  standard: { icon: 90,  temp: 86 },
  extended: { icon: 110, temp: 96 },
  // 130px full-tier art + every extra enabled overflows 480px — verified
  // in /widgets-matrix; 110 keeps sunbar + hourly on-tile.
  full:     { icon: 110, temp: 96 }
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

export function render(ctx) {
  const { weather, units, cfg, settings, cellW, cellH, density } = ctx;
  if (!weather) {
    const hasLoc =
      (settings && Number.isFinite(settings.lat) && Number.isFinite(settings.lon)) ||
      (cfg && Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon));
    return placeholder('WEATHER', hasLoc ? 'Weather unavailable' : 'Set your location', 'weather', { cellW, cellH }, hasLoc ? 'nodata' : 'setup');
  }
  const w = weather;
  const s = settings || {};
  const tier = pickTier(cellW, cellH, density);
  const variant = ctx.variant
    || (def.variants[s.variant] ? s.variant : 'classic');
  const sz = TIER_SIZE[tier];
  const staleClass = w.stale ? ' weather-stale' : '';
  const staleBadge = w.stale ? '<div class="stale-pill">CACHED</div>' : '';

  const tempBlock = (size) => `
    <div class="weather-temp" style="font-size:${size}px">
      <span class="temp-num">${w.temp}</span><span class="temp-deg" style="font-size:${Math.round(size*0.6)}px">°${units}</span>
    </div>`;
  const heroIcon = (px) => px > 0
    ? `<div class="weather-icon" style="height:${px}px">${icon(w, px)}</div>`
    : '';
  const descLine = () => (s.showDesc !== false) ? `<div class="weather-desc">${w.desc}</div>` : '';
  const hiloLine = () => `<div class="weather-hilo">HIGH ${w.tempMax}° &nbsp;·&nbsp; LOW ${w.tempMin}°</div>`;

  const statsKeys = Array.isArray(s.stats) && s.stats.length ? s.stats : DEFAULT_STATS;
  const statsBlock = () => {
    if (s.showStats === false) return '';
    const cells = statsKeys.map(k => statForKey(k, w)).filter(Boolean).slice(0, 4);
    if (!cells.length) return '';
    // Flat grid items (no per-stat wrapper) so the CSS grid can size
    // each column to its widest content. With the old `.stat` wrapper +
    // flex-between, a long value like "SE 4 (G10) mph" only pushed
    // within its own cell, breaking visual alignment with neighbouring
    // labels in the adjacent column.
    return `<div class="weather-stats">
      ${cells.map(c => `<span class="stat-k">${c.k}</span><span class="stat-v">${c.v}</span>`).join('')}
    </div>`;
  };

  // Tier gates for the extras — shared by classic and split so the two
  // variants degrade identically; minimal opts out of all of them.
  const tierRank = { tiny: 0, compact: 1, standard: 2, extended: 3, full: 4 }[tier];
  const alerts = (tierRank >= 3 && s.showAlerts !== false) ? alertBanner(w) : '';
  // Stats need ~120px under the hero — a standard-tier 8×6 tile (240px)
  // half-clips the grid mid-row, so require 8 grid rows of height too.
  const stats  = (tierRank >= 2 && (cellH || 0) >= 8) ? statsBlock() : '';
  const sun    = (tierRank >= 4 && s.showSunbar !== false) ? sunBar(w) : '';
  const hourly = (tierRank >= 4 && s.showHourly !== false) ? hourlyStrip(w) : '';
  const extras = `${alerts}${stats}${sun}${hourly}`;

  if (variant === 'trmnl') {
    // TRMNL-inspired title-bar card: label/value hero + icon, a 2×2 cell
    // grid, and a footer. Uses the shared .tr-* components (Inter grotesk,
    // dashed dividers, dither chips). See docs/trmnl-inspired-design.md.
    const city = tidyPlace((s.city || (cfg && cfg.city) || '').toString());
    const showCells = (cellH || 0) >= 6 && tier !== 'tiny';
    const showFoot  = (cellH || 0) >= 8;
    const heroPx = { tiny: 0, compact: 56, standard: 72, extended: 84, full: 84 }[tier] || 72;
    const cell = (ic, v, l) =>
      `<div class="tr-cell">${ic ? `<span class="tr-ci">${ic}</span>` : ''}`
      + `<div><div class="tr-cv">${v}</div><div class="tr-cl">${l}</div></div></div>`;
    const thermo = '<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M12 3a3 3 0 013 3v8a5 5 0 11-6 0V6a3 3 0 013-3z"/></svg>';
    const drop   = '<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M12 3s7 8 7 13a7 7 0 11-14 0c0-5 7-13 7-13z"/></svg>';
    const upK    = '<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
    const dnK    = '<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';
    const cells = showCells ? `<div class="tr-cells tr-cells-2">
      ${cell(thermo, `${w.feelsLike}°`, 'Feels like')}
      ${cell(drop, `${w.humidity}%`, 'Humidity')}
      ${cell(upK, `${w.tempMax}°`, 'High')}
      ${cell(dnK, `${w.tempMin}°`, 'Low')}
    </div>` : '';
    // Dithered condition bars (same look as the battery/AQI fill) on tall
    // cards. Humidity + cloud are natural 0–100 metrics; precip-heavy cloud
    // reads at a glance without another number. Each bar gets its own weave
    // (checkerboard vs diagonal) so the stacked pair is tellable-apart by
    // texture, not just position.
    const miniBar = (label, pct, tone = 'face-tone-g50') => `<div class="wx-bar-row">
      <span class="wx-bar-l">${label}</span>
      <div class="tr-bar wx-bar"><div class="tr-bar-fill ${tone}" style="width:${Math.max(2, Math.min(100, pct))}%"></div><div class="tr-bar-track face-tone-g15"></div></div>
      <span class="wx-bar-v">${Math.round(pct)}%</span>
    </div>`;
    const bars = (showFoot && Number.isFinite(w.humidity)) ? `<div class="wx-bars">
      ${miniBar('Humidity', w.humidity)}
      ${Number.isFinite(w.cloudCover) ? miniBar('Cloud', w.cloudCover, 'face-tone-diag') : ''}
    </div>` : '';
    return `<div class="tr-card${staleClass}">
      <div class="tr-titlebar"><span>Weather</span><span class="tr-meta">${city || (w.stale ? 'cached' : '')}</span></div>
      <div class="tr-body">
        <div style="display:flex;align-items:center;gap:14px">
          ${heroPx ? `<div style="flex:none;width:${heroPx}px;height:${heroPx}px">${icon(w, heroPx)}</div>` : ''}
          <div class="tr-lv tr-lv-xl"><div class="tr-v">${w.temp}<span class="tr-deg">°${units}</span></div><div class="tr-l">${w.desc || 'Temperature'}</div></div>
        </div>
        ${cells}
        ${bars}
      </div>
      ${showFoot ? `<div class="tr-foot"><span class="tr-foot-name">${icon(w, 14)} Weather</span><span>${w.stale ? 'cached' : 'now'}</span></div>` : ''}
    </div>`;
  }

  if (variant === 'minimal') {
    // Temperature-dominant; no icon and no extras at any tier. The temp
    // gets the icon's vacated room (one size class up vs classic).
    const tempPx = { tiny: 54, compact: 80, standard: 104, extended: 120, full: 120 }[tier];
    return `<div class="weather-hero hero-minimal hero-tier-${tier}${staleClass}">
      ${staleBadge}${tempBlock(tempPx)}${tierRank >= 1 ? hiloLine() : ''}
    </div>`;
  }

  if (variant === 'split') {
    if (tier === 'tiny') {
      // No room for two columns — same as classic tiny.
      return `<div class="weather-hero hero-tier-tiny${staleClass}">${staleBadge}${tempBlock(sz.temp)}</div>`;
    }
    return `<div class="weather-hero hero-split hero-tier-${tier}${staleClass}">
      ${staleBadge}
      ${heroIcon(sz.icon)}
      <div class="hero-readings">
        ${tempBlock(sz.temp)}
        ${tierRank >= 2 ? descLine() : ''}
        ${hiloLine()}
      </div>
    </div>${extras}`;
  }

  // classic
  switch (tier) {
    case 'tiny':
      return `<div class="weather-hero hero-tier-tiny${staleClass}">${staleBadge}${tempBlock(sz.temp)}</div>`;
    case 'compact':
      return `<div class="weather-hero hero-tier-compact${staleClass}">
        ${staleBadge}
        <div class="hero-row">${heroIcon(sz.icon)}${tempBlock(sz.temp)}</div>
        ${hiloLine()}
      </div>`;
    default:
      return `<div class="weather-hero hero-tier-${tier}${staleClass}">
        ${staleBadge}${heroIcon(sz.icon)}${tempBlock(sz.temp)}${descLine()}${hiloLine()}
      </div>${extras}`;
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

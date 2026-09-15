// Weather · Forecast — N-day high/low outlook.
//
// Contract v2 (widgets-refresh W2): two layout variants —
//   rows    — vertical list, one day per row (the original)
//   columns — horizontal strip, one day per column; built for the wide
//             short XL footprint where rows waste the width
// Day count auto-scales with the variant's long axis (rows → height,
// columns → width); an explicit forecastDays setting wins.

import { escapeHtml, placeholder, semRed } from './_shared.js';
import { icon } from './_weather_shared.js';

export const def = {
  id: 'weather_forecast',
  usesDensity: false,   // sizes off cellW/cellH directly, ignores ctx.density
  label: 'Forecast',
  requires: 'weather',
  minSize: { w: 6, h: 6 },
  sizes: {
    S:  { w: 6, h: 8 },
    M:  { w: 6, h: 12 },
    L:  { w: 12, h: 12 },
    XL: { w: 24, h: 6 }
  },
  defaultSize: 'M',
  variants: {
    rows:    { label: 'Rows — one day per line' },
    columns: { label: 'Columns — horizontal day strip' }
  },
  defaultVariant: 'columns',
  // Advisory: what shrinks away as the tile gets smaller. Day count
  // itself auto-scales with size, so the degrade story is mostly
  // "fewer days", plus precip hiding on narrow tiles in auto mode.
  degrade: {
    standard: ['precip (auto mode, rows < 8 cols wide)'],
    compact:  ['precip', 'days (fewer fit)'],
    tiny:     ['precip', 'days']
  },
  defaults: (ctx) => ({
    variant: 'columns',
    city: (ctx && ctx.city) || '',
    lat:  (ctx && Number.isFinite(ctx.lat)) ? ctx.lat : null,
    lon:  (ctx && Number.isFinite(ctx.lon)) ? ctx.lon : null,
    unitsOverride: 'inherit',
    forecastDays: null,
    includeToday: false,
    title: '',
    precipMode: 'auto',     // 'auto' | 'always' | 'never'
    hiloStyle:  'stack',    // 'stack' | 'inline' | 'arrows'
    showIcons:  true,
    showDayName: true,
    fontScale: 1,
    padding: 14
  })
};

function hiloBlock(f, hiloStyle) {
  if (hiloStyle === 'inline') {
    return `<div class="fc-hilo fc-hilo-inline"><span class="fc-hi">${f.hi}°</span><span class="fc-hilo-sep"> / </span><span class="fc-lo">${f.lo}°</span></div>`;
  }
  if (hiloStyle === 'arrows') {
    return `<div class="fc-hilo fc-hilo-arrows"><span class="fc-hi">↑${f.hi}°</span><span class="fc-lo">↓${f.lo}°</span></div>`;
  }
  return `<div class="fc-hilo"><div class="fc-hi">${f.hi}°</div><div class="fc-lo">${f.lo}°</div></div>`;
}

export function render(ctx) {
  const { weather, cfg, settings, cellW, cellH } = ctx;
  const w = weather;
  if (!w || !w.forecast || !w.forecast.length) {
    const hasLoc =
      (settings && Number.isFinite(settings.lat) && Number.isFinite(settings.lon)) ||
      (cfg && Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon));
    return placeholder('FORECAST', hasLoc ? 'Forecast unavailable' : 'Set your location', 'weather', { cellW, cellH }, hasLoc ? 'nodata' : 'setup');
  }
  const s = settings || {};
  const ch = cellH || 0, cw = cellW || 0;
  const variant = ctx.variant
    || (def.variants[s.variant] ? s.variant : 'rows');
  const userDays = parseInt(
    Number.isFinite(w.forecastDays)
      ? w.forecastDays
      : (cfg && cfg.weather && cfg.weather.forecastDays),
    10
  );
  // Auto day count follows the variant's long axis.
  const autoDays = variant === 'columns'
    ? (cw < 8 ? 2 : cw < 12 ? 3 : cw < 16 ? 4 : cw < 20 ? 5 : cw < 24 ? 6 : 7)
    : (ch < 4 ? 1 : ch < 6 ? 2 : ch < 8 ? 3 : ch < 10 ? 4 : ch < 12 ? 5 : 7);
  const days = Number.isFinite(userDays)
    ? Math.max(1, Math.min(8, userDays))
    : autoDays;
  const precipMode = s.precipMode || 'auto';
  const hiloStyle = s.hiloStyle || 'stack';
  const showIcons   = s.showIcons   !== false;
  const showDayName = s.showDayName !== false;
  // Today lives at forecast[0] (isToday). Drop it unless the tile opts in;
  // when shown, relabel it "TODAY".
  const includeToday = s.includeToday === true;
  let source = Array.isArray(w.forecast) ? w.forecast : [];
  if (!includeToday) source = source.filter(f => !f.isToday);
  const list = source.slice(0, days).map(f => (f.isToday ? { ...f, name: 'TODAY' } : f));
  const titleLabel = (s.title && String(s.title).trim())
    ? String(s.title).trim()
    : `${list.length}-DAY OUTLOOK`;
  const title = `<div class="col-title">${escapeHtml(titleLabel)}</div>`;

  if (variant === 'trmnl') {
    const showPrecip = precipMode === 'always' ? true
                     : precipMode === 'never'  ? false
                     :                            cw >= 8;
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>Forecast</span><span class="tr-meta">${list.length}-day</span></div>
      <div class="tr-body" style="padding:4px 12px;gap:0"><div class="tr-rows">
        ${(() => {
          // Scale the hi/lo font + icon to the tile width so the low temp
          // never clips at the right edge on a narrow (6-col) forecast.
          const tempPx = cw < 8 ? 15 : cw < 12 ? 17 : 19;
          const icPx   = cw < 8 ? 22 : 26;
          const gap    = cw < 8 ? 7 : 10;
          return list.map(f => `<div class="tr-row" style="align-items:center;gap:${gap}px">
          <span style="font-weight:700;font-size:13px;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.name)}</span>
          ${showIcons ? `<span class="fc-tr-icon" style="width:${icPx}px;height:${icPx}px;flex:none;display:inline-flex;overflow:hidden">${icon(f.main, icPx)}</span>` : ''}
          <span style="flex:1 1 auto;min-width:4px"></span>
          ${showPrecip && Number.isFinite(f.precip) && f.precip > 0 ? `<span style="font-size:12px;flex:none" class="fc-precip${semRed(s, f.precip >= 60)}">${f.precip}%</span>` : ''}
          <span style="font-size:${tempPx}px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap;flex:none">${f.hi}° <span style="font-weight:400">${f.lo}°</span></span>
        </div>`).join('');
        })()}
      </div></div>
    </div>`;
  }

  if (variant === 'columns') {
    // Auto precip in the strip keys off height — every column already
    // has the width, the question is vertical room under the hi/lo.
    const showPrecip = precipMode === 'always' ? true
                     : precipMode === 'never'  ? false
                     :                           ch >= 6;
    const iconPx = ch < 6 ? 30 : ch < 10 ? 38 : 44;
    return `
      ${title}
      <div class="fc-strip">
        ${list.map(f => `
          <div class="fc-col">
            ${showDayName ? `<div class="fc-day">${f.name}</div>` : ''}
            ${showIcons   ? `<div class="fc-icon">${icon(f.main, iconPx)}</div>` : ''}
            ${hiloBlock(f, hiloStyle)}
            ${showPrecip && Number.isFinite(f.precip) && f.precip > 0
              ? `<div class="fc-precip${semRed(s, f.precip >= 60)}">${f.precip}%</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  // rows
  const showPrecip = precipMode === 'always' ? true
                   : precipMode === 'never'  ? false
                   :                            cw >= 8;
  const iconPx = ch < 4 ? 26 : ch < 6 ? 28 : ch < 8 ? 32 : ch < 12 ? 34 : 38;
  return `
    ${title}
    ${list.map(f => `
      <div class="fc-row fc-hilo-${hiloStyle}">
        ${showDayName ? `<div class="fc-day">${f.name}</div>` : ''}
        ${showIcons   ? `<div class="fc-icon">${icon(f.main, iconPx)}</div>` : ''}
        ${hiloBlock(f, hiloStyle)}
        ${showPrecip && Number.isFinite(f.precip) && f.precip > 0
          ? `<div class="fc-precip${semRed(s, f.precip >= 60)}">${f.precip}%</div>` : ''}
      </div>
    `).join('')}
  `;
}

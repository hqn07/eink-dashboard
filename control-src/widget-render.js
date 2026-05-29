// Client-side mirror of dashboard.html's widget render functions.
// Both the React editor and the pool render real widget HTML by
// calling these — the result is dropped into the DOM via
// `dangerouslySetInnerHTML` and styled via /static/dashboard.css.

import { pickTier } from './widgets.js';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Format seconds as M:SS — used by the Now Playing progress display.
function fmtSec(s) {
  if (!Number.isFinite(s) || s < 0) return '--:--';
  const m = Math.floor(s / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${ss}`;
}

// Now-playing renderer. Two layouts:
//
//   horizontal (tiny / compact / standard tiers): art-left, text-right,
//   progress strip at the bottom.
//
//   stacked (extended / full tiers): art centered, elapsed / remaining
//   time as big bookends on either side, title + artist · album +
//   source label below the art, then a full-width progress bar.
//
// Future customizability — let users pick what fills the side-space
// (time bookends today; vertical text / play state / metadata later).
// See memory `project_eink_widget_customizability_roadmap.md`.
function renderNowPlaying(np, cellW, cellH, density, settings) {
  const tier = pickTier(cellW || 0, cellH || 0, density);
  const stateIcon = np.isPlaying ? '▶' : '❚❚';
  const s = settings || {};
  const variant   = s.variant   || 'time_bookends';
  const fontScale = Number.isFinite(s.fontScale) ? s.fontScale : 1;
  const padding   = Number.isFinite(s.padding)   ? s.padding   : 14;
  const TIER_CFG = {
    tiny:     { art: 0,   maxFont: 20, showProgress: false, showSource: false, stacked: false },
    compact:  { art: 56,  maxFont: 26, showProgress: false, showSource: false, stacked: false },
    standard: { art: 80,  maxFont: 34, showProgress: true,  showSource: true,  stacked: false },
    extended: { art: 240, maxFont: 48, showProgress: true,  showSource: true,  stacked: true  },
    full:     { art: 320, maxFont: 64, showProgress: true,  showSource: true,  stacked: true  }
  };
  const cfg = TIER_CFG[tier] || TIER_CFG.standard;
  const artistAlbum = [np.artist, np.album].filter(Boolean).map(escapeHtml).join(' · ');
  const source = cfg.showSource && np.sourceLabel ? `via ${escapeHtml(np.sourceLabel)}` : '';
  const hasProgress = cfg.showProgress
    && Number.isFinite(np.durationSec) && np.durationSec > 0
    && Number.isFinite(np.elapsedSec);
  const pct = hasProgress
    ? Math.max(0, Math.min(100, (np.elapsedSec || 0) / np.durationSec * 100))
    : 0;
  const artInner = np.artworkBase64
    ? `<img class="mac-np-art" style="width:${cfg.art}px;height:${cfg.art}px" src="data:image/png;base64,${np.artworkBase64}" alt="" />`
    : `<div class="mac-np-art mac-np-art-empty" style="width:${cfg.art}px;height:${cfg.art}px">${stateIcon}</div>`;

  if (cfg.stacked) {
    const elapsedStr = hasProgress ? fmtSec(np.elapsedSec) : '';
    const remainStr  = hasProgress ? '−' + fmtSec(Math.max(0, np.durationSec - (np.elapsedSec || 0))) : '';
    const progressBar = hasProgress
      ? `<div class="mac-np-bar mac-np-bar-only"><div class="mac-np-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>`
      : '';
    const showBookends = variant !== 'centered';
    const maxFont = Math.max(14, Math.round(cfg.maxFont * fontScale));
    const cardStyle = `padding:${padding}px;`;
    return `
      <div class="mac-np-card mac-np-stacked mac-np-tier-${tier} mac-np-var-${variant}" style="${cardStyle}">
        <div class="mac-np-head">
          <span class="col-title">NOW PLAYING</span>
        </div>
        <div class="mac-np-stacked-row">
          ${showBookends ? `<div class="mac-np-bookend mac-np-bookend-left">${elapsedStr}</div>` : ''}
          ${artInner}
          ${showBookends ? `<div class="mac-np-bookend mac-np-bookend-right">${remainStr}</div>` : ''}
        </div>
        <div class="mac-np-state-big">${stateIcon}</div>
        <div class="mac-np-stacked-text">
          <div class="mac-np-title autofit" data-min-font="14" data-max-font="${maxFont}">${escapeHtml(np.title)}</div>
          <div class="mac-np-meta">${artistAlbum || '—'}</div>
          ${source ? `<div class="mac-np-source">${source}</div>` : ''}
        </div>
        ${progressBar}
      </div>
    `;
  }

  const art = cfg.art === 0 ? '' : artInner;
  const progress = hasProgress
    ? `<div class="mac-np-progress">
         <div class="mac-np-bar"><div class="mac-np-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
         <div class="mac-np-time">${fmtSec(np.elapsedSec)} / ${fmtSec(np.durationSec)}</div>
       </div>`
    : '';
  return `
    <div class="mac-np-card mac-np-tier-${tier}">
      <div class="mac-np-head">
        <span class="mac-np-state">${stateIcon}</span>
        <span class="col-title">NOW PLAYING</span>
      </div>
      <div class="mac-np-body">
        ${art}
        <div class="mac-np-text">
          <div class="mac-np-title autofit" data-min-font="14" data-max-font="${cfg.maxFont}">${escapeHtml(np.title)}</div>
          <div class="mac-np-meta">${artistAlbum || '—'}</div>
          ${source ? `<div class="mac-np-source">${source}</div>` : ''}
        </div>
      </div>
      ${progress}
    </div>
  `;
}

// Minimal inline markdown: caller must escapeHtml first to keep this safe.
function md(s) {
  return String(s || '')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

// Per-widget placeholder glyphs. Chunky strokes survive 1-bit threshold.
// `weather` swapped to the vendored sevesalm cloud icon so the placeholder
// uses the same visual vocabulary as the live widget.
const PLACEHOLDER_ICONS = {
  weather:  '<img src="/static/icons/sevesalm/cloudy.svg" width="64" height="64" alt="" />',
  calendar: '<svg viewBox="0 0 64 64"><rect x="8" y="14" width="48" height="42" fill="none" stroke="#000" stroke-width="4"/><line x1="8" y1="24" x2="56" y2="24" stroke="#000" stroke-width="4"/><line x1="20" y1="8" x2="20" y2="20" stroke="#000" stroke-width="4" stroke-linecap="round"/><line x1="44" y1="8" x2="44" y2="20" stroke="#000" stroke-width="4" stroke-linecap="round"/></svg>',
  stocks:   '<svg viewBox="0 0 64 64"><polyline points="6,46 20,32 30,38 44,18 58,24" fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><line x1="6" y1="56" x2="58" y2="56" stroke="#000" stroke-width="4"/></svg>'
};

// Setup-needed placeholder. Matches dashboard.html so what you see in the
// editor previews matches what'll actually render on the device.
function placeholder(title, hint, iconKey) {
  const ic = iconKey && PLACEHOLDER_ICONS[iconKey];
  return `
    <div class="widget widget-placeholder">
      ${ic ? `<div class="ph-icon">${ic}</div>` : ''}
      <div class="ph-title">${title}</div>
      <div class="ph-hint">${hint}</div>
      <div class="ph-tag">SETUP NEEDED</div>
    </div>
  `;
}

// Weather icons are vendored from sevesalm/eInk-weather-display
// (BSD-3-Clause) under public/icons/sevesalm/. We pull them via
// /static/icons/sevesalm/<name>.svg so the bundle stays tiny — the
// browser caches the SVGs separately and Puppeteer loads them by URL.
// The mapping below must stay in sync with widgets/icons.js (server
// side) and the inline copy in public/dashboard.html.
const WMO_ICON = {
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
  // arg may be a `main` string (forecast / hourly callers) or a full
  // weather object (hero caller). Both shapes resolve to a filename.
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

function icon(arg, size) {
  const name = _pickIconName(arg);
  return `<img class="icon" src="/static/icons/sevesalm/${name}.svg" width="${size}" height="${size}" alt="" />`;
}

function fakeWeather(units) {
  return {
    temp: '--', feelsLike: '--', tempMin: '--', tempMax: '--',
    humidity: '--', windSpeed: '--', windDir: '--', windUnit: units === 'C' ? 'm/s' : 'mph',
    desc: 'NO DATA', main: 'Clear',
    sunrise: '--:--', sunset: '--:--',
    sunriseMin: null, sunsetMin: null, nowMin: null,
    forecast: [], hourly: []
  };
}

function sunBar(w) {
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

function hourlyStrip(w) {
  if (!w || !Array.isArray(w.hourly) || !w.hourly.length) return '';
  return `
    <div class="hourly-strip">
      ${w.hourly.map(h => `
        <div class="hr-cell">
          <div class="hr-time">${h.label}</div>
          ${icon(h.main, 22)}
          <div class="hr-temp">${h.temp}°</div>
          ${Number.isFinite(h.precip) && h.precip >= 10
            ? `<div class="hr-precip-pct">${h.precip}%</div>`
            : ''}
        </div>
      `).join('')}
    </div>
  `;
}

const RENDERERS = {
  weather_hero: ({ weather, units, cellW, cellH, density }) => {
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
  },
  weather_forecast: ({ weather, cfg, cellW, cellH, density }) => {
    const w = weather;
    if (!w || !w.forecast || !w.forecast.length) {
      return `<div class="col-title">FORECAST</div><div class="empty" style="border:0;padding:14px 0">NO DATA</div>`;
    }
    // Day count is user-configurable per-tile: server attaches
    // `forecastDays` straight onto the slot's weather payload (Commit
    // B). Fall back to the legacy cfg.weather.forecastDays for tiles
    // that haven't been re-saved since the contract switch.
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
    const t = { days, iconPx, showPrecip };
    const max = t.days;
    const list = w.forecast.slice(0, max);
    return `
      <div class="col-title">${list.length}-DAY OUTLOOK</div>
      ${list.map(f => `
        <div class="fc-row">
          <div class="fc-day">${f.name}</div>
          <div class="fc-icon">${icon(f.main, t.iconPx)}</div>
          <div class="fc-hilo">
            <div class="fc-hi">${f.hi}°</div>
            <div class="fc-lo">${f.lo}°</div>
          </div>
          ${t.showPrecip && Number.isFinite(f.precip) && f.precip > 0
            ? `<div class="fc-precip">${f.precip}%</div>` : '<div class="fc-precip"></div>'}
        </div>
      `).join('')}
    `;
  },
  message: ({ cfg, resolvedMessage, cellW, cellH, density }) => {
    const m = resolvedMessage || (cfg && cfg.message) || {};
    const text = m.text || 'Custom message';
    const sub  = m.subtitle || '';
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { txtSize: 14, subSize: 10, showSub: false },
      compact:  { txtSize: 18, subSize: 11, showSub: true  },
      standard: { txtSize: 22, subSize: 12, showSub: true  },
      extended: { txtSize: 28, subSize: 13, showSub: true  },
      full:     { txtSize: 36, subSize: 14, showSub: true  }
    };
    const t = matrix[tier];
    return `
      <div class="widget widget-msg">
        <div class="msg-text" style="font-size:${t.txtSize}px">${md(escapeHtml(text))}</div>
        ${t.showSub && sub ? `<div class="msg-sub" style="font-size:${t.subSize}px">${md(escapeHtml(sub))}</div>` : ''}
      </div>
    `;
  },
  calendar: ({ events, cellW, cellH, density }) => {
    const all = (events || []);
    if (!all.length) {
      return `<div class="widget widget-cal"><div class="widget-title">UPCOMING</div><div class="cal-row"><div class="cal-info"><div class="cal-title">No events</div></div></div></div>`;
    }
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { events: 1, sections: false },
      compact:  { events: 2, sections: false },
      standard: { events: 4, sections: false },
      extended: { events: 5, sections: true  },
      full:     { events: 8, sections: true  }
    };
    const t = matrix[tier];
    const list = all.slice(0, t.events);
    const row = ev => `
      <div class="cal-row ${ev.isAllDay ? 'allday' : ''}">
        <div class="cal-day">${escapeHtml(ev.dayLabel || '')}</div>
        <div class="cal-info">
          <div class="cal-title">${escapeHtml(ev.title || '')}</div>
          <div class="cal-time">${escapeHtml(ev.startLabel || '')}</div>
        </div>
      </div>`;
    if (!t.sections) {
      return `
        <div class="widget widget-cal">
          <div class="widget-title">UPCOMING</div>
          ${list.map(row).join('')}
        </div>
      `;
    }
    const groups = {};
    const order = [];
    for (const ev of list) {
      const s = ev.section || 'LATER';
      if (!groups[s]) { groups[s] = []; order.push(s); }
      groups[s].push(ev);
    }
    return `
      <div class="widget widget-cal">
        <div class="widget-title">UPCOMING</div>
        ${order.map(s => `
          <div class="cal-section-title">${s}</div>
          ${groups[s].map(row).join('')}
        `).join('')}
      </div>
    `;
  },
  stocks: ({ stocks, cellW, cellH, density }) => {
    // Per-tile contract: symbols live in `item.settings.symbols` and the
    // server fetches into `slot.stocks` for each tile. An empty list means
    // either the tile is unconfigured or every symbol failed to resolve.
    const list = stocks || [];
    if (!list.length) return placeholder('MARKETS', 'Add symbols (AAPL, BTC-USD) in settings', 'stocks');
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { watch: 0, heroSpark: false, heroMeta: false, heroChg: false, watchSpark: false, watchChg: false },
      compact:  { watch: 0, heroSpark: true,  heroMeta: false, heroChg: true,  watchSpark: false, watchChg: false },
      standard: { watch: 3, heroSpark: true,  heroMeta: true,  heroChg: true,  watchSpark: true,  watchChg: true  },
      extended: { watch: 5, heroSpark: true,  heroMeta: true,  heroChg: true,  watchSpark: true,  watchChg: true  },
      full:     { watch: 7, heroSpark: true,  heroMeta: true,  heroChg: true,  watchSpark: true,  watchChg: true  }
    };
    const t = matrix[tier];
    const hero = list[0];
    const watch = list.slice(1, 1 + t.watch);
    function spark(points, opts) {
      if (!Array.isArray(points) || points.length < 2) return '';
      const vbW = 100, vbH = 30, pad = 1;
      const min = Math.min(...points), max = Math.max(...points);
      const range = max - min || 1;
      const step = (vbW - pad * 2) / (points.length - 1);
      const path = points.map((v, i) => {
        const x = pad + i * step;
        const y = pad + (vbH - pad * 2) * (1 - (v - min) / range);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const cls = opts && opts.cls ? opts.cls : 'stock-spark';
      const styles = (opts && opts.style) ? opts.style : '';
      const sw = opts && opts.stroke ? opts.stroke : 2;
      return `<svg class="${cls}" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="none" style="${styles}"><path d="${path}" fill="none" stroke="#000" stroke-width="${sw}" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
    }
    const dirArrow = v => v >= 0 ? '▲' : '▼';
    const dirCls = v => v >= 0 ? 'up' : 'down';
    const heroChg = t.heroChg && Number.isFinite(hero.change)
      ? `<span class="hero-chg ${dirCls(hero.change)}">${dirArrow(hero.change)} ${Math.abs(hero.change).toFixed(2)} (${hero.change >= 0 ? '+' : '−'}${Math.abs(hero.changePct).toFixed(2)}%)</span>`
      : '';
    const heroMeta = t.heroMeta && (hero.dayHigh || hero.dayLow)
      ? `<div class="hero-meta">${hero.dayHigh ? `H ${hero.dayHigh}` : ''}${hero.dayHigh && hero.dayLow ? ' · ' : ''}${hero.dayLow ? `L ${hero.dayLow}` : ''}</div>`
      : '';
    const heroSparkHtml = t.heroSpark
      ? spark(hero.spark, { cls: 'hero-spark', stroke: 2.5, style: 'flex:1;min-height:0;width:100%' })
      : '';
    const watchRows = watch.map(s => `
      <div class="stock-watch-row">
        <span class="watch-sym">${escapeHtml(s.symbol)}</span>
        ${t.watchSpark ? spark(s.spark, { cls: 'watch-spark', stroke: 2, style: 'height:18px;width:100%' }) : '<span></span>'}
        <span class="watch-price">${s.price}</span>
        ${t.watchChg ? `<span class="watch-chg ${dirCls(s.change)}">${dirArrow(s.change)} ${Math.abs(s.changePct).toFixed(2)}%</span>` : ''}
      </div>
    `).join('');
    return `
      <div class="widget widget-stocks stocks-hero-mode">
        <div class="widget-title">MARKETS</div>
        <div class="stock-hero">
          <div class="hero-top">
            <span class="hero-sym">${escapeHtml(hero.symbol)}</span>
            ${heroChg}
          </div>
          <div class="hero-price autofit" data-min-font="22">${hero.price}</div>
          ${heroMeta}
          ${heroSparkHtml}
        </div>
        ${watch.length ? `<div class="stock-watch-list">${watchRows}</div>` : ''}
      </div>
    `;
  },

  mac_nowplaying: ({ macNowPlaying, cellW, cellH, density, settings }) => {
    if (!macNowPlaying) {
      return `<div class="col-title">NOW PLAYING</div><div class="empty" style="border:0;padding:14px 0">MAC OFFLINE</div>`;
    }
    return renderNowPlaying(macNowPlaying, cellW, cellH, density, settings);
  },

  mac_battery: ({ macBattery }) => {
    if (!macBattery) {
      return `<div class="col-title">MAC</div><div class="empty" style="border:0;padding:14px 0">OFFLINE</div>`;
    }
    const charging = /charg/i.test(macBattery.state);
    const arrow = charging ? '⚡' : '';
    return `
      <div class="mac-batt">
        <div class="col-title">MAC BATTERY</div>
        <div class="mac-batt-pct autofit" data-min-font="22">${macBattery.percent}%${arrow}</div>
        <div class="mac-batt-state">${escapeHtml(macBattery.state.toUpperCase())}</div>
      </div>
    `;
  },

  clock: ({ clockNow }) => {
    if (!clockNow) return `<div class="empty" style="border:0;padding:14px 0">NO TIME</div>`;
    const c = clockNow;
    const cls = c.style === 'thin' ? 'clock-thin' : 'clock-big';
    const ampm = c.ampm ? `<span class="clock-ampm">${c.ampm}</span>` : '';
    const date = c.dateLine ? `<div class="clock-date">${escapeHtml(c.dateLine)}</div>` : '';
    return `
      <div class="clock ${cls}">
        <div class="clock-time autofit" data-min-font="22">${c.timeStr}${ampm}</div>
        ${date}
      </div>
    `;
  },

};

export function renderWidget(id, data) {
  const fn = RENDERERS[id];
  if (!fn) return '';
  try { return fn(data || {}); } catch { return ''; }
}

// Default chrome — used when the screen's chrome is missing.
const DEFAULT_CHROME = {
  header: { enabled: true, left: '{city}', leftSub: '{date}', right: '{time}', rightSub: 'EDITION No. {edition}' },
  footer: { enabled: true, text: 'UPDATED {time} · REFRESH {refresh}MIN · THE DAILY {city}' }
};

function chromeTokens(data) {
  const cfg = (data && data.cfg) || {};
  const w = data && data.weather;
  // Always use the live wall clock — same fix as dashboard.html.
  const tz = cfg.timezone || 'UTC';
  const now = new Date();
  let timeStr = '', dateStr = '';
  try {
    timeStr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
    }).format(now).toUpperCase();
    dateStr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    }).format(now).toUpperCase();
  } catch {
    timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    dateStr = now.toDateString().toUpperCase();
  }
  const battery = (data && data.battery) || null;
  const battPct = battery && Number.isFinite(battery.pct) ? battery.pct : null;
  const battV   = battery && Number.isFinite(battery.v)   ? battery.v   : null;
  const battAgeMin = battery && Number.isFinite(battery.at)
    ? Math.max(0, Math.round((Date.now() - battery.at) / 60000))
    : null;
  const battAgeLabel = battAgeMin == null ? '—'
    : battAgeMin < 60 ? `${battAgeMin}m`
    : `${Math.round(battAgeMin / 60)}h`;
  return {
    '{city}': (cfg.cityLabel || cfg.city || '').toString(),
    '{time}': timeStr,
    '{date}': dateStr,
    '{refresh}': String(cfg.refreshMinutes || 30),
    '{edition}': String(Math.floor(Date.now() / 3600000) % 9999),
    '{battery}': battPct != null ? `${battPct}%` : '—',
    '{battpct}': battPct != null ? String(battPct) : '—',
    '{battv}':   battV   != null ? `${battV.toFixed(2)}V` : '—',
    '{battage}': battAgeLabel
  };
}

function tplString(s, tokens) {
  let out = String(s || '');
  for (const k in tokens) out = out.split(k).join(tokens[k]);
  return out;
}

// Header/footer chrome the dashboard wraps around the body grid. The
// editor renders these in fixed top/bottom strips so the body area
// exactly matches the dashboard's body grid pixel-for-pixel.
export function renderHeader(data) {
  const chrome = (data && data.chrome) || DEFAULT_CHROME;
  const h = chrome.header || {};
  if (h.enabled === false) return '';
  const tokens = chromeTokens(data);
  return `
    <div class="hdr-left">
      <div class="hdr-city">${escapeHtml(tplString(h.left, tokens))}</div>
      ${h.leftSub ? `<div class="hdr-date">${escapeHtml(tplString(h.leftSub, tokens))}</div>` : ''}
    </div>
    <div class="hdr-right">
      <div class="hdr-time">${escapeHtml(tplString(h.right, tokens))}</div>
      ${h.rightSub ? `<div class="hdr-meta">${escapeHtml(tplString(h.rightSub, tokens))}</div>` : ''}
    </div>
  `;
}

export function renderFooter(data) {
  const chrome = (data && data.chrome) || DEFAULT_CHROME;
  const f = chrome.footer || {};
  if (f.enabled === false) return '';
  const tokens = chromeTokens(data);
  const battBadge = f.showBattery
    ? `<span class="ftr-battery">BAT ${escapeHtml(tokens['{battery}'])}${tokens['{battage}'] !== '—' ? ` · ${escapeHtml(tokens['{battage}'])}` : ''}</span>`
    : '';
  return `<span class="ftr-bullet">●</span> ${escapeHtml(tplString(f.text, tokens))}${battBadge}`;
}

export function isHeaderOn(data) {
  const chrome = (data && data.chrome) || DEFAULT_CHROME;
  return (chrome.header || {}).enabled !== false;
}
export function isFooterOn(data) {
  const chrome = (data && data.chrome) || DEFAULT_CHROME;
  return (chrome.footer || {}).enabled !== false;
}
export function headerVariant(data) {
  const chrome = (data && data.chrome) || DEFAULT_CHROME;
  return ((chrome.header || {}).variant || 'masthead').toLowerCase();
}
export function footerVariant(data) {
  const chrome = (data && data.chrome) || DEFAULT_CHROME;
  return ((chrome.footer || {}).variant || 'editorial').toLowerCase();
}

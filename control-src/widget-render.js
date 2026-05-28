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

// Minimal inline markdown: caller must escapeHtml first to keep this safe.
function md(s) {
  return String(s || '')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

// Per-widget placeholder glyphs. Chunky strokes survive 1-bit threshold.
const PLACEHOLDER_ICONS = {
  weather:  '<svg viewBox="0 0 64 64"><path d="M 18 40 Q 10 40 10 32 Q 10 24 18 24 Q 18 14 28 14 Q 38 14 40 24 Q 52 24 52 34 Q 52 42 44 42 L 18 42 Z" fill="none" stroke="#000" stroke-width="4"/></svg>',
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

// Monochrome weather icons. Heavier strokes + solid silhouettes — reads
// cleanly on 1-bit e-ink at all sizes (thin lines would dither). Style
// is borrowed from the Erik Flowers / Bas Milius open-source weather
// icon sets — same vocabulary (sun with 8 rays, cumulus silhouette,
// slanted droplets, jagged bolt, hex snowflakes, stacked fog lines).
const ICONS = {
  Clear: `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="18" fill="none" stroke="#000" stroke-width="6"/>
    ${Array.from({length:8}, (_,i)=>{
      const a = i*Math.PI/4 + Math.PI/16;
      const x1 = 50 + 28*Math.cos(a), y1 = 50 + 28*Math.sin(a);
      const x2 = 50 + 42*Math.cos(a), y2 = 50 + 42*Math.sin(a);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="6" stroke-linecap="round"/>`;
    }).join('')}
  </svg>`,
  Clouds: `<svg viewBox="0 0 100 100">
    <path d="M 22 70 Q 8 70 8 56 Q 8 42 24 42 Q 28 26 46 26 Q 64 26 68 42 Q 88 42 88 60 Q 88 72 74 72 Z"
      fill="#000"/>
  </svg>`,
  PartlyCloudy: `<svg viewBox="0 0 100 100">
    <circle cx="34" cy="36" r="14" fill="none" stroke="#000" stroke-width="5"/>
    ${[0,1,2,3,4,5].map(i => {
      const a = i*Math.PI/3 - Math.PI/2;
      const x1 = 34 + 20*Math.cos(a), y1 = 36 + 20*Math.sin(a);
      const x2 = 34 + 28*Math.cos(a), y2 = 36 + 28*Math.sin(a);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="5" stroke-linecap="round"/>`;
    }).join('')}
    <path d="M 35 80 Q 22 80 22 70 Q 22 58 36 58 Q 40 46 56 46 Q 72 46 75 58 Q 90 58 90 70 Q 90 80 78 80 Z" fill="#000"/>
  </svg>`,
  Rain: `<svg viewBox="0 0 100 100">
    <path d="M 22 52 Q 8 52 8 40 Q 8 26 24 26 Q 28 12 46 12 Q 64 12 68 26 Q 88 26 88 42 Q 88 56 74 56 Z" fill="#000"/>
    ${[30,50,70].map((x,i)=>`
      <path d="M ${x} 64 L ${x-5} 84" stroke="#000" stroke-width="5" stroke-linecap="round" fill="none"/>
    `).join('')}
  </svg>`,
  Drizzle: `<svg viewBox="0 0 100 100">
    <path d="M 22 52 Q 8 52 8 40 Q 8 26 24 26 Q 28 12 46 12 Q 64 12 68 26 Q 88 26 88 42 Q 88 56 74 56 Z" fill="#000"/>
    ${[28,42,56,70,82].map(x=>`
      <circle cx="${x}" cy="74" r="3" fill="#000"/>
    `).join('')}
  </svg>`,
  Thunderstorm: `<svg viewBox="0 0 100 100">
    <path d="M 22 48 Q 8 48 8 36 Q 8 22 24 22 Q 28 8 46 8 Q 64 8 68 22 Q 88 22 88 38 Q 88 52 74 52 Z" fill="#000"/>
    <polygon points="52,56 38,82 50,82 42,96 64,68 52,68 60,56" fill="#000"/>
  </svg>`,
  Snow: `<svg viewBox="0 0 100 100">
    <path d="M 22 48 Q 8 48 8 36 Q 8 22 24 22 Q 28 8 46 8 Q 64 8 68 22 Q 88 22 88 38 Q 88 52 74 52 Z" fill="#000"/>
    ${[26,50,74].map(x=>`
      <g stroke="#000" stroke-width="3" stroke-linecap="round">
        <line x1="${x-8}" y1="76" x2="${x+8}" y2="76"/>
        <line x1="${x}" y1="68" x2="${x}" y2="84"/>
        <line x1="${x-6}" y1="70" x2="${x+6}" y2="82"/>
        <line x1="${x-6}" y1="82" x2="${x+6}" y2="70"/>
      </g>
    `).join('')}
  </svg>`,
  Mist: `<svg viewBox="0 0 100 100">
    ${[24,40,56,72,84].map((y,i)=>`
      <line x1="${10 + (i%2)*8}" y1="${y}" x2="${90 - (i%2)*8}" y2="${y}"
        stroke="#000" stroke-width="6" stroke-linecap="round"/>
    `).join('')}
  </svg>`
};
ICONS.Fog = ICONS.Mist;
ICONS.Haze = ICONS.Mist;

function icon(main, size) {
  const svg = ICONS[main] || ICONS.Clear;
  return `<span class="icon" style="width:${size}px;height:${size}px">${svg}</span>`;
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
    const heroIcon = (px) => `<div class="weather-icon" style="height:${px}px">${icon(w.main, px)}</div>`;
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
    // Day count is user-configurable via cfg.weather.forecastDays (1-7);
    // auto by cellH otherwise.
    const ch = cellH || 0, cw = cellW || 0;
    const userDays = parseInt((cfg && cfg.weather && cfg.weather.forecastDays), 10);
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
  stocks: ({ stocks, cfg, cellW, cellH, density }) => {
    const syms = (cfg && cfg.stocks && cfg.stocks.symbols) || [];
    if (!syms.length) return placeholder('MARKETS', 'Add symbols (AAPL, BTC-USD) in settings', 'stocks');
    const list = stocks || [];
    if (!list.length) return placeholder('MARKETS', 'Data unavailable — check symbols', 'stocks');
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

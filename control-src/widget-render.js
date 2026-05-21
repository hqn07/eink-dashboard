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
  clock:    '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="none" stroke="#000" stroke-width="4"/><line x1="32" y1="32" x2="32" y2="18" stroke="#000" stroke-width="4" stroke-linecap="round"/><line x1="32" y1="32" x2="42" y2="38" stroke="#000" stroke-width="4" stroke-linecap="round"/></svg>',
  weather:  '<svg viewBox="0 0 64 64"><path d="M 18 40 Q 10 40 10 32 Q 10 24 18 24 Q 18 14 28 14 Q 38 14 40 24 Q 52 24 52 34 Q 52 42 44 42 L 18 42 Z" fill="none" stroke="#000" stroke-width="4"/></svg>',
  calendar: '<svg viewBox="0 0 64 64"><rect x="8" y="14" width="48" height="42" fill="none" stroke="#000" stroke-width="4"/><line x1="8" y1="24" x2="56" y2="24" stroke="#000" stroke-width="4"/><line x1="20" y1="8" x2="20" y2="20" stroke="#000" stroke-width="4" stroke-linecap="round"/><line x1="44" y1="8" x2="44" y2="20" stroke="#000" stroke-width="4" stroke-linecap="round"/></svg>',
  todos:    '<svg viewBox="0 0 64 64"><rect x="12" y="14" width="14" height="14" fill="none" stroke="#000" stroke-width="4"/><line x1="32" y1="21" x2="56" y2="21" stroke="#000" stroke-width="4" stroke-linecap="round"/><rect x="12" y="38" width="14" height="14" fill="#000"/><polyline points="16,44 20,48 24,40" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><line x1="32" y1="45" x2="56" y2="45" stroke="#000" stroke-width="4" stroke-linecap="round"/></svg>',
  stocks:   '<svg viewBox="0 0 64 64"><polyline points="6,46 20,32 30,38 44,18 58,24" fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><line x1="6" y1="56" x2="58" y2="56" stroke="#000" stroke-width="4"/></svg>',
  photo:    '<svg viewBox="0 0 64 64"><rect x="6" y="10" width="52" height="44" fill="none" stroke="#000" stroke-width="4"/><circle cx="22" cy="24" r="4" fill="#000"/><polyline points="10,46 22,34 32,42 46,28 56,38" fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round"/></svg>',
  news:     '<svg viewBox="0 0 64 64"><rect x="8" y="10" width="48" height="44" fill="none" stroke="#000" stroke-width="4"/><line x1="14" y1="22" x2="50" y2="22" stroke="#000" stroke-width="4"/><line x1="14" y1="32" x2="40" y2="32" stroke="#000" stroke-width="4"/><line x1="14" y1="40" x2="50" y2="40" stroke="#000" stroke-width="4"/><line x1="14" y1="48" x2="34" y2="48" stroke="#000" stroke-width="4"/></svg>',
  aqi:      '<svg viewBox="0 0 64 64"><path d="M 32 8 Q 14 22 14 38 Q 14 52 32 52 Q 50 52 50 38 Q 50 22 32 8 Z" fill="none" stroke="#000" stroke-width="4"/><path d="M 32 28 Q 28 36 32 44" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round"/></svg>',
  moonsun:  '<svg viewBox="0 0 64 64"><circle cx="22" cy="32" r="14" fill="#000"/><circle cx="28" cy="28" r="10" fill="#fff"/><path d="M 44 22 L 58 22 M 51 14 L 51 30" stroke="#000" stroke-width="4" stroke-linecap="round"/></svg>',
  wifi:     '<svg viewBox="0 0 64 64"><rect x="14" y="14" width="36" height="36" fill="none" stroke="#000" stroke-width="4"/><rect x="22" y="22" width="6" height="6" fill="#000"/><rect x="36" y="22" width="6" height="6" fill="#000"/><rect x="22" y="36" width="6" height="6" fill="#000"/><rect x="36" y="36" width="6" height="6" fill="#000"/></svg>',
  quote:    '<svg viewBox="0 0 64 64"><path d="M 12 24 Q 12 14 22 14 L 22 24 L 18 24 Q 18 32 22 32 L 22 38 Q 12 38 12 28 Z" fill="#000"/><path d="M 36 24 Q 36 14 46 14 L 46 24 L 42 24 Q 42 32 46 32 L 46 38 Q 36 38 36 28 Z" fill="#000"/></svg>',
  countdown:'<svg viewBox="0 0 64 64"><path d="M 18 8 L 46 8 L 46 18 Q 46 24 38 28 Q 38 32 38 36 Q 46 40 46 46 L 46 56 L 18 56 L 18 46 Q 18 40 26 36 Q 26 32 26 28 Q 18 24 18 18 Z" fill="none" stroke="#000" stroke-width="4"/><path d="M 24 18 L 40 18 L 32 28 Z" fill="#000"/></svg>',
  github:   '<svg viewBox="0 0 64 64"><rect x="6" y="20" width="10" height="10" fill="#000"/><rect x="20" y="20" width="10" height="10" fill="#fff" stroke="#000" stroke-width="4"/><rect x="34" y="20" width="10" height="10" fill="#000"/><rect x="48" y="20" width="10" height="10" fill="#fff" stroke="#000" stroke-width="4"/><rect x="6" y="34" width="10" height="10" fill="#fff" stroke="#000" stroke-width="4"/><rect x="20" y="34" width="10" height="10" fill="#000"/><rect x="34" y="34" width="10" height="10" fill="#000"/><rect x="48" y="34" width="10" height="10" fill="#fff" stroke="#000" stroke-width="4"/></svg>'
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

const ICONS = {
  Clear: `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="22" fill="#000"/>
    ${Array.from({length:8}, (_,i)=>{
      const a = i*Math.PI/4;
      const x1 = 50 + 30*Math.cos(a), y1 = 50 + 30*Math.sin(a);
      const x2 = 50 + 42*Math.cos(a), y2 = 50 + 42*Math.sin(a);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="5" stroke-linecap="round"/>`;
    }).join('')}</svg>`,
  Clouds: `<svg viewBox="0 0 100 100">
    <path d="M 25 65 Q 15 65 15 55 Q 15 45 25 45 Q 25 30 40 30 Q 55 30 58 45 Q 75 45 75 60 Q 75 70 65 70 L 25 70 Z"
      fill="#000"/></svg>`,
  Rain: `<svg viewBox="0 0 100 100">
    <path d="M 25 50 Q 15 50 15 40 Q 15 30 25 30 Q 25 18 40 18 Q 55 18 58 30 Q 75 30 75 45 Q 75 55 65 55 L 25 55 Z" fill="#000"/>
    <line x1="30" y1="65" x2="26" y2="80" stroke="#000" stroke-width="4" stroke-linecap="round"/>
    <line x1="50" y1="65" x2="46" y2="80" stroke="#000" stroke-width="4" stroke-linecap="round"/>
    <line x1="70" y1="65" x2="66" y2="80" stroke="#000" stroke-width="4" stroke-linecap="round"/>
  </svg>`,
  Thunderstorm: `<svg viewBox="0 0 100 100">
    <path d="M 25 45 Q 15 45 15 35 Q 15 25 25 25 Q 25 12 40 12 Q 55 12 58 25 Q 75 25 75 40 Q 75 50 65 50 L 25 50 Z" fill="#000"/>
    <polygon points="48,55 38,75 48,75 42,90 60,68 50,68 56,55" fill="#000"/>
  </svg>`,
  Snow: `<svg viewBox="0 0 100 100">
    <path d="M 25 45 Q 15 45 15 35 Q 15 25 25 25 Q 25 12 40 12 Q 55 12 58 25 Q 75 25 75 40 Q 75 50 65 50 L 25 50 Z" fill="#000"/>
    ${[30,50,70].map(x => `
      <g stroke="#000" stroke-width="3" stroke-linecap="round">
        <line x1="${x-6}" y1="70" x2="${x+6}" y2="70"/>
        <line x1="${x}" y1="64" x2="${x}" y2="76"/>
        <line x1="${x-4}" y1="66" x2="${x+4}" y2="74"/>
        <line x1="${x-4}" y1="74" x2="${x+4}" y2="66"/>
      </g>
    `).join('')}
  </svg>`,
  Mist: `<svg viewBox="0 0 100 100">
    ${[30,45,60,75].map((y,i) => `
      <line x1="${15 + (i%2)*5}" y1="${y}" x2="${85 - (i%2)*5}" y2="${y}"
        stroke="#000" stroke-width="5" stroke-linecap="round"/>
    `).join('')}
  </svg>`
};
ICONS.Drizzle = ICONS.Rain;
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
  todos: ({ cfg, cellW, cellH, density }) => {
    const all = ((cfg && cfg.todos) || []);
    if (!all.length) {
      return `
        <div class="widget widget-todos">
          <div class="widget-title">TODO</div>
          <ul class="todo-list"><li><span class="checkbox"></span><span class="todo-text">No items</span></li></ul>
        </div>
      `;
    }
    const today = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    })();
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { items: 2,  showDue: false, showRecur: false, showFooter: false },
      compact:  { items: 4,  showDue: false, showRecur: true,  showFooter: false },
      standard: { items: 8,  showDue: true,  showRecur: true,  showFooter: true  },
      extended: { items: 14, showDue: true,  showRecur: true,  showFooter: true  },
      full:     { items: 30, showDue: true,  showRecur: true,  showFooter: true  }
    };
    const t = matrix[tier];
    const list = all.slice(0, t.items);
    const totalOpen = all.filter(x => !x.done).length;
    const totalDone = all.length - totalOpen;
    return `
      <div class="widget widget-todos">
        <div class="widget-title">TODO${t.showFooter ? ` · ${totalOpen} LEFT` : ''}</div>
        <ul class="todo-list">
          ${list.map(it => {
            const overdue = it.dueDate && !it.done && it.dueDate < today;
            const due = t.showDue && it.dueDate && !it.done
              ? `<span class="todo-due ${overdue ? 'overdue' : ''}">${it.dueDate === today ? 'TODAY' : (overdue ? 'LATE' : it.dueDate.slice(5))}</span>`
              : '';
            const recur = t.showRecur && it.recurring === 'daily' ? '<span class="todo-recur">↻</span>' : '';
            return `
              <li class="${it.done ? 'done' : ''}">
                <span class="checkbox">${it.done ? '✓' : ''}</span>
                <span class="todo-text">${escapeHtml(it.text)}</span>
                ${recur}
                ${due}
              </li>
            `;
          }).join('')}
        </ul>
        ${t.showFooter && all.length > t.items
          ? `<div class="todo-footer">+ ${all.length - t.items} more · ${totalDone}/${all.length} done</div>`
          : ''}
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
  spacer: ({ cfg }) => {
    const s = (cfg && cfg.spacer) || {};
    const text = (s.text || '').trim();
    const cls = s.invert ? ' invert' : '';
    return `<div class="widget widget-spacer${cls}">${text ? escapeHtml(text) : ''}</div>`;
  },
  quote: ({ cfg, resolvedQuote, cellW, cellH, density }) => {
    const q = resolvedQuote || (cfg && cfg.quote) || {};
    const body = (q.text || '').trim() || 'Type a quote in settings.';
    const attr = (q.attribution || '').trim();
    const align = (q.align === 'left' || q.align === 'right') ? q.align : 'center';
    const tier = pickTier(cellW, cellH, density);
    const padding = tier === 'tiny' ? 4 : tier === 'compact' ? 8 : tier === 'standard' ? 12 : tier === 'extended' ? 16 : 24;
    const showAttr = attr && tier !== 'tiny' && tier !== 'compact';
    return `
      <div class="widget widget-quote" style="text-align:${align};padding:${padding}px">
        <div class="quote-body autofit multiline" data-min-font="12">${md(escapeHtml(body))}</div>
        ${showAttr ? `<div class="quote-attr">— ${escapeHtml(attr)}</div>` : ''}
      </div>
    `;
  },
  clock: ({ cfg, clockNow, cellW, cellH, density }) => {
    const c = (cfg && cfg.clock) || {};
    const tnow = clockNow || { hour: 12, minute: 0, dateLabel: 'PREVIEW' };
    let h = tnow.hour;
    const fmt = c.format === 24 ? 24 : 12;
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (fmt === 12) { h = h % 12; if (h === 0) h = 12; }
    const hh = fmt === 24 ? String(h).padStart(2, '0') : String(h);
    const mm = String(tnow.minute).padStart(2, '0');
    const suffix = fmt === 12 ? ` ${ampm}` : '';
    const tier = pickTier(cellW, cellH, density);
    const showAmpm = tier !== 'tiny';
    const showDate = c.showDate !== false && tier !== 'tiny' && tier !== 'compact';
    const ampmHtml = showAmpm && fmt === 12 ? `<span class="clock-ampm">${suffix}</span>` : '';
    return `
      <div class="widget widget-clock">
        <div class="clock-time autofit" data-min-font="28">${hh}:${mm}${ampmHtml}</div>
        ${showDate ? `<div class="clock-date">${escapeHtml(tnow.dateLabel)}</div>` : ''}
      </div>
    `;
  },
  wifi_qr: ({ cfg, wifiQrSvg, cellW, cellH, density }) => {
    const w = (cfg && cfg.wifi) || {};
    if (!w.ssid) return placeholder('WIFI QR', 'Enter WiFi SSID + password in settings', 'wifi');
    const qr = wifiQrSvg || '<div class="wifi-qr-placeholder">QR</div>';
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { showSSID: false, showHint: false, ssidSize: 14 },
      compact:  { showSSID: true,  showHint: false, ssidSize: 16 },
      standard: { showSSID: true,  showHint: true,  ssidSize: 18 },
      extended: { showSSID: true,  showHint: true,  ssidSize: 22 },
      full:     { showSSID: true,  showHint: true,  ssidSize: 26 }
    };
    const t = matrix[tier];
    const showMeta = t.showSSID || t.showHint;
    return `
      <div class="widget widget-wifi" style="${showMeta ? '' : 'justify-content:center'}">
        <div class="wifi-qr">${qr}</div>
        ${showMeta ? `
          <div class="wifi-meta">
            ${t.showSSID ? `<div class="wifi-ssid" style="font-size:${t.ssidSize}px">${escapeHtml(w.ssid)}</div>` : ''}
            ${t.showHint ? `<div class="wifi-hint">SCAN TO CONNECT</div>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  },
  countdown: ({ countdowns, cellW, cellH, density }) => {
    const list = countdowns || [];
    if (!list.length) return placeholder('COUNTDOWN', 'Add a label + date in settings', 'countdown');
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { rows: 1, numSize: 28, showLabel: false },
      compact:  { rows: 2, numSize: 36, showLabel: true  },
      standard: { rows: 3, numSize: 44, showLabel: true  },
      extended: { rows: 4, numSize: 52, showLabel: true  },
      full:     { rows: 5, numSize: 64, showLabel: true  }
    };
    const t = matrix[tier];
    return `
      <div class="widget widget-countdown">
        ${list.slice(0, t.rows).map(c => `
          <div class="cd-row">
            <div class="cd-num" style="font-size:${t.numSize}px">${c.days}</div>
            <div class="cd-meta">
              <div class="cd-unit">${c.unit}</div>
              ${t.showLabel ? `<div class="cd-label">${escapeHtml(c.label)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },
  aqi: ({ aqi, cfg, cellW, cellH, density }) => {
    if (!aqi) {
      if (!cfg || !Number.isFinite(cfg.lat) || !Number.isFinite(cfg.lon)) {
        return placeholder('AIR QUALITY', 'Set your location in settings', 'aqi');
      }
      return placeholder('AIR QUALITY', 'Data unavailable for this location', 'aqi');
    }
    const advice = {
      'GOOD': 'Breathe easy.',
      'MODERATE': 'OK for most. Sensitive groups: caution.',
      'UNHEALTHY FOR SENSITIVE': 'Sensitive groups limit outdoor.',
      'UNHEALTHY': 'Limit outdoor activity.',
      'VERY UNHEALTHY': 'Avoid outdoor activity.',
      'HAZARDOUS': 'Stay indoors.'
    };
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { showCat: false, showStats: false, showAdvice: false },
      compact:  { showCat: true,  showStats: false, showAdvice: false },
      standard: { showCat: true,  showStats: false, showAdvice: true  },
      extended: { showCat: true,  showStats: true,  showAdvice: true  },
      full:     { showCat: true,  showStats: true,  showAdvice: true  }
    };
    const t = matrix[tier];
    return `
      <div class="widget widget-aqi">
        <div class="widget-title">AIR QUALITY</div>
        <div class="aqi-num autofit" data-min-font="28">${aqi.aqi}</div>
        ${t.showCat ? `<div class="aqi-cat">${aqi.category}</div>` : ''}
        ${t.showAdvice ? `<div class="aqi-advice">${advice[aqi.category] || ''}</div>` : ''}
        ${t.showStats ? `
          <div class="aqi-stats">
            <div class="stat"><span class="stat-k">PM2.5</span><span class="stat-v">${aqi.pm25 ?? '--'}</span></div>
            <div class="stat"><span class="stat-k">PM10</span><span class="stat-v">${aqi.pm10 ?? '--'}</span></div>
            <div class="stat"><span class="stat-k">O₃</span><span class="stat-v">${aqi.o3 ?? '--'}</span></div>
          </div>
        ` : ''}
      </div>
    `;
  },
  moonsun: ({ moonsun, cfg, cellW, cellH, density }) => {
    if (!moonsun) {
      if (!cfg || !Number.isFinite(cfg.lat) || !Number.isFinite(cfg.lon)) {
        return placeholder('MOON & SUN', 'Set your location in settings', 'moonsun');
      }
      return placeholder('MOON & SUN', 'Data unavailable', 'moonsun');
    }
    function parseClock(s) {
      if (!s || s === '--:--') return null;
      const m = String(s).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (!m) return null;
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const ap = (m[3] || '').toUpperCase();
      if (ap === 'PM' && h !== 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      return h * 60 + min;
    }
    const srM = parseClock(moonsun.sunrise);
    const ssM = parseClock(moonsun.sunset);
    let daylight = '';
    if (srM != null && ssM != null) {
      let mins = ssM - srM;
      if (mins < 0) mins += 24 * 60;
      daylight = `${Math.floor(mins / 60)}h ${mins % 60}m daylight`;
    }
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { showDisc: false, showSunRow: false, showDaylight: false },
      compact:  { showDisc: true,  showSunRow: false, showDaylight: false },
      standard: { showDisc: true,  showSunRow: true,  showDaylight: false },
      extended: { showDisc: true,  showSunRow: true,  showDaylight: true  },
      full:     { showDisc: true,  showSunRow: true,  showDaylight: true  }
    };
    const t = matrix[tier];
    return `
      <div class="widget widget-moonsun">
        <div class="widget-title">SKY</div>
        <div class="moon-row">
          ${t.showDisc ? `<div class="moon-disc">${moonsun.moonSvg}</div>` : ''}
          <div class="moon-meta">
            <div class="moon-phase">${moonsun.phase}</div>
            <div class="moon-illum">${moonsun.illuminationPct}% lit</div>
          </div>
        </div>
        ${t.showSunRow ? `<div class="sun-row">
          <span>↑ ${moonsun.sunrise}</span>
          <span>↓ ${moonsun.sunset}</span>
        </div>` : ''}
        ${t.showDaylight && daylight ? `<div class="moon-daylight">${daylight}</div>` : ''}
      </div>
    `;
  },
  news: ({ news, cfg, cellW, cellH, density }) => {
    if (!cfg || !cfg.news || !cfg.news.feedUrl) {
      return placeholder('NEWS HEADLINES', 'Paste an RSS or Atom feed URL in settings', 'news');
    }
    const list = news || [];
    if (!list.length) return placeholder('NEWS HEADLINES', 'Feed returned no items', 'news');
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { items: 1, showSource: false, titleClamp: 2 },
      compact:  { items: 2, showSource: false, titleClamp: 2 },
      standard: { items: 3, showSource: true,  titleClamp: 3 },
      extended: { items: 4, showSource: true,  titleClamp: 3 },
      full:     { items: 6, showSource: true,  titleClamp: 4 }
    };
    const t = matrix[tier];
    return `
      <div class="widget widget-news">
        <div class="widget-title">HEADLINES</div>
        <ul class="news-list">
          ${list.slice(0, t.items).map(n => `
            <li>
              <div class="news-title" style="-webkit-line-clamp:${t.titleClamp}">${escapeHtml(n.title)}</div>
              ${t.showSource && n.source ? `<div class="news-source">${escapeHtml(n.source)}</div>` : ''}
            </li>
          `).join('')}
        </ul>
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
  photo: ({ cfg, resolvedPhoto, cellW, cellH, density }) => {
    const p = (cfg && cfg.photo) || {};
    const slides = Array.isArray(p.slides) && p.slides.length
      ? p.slides
      : (p.dataUrl ? [{ dataUrl: p.dataUrl }] : []);
    const r = resolvedPhoto || (slides.length
      ? { dataUrl: slides[0].dataUrl, caption: slides[0].caption || '', fit: p.fit, index: 0, total: slides.length }
      : null);
    if (!r || !r.dataUrl) return placeholder('PHOTO', 'Upload an image in settings', 'photo');
    const fit = r.fit === 'cover' ? 'cover' : 'contain';
    const tier = pickTier(cellW, cellH, density);
    const showCaption = r.caption && tier !== 'tiny';
    const showCounter = r.total > 1 && (tier === 'extended' || tier === 'full');
    return `
      <div class="widget widget-photo">
        <img src="${escapeHtml(r.dataUrl)}" style="object-fit:${fit}" alt="" />
        ${showCaption ? `<div class="photo-caption">${escapeHtml(r.caption)}</div>` : ''}
        ${showCounter ? `<div class="photo-counter">${r.index + 1}/${r.total}</div>` : ''}
      </div>
    `;
  },
  github: ({ github, cfg, cellW, cellH, density }) => {
    if (!cfg || !cfg.github || !cfg.github.user) {
      return placeholder('GITHUB', 'Enter a GitHub username in settings', 'github');
    }
    if (!github || !github.weeks || !github.weeks.length) {
      return placeholder('GITHUB', 'Data unavailable for ' + escapeHtml(cfg.github.user), 'github');
    }
    const flat = [];
    for (const wk of github.weeks) for (const lvl of wk) flat.push(lvl);
    let curStreak = 0, longest = 0, run = 0;
    for (let i = flat.length - 1; i >= 0; i--) {
      if (flat[i] > 0) curStreak += 1; else break;
    }
    for (const lvl of flat) {
      if (lvl > 0) { run += 1; longest = Math.max(longest, run); } else run = 0;
    }
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { showTitle: false, weeksTail: 12, footer: '' },
      compact:  { showTitle: true,  weeksTail: 26, footer: '' },
      standard: { showTitle: true,  weeksTail: 53, footer: `STREAK ${curStreak}D` },
      extended: { showTitle: true,  weeksTail: 53, footer: `STREAK ${curStreak}D · LONGEST ${longest}D` },
      full:     { showTitle: true,  weeksTail: 53, footer: `STREAK ${curStreak}D · LONGEST ${longest}D · ${github.total} TOTAL` }
    };
    const t = matrix[tier];
    const weeks = github.weeks.slice(-t.weeksTail);
    const titleText = tier === 'compact'
      ? `${escapeHtml(github.user)} · ${github.total}`
      : `GITHUB · ${escapeHtml(github.user)} · ${github.total} CONTRIBUTIONS`;
    return `
      <div class="widget widget-github">
        ${t.showTitle ? `<div class="widget-title">${titleText}</div>` : ''}
        <div class="gh-grid">
          ${weeks.map(week => `
            <div class="gh-col">
              ${week.map(d => `<div class="gh-cell" data-l="${d}"></div>`).join('')}
            </div>
          `).join('')}
        </div>
        ${t.footer ? `<div class="gh-footer">${t.footer}</div>` : ''}
      </div>
    `;
  },
  counter: ({ counters, cellW, cellH, density }) => {
    const list = counters || [];
    if (!list.length) return placeholder('COUNTER', 'Add a label + start date in settings', 'countdown');
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { rows: 1, numSize: 28, showLabel: false },
      compact:  { rows: 2, numSize: 36, showLabel: true  },
      standard: { rows: 3, numSize: 44, showLabel: true  },
      extended: { rows: 4, numSize: 52, showLabel: true  },
      full:     { rows: 5, numSize: 64, showLabel: true  }
    };
    const t = matrix[tier];
    return `
      <div class="widget widget-countdown">
        ${list.slice(0, t.rows).map(c => `
          <div class="cd-row">
            <div class="cd-num" style="font-size:${t.numSize}px">${c.count}</div>
            <div class="cd-meta">
              <div class="cd-unit">${c.unit}</div>
              ${t.showLabel ? `<div class="cd-label">${escapeHtml(c.label)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },
  link_qr: ({ cfg, linkQrSvg, cellW, cellH, density }) => {
    const lq = (cfg && cfg.linkQr) || {};
    if (!lq.url) return placeholder('LINK QR', 'Set a URL in settings', 'wifi');
    if (!linkQrSvg) return placeholder('LINK QR', 'QR generator not available', 'wifi');
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { showLabel: false, showHint: false, labelSize: 14 },
      compact:  { showLabel: true,  showHint: false, labelSize: 16 },
      standard: { showLabel: true,  showHint: true,  labelSize: 18 },
      extended: { showLabel: true,  showHint: true,  labelSize: 22 },
      full:     { showLabel: true,  showHint: true,  labelSize: 26 }
    };
    const t = matrix[tier];
    const showMeta = t.showLabel || t.showHint;
    const label = (lq.label || '').trim() || 'SCAN';
    return `
      <div class="widget widget-wifi" style="${showMeta ? '' : 'justify-content:center'}">
        <div class="wifi-qr">${linkQrSvg}</div>
        ${showMeta ? `
          <div class="wifi-meta">
            ${t.showLabel ? `<div class="wifi-ssid" style="font-size:${t.labelSize}px">${escapeHtml(label)}</div>` : ''}
            ${t.showHint ? `<div class="wifi-hint">SCAN TO OPEN</div>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  },
  fx: ({ fx, cfg, cellW, cellH, density }) => {
    const pairs = (cfg && cfg.fx && cfg.fx.pairs) || [];
    if (!pairs.length) return placeholder('FX', 'Add pairs like USD/EUR in settings', 'stocks');
    const list = fx || [];
    if (!list.length) return placeholder('FX', 'Data unavailable — check pairs', 'stocks');
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { rows: 2, showDate: false },
      compact:  { rows: 3, showDate: false },
      standard: { rows: 5, showDate: true  },
      extended: { rows: 8, showDate: true  },
      full:     { rows: 12, showDate: true }
    };
    const t = matrix[tier];
    const slice = list.slice(0, t.rows);
    const date = slice.find(r => r.date) ? slice.find(r => r.date).date : '';
    return `
      <div class="widget widget-stocks">
        <div class="widget-title">FX${t.showDate && date ? ` · ${date}` : ''}</div>
        ${slice.map(r => `
          <div class="stock-watch-row">
            <span class="watch-sym">${escapeHtml(r.pair)}</span>
            <span></span>
            <span class="watch-price">${r.rateLabel}</span>
            <span></span>
          </div>
        `).join('')}
      </div>
    `;
  },
  iss: ({ iss, cellW, cellH, density }) => {
    if (!iss) return placeholder('ISS', 'Data unavailable', 'moonsun');
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { showStats: false, placeSize: 22 },
      compact:  { showStats: false, placeSize: 26 },
      standard: { showStats: true,  placeSize: 30 },
      extended: { showStats: true,  placeSize: 36 },
      full:     { showStats: true,  placeSize: 44 }
    };
    const t = matrix[tier];
    const latLabel = (iss.lat != null && iss.lon != null)
      ? `${iss.lat.toFixed(1)}°, ${iss.lon.toFixed(1)}°`
      : '—';
    return `
      <div class="widget widget-iss">
        <div class="widget-title">ISS · OVERHEAD</div>
        <div class="iss-place autofit" data-min-font="18" style="font-size:${t.placeSize}px">${escapeHtml(iss.place || '—')}</div>
        <div class="iss-coord">${latLabel}</div>
        ${t.showStats ? `
          <div class="weather-stats">
            <div class="stat"><span class="stat-k">ALT</span><span class="stat-v">${iss.altKm != null ? iss.altKm + ' km' : '—'}</span></div>
            <div class="stat"><span class="stat-k">VEL</span><span class="stat-v">${iss.velKmh != null ? iss.velKmh + ' km/h' : '—'}</span></div>
          </div>
        ` : ''}
      </div>
    `;
  },
  habit: ({ habits, cellW, cellH, density }) => {
    const list = habits || [];
    if (!list.length) return placeholder('HABITS', 'Add habits in settings', 'todos');
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { rows: 2, daysShown: 7,  showStreak: false },
      compact:  { rows: 3, daysShown: 7,  showStreak: false },
      standard: { rows: 4, daysShown: 14, showStreak: true  },
      extended: { rows: 6, daysShown: 14, showStreak: true  },
      full:     { rows: 8, daysShown: 14, showStreak: true  }
    };
    const t = matrix[tier];
    return `
      <div class="widget widget-habit">
        <div class="widget-title">HABITS</div>
        ${list.slice(0, t.rows).map(h => {
          const days = (h.days || []).slice(-t.daysShown);
          return `
            <div class="habit-row">
              <div class="habit-label">${escapeHtml(h.label || '—')}</div>
              <div class="habit-cells">
                ${days.map(d => `<span class="habit-cell ${d.done ? 'done' : ''}"></span>`).join('')}
              </div>
              ${t.showStreak ? `<div class="habit-streak">${h.currentStreak}D</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  },
  wod: ({ wod, cellW, cellH, density }) => {
    if (!wod || !wod.word) return placeholder('WORD', 'Data unavailable', 'quote');
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { wordSize: 28, showPos: false, showDef: false },
      compact:  { wordSize: 36, showPos: true,  showDef: false },
      standard: { wordSize: 48, showPos: true,  showDef: true  },
      extended: { wordSize: 60, showPos: true,  showDef: true  },
      full:     { wordSize: 80, showPos: true,  showDef: true  }
    };
    const t = matrix[tier];
    return `
      <div class="widget widget-wod">
        <div class="widget-title">WORD OF THE DAY</div>
        <div class="wod-word" style="font-size:${t.wordSize}px">${escapeHtml(wod.word)}</div>
        ${t.showPos && wod.partOfSpeech ? `<div class="wod-pos">${escapeHtml(wod.partOfSpeech)}</div>` : ''}
        ${t.showDef && wod.definition ? `<div class="wod-def">${escapeHtml(wod.definition)}</div>` : ''}
      </div>
    `;
  },
  sports: ({ sports, cfg, cellW, cellH, density }) => {
    if (!cfg || !cfg.sports || !cfg.sports.teamId) return placeholder('SPORTS', 'Enter a TheSportsDB team ID', 'stocks');
    if (!sports || (!sports.last && !sports.next)) return placeholder('SPORTS', 'Data unavailable', 'stocks');
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { showLast: true,  showNext: false, showLeague: false },
      compact:  { showLast: true,  showNext: true,  showLeague: false },
      standard: { showLast: true,  showNext: true,  showLeague: true  },
      extended: { showLast: true,  showNext: true,  showLeague: true  },
      full:     { showLast: true,  showNext: true,  showLeague: true  }
    };
    const t = matrix[tier];
    const lastBlock = (g) => g ? `
      <div class="sports-block">
        <div class="sports-tag">LAST</div>
        <div class="sports-teams">${escapeHtml(g.home)} <span class="sports-vs">vs</span> ${escapeHtml(g.away)}</div>
        <div class="sports-score">${g.homeScore ?? '—'} – ${g.awayScore ?? '—'}</div>
      </div>` : '';
    const nextBlock = (g) => g ? `
      <div class="sports-block">
        <div class="sports-tag">NEXT</div>
        <div class="sports-teams">${escapeHtml(g.home)} <span class="sports-vs">vs</span> ${escapeHtml(g.away)}</div>
        <div class="sports-when">${escapeHtml(g.dateLocal || '')} ${escapeHtml(g.timeLocal || '')}</div>
      </div>` : '';
    return `
      <div class="widget widget-sports">
        <div class="widget-title">${escapeHtml(sports.teamName || 'SPORTS')}${t.showLeague && sports.league ? ` · ${escapeHtml(sports.league)}` : ''}</div>
        ${t.showLast ? lastBlock(sports.last) : ''}
        ${t.showNext ? nextBlock(sports.next) : ''}
      </div>
    `;
  },
  chore: ({ chores, cellW, cellH, density }) => {
    const list = chores || [];
    if (!list.length) return placeholder('CHORES', 'Add a chore + weekday in settings', 'todos');
    const tier = pickTier(cellW, cellH, density);
    const matrix = {
      tiny:     { rows: 1, showTime: false },
      compact:  { rows: 2, showTime: false },
      standard: { rows: 3, showTime: true  },
      extended: { rows: 4, showTime: true  },
      full:     { rows: 6, showTime: true  }
    };
    const t = matrix[tier];
    return `
      <div class="widget widget-chore">
        <div class="widget-title">CHORES</div>
        ${list.slice(0, t.rows).map(c => `
          <div class="chore-row">
            <span class="chore-when">${escapeHtml(c.dueLabel)}</span>
            <span class="chore-label">${escapeHtml(c.label)}</span>
            ${t.showTime && c.time ? `<span class="chore-time">${escapeHtml(c.time)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }
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
  return {
    '{city}': (cfg.cityLabel || cfg.city || '').toString(),
    '{time}': timeStr,
    '{date}': dateStr,
    '{refresh}': String(cfg.refreshMinutes || 30),
    '{edition}': String(Math.floor(Date.now() / 3600000) % 9999)
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
  return `<span class="ftr-bullet">●</span> ${escapeHtml(tplString(f.text, tokens))}`;
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

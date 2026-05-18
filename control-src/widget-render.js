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

// Setup-needed placeholder. Matches dashboard.html so what you see in the
// editor previews matches what'll actually render on the device.
function placeholder(title, hint) {
  return `
    <div class="widget widget-placeholder">
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
  weather_hero: ({ weather, units, cellW, cellH }) => {
    const w = weather || fakeWeather(units);
    const tier = pickTier(cellW, cellH);
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
        <div class="stat"><span class="stat-k">WIND</span><span class="stat-v">${w.windDir} ${w.windSpeed} ${w.windUnit || ''}</span></div>
        <div class="stat"><span class="stat-k">RISE</span><span class="stat-v">${w.sunrise}</span></div>
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
  weather_forecast: ({ weather, cellW, cellH }) => {
    const w = weather;
    if (!w || !w.forecast || !w.forecast.length) {
      return `<div class="col-title">FORECAST</div><div class="empty" style="border:0;padding:14px 0">NO DATA</div>`;
    }
    const tier = pickTier(cellW, cellH);
    const matrix = {
      tiny:     { days: 1, iconPx: 30, showPrecip: false },
      compact:  { days: 2, iconPx: 30, showPrecip: false },
      standard: { days: 3, iconPx: 34, showPrecip: true  },
      extended: { days: 4, iconPx: 36, showPrecip: true  },
      full:     { days: 5, iconPx: 38, showPrecip: true  }
    };
    const t = matrix[tier];
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
  message: ({ cfg, resolvedMessage, cellH }) => {
    const m = resolvedMessage || (cfg && cfg.message) || {};
    const text = m.text || 'Custom message';
    const sub  = m.subtitle || '';
    const ch = cellH || 0;
    const showSub = ch >= 3;
    const txtSize = ch < 3 ? 14 : ch < 5 ? 18 : ch < 8 ? 22 : 28;
    return `
      <div class="widget widget-msg">
        <div class="msg-text" style="font-size:${txtSize}px">${md(escapeHtml(text))}</div>
        ${showSub && sub ? `<div class="msg-sub">${md(escapeHtml(sub))}</div>` : ''}
      </div>
    `;
  },
  todos: ({ cfg, cellW, cellH }) => {
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
    const tier = pickTier(cellW, cellH);
    const matrix = {
      tiny:     { items: 2,  showDue: false, showRecur: false, showFooter: false },
      compact:  { items: 3,  showDue: false, showRecur: true,  showFooter: false },
      standard: { items: 5,  showDue: true,  showRecur: true,  showFooter: true  },
      extended: { items: 7,  showDue: true,  showRecur: true,  showFooter: true  },
      full:     { items: 10, showDue: true,  showRecur: true,  showFooter: true  }
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
  calendar: ({ events, cellW, cellH }) => {
    const all = (events || []);
    if (!all.length) {
      return `<div class="widget widget-cal"><div class="widget-title">UPCOMING</div><div class="cal-row"><div class="cal-info"><div class="cal-title">No events</div></div></div></div>`;
    }
    const tier = pickTier(cellW, cellH);
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
  quote: ({ cfg, resolvedQuote, cellW, cellH }) => {
    const q = resolvedQuote || (cfg && cfg.quote) || {};
    const body = (q.text || '').trim() || 'Type a quote in settings.';
    const attr = (q.attribution || '').trim();
    const align = (q.align === 'left' || q.align === 'right') ? q.align : 'center';
    const tier = pickTier(cellW, cellH);
    const matrix = {
      tiny:     { cap: 18, showAttr: false, padding: 4  },
      compact:  { cap: 26, showAttr: false, padding: 8  },
      standard: { cap: 36, showAttr: true,  padding: 12 },
      extended: { cap: 48, showAttr: true,  padding: 16 },
      full:     { cap: 64, showAttr: true,  padding: 24 }
    };
    const t = matrix[tier];
    const lengthBase = Math.max(14, Math.min(64, Math.round(560 / Math.max(8, body.length / 4))));
    const finalSize = Math.min(lengthBase, t.cap);
    return `
      <div class="widget widget-quote" style="text-align:${align};padding:${t.padding}px">
        <div class="quote-body" style="font-size:${finalSize}px">${md(escapeHtml(body))}</div>
        ${t.showAttr && attr ? `<div class="quote-attr">— ${escapeHtml(attr)}</div>` : ''}
      </div>
    `;
  },
  clock: ({ cfg, clockNow, cellW, cellH }) => {
    const c = (cfg && cfg.clock) || {};
    const tnow = clockNow || { hour: 12, minute: 0, dateLabel: 'PREVIEW' };
    let h = tnow.hour;
    const fmt = c.format === 24 ? 24 : 12;
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (fmt === 12) { h = h % 12; if (h === 0) h = 12; }
    const hh = fmt === 24 ? String(h).padStart(2, '0') : String(h);
    const mm = String(tnow.minute).padStart(2, '0');
    const suffix = fmt === 12 ? ` ${ampm}` : '';
    const tier = pickTier(cellW, cellH);
    const matrix = {
      tiny:     { timeSize: 34, showAmpm: false, showDate: false },
      compact:  { timeSize: 48, showAmpm: true,  showDate: false },
      standard: { timeSize: 64, showAmpm: true,  showDate: true  },
      extended: { timeSize: 84, showAmpm: true,  showDate: true  },
      full:     { timeSize: 104,showAmpm: true,  showDate: true  }
    };
    const t = matrix[tier];
    const ampmHtml = t.showAmpm && fmt === 12 ? `<span class="clock-ampm">${suffix}</span>` : '';
    const dateOk = c.showDate !== false && t.showDate;
    return `
      <div class="widget widget-clock">
        <div class="clock-time" style="font-size:${t.timeSize}px">${hh}:${mm}${ampmHtml}</div>
        ${dateOk ? `<div class="clock-date">${escapeHtml(tnow.dateLabel)}</div>` : ''}
      </div>
    `;
  },
  wifi_qr: ({ cfg, wifiQrSvg, cellH, cellW }) => {
    const w = (cfg && cfg.wifi) || {};
    if (!w.ssid) return placeholder('WIFI QR', 'Enter WiFi SSID + password in settings');
    const qr = wifiQrSvg || '<div class="wifi-qr-placeholder">QR</div>';
    const ch = cellH || 0, cw = cellW || 0;
    const showMeta = ch >= 6 && cw >= 8;
    return `
      <div class="widget widget-wifi" style="${showMeta ? '' : 'justify-content:center'}">
        <div class="wifi-qr">${qr}</div>
        ${showMeta ? `
          <div class="wifi-meta">
            <div class="wifi-ssid">${escapeHtml(w.ssid)}</div>
            <div class="wifi-hint">SCAN TO CONNECT</div>
          </div>
        ` : ''}
      </div>
    `;
  },
  countdown: ({ countdowns, cellH }) => {
    const list = countdowns || [];
    if (!list.length) return placeholder('COUNTDOWN', 'Add a label + date in settings');
    const ch = cellH || 0;
    const maxRows = ch < 4 ? 1 : ch < 8 ? 3 : 5;
    const numSize = ch < 4 ? 28 : ch < 6 ? 36 : ch < 9 ? 44 : 56;
    return `
      <div class="widget widget-countdown">
        ${list.slice(0, maxRows).map(c => `
          <div class="cd-row">
            <div class="cd-num" style="font-size:${numSize}px">${c.days}</div>
            <div class="cd-meta">
              <div class="cd-unit">${c.unit}</div>
              <div class="cd-label">${escapeHtml(c.label)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },
  aqi: ({ aqi, cfg, cellW, cellH }) => {
    if (!aqi) {
      if (!cfg || !Number.isFinite(cfg.lat) || !Number.isFinite(cfg.lon)) {
        return placeholder('AIR QUALITY', 'Set your location in settings');
      }
      return placeholder('AIR QUALITY', 'Data unavailable for this location');
    }
    const advice = {
      'GOOD': 'Breathe easy.',
      'MODERATE': 'OK for most. Sensitive groups: caution.',
      'UNHEALTHY FOR SENSITIVE': 'Sensitive groups limit outdoor.',
      'UNHEALTHY': 'Limit outdoor activity.',
      'VERY UNHEALTHY': 'Avoid outdoor activity.',
      'HAZARDOUS': 'Stay indoors.'
    };
    const tier = pickTier(cellW, cellH);
    const matrix = {
      tiny:     { showCat: false, showStats: false, showAdvice: false, numSize: 36 },
      compact:  { showCat: true,  showStats: false, showAdvice: false, numSize: 48 },
      standard: { showCat: true,  showStats: false, showAdvice: true,  numSize: 56 },
      extended: { showCat: true,  showStats: true,  showAdvice: true,  numSize: 64 },
      full:     { showCat: true,  showStats: true,  showAdvice: true,  numSize: 72 }
    };
    const t = matrix[tier];
    return `
      <div class="widget widget-aqi">
        <div class="widget-title">AIR QUALITY</div>
        <div class="aqi-num" style="font-size:${t.numSize}px">${aqi.aqi}</div>
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
  moonsun: ({ moonsun, cfg, cellH }) => {
    if (!moonsun) {
      if (!cfg || !Number.isFinite(cfg.lat) || !Number.isFinite(cfg.lon)) {
        return placeholder('MOON & SUN', 'Set your location in settings');
      }
      return placeholder('MOON & SUN', 'Data unavailable');
    }
    const ch = cellH || 0;
    const showSunRow = ch >= 5;
    return `
      <div class="widget widget-moonsun">
        <div class="widget-title">SKY</div>
        <div class="moon-row">
          <div class="moon-disc">${moonsun.moonSvg}</div>
          <div class="moon-meta">
            <div class="moon-phase">${moonsun.phase}</div>
            <div class="moon-illum">${moonsun.illuminationPct}% lit</div>
          </div>
        </div>
        ${showSunRow ? `<div class="sun-row">
          <span>↑ ${moonsun.sunrise}</span>
          <span>↓ ${moonsun.sunset}</span>
        </div>` : ''}
      </div>
    `;
  },
  news: ({ news, cfg, cellW, cellH }) => {
    if (!cfg || !cfg.news || !cfg.news.feedUrl) {
      return placeholder('NEWS HEADLINES', 'Paste an RSS or Atom feed URL in settings');
    }
    const list = news || [];
    if (!list.length) return placeholder('NEWS HEADLINES', 'Feed returned no items');
    const tier = pickTier(cellW, cellH);
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
  stocks: ({ stocks, cfg, cellW, cellH }) => {
    const syms = (cfg && cfg.stocks && cfg.stocks.symbols) || [];
    if (!syms.length) return placeholder('MARKETS', 'Add symbols (AAPL, BTC-USD) in settings');
    const list = stocks || [];
    if (!list.length) return placeholder('MARKETS', 'Data unavailable — check symbols');
    const tier = pickTier(cellW, cellH);
    const matrix = {
      tiny:     { rows: 2, showChg: false },
      compact:  { rows: 3, showChg: true  },
      standard: { rows: 4, showChg: true  },
      extended: { rows: 6, showChg: true  },
      full:     { rows: 8, showChg: true  }
    };
    const t = matrix[tier];
    return `
      <div class="widget widget-stocks">
        <div class="widget-title">MARKETS</div>
        <div class="stock-rows">
          ${list.slice(0, t.rows).map(s => `
            <div class="stock-row">
              <span class="stock-sym">${escapeHtml(s.symbol)}</span>
              <span class="stock-price">${s.price}</span>
              ${t.showChg ? `<span class="stock-chg ${s.change >= 0 ? 'up' : 'down'}">${s.change >= 0 ? '▲' : '▼'} ${Math.abs(s.changePct).toFixed(2)}%</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },
  photo: ({ cfg }) => {
    const p = (cfg && cfg.photo) || {};
    if (!p.dataUrl) return placeholder('PHOTO', 'Upload an image in settings');
    const fit = p.fit === 'cover' ? 'cover' : 'contain';
    return `<div class="widget widget-photo"><img src="${p.dataUrl}" style="object-fit:${fit}" alt="" /></div>`;
  },
  github: ({ github, cfg, cellW, cellH }) => {
    if (!cfg || !cfg.github || !cfg.github.user) {
      return placeholder('GITHUB', 'Enter a GitHub username in settings');
    }
    if (!github || !github.weeks || !github.weeks.length) {
      return placeholder('GITHUB', 'Data unavailable for ' + escapeHtml(cfg.github.user));
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
    const tier = pickTier(cellW, cellH);
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

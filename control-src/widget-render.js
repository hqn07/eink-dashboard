// Client-side mirror of dashboard.html's widget render functions.
// Both the React editor and the pool render real widget HTML by
// calling these — the result is dropped into the DOM via
// `dangerouslySetInnerHTML` and styled via /static/dashboard.css.

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
        </div>
      `).join('')}
    </div>
  `;
}

const RENDERERS = {
  weather_hero: ({ weather, units, cellW, cellH }) => {
    const w = weather || fakeWeather(units);
    const staleClass = w.stale ? ' weather-stale' : '';
    const staleBadge = w.stale ? '<div class="stale-pill">CACHED</div>' : '';
    const hasRoom = (cellH || 0) >= 6 && (cellW || 0) >= 6;
    const extras = hasRoom ? `${sunBar(w)}${hourlyStrip(w)}` : '';
    return `
      <div class="weather-hero${staleClass}">
        ${staleBadge}
        <div class="weather-icon">${icon(w.main, 110)}</div>
        <div class="weather-temp">
          <span class="temp-num">${w.temp}</span><span class="temp-deg">°${units}</span>
        </div>
        <div class="weather-desc">${w.desc}</div>
        <div class="weather-hilo">HIGH ${w.tempMax}° &nbsp;·&nbsp; LOW ${w.tempMin}°</div>
      </div>
      <div class="weather-stats">
        <div class="stat"><span class="stat-k">FEELS</span><span class="stat-v">${w.feelsLike}°</span></div>
        <div class="stat"><span class="stat-k">HUMID</span><span class="stat-v">${w.humidity}%</span></div>
        <div class="stat"><span class="stat-k">WIND</span><span class="stat-v">${w.windDir} ${w.windSpeed} ${w.windUnit || ''}</span></div>
        <div class="stat"><span class="stat-k">RISE</span><span class="stat-v">${w.sunrise}</span></div>
      </div>
      ${extras}
    `;
  },
  weather_forecast: ({ weather, cellH }) => {
    const w = weather;
    if (!w || !w.forecast || !w.forecast.length) {
      return `<div class="col-title">FORECAST</div><div class="empty" style="border:0;padding:14px 0">NO DATA</div>`;
    }
    const max = (cellH || 0) >= 6 ? 7 : 3;
    const list = w.forecast.slice(0, max);
    return `
      <div class="col-title">${list.length}-DAY OUTLOOK</div>
      ${list.map(f => `
        <div class="fc-row">
          <div class="fc-day">${f.name}</div>
          <div class="fc-icon">${icon(f.main, 38)}</div>
          <div class="fc-hilo">
            <div class="fc-hi">${f.hi}°</div>
            <div class="fc-lo">${f.lo}°</div>
          </div>
          ${Number.isFinite(f.precip) && f.precip > 0
            ? `<div class="fc-precip">${f.precip}%</div>` : '<div class="fc-precip"></div>'}
        </div>
      `).join('')}
    `;
  },
  message: ({ cfg, resolvedMessage }) => {
    const m = resolvedMessage || (cfg && cfg.message) || {};
    const text = m.text || 'Custom message';
    const sub  = m.subtitle || '';
    return `
      <div class="widget widget-msg">
        <div class="msg-text">${md(escapeHtml(text))}</div>
        ${sub ? `<div class="msg-sub">${md(escapeHtml(sub))}</div>` : ''}
      </div>
    `;
  },
  todos: ({ cfg }) => {
    const todos = ((cfg && cfg.todos) || []).slice(0, 8);
    if (!todos.length) {
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
    return `
      <div class="widget widget-todos">
        <div class="widget-title">TODO</div>
        <ul class="todo-list">
          ${todos.map(t => {
            const overdue = t.dueDate && !t.done && t.dueDate < today;
            const due = t.dueDate && !t.done
              ? `<span class="todo-due ${overdue ? 'overdue' : ''}">${t.dueDate === today ? 'TODAY' : (overdue ? 'LATE' : t.dueDate.slice(5))}</span>`
              : '';
            const recur = t.recurring === 'daily' ? '<span class="todo-recur">↻</span>' : '';
            return `
              <li class="${t.done ? 'done' : ''}">
                <span class="checkbox">${t.done ? '✓' : ''}</span>
                <span class="todo-text">${escapeHtml(t.text)}</span>
                ${recur}
                ${due}
              </li>
            `;
          }).join('')}
        </ul>
      </div>
    `;
  },
  calendar: ({ events }) => {
    const list = (events || []).slice(0, 8);
    if (!list.length) {
      return `<div class="widget widget-cal"><div class="widget-title">UPCOMING</div><div class="cal-row"><div class="cal-info"><div class="cal-title">No events</div></div></div></div>`;
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
          ${groups[s].map(ev => `
            <div class="cal-row ${ev.isAllDay ? 'allday' : ''}">
              <div class="cal-day">${escapeHtml(ev.dayLabel || '')}</div>
              <div class="cal-info">
                <div class="cal-title">${escapeHtml(ev.title || '')}</div>
                <div class="cal-time">${escapeHtml(ev.startLabel || '')}</div>
              </div>
            </div>
          `).join('')}
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
  quote: ({ cfg, resolvedQuote }) => {
    const q = resolvedQuote || (cfg && cfg.quote) || {};
    const body = (q.text || '').trim() || 'Type a quote in settings.';
    const attr = (q.attribution || '').trim();
    const align = (q.align === 'left' || q.align === 'right') ? q.align : 'center';
    const baseSize = Math.max(14, Math.min(46, Math.round(420 / Math.max(8, body.length / 4))));
    return `
      <div class="widget widget-quote" style="text-align:${align}">
        <div class="quote-body" style="font-size:${baseSize}px">${md(escapeHtml(body))}</div>
        ${attr ? `<div class="quote-attr">— ${escapeHtml(attr)}</div>` : ''}
      </div>
    `;
  },
  clock: ({ cfg, clockNow }) => {
    const c = (cfg && cfg.clock) || {};
    const t = clockNow || { hour: 12, minute: 0, second: 0, dateLabel: 'PREVIEW' };
    let h = t.hour;
    const fmt = c.format === 24 ? 24 : 12;
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (fmt === 12) { h = h % 12; if (h === 0) h = 12; }
    const hh = fmt === 24 ? String(h).padStart(2, '0') : String(h);
    const mm = String(t.minute).padStart(2, '0');
    const ss = c.showSeconds ? `:${String(t.second).padStart(2,'0')}` : '';
    const suffix = fmt === 12 ? ` ${ampm}` : '';
    return `
      <div class="widget widget-clock">
        <div class="clock-time">${hh}:${mm}${ss}<span class="clock-ampm">${suffix}</span></div>
        ${c.showDate ? `<div class="clock-date">${escapeHtml(t.dateLabel)}</div>` : ''}
      </div>
    `;
  },
  wifi_qr: ({ cfg, wifiQrSvg }) => {
    const w = (cfg && cfg.wifi) || {};
    if (!w.ssid) return placeholder('WIFI QR', 'Enter WiFi SSID + password in settings');
    const qr = wifiQrSvg || '<div class="wifi-qr-placeholder">QR</div>';
    return `
      <div class="widget widget-wifi">
        <div class="wifi-qr">${qr}</div>
        <div class="wifi-meta">
          <div class="wifi-ssid">${escapeHtml(w.ssid)}</div>
          <div class="wifi-hint">SCAN TO CONNECT</div>
        </div>
      </div>
    `;
  },
  countdown: ({ countdowns }) => {
    const list = countdowns || [];
    if (!list.length) return placeholder('COUNTDOWN', 'Add a label + date in settings');
    return `
      <div class="widget widget-countdown">
        ${list.slice(0, 3).map(c => `
          <div class="cd-row">
            <div class="cd-num">${c.days}</div>
            <div class="cd-meta">
              <div class="cd-unit">${c.unit}</div>
              <div class="cd-label">${escapeHtml(c.label)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },
  aqi: ({ aqi, cfg }) => {
    if (!aqi) {
      if (!cfg || !Number.isFinite(cfg.lat) || !Number.isFinite(cfg.lon)) {
        return placeholder('AIR QUALITY', 'Set your location in settings');
      }
      return placeholder('AIR QUALITY', 'Data unavailable for this location');
    }
    return `
      <div class="widget widget-aqi">
        <div class="widget-title">AIR QUALITY</div>
        <div class="aqi-num">${aqi.aqi}</div>
        <div class="aqi-cat">${aqi.category}</div>
        <div class="aqi-stats">
          <div class="stat"><span class="stat-k">PM2.5</span><span class="stat-v">${aqi.pm25 ?? '--'}</span></div>
          <div class="stat"><span class="stat-k">PM10</span><span class="stat-v">${aqi.pm10 ?? '--'}</span></div>
          <div class="stat"><span class="stat-k">O₃</span><span class="stat-v">${aqi.o3 ?? '--'}</span></div>
        </div>
      </div>
    `;
  },
  moonsun: ({ moonsun, cfg }) => {
    if (!moonsun) {
      if (!cfg || !Number.isFinite(cfg.lat) || !Number.isFinite(cfg.lon)) {
        return placeholder('MOON & SUN', 'Set your location in settings');
      }
      return placeholder('MOON & SUN', 'Data unavailable');
    }
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
        <div class="sun-row">
          <span>↑ ${moonsun.sunrise}</span>
          <span>↓ ${moonsun.sunset}</span>
        </div>
      </div>
    `;
  },
  news: ({ news, cfg }) => {
    if (!cfg || !cfg.news || !cfg.news.feedUrl) {
      return placeholder('NEWS HEADLINES', 'Paste an RSS or Atom feed URL in settings');
    }
    const list = news || [];
    if (!list.length) return placeholder('NEWS HEADLINES', 'Feed returned no items');
    return `
      <div class="widget widget-news">
        <div class="widget-title">HEADLINES</div>
        <ul class="news-list">
          ${list.slice(0, 5).map(n => `
            <li>
              <div class="news-title">${escapeHtml(n.title)}</div>
              ${n.source ? `<div class="news-source">${escapeHtml(n.source)}</div>` : ''}
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  },
  stocks: ({ stocks, cfg }) => {
    const syms = (cfg && cfg.stocks && cfg.stocks.symbols) || [];
    if (!syms.length) return placeholder('MARKETS', 'Add symbols (AAPL, BTC-USD) in settings');
    const list = stocks || [];
    if (!list.length) return placeholder('MARKETS', 'Data unavailable — check symbols');
    return `
      <div class="widget widget-stocks">
        <div class="widget-title">MARKETS</div>
        <div class="stock-rows">
          ${list.map(s => `
            <div class="stock-row">
              <span class="stock-sym">${escapeHtml(s.symbol)}</span>
              <span class="stock-price">${s.price}</span>
              <span class="stock-chg ${s.change >= 0 ? 'up' : 'down'}">${s.change >= 0 ? '▲' : '▼'} ${Math.abs(s.changePct).toFixed(2)}%</span>
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
  github: ({ github, cfg }) => {
    if (!cfg || !cfg.github || !cfg.github.user) {
      return placeholder('GITHUB', 'Enter a GitHub username in settings');
    }
    if (!github || !github.weeks || !github.weeks.length) {
      return placeholder('GITHUB', 'Data unavailable for ' + escapeHtml(cfg.github.user));
    }
    return `
      <div class="widget widget-github">
        <div class="widget-title">GITHUB · ${escapeHtml(github.user)} · ${github.total} CONTRIBUTIONS</div>
        <div class="gh-grid">
          ${github.weeks.map(week => `
            <div class="gh-col">
              ${week.map(d => `<div class="gh-cell" data-l="${d}"></div>`).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
};

export function renderWidget(id, data) {
  const fn = RENDERERS[id];
  if (!fn) return '';
  try { return fn(data || {}); } catch { return ''; }
}

// Header/footer chrome the dashboard wraps around the body grid. The
// editor renders these in fixed top/bottom strips so the body area
// exactly matches the dashboard's body grid pixel-for-pixel.
export function renderHeader(data) {
  const cfg = (data && data.cfg) || {};
  const w   = data && data.weather;
  const cityLabel = (cfg.cityLabel || cfg.city || '').toString();
  const dateStr = w ? w.currentDate : new Date().toDateString().toUpperCase();
  const timeStr = w ? w.currentTime : '';
  return `
    <div class="hdr-left">
      <div class="hdr-city">${escapeHtml(cityLabel)}</div>
      <div class="hdr-date">${escapeHtml(dateStr)}</div>
    </div>
    <div class="hdr-right">
      <div class="hdr-time">${escapeHtml(timeStr)}</div>
      <div class="hdr-meta">EDITION No. ${Math.floor(Date.now()/3600000) % 9999}</div>
    </div>
  `;
}

export function renderFooter(data) {
  const cfg = (data && data.cfg) || {};
  const w   = data && data.weather;
  const cityLabel = (cfg.cityLabel || cfg.city || '').toString();
  const timeStr = w ? w.currentTime : '—';
  return `
    <span class="ftr-bullet">●</span>
    UPDATED ${escapeHtml(timeStr || '—')}
    <span class="ftr-sep">·</span>
    REFRESH ${cfg.refreshMinutes || 30}MIN
    <span class="ftr-sep">·</span>
    THE DAILY ${escapeHtml((cityLabel || 'DASHBOARD').split(' ')[0])}
  `;
}

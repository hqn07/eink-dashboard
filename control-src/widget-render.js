// Client-side mirror of dashboard.html's widget render functions.
// Both the React editor and the pool render real widget HTML by
// calling these — the result is dropped into the DOM via
// `dangerouslySetInnerHTML` and styled via /static/dashboard.css.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
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
    sunrise: '--:--',
    forecast: []
  };
}

const RENDERERS = {
  weather_hero: ({ weather, units }) => {
    const w = weather || fakeWeather(units);
    return `
      <div class="weather-hero">
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
    `;
  },
  weather_forecast: ({ weather }) => {
    const w = weather;
    if (!w || !w.forecast || !w.forecast.length) {
      return `<div class="col-title">3-DAY OUTLOOK</div><div class="empty" style="border:0;padding:14px 0">NO DATA</div>`;
    }
    return `
      <div class="col-title">3-DAY OUTLOOK</div>
      ${w.forecast.map(f => `
        <div class="fc-row">
          <div class="fc-day">${f.name}</div>
          <div class="fc-icon">${icon(f.main, 38)}</div>
          <div class="fc-hilo">
            <div class="fc-hi">${f.hi}°</div>
            <div class="fc-lo">${f.lo}°</div>
          </div>
        </div>
      `).join('')}
    `;
  },
  message: ({ cfg }) => {
    const m = (cfg && cfg.message) || {};
    const text = m.text || 'Custom message';
    const sub  = m.subtitle || '';
    return `
      <div class="widget widget-msg">
        <div class="msg-text">${escapeHtml(text)}</div>
        ${sub ? `<div class="msg-sub">${escapeHtml(sub)}</div>` : ''}
      </div>
    `;
  },
  todos: ({ cfg }) => {
    const todos = ((cfg && cfg.todos) || []).slice(0, 6);
    if (!todos.length) {
      return `
        <div class="widget widget-todos">
          <div class="widget-title">TODO</div>
          <ul class="todo-list"><li><span class="checkbox"></span><span class="todo-text">No items</span></li></ul>
        </div>
      `;
    }
    return `
      <div class="widget widget-todos">
        <div class="widget-title">TODO</div>
        <ul class="todo-list">
          ${todos.map(t => `
            <li class="${t.done ? 'done' : ''}">
              <span class="checkbox"></span>
              <span class="todo-text">${escapeHtml(t.text)}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  },
  calendar: ({ events }) => {
    const list = (events || []).slice(0, 3);
    return `
      <div class="widget widget-cal">
        <div class="widget-title">UPCOMING</div>
        ${list.length
          ? list.map(ev => `
            <div class="cal-row">
              <div class="cal-day">${escapeHtml(ev.dayLabel || '')}</div>
              <div class="cal-info">
                <div class="cal-title">${escapeHtml(ev.title || '')}</div>
                <div class="cal-time">${escapeHtml(ev.startLabel || '')}</div>
              </div>
            </div>
          `).join('')
          : `<div class="cal-row"><div class="cal-info"><div class="cal-title">No events</div></div></div>`}
      </div>
    `;
  },
  spacer: ({ cfg }) => {
    const s = (cfg && cfg.spacer) || {};
    const text = (s.text || '').trim();
    const cls = s.invert ? ' invert' : '';
    return `<div class="widget widget-spacer${cls}">${text ? escapeHtml(text) : ''}</div>`;
  },
  quote: ({ cfg }) => {
    const q = (cfg && cfg.quote) || {};
    const body = (q.text || '').trim() || 'Type a quote in settings.';
    const attr = (q.attribution || '').trim();
    const align = (q.align === 'left' || q.align === 'right') ? q.align : 'center';
    const baseSize = Math.max(14, Math.min(46, Math.round(420 / Math.max(8, body.length / 4))));
    return `
      <div class="widget widget-quote" style="text-align:${align}">
        <div class="quote-body" style="font-size:${baseSize}px">${escapeHtml(body)}</div>
        ${attr ? `<div class="quote-attr">— ${escapeHtml(attr)}</div>` : ''}
      </div>
    `;
  }
};

export function renderWidget(id, data) {
  const fn = RENDERERS[id];
  if (!fn) return '';
  try { return fn(data || {}); } catch { return ''; }
}

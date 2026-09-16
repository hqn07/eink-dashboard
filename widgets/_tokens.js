// Logic-less {{token}} interpolation for user-facing text widgets.
// Fixed registry — no arbitrary code execution, no nested paths.
//
// Missing/empty values render as the universal placeholder "—" (em dash)
// matching dashboard convention (Grafana "N/A", HA "unavailable"). Authors
// can override per-spot with the `default:` pipe filter:
//   {{weather}}                     → "—" if no data
//   {{weather|default:Sunny}}       → "Sunny" if no data
//   {{temp|unit|default:N/A}}       → "N/A" if no temp; "72°F" if present
//
// Unknown tokens (typos like {{wether}}) pass through raw so they stay
// visible to the user — they don't honor `default`.

const { homeValue } = require('../lib/home');

function fmtDate(d, tz, opts) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', ...opts }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-US', opts).format(d);
  }
}

function relTime(then, now) {
  if (!then) return '';
  const diffMs = now - then;
  const m = Math.round(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function batteryBar(pct) {
  const filled = Math.round(pct / 25);
  return '▓'.repeat(filled) + '░'.repeat(4 - filled);
}

// Round a temp-ish value that may arrive as '--' (weather stub) or a
// number; '' lets the pipeline fall through to default/em-dash.
function fmtTemp(v, fmt, ctx) {
  if (!Number.isFinite(Number(v))) return '';
  const r = Math.round(Number(v));
  return fmt === 'unit' ? `${r}°${ctx.units === 'C' ? 'C' : 'F'}` : `${r}°`;
}

// Wall-clock "now" in the ctx timezone → { dow (0=Sun), minutes }.
function nowInTz(ctx) {
  const d = new Date(ctx.now || Date.now());
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ctx.timezone || 'UTC', weekday: 'short',
      hour: 'numeric', minute: 'numeric', hour12: false
    }).formatToParts(d);
    const get = (t) => (parts.find(p => p.type === t) || {}).value;
    const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
    return { dow: dow < 0 ? d.getDay() : dow, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
  } catch {
    return { dow: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
  }
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtClock(minutes) {
  let h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

const TOKENS = {
  date(ctx, fmt) {
    if (!ctx.now) return '';
    const d = new Date(ctx.now);
    const tz = ctx.timezone;
    const tables = {
      long:  { weekday: 'long', month: 'long', day: 'numeric' },
      short: { month: 'short', day: 'numeric' },
      iso:   { year: 'numeric', month: '2-digit', day: '2-digit' },
      day:   { weekday: 'long' },
    };
    if (fmt === 'iso') {
      // sv-SE gives ISO format natively (YYYY-MM-DD); en-US gives MM/DD/YYYY.
      try {
        return new Intl.DateTimeFormat('sv-SE', { timeZone: tz || 'UTC', ...tables.iso }).format(d);
      } catch {
        return new Intl.DateTimeFormat('sv-SE', tables.iso).format(d);
      }
    }
    const opts = tables[fmt] || tables.long;
    return fmtDate(d, tz, opts);
  },
  day(ctx, fmt) {
    return TOKENS.date(ctx, fmt === 'short' ? null : 'day').slice(0, fmt === 'short' ? 3 : undefined);
  },
  city(ctx) {
    const cfg = ctx.cfg || {};
    return homeValue(cfg, 'city') || (cfg.location && cfg.location.city) || '';
  },
  temp(ctx, fmt) {
    const w = ctx.weather;
    return w ? fmtTemp(w.tempF != null ? w.tempF : w.temp, fmt, ctx) : '';
  },
  tempHi(ctx, fmt) {
    return ctx.weather ? fmtTemp(ctx.weather.tempMax, fmt, ctx) : '';
  },
  tempLo(ctx, fmt) {
    return ctx.weather ? fmtTemp(ctx.weather.tempMin, fmt, ctx) : '';
  },
  weather(ctx) {
    const w = ctx.weather;
    // `desc` is the Open-Meteo fetcher's field; description/summary kept
    // for older cached shapes.
    return (w && (w.desc || w.description || w.summary)) || '';
  },
  nextEvent(ctx, fmt) {
    const ev = Array.isArray(ctx.events) ? ctx.events[0] : null;
    if (!ev) return '';
    if (fmt === 'time') return ev.isAllDay ? 'All day' : (ev.startLabel || '');
    if (fmt === 'day')  return ev.dayLabel || '';
    return ev.title || '';
  },
  aqi(ctx, fmt) {
    const a = ctx.aqi;
    if (!a || a.aqi == null) return '';
    return fmt === 'label' ? (a.label || '') : String(Math.round(a.aqi));
  },
  eventsToday(ctx) {
    if (!Array.isArray(ctx.events) || !ctx.events.length) return '0';
    const tz = ctx.timezone || 'UTC';
    const dayOf = (t) => {
      try { return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t)); }
      catch { return new Date(t).toDateString(); }
    };
    const today = dayOf(ctx.now || Date.now());
    return String(ctx.events.filter(e => e.startISO && dayOf(e.startISO) === today).length);
  },
  lastRefresh(ctx, fmt) {
    const t = ctx.lastRefresh || ctx.now;
    if (!t) return '';
    if (fmt === 'relative') return relTime(t, ctx.now || Date.now());
    return fmtDate(new Date(t), ctx.timezone, { hour: 'numeric', minute: '2-digit' });
  },
  battery(ctx, fmt) {
    const b = ctx.battery;
    const p = b && (b.pct != null ? b.pct : b.percent);
    if (p == null) return '';
    return fmt === 'bar' ? batteryBar(p) : `${Math.round(p)}%`;
  },
};

// Pipe segments allow word format keywords OR `default:VALUE` where
// VALUE can be any chars except `|` or `}`. Multiple pipes parsed
// independently — e.g. `{{temp|unit|default:N/A}}`.
const RE = /\{\{\s*(\w+)((?:\s*\|\s*[^|}]+)*)\s*\}\}/g;
const DEFAULT_FALLBACK = '—';

function parsePipes(raw) {
  if (!raw) return { fmt: null, def: null };
  const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
  let fmt = null, def = null;
  for (const p of parts) {
    if (p.startsWith('default:')) def = p.slice('default:'.length);
    else fmt = p;
  }
  return { fmt, def };
}

function renderTokens(str, ctx) {
  if (!str) return '';
  const safeCtx = ctx || { now: Date.now() };
  return String(str).replace(RE, (raw, name, pipesStr) => {
    const fn = TOKENS[name];
    if (!fn) return raw;
    const { fmt, def } = parsePipes(pipesStr);
    let out;
    try {
      out = fn(safeCtx, fmt);
    } catch {
      out = null;
    }
    if (out == null || out === '') return def != null ? def : DEFAULT_FALLBACK;
    return String(out);
  });
}

// `relative` removed from lastRefresh's advertised formats: the context
// is built at render time so the delta was always "just now". The parser
// still accepts it for old configs.
const TOKEN_META = [
  { name: 'date',        formats: ['long', 'short', 'iso', 'day'], example: 'Saturday, June 6' },
  { name: 'day',         formats: ['long', 'short'],               example: 'Saturday' },
  { name: 'city',        formats: [],                              example: 'Brooklyn' },
  { name: 'temp',        formats: ['unit'],                        example: '72°' },
  { name: 'tempHi',      formats: ['unit'],                        example: '78°' },
  { name: 'tempLo',      formats: ['unit'],                        example: '61°' },
  { name: 'weather',     formats: [],                              example: 'Partly cloudy' },
  { name: 'nextEvent',   formats: ['time', 'day'],                 example: 'Physics lab' },
  { name: 'eventsToday', formats: [],                              example: '3' },
  { name: 'aqi',         formats: ['label'],                       example: '42' },
  { name: 'lastRefresh', formats: [],                              example: '8:42 AM' },
  { name: 'battery',     formats: ['bar'],                         example: '84%' },
];

// Settings keys eligible for {{token}} resolution across ALL widgets
// (buildTileCtx runs them through renderTokens). Data-bearing fields —
// qr `data`/`ssid`, webhook `key`/`template`, crypto symbols, URLs —
// are excluded by not being listed.
const RESOLVABLE_KEYS = ['title', 'subtitle', 'label', 'caption', 'note', 'text'];

module.exports = { renderTokens, TOKEN_META, TOKENS, DEFAULT_FALLBACK, RESOLVABLE_KEYS };

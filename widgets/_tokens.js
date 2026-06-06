// Logic-less {{token}} interpolation for user-facing text widgets.
// Fixed registry — no arbitrary code execution, no nested paths.
// Unknown tokens pass through raw so typos are visible to the user.

function fmtDate(d, tz, opts) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', ...opts }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-US', opts).format(d);
  }
}

function relTime(then, now) {
  if (!then) return '—';
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

const TOKENS = {
  date(ctx, fmt) {
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
    return cfg.city || (cfg.location && cfg.location.city) || '';
  },
  temp(ctx, fmt) {
    const w = ctx.weather;
    const t = w && (w.tempF != null ? w.tempF : w.temp);
    if (t == null) return '—';
    const r = Math.round(t);
    return fmt === 'unit' ? `${r}°${ctx.units === 'C' ? 'C' : 'F'}` : `${r}°`;
  },
  weather(ctx) {
    const w = ctx.weather;
    return (w && (w.description || w.summary)) || '';
  },
  lastRefresh(ctx, fmt) {
    const t = ctx.lastRefresh || ctx.now;
    if (fmt === 'relative') return relTime(t, ctx.now);
    return fmtDate(new Date(t), ctx.timezone, { hour: 'numeric', minute: '2-digit' });
  },
  battery(ctx, fmt) {
    const b = ctx.battery;
    const p = b && (b.pct != null ? b.pct : b.percent);
    if (p == null) return '—';
    return fmt === 'bar' ? batteryBar(p) : `${Math.round(p)}%`;
  },
};

const RE = /\{\{\s*(\w+)(?:\s*\|\s*(\w+))?\s*\}\}/g;

function renderTokens(str, ctx) {
  if (!str) return '';
  const safeCtx = ctx || { now: Date.now() };
  return String(str).replace(RE, (raw, name, fmt) => {
    const fn = TOKENS[name];
    if (!fn) return raw;
    try {
      const out = fn(safeCtx, fmt);
      return out == null ? raw : String(out);
    } catch {
      return raw;
    }
  });
}

const TOKEN_META = [
  { name: 'date',        formats: ['long', 'short', 'iso', 'day'], example: 'Saturday, June 6' },
  { name: 'day',         formats: ['long', 'short'],               example: 'Saturday' },
  { name: 'city',        formats: [],                              example: 'Brooklyn' },
  { name: 'temp',        formats: ['unit'],                        example: '72°' },
  { name: 'weather',     formats: [],                              example: 'Partly cloudy' },
  { name: 'lastRefresh', formats: ['relative'],                    example: '8:42 AM' },
  { name: 'battery',     formats: ['bar'],                         example: '84%' },
];

module.exports = { renderTokens, TOKEN_META, TOKENS };

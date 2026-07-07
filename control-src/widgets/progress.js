import { escapeHtml, pickTier } from './_shared.js';

// Progress — elapsed-fraction bars for the day / week / month / year. Pure
// client compute: no fetcher. `now` comes from ctx.now when present (frozen
// demo data → deterministic matrix / visual-regression) and falls back to
// Date.now() on the live face. All spans are computed in the dashboard's
// timezone (ctx.cfg.timezone) so "day 62%" matches the user's wall clock.

export const def = {
  id: 'progress',
  label: 'Progress',
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 6, h: 4 },
    M: { w: 8, h: 6 },
    L: { w: 10, h: 8 }
  },
  defaultSize: 'M',
  variants: {
    trmnl: { label: 'TRMNL — title-bar card' },
    plain: { label: 'Plain — bars only' }
  },
  defaultVariant: 'trmnl',
  degrade: {
    tiny: ['percent-label']
  },
  defaults: () => ({
    variant: 'trmnl',
    spans: ['day', 'year'],   // any of: day, week, month, year
    title: '',
    fontScale: 1,
    padding: 14
  })
};

const SPAN_LABELS = { day: 'DAY', week: 'WEEK', month: 'MONTH', year: 'YEAR' };
const SPAN_ORDER = ['day', 'week', 'month', 'year'];
// Each span keeps its own fill weave (finer = shorter span) so stacked bars
// read apart by texture, not just label — same trick as the weather-hero
// humidity/cloud pair. Keyed by span, not row index, so identity is stable
// no matter which spans the user has enabled.
const SPAN_TONES = {
  day:   'face-tone-g50',    // checkerboard
  week:  'face-tone-diag',   // 45° weave
  month: 'face-tone-vlines', // vertical ticks
  year:  'face-tone-cross'   // coarse hatch
};

function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
function daysInMonth(y, mo) { return new Date(y, mo, 0).getDate(); }
function dayOfYear(y, mo, d) {
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return cum[mo - 1] + d + (mo > 2 && isLeap(y) ? 1 : 0);
}

// Wall-clock parts in a timezone, straight from Intl so we never touch UTC
// offset math. weekday index: Monday = 0 … Sunday = 6.
function tzParts(now, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'UTC', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short', hour12: false
  });
  const p = {};
  for (const part of dtf.formatToParts(now)) p[part.type] = part.value;
  const wk = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return {
    y: +p.year, mo: +p.month, d: +p.day,
    h: (+p.hour) % 24, mi: +p.minute, s: +p.second,
    wd: wk[p.weekday] != null ? wk[p.weekday] : 0
  };
}

function fractions(now, tz) {
  const { y, mo, d, h, mi, s, wd } = tzParts(now, tz);
  const dayFrac = (h * 3600 + mi * 60 + s) / 86400;
  const totalDays = isLeap(y) ? 366 : 365;
  return {
    day:   dayFrac,
    week:  (wd + dayFrac) / 7,
    month: (d - 1 + dayFrac) / daysInMonth(y, mo),
    year:  (dayOfYear(y, mo, d) - 1 + dayFrac) / totalDays
  };
}

// Head styles are inlined — `.tr-l` / `.tr-v` are only styled inside a
// `.tr-lv` stack, so bare class use here silently fell back to the 16px
// body font and fattened every row by ~10px (found via box measurement).
function bar(spanKey, frac, showPct) {
  const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
  const head = `<div style="display:flex;justify-content:space-between;align-items:baseline;line-height:1">`
    + `<span style="font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase">${SPAN_LABELS[spanKey]}</span>`
    + (showPct ? `<span style="font-size:16px;font-weight:800;font-variant-numeric:tabular-nums">${pct}%</span>` : '')
    + `</div>`;
  const track = `<div class="tr-bar" style="height:16px;flex:none;margin-top:4px">`
    + `<div class="tr-bar-fill ${SPAN_TONES[spanKey] || 'face-tone-g50'}" style="width:${pct}%"></div>`
    + `<div class="tr-bar-track face-tone-g15"></div>`
    + `</div>`;
  return `<div>${head}${track}</div>`;
}

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'PROGRESS';
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const tz = (ctx.cfg && ctx.cfg.timezone) || 'UTC';
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'trmnl');
  const tier = pickTier(cellW || 0, cellH || 0, density);
  const showPct = tier !== 'tiny';

  const fr = fractions(now, tz);
  let spans = (Array.isArray(s.spans) && s.spans.length ? s.spans : ['day', 'year'])
    .filter(k => SPAN_ORDER.includes(k))
    .sort((a, b) => SPAN_ORDER.indexOf(a) - SPAN_ORDER.indexOf(b));

  // Degrade: drop trailing spans that can't fit the tile instead of
  // clipping mid-bar. Measured (headless box metrics, M tile): grid rows
  // are 40px; a bar block is ~43px (19px head + 4px + 20px bordered
  // track) + 12px stack gap; chrome = cell padding 30 + title bar 27 +
  // body padding 24 ≈ 81px (plain skips the card chrome).
  const pxH = (cellH || 0) * 40;
  const chromePx = variant === 'plain' ? 34 : 81;
  const maxBars = Math.max(1, Math.floor((pxH - chromePx + 12) / 55));
  if (spans.length > maxBars) spans = spans.slice(0, maxBars);

  const bars = spans.map(k => bar(k, fr[k], showPct)).join('');
  const stack = (pad) =>
    `<div style="display:flex;flex-direction:column;justify-content:center;gap:12px;height:100%;overflow:hidden;${pad}">${bars}</div>`;

  if (variant === 'plain') {
    return `<div class="widget" style="height:100%">${stack('padding:2px 0')}</div>`;
  }

  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span></div>
    <div class="tr-body" style="flex-direction:column;justify-content:center">${stack('')}</div>
  </div>`;
}

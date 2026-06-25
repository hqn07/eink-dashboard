import { escapeHtml, pickTier, placeholder, semRed } from './_shared.js';

// Countdown — days (and optionally hours) until a target date. Pure
// client compute: no fetcher, no server data. `now` comes from
// ctx.now when present (frozen demo data → deterministic matrix /
// visual-regression) and falls back to Date.now() on the live face so
// the count is current at each refresh.
//
// Contract v2 (widgets-refresh W2): variants —
//   big      — one big number + unit + label (the default)
//   detail   — days + hours side by side + label
//   minimal  — number + unit only
// Minutes/seconds are deliberately omitted: the panel refreshes every
// few minutes, so anything finer than hours is stale on arrival.

export const def = {
  id: 'countdown',
  label: 'Countdown',
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 6, h: 4 },
    M: { w: 8, h: 4 },
    L: { w: 8, h: 6 }
  },
  defaultSize: 'M',
  variants: {
    big:     { label: 'Big — one number' },
    detail:  { label: 'Detail — days + hours' },
    minimal: { label: 'Minimal — number + unit' }
  },
  defaultVariant: 'big',
  degrade: {
    tiny: ['label', 'hours']
  },
  defaults: () => ({
    variant: 'big',
    target: '',          // YYYY-MM-DD or YYYY-MM-DDTHH:MM
    label: '',           // e.g. "until launch"
    title: '',
    fontScale: 1,
    padding: 14
  })
};

const DAY = 86400000, HOUR = 3600000;

// Parse a bare YYYY-MM-DD as local midnight (not UTC) so "3 days" lines
// up with the user's calendar; pass datetime strings through as-is.
function parseTarget(t) {
  if (typeof t !== 'string' || !t.trim()) return null;
  const s = t.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'COUNTDOWN';
  const target = parseTarget(s.target);
  if (target == null) {
    return placeholder(titleLabel.split(/\s+/)[0] || 'COUNTDOWN', 'Set a date', 'msg', { cellW, cellH });
  }
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'big');
  const tier = pickTier(cellW || 0, cellH || 0, density);

  const diff = target - now;
  const past = diff <= 0;
  const absd = Math.abs(diff);
  const days = Math.floor(absd / DAY);
  const hours = Math.floor((absd % DAY) / HOUR);
  // Past dates flip to "since"; the day word stays singular at 1.
  const unitWord = days === 1 ? 'DAY' : 'DAYS';
  const labelText = past
    ? (s.label && s.label.trim() ? `${s.label.trim()} (PASSED)` : 'AGO')
    : (s.label || '').trim();

  // Semantic auto-red: an overdue countdown (target in the past) reads as
  // an alert — redden the number, unit and the "(PASSED)" label.
  const od = semRed(s, past);
  const title = `<div class="col-title">${escapeHtml(titleLabel)}</div>`;
  const label = (tier !== 'tiny' && labelText)
    ? `<div class="cd-label${od}">${escapeHtml(labelText)}</div>` : '';

  if (variant === 'minimal') {
    return `
      <div class="countdown cd-minimal">
        <div class="cd-num autofit${od}" data-min-font="22">${days}</div>
        <div class="cd-unit${od}">${unitWord}</div>
      </div>
    `;
  }

  if (variant === 'detail') {
    const showHours = tier !== 'tiny';
    return `
      <div class="countdown cd-detail">
        ${tier !== 'tiny' ? title : ''}
        <div class="cd-detail-row">
          <div class="cd-cell"><span class="cd-num${od}">${days}</span><span class="cd-unit${od}">${unitWord}</span></div>
          ${showHours ? `<div class="cd-cell"><span class="cd-num${od}">${hours}</span><span class="cd-unit${od}">${hours === 1 ? 'HR' : 'HRS'}</span></div>` : ''}
        </div>
        ${label}
      </div>
    `;
  }

  // big
  return `
    <div class="countdown cd-big">
      ${tier !== 'tiny' ? title : ''}
      <div class="cd-num autofit${od}" data-min-font="22">${days}</div>
      <div class="cd-unit${od}">${unitWord}</div>
      ${label}
    </div>
  `;
}

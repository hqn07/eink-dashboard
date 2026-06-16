import { escapeHtml, pickTier, placeholder } from './_shared.js';

// World Clock — current time in one or more IANA timezones. Pure
// compute via Intl.DateTimeFormat (works in Node SSR + the browser);
// `now` comes from ctx.now when present (frozen demo → deterministic
// matrix / visual-regression) else Date.now().
//
// Zones are stored as "LABEL|IANA/Zone" strings (matches the
// string-row ListEditor the calendar feed list uses).
//
// Contract v2 (widgets-refresh W2): variants —
//   stack — label · time rows, one per zone (default; scales to many)
//   big   — first zone only, big time + label
//   dual  — first two zones side by side

export const def = {
  id: 'world_clock',
  label: 'World Clock',
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 6, h: 4 },
    M: { w: 8, h: 5 },
    L: { w: 10, h: 6 }
  },
  defaultSize: 'M',
  variants: {
    stack: { label: 'Stack — label · time rows' },
    big:   { label: 'Big — one zone, large' },
    dual:  { label: 'Dual — two zones side by side' }
  },
  defaultVariant: 'stack',
  degrade: {
    tiny: ['title']
  },
  defaults: () => ({
    variant: 'stack',
    title: '',
    zones: ['LONDON|Europe/London', 'TOKYO|Asia/Tokyo'],
    format: '12h',
    fontScale: 1,
    padding: 14
  })
};

function parseZone(str) {
  if (typeof str !== 'string') return null;
  const i = str.indexOf('|');
  if (i < 0) return { label: str.trim().toUpperCase(), tz: str.trim() };
  return { label: str.slice(0, i).trim().toUpperCase(), tz: str.slice(i + 1).trim() };
}

function timeIn(tz, now, hour12) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12
    }).format(now);
  } catch {
    return '--:--';
  }
}

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'WORLD CLOCK';
  const zones = (Array.isArray(s.zones) ? s.zones : [])
    .map(parseZone).filter(z => z && z.tz);
  if (!zones.length) {
    return placeholder('WORLD CLOCK', 'Add a timezone', 'msg', { cellW, cellH });
  }
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const hour12 = s.format !== '24h';
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'stack');
  const tier = pickTier(cellW || 0, cellH || 0, density);

  if (variant === 'big') {
    const z = zones[0];
    return `
      <div class="wclock wclock-big">
        <div class="wclock-time autofit" data-min-font="22">${escapeHtml(timeIn(z.tz, now, hour12))}</div>
        <div class="wclock-zone">${escapeHtml(z.label)}</div>
      </div>
    `;
  }

  if (variant === 'dual') {
    const two = zones.slice(0, 2);
    return `
      <div class="wclock wclock-dual">
        ${two.map(z => `
          <div class="wclock-cell">
            <div class="wclock-time">${escapeHtml(timeIn(z.tz, now, hour12))}</div>
            <div class="wclock-zone">${escapeHtml(z.label)}</div>
          </div>`).join('')}
      </div>
    `;
  }

  // stack — cap rows so a tiny tile doesn't overflow.
  const maxRows = tier === 'tiny' ? 2 : tier === 'compact' ? 3 : 6;
  const rows = zones.slice(0, maxRows);
  return `
    <div class="wclock wclock-stack">
      ${tier !== 'tiny' ? `<div class="col-title">${escapeHtml(titleLabel)}</div>` : ''}
      ${rows.map(z => `
        <div class="wclock-row">
          <span class="wclock-zone">${escapeHtml(z.label)}</span>
          <span class="wclock-time">${escapeHtml(timeIn(z.tz, now, hour12))}</span>
        </div>`).join('')}
    </div>
  `;
}

import { escapeHtml, pickTier, placeholder } from './_shared.js';

// World Clock — current time in one or more IANA timezones. Pure
// compute via Intl.DateTimeFormat (works in Node SSR + the browser);
// `now` comes from ctx.now when present (frozen demo → deterministic
// matrix / visual-regression) else Date.now().
//
// Zones are stored as "LABEL|IANA/Zone" strings (matches the
// string-row ListEditor the calendar feed list uses).
//
// Each zone resolves to: time, weekday, UTC offset (GMT±h), a
// day/night glyph (sun 06–18, else moon), and a relative-day badge
// (+1d / -1d) measured against the FIRST zone, treated as "home" — so
// "Tokyo is tomorrow" reads at a glance.
//
// Contract v2 (widgets-refresh W2): variants —
//   stack — label · time rows, one per zone (default; scales to many)
//   big   — first zone only, big time + label
//   dual  — first two zones side by side
//
// Autofit: big + dual size their time to the cell; stack scales the
// time font by tier (per-row autofit can't measure a content-sized
// inline box, so tier classes give predictable, overflow-safe sizes).

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
    big:   { label: 'Big — one zone, large' }
  },
  defaultVariant: 'big',
  degrade: {
    tiny: ['title', 'meta', 'glyph']
  },
  defaults: () => ({
    variant: 'big',
    title: '',
    zones: ['LONDON|Europe/London', 'TOKYO|Asia/Tokyo'],
    format: '12h',
    showMeta: true,
  })
};

function parseZone(str) {
  if (typeof str !== 'string') return null;
  const i = str.indexOf('|');
  if (i < 0) return { label: str.trim().toUpperCase(), tz: str.trim() };
  return { label: str.slice(0, i).trim().toUpperCase(), tz: str.slice(i + 1).trim() };
}

// Resolve everything we render for one zone in a single pass. Any
// Intl failure (bad IANA name) degrades to a placeholder time.
function zoneInfo(z, now, hour12) {
  try {
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: z.tz, hour: 'numeric', minute: '2-digit', hour12
    }).format(now);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: z.tz, weekday: 'short', hour: 'numeric', hour12: false
    }).formatToParts(now);
    const weekday = (parts.find(p => p.type === 'weekday')?.value || '').toUpperCase();
    let hour24 = parseInt(parts.find(p => p.type === 'hour')?.value || '12', 10);
    if (hour24 === 24) hour24 = 0;
    const isDay = hour24 >= 6 && hour24 < 18;
    let offset = '';
    try {
      const op = new Intl.DateTimeFormat('en-US', {
        timeZone: z.tz, timeZoneName: 'shortOffset'
      }).formatToParts(now);
      offset = (op.find(p => p.type === 'timeZoneName')?.value || '').replace('GMT', 'UTC');
    } catch { /* shortOffset unsupported — skip */ }
    const dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: z.tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
    return { ok: true, label: z.label, time, weekday, isDay, offset, dayKey };
  } catch {
    return { ok: false, label: z.label, time: '--:--', weekday: '', isDay: true, offset: '', dayKey: '' };
  }
}

function dayDelta(homeKey, key) {
  const a = Date.parse(homeKey + 'T00:00:00Z');
  const b = Date.parse(key + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function deltaBadge(d) {
  if (!d) return '';
  return `<span class="wclock-delta">${d > 0 ? '+' : '−'}${Math.abs(d)}d</span>`;
}

// 1-bit safe day/night glyph. Sun = disc + 8 rays; moon = a crescent cut
// with fill-rule="evenodd" from two overlapping circle subpaths.
//
// The moon used to be a black disc with a #fff disc painted over it, which
// assumed the panel background was white. On an inverted tile the theme
// repaints every shape white (015-body-grid-system.css) and the bite
// vanished into the disc — a solid white blob. One subpath, one fill, no
// assumption about the background: the theme can invert it correctly, which
// is exactly what a glyph should let it do.
function dnGlyph(isDay) {
  if (isDay) {
    return `<svg class="wclock-dn" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">`
      + `<circle cx="8" cy="8" r="3" fill="#000"/>`
      + `<g stroke="#000" stroke-width="2" stroke-linecap="round">`
      + `<line x1="8" y1="1" x2="8" y2="2.5"/><line x1="8" y1="13.5" x2="8" y2="15"/>`
      + `<line x1="1" y1="8" x2="2.5" y2="8"/><line x1="13.5" y1="8" x2="15" y2="8"/>`
      + `<line x1="3.3" y1="3.3" x2="4.4" y2="4.4"/><line x1="11.6" y1="11.6" x2="12.7" y2="12.7"/>`
      + `<line x1="3.3" y1="12.7" x2="4.4" y2="11.6"/><line x1="11.6" y1="4.4" x2="12.7" y2="3.3"/>`
      + `</g></svg>`;
  }
  // Disc r6 at (8,8); bite r4 at (9.41,6.59) — offset 2 toward the upper
  // right, so 2 + 4 = 6 and the bite is internally TANGENT, never poking
  // outside. That matters: even-odd fills any region covered an odd number
  // of times, so a bite that overhung the limb would paint the overhang as
  // a second sliver of moon.
  return `<svg class="wclock-dn" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">`
    + `<path fill="#000" fill-rule="evenodd" d="`
    +   `M 2 8 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0 `
    +   `M 5.41 6.59 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0"/></svg>`;
}

function metaLine(info, showMeta) {
  if (!showMeta) return '';
  const bits = [info.weekday, info.offset].filter(Boolean).join(' · ');
  return bits ? `<span class="wclock-meta">${escapeHtml(bits)}</span>` : '';
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
  const showGlyph = tier !== 'tiny';
  const showMeta = s.showMeta !== false && tier !== 'tiny' && tier !== 'compact';

  // Resolve every zone once; home = first zone (relative-day anchor).
  const infos = zones.map(z => zoneInfo(z, now, hour12));
  const homeKey = infos[0].dayKey;

  if (variant === 'trmnl') {
    const titleRows = 1;
    const maxRows = Math.max(2, Math.min(8, Math.floor(((cellH || 0) - titleRows) / 1.5)));
    const rows = infos.slice(0, maxRows);
    // Under-full → rows grow to fill the card (space-aware fit ladder).
    const fill = rows.length < maxRows ? ' tr-rows-fill' : '';
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span></div>
      <div class="tr-body" style="padding:4px 14px;gap:0"><div class="tr-rows${fill}">
        ${rows.map(z => `<div class="tr-row"><div class="tr-row-inner" style="justify-content:space-between">
          <div class="tr-row-main"><div class="tr-row-title">${showGlyph ? dnGlyph(z.isDay) + ' ' : ''}${escapeHtml(z.label)}</div>${showMeta ? `<div class="tr-row-sub">${escapeHtml([z.weekday, z.offset].filter(Boolean).join(' · '))}</div>` : ''}</div>
          <div style="font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap">${escapeHtml(z.time)} ${deltaBadge(dayDelta(homeKey, z.dayKey))}</div>
        </div></div>`).join('')}
      </div></div>
    </div>`;
  }

  if (variant === 'big') {
    const z = infos[0];
    return `
      <div class="wclock wclock-big">
        <div class="wclock-time autofit" data-min-font="22">${escapeHtml(z.time)}</div>
        <div class="wclock-bigfoot">
          ${showGlyph ? dnGlyph(z.isDay) : ''}
          <span class="wclock-zone">${escapeHtml(z.label)}</span>
          ${metaLine(z, showMeta)}
        </div>
      </div>
    `;
  }

  if (variant === 'dual') {
    const two = infos.slice(0, 2);
    return `
      <div class="wclock wclock-dual">
        ${two.map(z => `
          <div class="wclock-cell">
            <div class="wclock-time autofit" data-min-font="22" data-max-font="64">${escapeHtml(z.time)}</div>
            <div class="wclock-bigfoot">
              ${showGlyph ? dnGlyph(z.isDay) : ''}
              <span class="wclock-zone">${escapeHtml(z.label)}</span>
              ${deltaBadge(dayDelta(homeKey, z.dayKey))}
            </div>
            ${metaLine(z, showMeta)}
          </div>`).join('')}
      </div>
    `;
  }

  // stack — row count is driven by available HEIGHT, not pickTier
  // (tier is min(width,height) tier, so a tall narrow tile would cap at
  // the width tier and waste vertical space — the 3-row bug). Grid is
  // 12 rows tall; ~1.25 grid rows per clock row, minus one for title.
  const titleRows = tier !== 'tiny' ? 1 : 0;
  const maxRows = Math.max(2, Math.min(12, Math.floor(((cellH || 0) - titleRows) / 1.25)));
  const rows = infos.slice(0, maxRows);
  return `
    <div class="wclock wclock-stack wclock-stack--${tier}">
      ${tier !== 'tiny' ? `<div class="col-title">${escapeHtml(titleLabel)}</div>` : ''}
      ${rows.map(z => `
        <div class="wclock-row">
          <span class="wclock-rowhead">
            ${showGlyph ? dnGlyph(z.isDay) : ''}
            <span class="wclock-headtext">
              <span class="wclock-zone">${escapeHtml(z.label)}</span>
              ${metaLine(z, showMeta)}
            </span>
          </span>
          <span class="wclock-rowtime">
            <span class="wclock-time">${escapeHtml(z.time)}</span>
            ${deltaBadge(dayDelta(homeKey, z.dayKey))}
          </span>
        </div>`).join('')}
    </div>
  `;
}

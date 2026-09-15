import { escapeHtml, placeholder, staleMark, pickTier } from './_shared.js';

// Sunrise / Sunset — server fetches Open-Meteo into ctx.sun =
// { sunrise, sunset, daylightSec, tz, stale } (local ISO strings for the
// dashboard location). render() only formats it.

export const def = {
  id: 'sun',
  label: 'Sunrise / Sunset',
  requires: [],
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 6, h: 4 },
    M: { w: 8, h: 5 },
    L: { w: 10, h: 6 }
  },
  defaultSize: 'M',
  defaultVariant: 'trmnl',
  defaults: () => ({
    variant: 'trmnl',
    hour24: false,
    showDaylight: true,
    title: '',
    fontScale: 1,
    padding: 14
  })
};

// "2026-07-04T05:34" → "5:34 AM" (or 24h). Returns '--' when unparseable.
function fmtTime(iso, hour24) {
  if (typeof iso !== 'string') return '--';
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return '--';
  let h = +m[1]; const mi = m[2];
  if (hour24) return `${String(h).padStart(2, '0')}:${mi}`;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${mi} ${ap}`;
}

function fmtDaylight(sec) {
  if (!Number.isFinite(sec)) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const sun = ctx.sun;
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'SUN';

  if (!sun || (!sun.sunrise && !sun.sunset)) {
    return placeholder(titleLabel, 'Set dashboard location', 'msg', { cellW, cellH });
  }

  const tier = pickTier(cellW || 0, cellH || 0, density);
  const stale = staleMark(sun.stale);
  const rise = fmtTime(sun.sunrise, s.hour24);
  const set = fmtTime(sun.sunset, s.hour24);
  const daylight = (s.showDaylight !== false && tier !== 'tiny')
    ? fmtDaylight(sun.daylightSec) : '';

  const cells = `<div class="tr-stats">
    <div class="tr-stat"><div class="tr-sv">${escapeHtml(rise)}</div><div class="tr-sl">↑ SUNRISE</div></div>
    <div class="tr-stat"><div class="tr-sv">${escapeHtml(set)}</div><div class="tr-sl">↓ SUNSET</div></div>
  </div>`;

  const daylightRow = daylight
    ? `<div class="tr-l" style="text-align:center;margin-top:8px">DAYLIGHT ${escapeHtml(daylight)}</div>` : '';

  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span>${stale ? `<span class="tr-meta">${stale}</span>` : ''}</div>
    <div class="tr-body" style="flex-direction:column;justify-content:center">${cells}${daylightRow}</div>
  </div>`;
}

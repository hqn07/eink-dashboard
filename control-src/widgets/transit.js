import { escapeHtml, pickTier, placeholder, semRed, staleMark } from './_shared.js';

// Transit — NYC MTA subway real-time arrivals. Fetched + decoded
// server-side (widgets/transit.js) to ctx.transit = { stop, items:[{line,
// minutes}], stale }. render() draws a departures board: route bullet +
// minutes-away. Imminent trains (≤2 min) get the semantic red accent.
//
// Contract v2 variants —
//   trmnl   — title-bar card, bullet + minutes rows (default)
//   board   — big minutes, one row per train
//   compact — dense rows

export const def = {
  id: 'transit',
  label: 'Transit',
  requires: 'transit',
  minSize: { w: 6, h: 4 },
  sizes: {
    S: { w: 6,  h: 4 },
    M: { w: 9,  h: 6 },
    L: { w: 12, h: 9 }
  },
  defaultSize: 'M',
  variants: {
    trmnl:   { label: 'TRMNL — title-bar board' },
    board:   { label: 'Board — big minutes' },
    compact: { label: 'Compact — dense rows' }
  },
  defaultVariant: 'board',
  degrade: { tiny: ['stop'] },
  defaults: () => ({
    variant: 'board',
    line: 'L',
    stopId: '',
    direction: 'N',
    count: 5,
    title: '',
    fontScale: 1,
    padding: 14
  })
};

const ROWS_BY_TIER = { tiny: 2, compact: 3, standard: 4, extended: 6, full: 8 };

// MTA route bullet — bordered circle with the route glyph. Solid 2px stroke
// so it survives threshold + invert (a filled disc would clash with 1-bit).
function bullet(route) {
  return `<span class="tr-bullet">${escapeHtml(String(route || '').slice(0, 3))}</span>`;
}

export function render(ctx) {
  const { transit, settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim()) ? s.title.trim() : 'TRANSIT';
  if (!transit || !Array.isArray(transit.items) || !transit.items.length) {
    const hint = transit ? 'No trains soon' : (s.stopId ? 'No data' : 'Add a stop');
    const kind = transit ? 'empty' : (s.stopId ? 'nodata' : 'setup');
    return placeholder('TRANSIT', hint, 'msg', { cellW, cellH }, kind);
  }

  const tier = pickTier(cellW || 0, cellH || 0, density);
  const wantCount = Number.isFinite(s.count) ? s.count : 5;
  const maxRows = Math.min(wantCount, ROWS_BY_TIER[tier] || 4, transit.items.length);
  const items = transit.items.slice(0, maxRows);
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'trmnl');
  const stale = staleMark(transit.stale);
  const both = !!transit.both;
  const dir = (transit.stop || '').slice(-1);
  const dirLabel = both ? 'both platforms'
    : dir === 'N' ? 'northbound' : dir === 'S' ? 'southbound' : '';

  const row = (it) => {
    const soon = it.minutes <= 2;
    const red = semRed(s, soon);
    const min = it.minutes <= 0 ? 'now' : `${it.minutes}<span class="tr-t-unit">min</span>`;
    // Both-platform mode marks each arrival ↑ (N) / ↓ (S).
    const arrow = both ? `<span class="tr-t-dir">${it.dir === 'S' ? '↓' : '↑'}</span>` : '';
    return `<div class="tr-t-row">
      ${bullet(it.line)}${arrow}
      <span class="tr-t-min${red}">${min}</span>
    </div>`;
  };
  const rows = items.map(row).join('');

  if (variant === 'trmnl') {
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${dirLabel}${stale}</span></div>
      <div class="tr-body" style="gap:0;padding:0"><div class="tr-t-list tr-t-list--trmnl">${rows}</div></div>
    </div>`;
  }
  return `<div class="widget widget-transit">
    <div class="widget-title">${escapeHtml(titleLabel)}${stale}</div>
    <div class="tr-t-list tr-t-list--${variant}">${rows}</div>
  </div>`;
}

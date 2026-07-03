import { escapeHtml, pickTier, placeholder } from './_shared.js';

// Headlines — recent items from an RSS/Atom feed or Hacker News. The feed
// is fetched + parsed server-side (widgets/headlines.js) and arrives as
// ctx.headlines = { source, items:[{title, age}], stale }. render() lays it
// out; empty/failed feeds show a placeholder.
//
// Contract v2 variants —
//   trmnl   — title-bar card, source label + item rows (default)
//   list    — numbered agenda rows
//   compact — dense rows, no numbers

export const def = {
  id: 'headlines',
  label: 'Headlines',
  requires: 'headlines',
  minSize: { w: 8, h: 4 },
  sizes: {
    S: { w: 8,  h: 4 },
    M: { w: 10, h: 7 },
    L: { w: 14, h: 10 }
  },
  defaultSize: 'M',
  variants: {
    trmnl:   { label: 'TRMNL — title-bar list' },
    list:    { label: 'List — numbered rows' },
    compact: { label: 'Compact — dense rows' }
  },
  defaultVariant: 'trmnl',
  degrade: {
    compact: ['age'],
    tiny:    ['age', 'source']
  },
  defaults: () => ({
    variant: 'trmnl',
    source: 'hn',        // 'hn' | 'rss'
    hnFeed: 'top',       // 'top' | 'best' | 'new'
    feedUrl: '',         // source=rss
    count: 6,
    showAge: true,
    title: '',
    fontScale: 1,
    padding: 14
  })
};

// How many rows fit per tier — the render clamps the fetched list to this.
const ROWS_BY_TIER = { tiny: 2, compact: 3, standard: 5, extended: 7, full: 9 };

export function render(ctx) {
  const { headlines, settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim()
    : (headlines && headlines.source) || 'HEADLINES';
  if (!headlines || !Array.isArray(headlines.items) || !headlines.items.length) {
    return placeholder('HEADLINES', headlines ? 'No items' : 'Add a feed', 'msg', { cellW, cellH });
  }

  const tier = pickTier(cellW || 0, cellH || 0, density);
  const wantCount = Number.isFinite(s.count) ? s.count : 6;
  const maxRows = Math.min(wantCount, ROWS_BY_TIER[tier] || 5, headlines.items.length);
  const items = headlines.items.slice(0, maxRows);
  const showAge = s.showAge !== false && tier !== 'tiny';
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'trmnl');
  const stale = headlines.stale ? ' <span class="hl-stale">·stale</span>' : '';

  const ageEl = (it) => (showAge && it.age) ? `<span class="hl-age">${escapeHtml(it.age)}</span>` : '';

  if (variant === 'trmnl') {
    const rows = items.map(it => `
      <div class="hl-row">
        <span class="hl-title tr-clamp" style="--fit-lines:2">${escapeHtml(it.title)}</span>
        ${ageEl(it)}
      </div>`).join('');
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${escapeHtml((headlines.source || '').toLowerCase())}${stale}</span></div>
      <div class="tr-body" style="gap:0;padding:0">
        <div class="hl-list hl-list--trmnl">${rows}</div>
      </div>
    </div>`;
  }

  const numbered = variant === 'list';
  const rows = items.map((it, i) => `
    <div class="hl-row ${numbered ? 'hl-row--num' : ''}">
      ${numbered ? `<span class="hl-num">${i + 1}</span>` : ''}
      <span class="hl-title tr-clamp" style="--fit-lines:2">${escapeHtml(it.title)}</span>
      ${ageEl(it)}
    </div>`).join('');
  return `<div class="widget widget-headlines">
    <div class="widget-title">${escapeHtml(titleLabel)}${stale}</div>
    <div class="hl-list">${rows}</div>
  </div>`;
}

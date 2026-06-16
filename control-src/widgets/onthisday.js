import { escapeHtml, pickTier, placeholder } from './_shared.js';

// On This Day — historical events for today, from widgets/onthisday.js
// (server, Wikipedia REST). ctx.onThisDay = { dateLabel, events:
// [{year, text}], stale }.
//
// Contract v2 (widgets-refresh W2): variants —
//   list    — title + dated rows (YEAR · text), count by tier (default)
//   feature — one event, big year + text
//   compact — denser rows, more events

export const def = {
  id: 'onthisday',
  label: 'On This Day',
  requires: 'onthisday',
  minSize: { w: 10, h: 4 },
  sizes: {
    S: { w: 10, h: 4 },
    M: { w: 12, h: 6 },
    L: { w: 12, h: 8 }
  },
  defaultSize: 'M',
  variants: {
    list:    { label: 'List — dated rows' },
    feature: { label: 'Feature — one event, large' },
    compact: { label: 'Compact — dense rows' }
  },
  defaultVariant: 'list',
  degrade: {
    tiny: ['title']
  },
  defaults: () => ({
    variant: 'list',
    title: '',
    fontScale: 1,
    padding: 14
  })
};

export function render(ctx) {
  const { onThisDay: d, settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  if (!d || !Array.isArray(d.events) || !d.events.length) {
    return placeholder('ON THIS DAY', 'No data', 'msg', { cellW, cellH });
  }
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'list');
  const tier = pickTier(cellW || 0, cellH || 0, density);
  const heading = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim()
    : `ON THIS DAY${d.dateLabel ? ` · ${d.dateLabel}` : ''}`;
  const stale = d.stale ? ' <span class="otd-stale">OLD</span>' : '';

  if (variant === 'feature') {
    const e = d.events[0];
    return `
      <div class="otd otd-feature">
        ${tier !== 'tiny' ? `<div class="col-title">${escapeHtml(heading)}${stale}</div>` : ''}
        <div class="otd-feature-year">${e.year}</div>
        <div class="otd-feature-text autofit multiline" data-min-font="14" data-max-font="32">${escapeHtml(e.text)}</div>
      </div>
    `;
  }

  const compact = variant === 'compact';
  // Row budget by tier; compact packs more + clamps each to one line.
  const byTier = compact
    ? { tiny: 3, compact: 4, standard: 6, extended: 8, full: 8 }
    : { tiny: 2, compact: 3, standard: 4, extended: 6, full: 6 };
  const rows = d.events.slice(0, byTier[tier] || 3);
  return `
    <div class="otd otd-list ${compact ? 'otd-compact' : ''}">
      ${tier !== 'tiny' ? `<div class="col-title">${escapeHtml(heading)}${stale}</div>` : ''}
      ${rows.map(e => `
        <div class="otd-row">
          <span class="otd-year">${e.year}</span>
          <span class="otd-text">${escapeHtml(e.text)}</span>
        </div>`).join('')}
    </div>
  `;
}

import { escapeHtml, pickTier, placeholder, fillRowFont } from './_shared.js';

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
    list:    { label: 'List — dated rows' }
  },
  defaultVariant: 'list',
  degrade: {
    tiny: ['title']
  },
  defaults: () => ({
    variant: 'list',
    title: '',
  })
};

export function render(ctx) {
  const { onThisDay: d, settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  if (!d || !Array.isArray(d.events) || !d.events.length) {
    return placeholder('ON THIS DAY', 'No data', 'msg', { cellW, cellH }, 'nodata');
  }
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'list');
  const tier = pickTier(cellW || 0, cellH || 0, density);
  const heading = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim()
    : `ON THIS DAY${d.dateLabel ? ` · ${d.dateLabel}` : ''}`;
  const stale = d.stale ? ' <span class="otd-stale">OLD</span>' : '';

  if (variant === 'trmnl') {
    const byTier = { tiny: 1, compact: 2, standard: 4, extended: 6, full: 7 };
    const cap = byTier[tier] || 3;
    const rows = d.events.slice(0, cap);
    // Under-full → rows grow to fill the card + title text grows with the
    // space (autofit-grow). Events run long, so cap the growth lower.
    const under = rows.length < cap;
    const fill = under ? ' tr-rows-fill' : '';
    const rowsStyle = under ? `--row-font:${fillRowFont(cellH, rows.length, { max: 20 })}px` : '';
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>On This Day</span><span class="tr-meta">${escapeHtml(d.dateLabel || '')}${d.stale ? ' · old' : ''}</span></div>
      <div class="tr-body" style="padding:6px 14px;gap:0"><div class="tr-rows${fill}" style="${rowsStyle}">
        ${rows.map(e => `<div class="tr-row"><div class="tr-row-inner">
          <div class="tr-row-time">${e.year}</div>
          <div class="tr-row-main"><div class="tr-row-title" style="white-space:normal">${escapeHtml(e.text)}</div></div>
        </div></div>`).join('')}
      </div></div>
    </div>`;
  }

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
  // Each entry wraps to two lines at these widths, so a row is worth roughly
  // two of a single-line list's. Budgets below are per-row, not per-line.
  const byTier = compact
    ? { tiny: 2, compact: 3, standard: 6, extended: 8, full: 8 }
    : { tiny: 1, compact: 2, standard: 4, extended: 6, full: 6 };
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

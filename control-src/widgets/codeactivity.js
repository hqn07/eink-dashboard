import { escapeHtml, placeholder, heatmapHtml } from './_shared.js';

// Code Activity — GitHub contribution heatmap. Data comes from
// widgets/codeactivity.js (server) on ctx.codeActivity:
//   { user, days:[{date,count,level 0-4}], total, stale }.
// Renders the shared contribution-heatmap primitive; the number of weeks
// shown scales with tile width. The API's day array starts on a Sunday, so
// a rows=7 column-major grid lines up as Sun→Sat weeks like GitHub.

export const def = {
  id: 'codeactivity',
  label: 'Code Activity',
  requires: 'codeActivity',
  minSize: { w: 8, h: 3 },
  sizes: {
    S: { w: 10, h: 4 },
    M: { w: 14, h: 5 },
    L: { w: 20, h: 6 }
  },
  defaultSize: 'M',
  variants: {
    trmnl: { label: 'TRMNL — heatmap card' }
  },
  defaultVariant: 'trmnl',
  defaults: () => ({
    variant: 'trmnl',
    username: '',
    title: '',
    fontScale: 1,
    padding: 14
  })
};

export function render(ctx) {
  const { codeActivity: d, settings, cellW, cellH } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'CODE ACTIVITY';

  if (!d || !Array.isArray(d.days) || !d.days.length) {
    const hint = (s.username && s.username.trim())
      ? 'NO DATA' : 'Set a GitHub username in settings';
    return placeholder(titleLabel.split(/\s+/)[0] || 'CODE', hint, 'msg', { cellW, cellH });
  }

  // Weeks to show ≈ tile width; each week is ~12px of column budget.
  const tileW = (cellW || 0) * (800 / 24);
  const weeks = Math.max(8, Math.min(53, Math.round(tileW / 12)));
  const slice = d.days.slice(-weeks * 7);
  // Use the API's precomputed 0-4 level directly (level(v) → v).
  const grid = heatmapHtml({ values: slice.map(x => x.level | 0), rows: 7, level: (v) => v });

  const total = Number.isFinite(d.total) ? d.total : slice.reduce((a, x) => a + (x.count | 0), 0);
  const meta = `${total} contribution${total === 1 ? '' : 's'}${d.stale ? ' · old' : ''}`;
  const who = d.user ? ` · @${escapeHtml(d.user)}` : '';
  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}${who}</span><span class="tr-meta">${escapeHtml(meta)}</span></div>
    <div class="tr-body"><div class="ca-grid">${grid}</div></div>
  </div>`;
}

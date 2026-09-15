import { escapeHtml, pickTier, placeholder, semRed, staleMark } from './_shared.js';

// Tasks — a to-do list from Todoist or an iCal VTODO feed. Fetched +
// normalized server-side (widgets/tasks.js) to ctx.tasks = { items:[{title,
// due, priority}], stale }. render() draws checkbox rows; priority 1 (urgent)
// and overdue items get the semantic red accent.
//
// Contract v2 variants —
//   trmnl   — title-bar card with checkbox rows (default)
//   list    — plain checkbox rows, no card chrome
//   compact — dense rows, due dates dropped

export const def = {
  id: 'tasks',
  label: 'Tasks',
  requires: 'tasks',
  minSize: { w: 6, h: 4 },
  sizes: {
    S: { w: 6,  h: 4 },
    M: { w: 9,  h: 7 },
    L: { w: 12, h: 10 }
  },
  defaultSize: 'M',
  variants: {
    trmnl:   { label: 'TRMNL — title-bar checklist' },
    list:    { label: 'List — checkbox rows' },
    compact: { label: 'Compact — dense rows' }
  },
  defaultVariant: 'list',
  degrade: {
    compact: ['due'],
    tiny:    ['due']
  },
  defaults: () => ({
    variant: 'list',
    source: 'todoist',   // 'todoist' | 'ical'
    token: '',           // Todoist API token
    icalUrl: '',         // source=ical (VTODO feed)
    count: 6,
    showDue: true,
    title: '',
    fontScale: 1,
    padding: 14
  })
};

const ROWS_BY_TIER = { tiny: 2, compact: 3, standard: 5, extended: 7, full: 9 };

// Empty checkbox glyph — solid 2px stroke SVG (threshold + invert safe;
// a CSS-border box can vanish on the panel at small sizes).
const CHECKBOX = '<svg class="task-box" viewBox="0 0 16 16" width="0.95em" height="0.95em" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" fill="none" stroke="#000" stroke-width="2"/></svg>';

export function render(ctx) {
  const { tasks, settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim()) ? s.title.trim() : 'TASKS';
  if (!tasks || !Array.isArray(tasks.items) || !tasks.items.length) {
    const hint = tasks ? 'All clear' : (s.source === 'ical' ? 'Add a feed' : 'Add a token');
    return placeholder('TASKS', hint, 'msg', { cellW, cellH }, tasks ? 'empty' : 'setup');
  }

  const tier = pickTier(cellW || 0, cellH || 0, density);
  const wantCount = Number.isFinite(s.count) ? s.count : 6;
  const maxRows = Math.min(wantCount, ROWS_BY_TIER[tier] || 5, tasks.items.length);
  const items = tasks.items.slice(0, maxRows);
  const showDue = s.showDue !== false && tier !== 'tiny' && tier !== 'compact';
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'trmnl');
  const stale = staleMark(tasks.stale);

  const row = (it) => {
    const urgent = it.priority === 1 || it.due === 'overdue';
    const red = semRed(s, urgent);
    const due = (showDue && it.due)
      ? `<span class="task-due${it.due === 'overdue' ? red : ''}">${escapeHtml(it.due)}</span>` : '';
    return `<div class="task-row">
      ${CHECKBOX}
      <span class="task-title tr-clamp${red}" style="--fit-lines:2">${escapeHtml(it.title)}</span>
      ${due}
    </div>`;
  };
  const rows = items.map(row).join('');

  if (variant === 'trmnl') {
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${items.length} open${stale}</span></div>
      <div class="tr-body" style="gap:0;padding:0"><div class="task-list task-list--trmnl">${rows}</div></div>
    </div>`;
  }
  return `<div class="widget widget-tasks">
    <div class="widget-title">${escapeHtml(titleLabel)}${stale}</div>
    <div class="task-list">${rows}</div>
  </div>`;
}

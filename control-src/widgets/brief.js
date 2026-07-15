import { escapeHtml, placeholder, staleMark } from './_shared.js';

// AI daily brief — ctx.brief = { text, at, stale } from the server
// (widgets/brief.js, one Claude call per day). Serif editorial card:
// reads like the standfirst under a newspaper masthead.

export const def = {
  id: 'brief',
  label: 'Daily Brief',
  requires: null,
  minSize: { w: 8, h: 3 },
  sizes: {
    S: { w: 12, h: 4 },
    M: { w: 16, h: 4 },
    L: { w: 24, h: 5 }
  },
  defaultSize: 'M',
  defaults: () => ({
    title: '',
    fontScale: 1,
    padding: 14
  })
};

export function render(ctx) {
  const { brief, settings, cellW, cellH } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'THE BRIEF';
  if (!brief || !brief.text) {
    return placeholder(titleLabel, 'Set ANTHROPIC_API_KEY on the server', 'msg', { cellW, cellH }, 'setup');
  }
  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">AI${staleMark(brief.stale)}</span></div>
    <div class="tr-body brief-body">
      <div class="brief-text autofit multiline" data-min-font="13">${escapeHtml(brief.text)}</div>
    </div>
  </div>`;
}

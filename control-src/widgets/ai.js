import { escapeHtml, placeholder, pickTier } from './_shared.js';

// AI — the dashboard's own data plus a prompt you write, turned into a few
// lines of text. The server half (widgets/ai.js) does the generating and the
// caching; this only renders what it produced.
//
// No variants, on purpose. Every shape this could take is "some text in a
// card", and the whole point of the 2026-09-15 simplification is that a
// picker between near-identical looks is a cost, not a feature. The one
// setting that matters is the prompt — that IS the customization.

export const def = {
  id: 'ai',
  label: 'AI',
  requires: [],
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 8, h: 3 },
    M: { w: 10, h: 4 },
    L: { w: 14, h: 5 }
  },
  defaultSize: 'M',
  // Reads its own cadence, not ctx.density — the layout is one text block at
  // every size, so the density control would have been another dead knob.
  usesDensity: false,
  defaults: () => ({
    prompt: 'Brief me on today in two short sentences.',
    cadence: 'daily',
    title: '',
    // Extra RSS/Atom feeds to read into the prompt. Data the system cannot
    // know, so it stays a setting — the model has no web access of its own,
    // and these are the only way to point it at a source you care about.
    feedUrls: []
  })
};

// "updated 2h ago" — the reader needs to know how old the thinking is,
// especially on a daily cadence where it could be from this morning.
function ago(at, now) {
  if (!at) return '';
  const mins = Math.max(0, Math.round((now - at) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function render(ctx) {
  const { settings, cellW, cellH } = ctx;
  const s = settings || {};
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const data = ctx.ai || null;
  const tier = pickTier(cellW || 0, cellH || 0);

  if (!s.prompt || !String(s.prompt).trim()) {
    return placeholder('AI', 'Write a prompt', 'msg', { cellW, cellH });
  }
  if (data && data.needsSetup) {
    return placeholder('AI', 'Set AI_API_KEY + AI_MODEL', 'msg', { cellW, cellH });
  }
  if (!data || (!data.text && data.error)) {
    // Only reachable before the first successful generation — after that the
    // server serves the last good text rather than surfacing an error.
    //
    // Show the provider's own words, trimmed. "Generation failed" told the
    // reader nothing and sent them to /status to find out what a wrong model
    // id or an empty balance looks like; the reason belongs where the problem
    // is visible. Provider error bodies carry the status and message, never
    // the API key.
    const why = data && data.error
      ? String(data.error).replace(/\s+/g, ' ').slice(0, 90)
      : 'Waiting…';
    return placeholder('AI', why, 'msg', { cellW, cellH });
  }
  if (!data.text) {
    return placeholder('AI', 'Waiting…', 'msg', { cellW, cellH });
  }

  const title = s.title ? escapeHtml(s.title) : 'AI';
  // Stale means the last refresh attempt failed and this is the previous
  // answer — worth saying quietly so old text isn't read as current.
  const meta = [data.stale ? 'offline' : '', ago(data.at, now)]
    .filter(Boolean).join(' · ');

  const body = escapeHtml(data.text).replace(/\n+/g, '<br>');

  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${title}</span>${
      meta && tier !== 'tiny' ? `<span class="tr-meta">${escapeHtml(meta)}</span>` : ''
    }</div>
    <div class="tr-body">
      <div class="ai-text autofit multiline" data-min-font="12" data-max-font="24">${body}</div>
    </div>
  </div>`;
}

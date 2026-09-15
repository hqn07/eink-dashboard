import { escapeHtml } from './_shared.js';

// Art — deterministic generative patterns for e-ink. No fetcher, no
// config required: the pattern is seeded from the local date (plus a
// per-tile seed offset), so every day the panel wakes up to a fresh
// piece and every render of the same day is bit-identical (visual
// regression + preview parity for free).
//
// Two families, both natively 1-bit:
//   hitomezashi — Japanese stitch pattern from two boolean sequences
//   truchet     — quarter-circle tiles on a grid, classic Smith tiles

export const def = {
  id: 'art',
  // No tier response — art sizes off its own numeric `density` (grid
  // fineness), not ctx.density, so the modal's Layout-density control is
  // hidden to avoid a dead knob that also collides with that setting.
  usesDensity: false,
  label: 'Daily Art',
  requires: null,
  minSize: { w: 4, h: 3 },
  sizes: {
    S:  { w: 8,  h: 6 },
    M:  { w: 12, h: 12 },
    XL: { w: 24, h: 12 }
  },
  defaultSize: 'M',
  variants: {
    hitomezashi: { label: 'Hitomezashi — stitch weave' },
    truchet:     { label: 'Truchet — quarter-circle tiles' }
  },
  defaultVariant: 'hitomezashi',
  defaults: () => ({
    variant: 'hitomezashi',
    seed: 0,           // extra offset so two tiles differ on the same day
    density: 22,       // approximate cell size in px (smaller = finer)
    showDate: false,   // small corner date stamp
  })
};

// Deterministic PRNG (mulberry32) — same seed, same art, any surface.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seed from the local date in the dashboard's timezone + user offset.
function daySeed(ctx, extra) {
  const tz = (ctx.cfg && ctx.cfg.timezone) || 'UTC';
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  let key;
  try {
    key = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(now));
  } catch {
    key = new Date(now).toDateString();
  }
  let h = 2166136261;
  for (const c of key) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h ^ (extra * 0x9E3779B9)) >>> 0;
}

const CELL_W = 800 / 24, CELL_H = 480 / 12;

function hitomezashi(w, h, step, rand) {
  // Two boolean sequences (row offsets, column offsets) generate the
  // whole pattern — dashes alternate, offset by the sequence bit.
  const cols = Math.ceil(w / step) + 1;
  const rows = Math.ceil(h / step) + 1;
  const rowBits = Array.from({ length: rows }, () => rand() < 0.5);
  const colBits = Array.from({ length: cols }, () => rand() < 0.5);
  let d = '';
  for (let r = 0; r < rows; r++) {
    const y = r * step;
    for (let c = rowBits[r] ? 0 : 1; c < cols; c += 2) {
      d += `M${c * step} ${y}h${step}`;
    }
  }
  for (let c = 0; c < cols; c++) {
    const x = c * step;
    for (let r = colBits[c] ? 0 : 1; r < rows; r += 2) {
      d += `M${x} ${r * step}v${step}`;
    }
  }
  return `<path d="${d}" stroke="#000" stroke-width="2.5" fill="none" stroke-linecap="square"/>`;
}

function truchet(w, h, step, rand) {
  const cols = Math.ceil(w / step);
  const rows = Math.ceil(h / step);
  const r = step / 2;
  let d = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * step, y = row * step;
      if (rand() < 0.5) {
        // arcs: top-left + bottom-right corners
        d += `M${x + r} ${y}A${r} ${r} 0 0 0 ${x} ${y + r}`;
        d += `M${x + step} ${y + r}A${r} ${r} 0 0 0 ${x + r} ${y + step}`;
      } else {
        // arcs: top-right + bottom-left corners
        d += `M${x + r} ${y}A${r} ${r} 0 0 1 ${x + step} ${y + r}`;
        d += `M${x} ${y + r}A${r} ${r} 0 0 1 ${x + r} ${y + step}`;
      }
    }
  }
  return `<path d="${d}" stroke="#000" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
}

export function render(ctx) {
  const s = ctx.settings || {};
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'hitomezashi');
  const pxW = Math.round((ctx.cellW || 12) * CELL_W);
  const pxH = Math.round((ctx.cellH || 12) * CELL_H);
  const step = Math.max(12, Math.min(48, Number.isFinite(s.density) ? s.density : 22));
  const rand = rng(daySeed(ctx, Number.isFinite(s.seed) ? s.seed : 0) ^ (variant === 'truchet' ? 0x51ab : 0));
  const body = variant === 'truchet'
    ? truchet(pxW, pxH, step, rand)
    : hitomezashi(pxW, pxH, step, rand);
  let stamp = '';
  if (s.showDate) {
    const tz = (ctx.cfg && ctx.cfg.timezone) || 'UTC';
    let label = '';
    try {
      label = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' })
        .format(new Date(Number.isFinite(ctx.now) ? ctx.now : Date.now()));
    } catch { /* skip stamp */ }
    if (label) stamp = `<div class="art-stamp">${escapeHtml(label.toUpperCase())}</div>`;
  }
  return `
    <div class="widget widget-art">
      <svg class="art-svg" viewBox="0 0 ${pxW} ${pxH}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${body}</svg>
      ${stamp}
    </div>
  `;
}

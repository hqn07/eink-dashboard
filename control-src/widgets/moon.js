import { escapeHtml, pickTier, placeholder } from './_shared.js';
import { MOON_IMAGE } from './_moon-image.js';

// Moon phase — computed from the date, no fetcher. `now` comes from
// ctx.now when present (frozen demo → deterministic matrix /
// visual-regression) else Date.now() on the live face.
//
// Contract v2 (widgets-refresh W2): variants —
//   disc    — big illuminated disc + phase name (default)
//   detail  — disc left, name + illumination % + age right
//   minimal — disc + name only
//
// The disc is a 1-bit SVG: lit area solid black, the rest the white
// paper, full limb outlined. Geometry verified at all eight phases
// (see the moon-phase test) so this can't regress into the kind of
// mis-drawn icon the old client-side renderer produced.

const SYNODIC = 29.530588853;            // mean synodic month (days)
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14, 0); // known new moon

export function moonInfo(now) {
  const days = (now - NEW_MOON_REF) / 86400000;
  let p = (days % SYNODIC) / SYNODIC;    // phase fraction 0..1
  if (p < 0) p += 1;
  const illum = (1 - Math.cos(2 * Math.PI * p)) / 2; // 0..1
  return { p, age: p * SYNODIC, illum, waxing: p < 0.5, name: phaseName(p) };
}

function phaseName(p) {
  // ±~1 day windows around the four principal phases.
  if (p < 0.0345 || p >= 0.9655) return 'NEW MOON';
  if (p < 0.2155) return 'WAXING CRESCENT';
  if (p < 0.2845) return 'FIRST QUARTER';
  if (p < 0.4655) return 'WAXING GIBBOUS';
  if (p < 0.5345) return 'FULL MOON';
  if (p < 0.7155) return 'WANING GIBBOUS';
  if (p < 0.7845) return 'LAST QUARTER';
  return 'WANING CRESCENT';
}

// Unique-id counter so multiple discs on one page (matrix / preview) don't
// share <clipPath> ids. Deterministic within a render pass (order is
// stable), so visual-regression stays byte-stable.
let discUid = 0;

// SVG for the illuminated disc. size px square.
//   Polarity: the moon face is LIGHT, the shadow DARK. On white paper the
//   shadow is a solid-black region and the lit face shows a real dithered
//   near-side photo (MOON_IMAGE) — so a full moon reads as a bright
//   cratered disc, a new moon as a black disc (matches the sky, and fixes
//   the old inverted fill where 99% came out near-solid black). Only the
//   illuminated side shows the surface (clipped to the terminator), as in
//   reality. The photo is a pre-dithered 1-bit PNG rendered with
//   image-rendering:pixelated (see 036-moon.css) so downscaling stays pure
//   black/white — no greys for the panel's threshold(128) to mangle.
// The lit region = a semicircle on the illuminated limb + a half-ellipse
// terminator whose x-radius shrinks to 0 at the quarters and flips sign
// through the gibbous phases.
export function moonSvg(size, illum, waxing) {
  const R = size / 2, cx = R, cy = R;
  const k = Math.max(0, Math.min(1, illum));
  const rx = R * Math.abs(1 - 2 * k);    // terminator semi-width
  const gibbous = k > 0.5;
  const limbSweep = waxing ? 1 : 0;      // waxing lights the right
  const termSweep = waxing ? (gibbous ? 1 : 0) : (gibbous ? 0 : 1);
  const lit = `M ${cx} ${cy - R}
    A ${R} ${R} 0 0 ${limbSweep} ${cx} ${cy + R}
    A ${rx} ${R} 0 0 ${termSweep} ${cx} ${cy - R} Z`;

  const id = `mn${discUid++}`;
  return `<svg class="moon-disc" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <defs>
      <clipPath id="${id}c"><path d="${lit}"/></clipPath>
      <clipPath id="${id}d"><circle cx="${cx}" cy="${cy}" r="${R - 1}"/></clipPath>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${R - 1}" fill="#000"/>
    <g clip-path="url(#${id}c)">
      <image href="${MOON_IMAGE}" x="0" y="0" width="${size}" height="${size}"
        clip-path="url(#${id}d)" preserveAspectRatio="xMidYMid slice"/>
    </g>
    <circle cx="${cx}" cy="${cy}" r="${R - 1}" fill="none" stroke="#000" stroke-width="2"/>
  </svg>`;
}

export const def = {
  id: 'moon',
  label: 'Moon Phase',
  minSize: { w: 6, h: 4 },
  sizes: {
    S: { w: 6, h: 4 },
    M: { w: 8, h: 4 },
    L: { w: 8, h: 6 }
  },
  defaultSize: 'M',
  variants: {
    trmnl:   { label: 'TRMNL — title-bar card' },
    flow:    { label: 'Flow — phase filmstrip (today centered)' },
    disc:    { label: 'Disc — moon + phase name' },
    detail:  { label: 'Detail — moon + illumination + age' },
    minimal: { label: 'Minimal — disc + name' }
  },
  defaultVariant: 'trmnl',
  degrade: {
    tiny: ['name', 'stats']
  },
  defaults: () => ({
    variant: 'trmnl',
    title: '',
    fontScale: 1,
    padding: 14
  })
};

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'MOON';
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const m = moonInfo(now);
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'disc');
  const tier = pickTier(cellW || 0, cellH || 0, density);

  const pct = Math.round(m.illum * 100);
  const age = Math.round(m.age);
  const name = `<div class="moon-name">${escapeHtml(m.name)}</div>`;

  if (variant === 'flow') {
    // Phase filmstrip: today's disc big in the middle, the days before/after
    // shrinking outward — a flat "cover-flow" that reads the cycle at a
    // glance. Wide tiles get ±2 days, narrower ones ±1.
    const DAY = 86400000;
    const big = tier === 'tiny' ? 54 : ((cellH || 0) >= 7 ? 112 : 84);
    const near = Math.round(big * 0.6);
    const far = Math.round(big * 0.4);
    const perSide = (cellW || 0) >= 16 ? 2 : 1;
    const offsets = perSide === 2 ? [-2, -1, 0, 1, 2] : [-1, 0, 1];
    const sizeFor = (o) => (o === 0 ? big : Math.abs(o) === 1 ? near : far);
    const cells = offsets.map((o) => {
      const mi = moonInfo(now + o * DAY);
      const cap = o === 0
        ? `<div class="moon-flow-cap"><span class="moon-flow-pct">${Math.round(mi.illum * 100)}%</span><span class="moon-flow-name">${escapeHtml(mi.name)}</span></div>`
        : '';
      return `<div class="moon-flow-cell${o === 0 ? ' moon-flow-now' : ''}">${moonSvg(sizeFor(o), mi.illum, mi.waxing)}${cap}</div>`;
    }).join('');
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>Moon</span><span class="tr-meta">${escapeHtml(m.name)}</span></div>
      <div class="tr-body" style="justify-content:center"><div class="moon-flow">${cells}</div></div>
    </div>`;
  }

  if (variant === 'trmnl') {
    const disc = moonSvg(tier === 'tiny' ? 56 : 88, m.illum, m.waxing);
    const stats = (cellH || 0) >= 6
      ? `<div class="tr-stats">
           <div class="tr-stat"><div class="tr-sv">${age}</div><div class="tr-sl">Day of 29</div></div>
           <div class="tr-stat"><div class="tr-sv">${m.waxing ? 'Waxing' : 'Waning'}</div><div class="tr-sl">Trend</div></div>
         </div>` : '';
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>Moon</span><span class="tr-meta">${escapeHtml(m.name)}</span></div>
      <div class="tr-body">
        <div style="display:flex;align-items:center;gap:16px;flex:1">
          <div style="flex:none">${disc}</div>
          <div class="tr-lv tr-lv-md"><div class="tr-v">${pct}<span class="tr-deg">%</span></div><div class="tr-l">Illuminated</div></div>
        </div>
        ${stats}
      </div>
    </div>`;
  }

  if (variant === 'detail') {
    const disc = moonSvg(tier === 'tiny' ? 56 : 96, m.illum, m.waxing);
    return `
      <div class="moon moon-detail">
        ${disc}
        <div class="moon-meta">
          ${tier !== 'tiny' ? `<div class="col-title">${escapeHtml(titleLabel)}</div>` : ''}
          ${name}
          <div class="moon-stat">${pct}% LIT</div>
          <div class="moon-stat">DAY ${age} OF 29</div>
        </div>
      </div>
    `;
  }

  // disc + minimal share the centered layout; minimal just hides the
  // heading. Both scale the disc to the cell.
  const discSize = tier === 'tiny' ? 64 : (tier === 'compact' ? 88 : 120);
  return `
    <div class="moon moon-disc-layout">
      ${(variant === 'disc' && tier !== 'tiny') ? `<div class="col-title">${escapeHtml(titleLabel)}</div>` : ''}
      ${moonSvg(discSize, m.illum, m.waxing)}
      ${tier !== 'tiny' ? name : ''}
    </div>
  `;
}

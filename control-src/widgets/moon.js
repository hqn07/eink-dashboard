import { escapeHtml, pickTier, placeholder } from './_shared.js';

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

// SVG for the illuminated disc. size px square; lit area filled #000.
// The lit region = a semicircle on the illuminated limb + a half-
// ellipse terminator whose x-radius shrinks to 0 at the quarters and
// flips sign through the gibbous phases.
export function moonSvg(size, illum, waxing) {
  const R = size / 2, cx = R, cy = R;
  const k = Math.max(0, Math.min(1, illum));
  const rx = R * Math.abs(1 - 2 * k);    // terminator semi-width
  const gibbous = k > 0.5;
  // Lit limb: waxing lights the right (sweep 1), waning the left (0).
  const limbSweep = waxing ? 1 : 0;
  // Terminator curves toward the dark side for a crescent, away for a
  // gibbous; mirrored for waning.
  const termSweep = waxing ? (gibbous ? 1 : 0) : (gibbous ? 0 : 1);
  const lit = `M ${cx} ${cy - R}
    A ${R} ${R} 0 0 ${limbSweep} ${cx} ${cy + R}
    A ${rx} ${R} 0 0 ${termSweep} ${cx} ${cy - R} Z`;
  return `<svg class="moon-disc" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="${R - 1}" fill="#fff" stroke="#000" stroke-width="2"/>
    <path d="${lit}" fill="#000"/>
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
    disc:    { label: 'Disc — moon + phase name' },
    detail:  { label: 'Detail — moon + illumination + age' },
    minimal: { label: 'Minimal — disc + name' }
  },
  defaultVariant: 'disc',
  degrade: {
    tiny: ['name', 'stats']
  },
  defaults: () => ({
    variant: 'disc',
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

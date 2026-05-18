// Moon phase + sun calc. No API needed.
// Phase algo: simple synodic-period approximation against a known new moon.
// Accuracy ~1 day, plenty for a kitchen dashboard.

const PHASE_NAMES = [
  'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'
];

// Reference new moon: 2000-01-06 18:14 UTC.
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0) / 1000;
const SYNODIC_DAYS = 29.530588853;

function phaseFraction(date = new Date()) {
  const t = date.getTime() / 1000;
  const days = (t - REF_NEW_MOON) / 86400;
  let frac = (days % SYNODIC_DAYS) / SYNODIC_DAYS;
  if (frac < 0) frac += 1;
  return frac;
}

function nameForFraction(f) {
  if (f < 0.03 || f > 0.97) return PHASE_NAMES[0];
  if (f < 0.22) return PHASE_NAMES[1];
  if (f < 0.28) return PHASE_NAMES[2];
  if (f < 0.47) return PHASE_NAMES[3];
  if (f < 0.53) return PHASE_NAMES[4];
  if (f < 0.72) return PHASE_NAMES[5];
  if (f < 0.78) return PHASE_NAMES[6];
  return PHASE_NAMES[7];
}

// Render a moon disc as inline SVG. White-on-black, suitable for e-ink.
function moonSvg(fraction) {
  const r = 28;
  const cx = 32, cy = 32;
  // Illumination: 0=new, 0.5=full, 1=new again.
  // For waxing (f<0.5), bright on the right; waning on the left.
  let illum;
  if (fraction < 0.5) {
    illum = fraction * 2; // 0..1
  } else {
    illum = (1 - fraction) * 2;
  }
  // Width of bright crescent's inner edge (offset from center).
  const offset = (1 - illum) * r;
  const waxing = fraction < 0.5;

  // SVG with two arcs forming the lit portion.
  // Background disc = black, lit area filled with white.
  // Use a path approximating the lit shape:
  // M cx, cy-r → arc to cx, cy+r (right side) → arc back via ellipse with offset.
  const sweepOuter = 1;
  const sweepInner = waxing ? 0 : 1;
  const ellipseRx = Math.abs(offset);
  const path = `
    M ${cx},${cy - r}
    A ${r},${r} 0 ${waxing ? 1 : 0} ${sweepOuter} ${cx},${cy + r}
    A ${ellipseRx},${r} 0 ${waxing ? 1 : 0} ${sweepInner} ${cx},${cy - r}
    Z
  `;
  return `
    <svg viewBox="0 0 64 64" width="56" height="56">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#000" stroke="#000" stroke-width="1"/>
      <path d="${path}" fill="#fff"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000" stroke-width="1.5"/>
    </svg>
  `;
}

function buildMoonSun(weather) {
  const f = phaseFraction(new Date());
  const illuminationPct = Math.round(
    f <= 0.5 ? f * 2 * 100 : (1 - f) * 2 * 100
  );
  return {
    phase: nameForFraction(f).toUpperCase(),
    fraction: f,
    illuminationPct,
    moonSvg: moonSvg(f),
    sunrise: (weather && weather.sunrise) || '--:--',
    sunset:  (weather && weather.sunset)  || '--:--'
  };
}

module.exports = { buildMoonSun };

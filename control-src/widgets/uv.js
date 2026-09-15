import { escapeHtml, placeholder, pickTier, gaugeHtml } from './_shared.js';

// UV index — server fetches Open-Meteo into ctx.uv = { uv, uvMax, stale }.
// Two variants: `gauge` (ring dial, number in the middle) and `scale`
// (WHO band strip with a position marker — the five bands rendered as an
// escalating dither ramp so severity reads as darkness, not color).

export const def = {
  id: 'uv',
  label: 'UV Index',
  requires: [],
  minSize: { w: 5, h: 3 },
  sizes: {
    S: { w: 6, h: 4 },
    M: { w: 8, h: 5 },
    L: { w: 10, h: 6 }
  },
  defaultSize: 'S',
  variants: {
    gauge: { label: 'Gauge — ring dial' }
  },
  defaultVariant: 'gauge',
  defaults: () => ({
    variant: 'gauge',
    title: '',
  })
};

// WHO exposure categories. Tones escalate with severity so the scale
// variant reads as a darkness ramp on 1-bit ink.
const BANDS = [
  { max: 2,        label: 'LOW',       tone: 'face-tone-g15' },
  { max: 5,        label: 'MODERATE',  tone: 'face-tone-g25' },
  { max: 7,        label: 'HIGH',      tone: 'face-tone-g50' },
  { max: 10,       label: 'VERY HIGH', tone: 'face-tone-g75' },
  { max: Infinity, label: 'EXTREME',   tone: 'face-tone-g87' }
];
// WHO categories are defined on the rounded index (a 2.4 reading is
// still "low"), so band on Math.round.
function bandFor(uv) {
  const r = Math.round(uv);
  return BANDS.find(b => r <= b.max) || BANDS[BANDS.length - 1];
}

// The scale caps at 11+ (WHO "extreme"); higher readings pin the marker.
const SCALE_MAX = 11;

function scaleHtml(uv, scalePct) {
  const pos = Math.max(0, Math.min(100, (uv / SCALE_MAX) * 100));
  // Five band segments, widths proportional to their WHO ranges (0-2,
  // 3-5, 6-7, 8-10, 11+ → 2/11, 3/11, 2/11, 3/11, 1/11 of the strip).
  const widths = [2, 3, 2, 3, 1].map(w => (w / SCALE_MAX) * 100);
  const segs = BANDS.map((b, i) =>
    `<div class="${b.tone}" style="width:${widths[i]}%;height:100%"></div>`).join('');
  return `
    <div style="position:relative;padding-top:14px">
      <div style="position:absolute;top:0;left:${pos}%;transform:translateX(-50%);font-size:${Math.round(14 * scalePct)}px;line-height:1">▼</div>
      <div class="tr-bar" style="height:18px;display:flex">${segs}</div>
      <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:600;letter-spacing:0.5px;margin-top:3px">
        <span>0</span><span>3</span><span>6</span><span>8</span><span>11+</span>
      </div>
    </div>`;
}

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const uvData = ctx.uv;
  const tier = pickTier(cellW || 0, cellH || 0, density);
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'gauge');
  const scale = Number.isFinite(s.fontScale) ? s.fontScale : 1;
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'UV INDEX';

  if (!uvData || !Number.isFinite(uvData.uv)) {
    return placeholder('UV', 'Waiting for Open-Meteo — needs a dashboard location.');
  }

  const uv = uvData.uv;
  const band = bandFor(uv);
  const uvTxt = uv < 10 ? uv.toFixed(1) : String(Math.round(uv));
  const peakNum = Number.isFinite(uvData.uvMax)
    ? (uvData.uvMax < 10 ? uvData.uvMax.toFixed(1) : String(Math.round(uvData.uvMax))) : '';
  const peak = peakNum ? `peak today ${peakNum}` : '';
  const showFoot = tier !== 'tiny' && (cellH || 0) >= 5;

  let body, bodyStyle;
  if (variant === 'scale') {
    bodyStyle = 'flex-direction:column;justify-content:center';
    body = `
      <div class="tr-lv tr-lv-md" style="margin-bottom:4px">
        <div class="tr-v">${uvTxt}</div>
        <div class="tr-l">${band.label}</div>
      </div>
      ${scaleHtml(uv, scale)}`;
  } else {
    // Gauge sits DIRECTLY in .tr-body — its height:100% + aspect-ratio
    // sizing needs the body as its box (wrapping it in another flex row
    // breaks the chain and the SVG blows past the card).
    bodyStyle = 'justify-content:center;align-items:center';
    body = gaugeHtml({
      value: uv, max: SCALE_MAX, center: uvTxt, label: band.label,
      size: (cellH || 0) >= 6 ? 'lg' : (cellH || 0) >= 5 ? 'md' : 'sm'
    });
  }

  // The peak lives in the foot; on short tiles (foot hidden — including
  // the default S) it moves to the title-bar meta so a nighttime "0.0"
  // still tells you what the day holds.
  const meta = showFoot
    ? (uvData.stale ? 'cached' : 'now')
    : (peakNum ? `peak ${peakNum}` : (uvData.stale ? 'cached' : 'now'));
  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${escapeHtml(meta)}</span></div>
    <div class="tr-body" style="${bodyStyle}">${body}</div>
    ${showFoot ? `<div class="tr-foot"><span class="tr-foot-name">UV</span><span>${escapeHtml(peak || 'Open-Meteo')}</span></div>` : ''}
  </div>`;
}

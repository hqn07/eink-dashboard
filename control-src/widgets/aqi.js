import { escapeHtml, pickTier, placeholder, semRed, gaugeHtml } from './_shared.js';

// Air Quality (US AQI). Data comes from widgets/aqi.js (server) on
// ctx.aqi: { aqi, band, bands, label, pm25, pm10, o3, no2, stale }.
//
// Contract v2 (widgets-refresh W2): three layout variants —
//   big     — big AQI number, category word, pollutant line (the default)
//   bar     — number + category over a 6-segment Good→Hazardous scale
//             with the current band filled
//   minimal — number + category only
// Tier gates the pollutant line + (on big) the category off the
// smallest tiles so the number keeps the cell.

export const def = {
  id: 'aqi',
  label: 'Air Quality',
  requires: 'aqi',
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 6, h: 4 },
    M: { w: 8, h: 4 },
    L: { w: 8, h: 6 }
  },
  defaultSize: 'M',
  variants: {
    trmnl:   { label: 'TRMNL — title-bar card' },
    gauge:   { label: 'Gauge — ring dial' },
    big:     { label: 'Big — number + category' },
    bar:     { label: 'Bar — number over a scale' },
    minimal: { label: 'Minimal — number + category only' }
  },
  defaultVariant: 'trmnl',
  degrade: {
    compact: ['pollutants'],
    tiny:    ['pollutants', 'title', 'category']
  },
  defaults: () => ({
    variant: 'trmnl',
    title: '',
    showPollutants: true,
    fontScale: 1,
    padding: 14
  })
};

// 6-segment scale; segments up to + including the active band are
// filled, the active one carries an extra marker class for emphasis.
function scaleHtml(band, bands) {
  const n = bands || 6;
  let segs = '';
  for (let i = 0; i < n; i++) {
    const on = i <= band ? ' aqi-seg-on' : '';
    const cur = i === band ? ' aqi-seg-cur' : '';
    segs += `<span class="aqi-seg${on}${cur}"></span>`;
  }
  return `<div class="aqi-scale">${segs}</div>`;
}

export function render(ctx) {
  const { aqi: a, settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'AIR QUALITY';
  if (!a || !Number.isFinite(a.aqi)) {
    return placeholder(titleLabel.split(/\s+/)[0] || 'AQI', 'No data', 'msg', { cellW, cellH }, 'nodata');
  }
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'big');
  const tier = pickTier(cellW || 0, cellH || 0, density);

  // Semantic auto-red: band >= 3 is "Unhealthy" or worse on the 6-step
  // Good→Hazardous scale — exactly what AQI color-coding signals.
  const danger = semRed(s, Number.isFinite(a.band) && a.band >= 3);
  const num = `<div class="aqi-num autofit${danger}" data-min-font="22">${a.aqi}</div>`;
  const numInline = `<span class="aqi-num${danger}">${a.aqi}</span>`;
  const cat = `<div class="aqi-cat${danger}">${escapeHtml(a.label || '')}</div>`;
  const title = `<div class="col-title">${escapeHtml(titleLabel)}</div>`;
  const stale = a.stale ? '<span class="aqi-stale">OLD</span>' : '';

  // Pollutant breakdown — only the two the US AQI is usually driven by.
  const parts = [];
  if (Number.isFinite(a.pm25)) parts.push(`PM2.5 ${a.pm25}`);
  if (Number.isFinite(a.pm10)) parts.push(`PM10 ${a.pm10}`);
  const showPollutants = tier !== 'tiny' && tier !== 'compact'
    && s.showPollutants !== false && parts.length;
  const sub = showPollutants
    ? `<div class="aqi-sub">${escapeHtml(parts.join(' · '))}</div>` : '';

  if (variant === 'gauge') {
    // Ring dial: arc caps at 300 (the Hazardous threshold) so the sweep
    // stays meaningful; center = AQI number, band word under it. Danger
    // bands ride the arc + number on the red plane.
    const isDanger = !!danger;
    const gauge = gaugeHtml({
      value: a.aqi, max: 300, center: a.aqi,
      label: a.label || '', red: isDanger,
      size: (cellH || 0) >= 6 ? 'lg' : 'md'
    });
    const stats = (cellH || 0) >= 6 && parts.length
      ? `<div class="tr-stats">${parts.map(p => {
          const i = p.lastIndexOf(' ');
          return `<div class="tr-stat"><div class="tr-sv">${escapeHtml(p.slice(i + 1))}</div><div class="tr-sl">${escapeHtml(p.slice(0, i))}</div></div>`;
        }).join('')}</div>` : '';
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">US AQI${a.stale ? ' · old' : ''}</span></div>
      <div class="tr-body" style="justify-content:center;align-items:center">${gauge}</div>
      ${stats}
    </div>`;
  }

  if (variant === 'trmnl') {
    const redStyle = danger ? 'color:var(--face-red);' : '';
    const stats = (cellH || 0) >= 6 && parts.length
      ? `<div class="tr-stats">${parts.map(p => {
          const i = p.lastIndexOf(' ');
          return `<div class="tr-stat"><div class="tr-sv">${escapeHtml(p.slice(i + 1))}</div><div class="tr-sl">${escapeHtml(p.slice(0, i))}</div></div>`;
        }).join('')}</div>` : '';
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${escapeHtml(a.label || '')}${a.stale ? ' · old' : ''}</span></div>
      <div class="tr-body" style="justify-content:center;gap:8px">
        <div class="tr-lv"><div class="tr-v" style="${redStyle}">${a.aqi}</div><div class="tr-l">US AQI</div></div>
        ${scaleHtml(a.band, a.bands)}
      </div>
      ${stats}
    </div>`;
  }

  if (variant === 'minimal') {
    return `<div class="aqi aqi-minimal">${num}${tier !== 'tiny' ? cat : ''}</div>`;
  }

  if (variant === 'bar') {
    return `
      <div class="aqi aqi-bar">
        ${tier !== 'tiny' ? title : ''}
        <div class="aqi-bar-head">${numInline}<span class="aqi-cat${danger}">${escapeHtml(a.label || '')}</span>${stale}</div>
        ${scaleHtml(a.band, a.bands)}
        ${sub}
      </div>
    `;
  }

  // big
  return `
    <div class="aqi aqi-big">
      ${tier !== 'tiny' ? `<div class="aqi-head">${title}${stale}</div>` : ''}
      ${num}
      ${tier !== 'tiny' ? cat : ''}
      ${sub}
    </div>
  `;
}

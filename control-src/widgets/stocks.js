import { escapeHtml, pickTier, placeholder } from './_shared.js';

export const def = {
  id: 'stocks',
  label: 'Stocks / Crypto',
  requires: 'stocks',
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 8, h: 4 },
    M: { w: 12, h: 6 },
    L: { w: 24, h: 6 },
    XL: { w: 24, h: 12 }
  },
  defaultSize: 'M',
  defaults: () => ({
    symbols: [],
    title: '',
    layout: 'hero_watch',  // 'hero_watch' | 'list_only' | 'hero_only'
    sparkStyle: 'line',    // 'line' | 'bars' | 'area'
    showSpark:  true,
    showChange: true,
    fontScale: 1,
    padding: 14
  })
};

function spark(points, opts) {
  if (!Array.isArray(points) || points.length < 2) return '';
  const vbW = 100, vbH = 30, pad = 1;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const cls = (opts && opts.cls) || 'stock-spark';
  const styles = (opts && opts.style) || '';
  const sw = (opts && opts.stroke) || 2;
  const variant = (opts && opts.variant) || 'line';
  const wrap = (body) => `<svg class="${cls}" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="none" style="${styles}">${body}</svg>`;
  const xs = points.map((_, i) => pad + i * ((vbW - pad * 2) / (points.length - 1)));
  const ys = points.map(v => pad + (vbH - pad * 2) * (1 - (v - min) / range));
  if (variant === 'bars') {
    const colW = (vbW - pad * 2) / points.length;
    const barW = Math.max(0.6, colW * 0.7);
    const baseY = vbH - pad;
    const rects = points.map((_, i) => {
      const x = pad + i * colW + (colW - barW) / 2;
      const y = ys[i];
      const h = Math.max(0.5, baseY - y);
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" fill="#000"/>`;
    }).join('');
    return wrap(rects);
  }
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const stroke = `<path d="${path}" fill="none" stroke="#000" stroke-width="${sw}" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (variant === 'area') {
    const baseY = (vbH - pad).toFixed(1);
    const areaPath = `${path} L${xs[xs.length - 1].toFixed(1)},${baseY} L${xs[0].toFixed(1)},${baseY} Z`;
    return wrap(`<path d="${areaPath}" fill="#000" fill-opacity="0.18"/>${stroke}`);
  }
  return wrap(stroke);
}

const dirArrow = v => v >= 0 ? '▲' : '▼';
const dirCls   = v => v >= 0 ? 'up' : 'down';

function heroBlock(hero, t) {
  const heroChg = t.heroChg && Number.isFinite(hero.change)
    ? `<span class="hero-chg ${dirCls(hero.change)}">${dirArrow(hero.change)} ${Math.abs(hero.change).toFixed(2)} (${hero.change >= 0 ? '+' : '−'}${Math.abs(hero.changePct).toFixed(2)}%)</span>`
    : '';
  const heroMeta = t.heroMeta && (hero.dayHigh || hero.dayLow)
    ? `<div class="hero-meta">${hero.dayHigh ? `H ${hero.dayHigh}` : ''}${hero.dayHigh && hero.dayLow ? ' · ' : ''}${hero.dayLow ? `L ${hero.dayLow}` : ''}</div>`
    : '';
  const heroSparkHtml = t.heroSpark
    ? spark(hero.spark, { cls: 'hero-spark', stroke: 2.5, style: 'flex:1;min-height:0;width:100%', variant: t.sparkVariant })
    : '';
  return `
    <div class="stock-hero">
      <div class="hero-top">
        <span class="hero-sym">${escapeHtml(hero.symbol)}</span>
        ${heroChg}
      </div>
      <div class="hero-price autofit" data-min-font="22">${hero.price}</div>
      ${heroMeta}
      ${heroSparkHtml}
    </div>`;
}

// Watchlist row — adopts the shared .item primitive. Symbol fills the
// meta slot, sparkline takes the content slot, price + change stack
// in trailing. Drops the old .stock-watch-row 4-column grid.
function watchRow(s, t) {
  const sparkHtml = t.watchSpark
    ? spark(s.spark, { cls: 'watch-spark', stroke: 2, style: 'height:18px;width:100%', variant: t.sparkVariant })
    : '';
  const chgHtml = t.watchChg
    ? `<div class="stock-chg ${dirCls(s.change)}">${dirArrow(s.change)} ${Math.abs(s.changePct).toFixed(2)}%</div>`
    : '';
  return `
    <div class="item stock-row">
      <div class="meta stock-sym">${escapeHtml(s.symbol)}</div>
      <div class="content">${sparkHtml}</div>
      <div class="trailing stock-trailing">
        <div class="stock-price">${s.price}</div>
        ${chgHtml}
      </div>
    </div>`;
}

export function render({ stocks, settings, cellW, cellH, density }) {
  const list = stocks || [];
  const titleLabel = (settings && typeof settings.title === 'string' && settings.title.trim())
    ? settings.title.trim()
    : 'MARKETS';
  if (!list.length) return placeholder(titleLabel, 'Add symbols (AAPL, BTC-USD) in settings', 'stocks');
  const tier = pickTier(cellW, cellH, density);
  const matrix = {
    tiny:     { watch: 0, heroSpark: false, heroMeta: false, heroChg: false, watchSpark: false, watchChg: false },
    compact:  { watch: 0, heroSpark: true,  heroMeta: false, heroChg: true,  watchSpark: false, watchChg: false },
    standard: { watch: 3, heroSpark: true,  heroMeta: true,  heroChg: true,  watchSpark: true,  watchChg: true  },
    extended: { watch: 5, heroSpark: true,  heroMeta: true,  heroChg: true,  watchSpark: true,  watchChg: true  },
    full:     { watch: 7, heroSpark: true,  heroMeta: true,  heroChg: true,  watchSpark: true,  watchChg: true  }
  };
  const tBase = matrix[tier];
  const s = settings || {};
  const layout = s.layout || 'hero_watch';
  // Apply per-tile show toggles on top of the tier-level matrix; toggle
  // can only HIDE, not force-show on a tier that wouldn't allow it.
  const t = {
    ...tBase,
    heroSpark:  tBase.heroSpark  && s.showSpark  !== false,
    watchSpark: tBase.watchSpark && s.showSpark  !== false,
    heroChg:    tBase.heroChg    && s.showChange !== false,
    watchChg:   tBase.watchChg   && s.showChange !== false,
    sparkVariant: (s.sparkStyle === 'bars' || s.sparkStyle === 'area') ? s.sparkStyle : 'line'
  };

  if (layout === 'list_only') {
    // Treat every symbol equally; no hero. Renders as many rows as the
    // tier matrix allows (hero + watch count, inclusive).
    const rowCount = 1 + t.watch;
    const rows = list.slice(0, rowCount);
    return `
      <div class="widget widget-stocks stocks-list-mode">
        <div class="widget-title">${escapeHtml(titleLabel)}</div>
        <div class="stock-watch-list stock-list-full">
          ${rows.map(s => watchRow(s, t)).join('')}
        </div>
      </div>
    `;
  }

  if (layout === 'hero_only') {
    // Just the first symbol — bigger hero card, no watchlist clutter.
    const hero = list[0];
    return `
      <div class="widget widget-stocks stocks-hero-mode stocks-hero-only">
        <div class="widget-title">${escapeHtml(titleLabel)}</div>
        ${heroBlock(hero, t)}
      </div>
    `;
  }

  // Default: hero + watchlist.
  const hero = list[0];
  const watch = list.slice(1, 1 + t.watch);
  return `
    <div class="widget widget-stocks stocks-hero-mode">
      <div class="widget-title">${escapeHtml(titleLabel)}</div>
      ${heroBlock(hero, t)}
      ${watch.length ? `<div class="stock-watch-list">${watch.map(s => watchRow(s, t)).join('')}</div>` : ''}
    </div>
  `;
}

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
  const step = (vbW - pad * 2) / (points.length - 1);
  const path = points.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (vbH - pad * 2) * (1 - (v - min) / range);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const cls = opts && opts.cls ? opts.cls : 'stock-spark';
  const styles = (opts && opts.style) ? opts.style : '';
  const sw = opts && opts.stroke ? opts.stroke : 2;
  return `<svg class="${cls}" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="none" style="${styles}"><path d="${path}" fill="none" stroke="#000" stroke-width="${sw}" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
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
    ? spark(hero.spark, { cls: 'hero-spark', stroke: 2.5, style: 'flex:1;min-height:0;width:100%' })
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

function watchRow(s, t) {
  return `
    <div class="stock-watch-row">
      <span class="watch-sym">${escapeHtml(s.symbol)}</span>
      ${t.watchSpark ? spark(s.spark, { cls: 'watch-spark', stroke: 2, style: 'height:18px;width:100%' }) : '<span></span>'}
      <span class="watch-price">${s.price}</span>
      ${t.watchChg ? `<span class="watch-chg ${dirCls(s.change)}">${dirArrow(s.change)} ${Math.abs(s.changePct).toFixed(2)}%</span>` : ''}
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
    watchChg:   tBase.watchChg   && s.showChange !== false
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

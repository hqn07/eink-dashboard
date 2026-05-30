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
  defaults: () => ({ symbols: [], fontScale: 1, padding: 14 })
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

export function render({ stocks, cellW, cellH, density }) {
  const list = stocks || [];
  if (!list.length) return placeholder('MARKETS', 'Add symbols (AAPL, BTC-USD) in settings', 'stocks');
  const tier = pickTier(cellW, cellH, density);
  const matrix = {
    tiny:     { watch: 0, heroSpark: false, heroMeta: false, heroChg: false, watchSpark: false, watchChg: false },
    compact:  { watch: 0, heroSpark: true,  heroMeta: false, heroChg: true,  watchSpark: false, watchChg: false },
    standard: { watch: 3, heroSpark: true,  heroMeta: true,  heroChg: true,  watchSpark: true,  watchChg: true  },
    extended: { watch: 5, heroSpark: true,  heroMeta: true,  heroChg: true,  watchSpark: true,  watchChg: true  },
    full:     { watch: 7, heroSpark: true,  heroMeta: true,  heroChg: true,  watchSpark: true,  watchChg: true  }
  };
  const t = matrix[tier];
  const hero = list[0];
  const watch = list.slice(1, 1 + t.watch);
  const dirArrow = v => v >= 0 ? '▲' : '▼';
  const dirCls = v => v >= 0 ? 'up' : 'down';
  const heroChg = t.heroChg && Number.isFinite(hero.change)
    ? `<span class="hero-chg ${dirCls(hero.change)}">${dirArrow(hero.change)} ${Math.abs(hero.change).toFixed(2)} (${hero.change >= 0 ? '+' : '−'}${Math.abs(hero.changePct).toFixed(2)}%)</span>`
    : '';
  const heroMeta = t.heroMeta && (hero.dayHigh || hero.dayLow)
    ? `<div class="hero-meta">${hero.dayHigh ? `H ${hero.dayHigh}` : ''}${hero.dayHigh && hero.dayLow ? ' · ' : ''}${hero.dayLow ? `L ${hero.dayLow}` : ''}</div>`
    : '';
  const heroSparkHtml = t.heroSpark
    ? spark(hero.spark, { cls: 'hero-spark', stroke: 2.5, style: 'flex:1;min-height:0;width:100%' })
    : '';
  const watchRows = watch.map(s => `
    <div class="stock-watch-row">
      <span class="watch-sym">${escapeHtml(s.symbol)}</span>
      ${t.watchSpark ? spark(s.spark, { cls: 'watch-spark', stroke: 2, style: 'height:18px;width:100%' }) : '<span></span>'}
      <span class="watch-price">${s.price}</span>
      ${t.watchChg ? `<span class="watch-chg ${dirCls(s.change)}">${dirArrow(s.change)} ${Math.abs(s.changePct).toFixed(2)}%</span>` : ''}
    </div>
  `).join('');
  return `
    <div class="widget widget-stocks stocks-hero-mode">
      <div class="widget-title">MARKETS</div>
      <div class="stock-hero">
        <div class="hero-top">
          <span class="hero-sym">${escapeHtml(hero.symbol)}</span>
          ${heroChg}
        </div>
        <div class="hero-price autofit" data-min-font="22">${hero.price}</div>
        ${heroMeta}
        ${heroSparkHtml}
      </div>
      ${watch.length ? `<div class="stock-watch-list">${watchRows}</div>` : ''}
    </div>
  `;
}

import { escapeHtml, placeholder, staleMark, pickTier } from './_shared.js';

// Currency / FX — server fetches frankfurter.app into ctx.fx =
// { base, date, rates:[{code, rate}], stale }. render() only formats it.

export const def = {
  id: 'fx',
  label: 'Currency',
  requires: [],
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 6, h: 4 },
    M: { w: 8, h: 5 },
    L: { w: 8, h: 8 }
  },
  defaultSize: 'M',
  variants: {
    trmnl: { label: 'TRMNL — title-bar card' }
  },
  defaultVariant: 'trmnl',
  defaults: () => ({
    variant: 'trmnl',
    base: 'USD',
    targets: ['EUR', 'GBP'],
    title: '',
    fontScale: 1,
    padding: 14
  })
};

// Trim a rate to a readable precision: big rates (JPY ~150) get 2 dp,
// small ones (EUR ~0.9) get 4 so the movement is visible.
function fmtRate(r) {
  if (!Number.isFinite(r)) return '--';
  return r >= 100 ? r.toFixed(2) : r.toFixed(4);
}

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const fx = ctx.fx;
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'CURRENCY';

  if (!fx || !Array.isArray(fx.rates) || !fx.rates.length) {
    return placeholder(titleLabel, 'Set base + targets', 'msg', { cellW, cellH });
  }

  const tier = pickTier(cellW || 0, cellH || 0, density);
  const stale = staleMark(fx.stale);
  // Cap rows on short tiles so nothing clips.
  const maxRows = (cellH || 0) <= 4 ? 3 : (cellH || 0) <= 6 ? 5 : 8;
  const rows = fx.rates.slice(0, maxRows).map(r => `
    <div class="fx-row" style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 0">
      <span class="tr-l">${escapeHtml(r.code)}</span>
      <span class="tr-v" style="font-size:20px">${fmtRate(r.rate)}</span>
    </div>`).join('');

  const meta = `1 ${escapeHtml(fx.base)}${stale}`;
  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${meta}</span></div>
    <div class="tr-body" style="flex-direction:column;justify-content:center">${rows}</div>
  </div>`;
}

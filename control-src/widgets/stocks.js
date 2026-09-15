import { escapeHtml, placeholder, staleMark, pickTier } from './_shared.js';

// Stocks — server fetches Yahoo Finance (keyless, 15-min delayed) into
// ctx.stocks = { quotes:[{ symbol, price, changePct, currency }], stale }.
// Same row idiom as the crypto widget so a Money screen reads as one set.

export const def = {
  id: 'stocks',
  label: 'Stocks',
  requires: [],
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 6, h: 4 },
    M: { w: 8, h: 5 },
    L: { w: 10, h: 8 }
  },
  defaultSize: 'M',
  defaultVariant: 'trmnl',
  defaults: () => ({
    variant: 'trmnl',
    symbols: ['AAPL', 'VOO'],
    title: '',
  })
};

function fmtPrice(p) {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(3);
}

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const st = ctx.stocks;
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'MARKETS';

  const wanted = Array.isArray(s.symbols) && s.symbols.filter(Boolean).length;
  if (!st || !Array.isArray(st.quotes) || !st.quotes.length) {
    return placeholder(titleLabel, wanted ? 'No quotes' : 'Add tickers', 'msg',
      { cellW, cellH }, wanted ? 'nodata' : 'setup');
  }

  const tier = pickTier(cellW || 0, cellH || 0, density);
  const stale = staleMark(st.stale);
  const showChange = tier !== 'tiny';
  const maxRows = (cellH || 0) <= 4 ? 3 : (cellH || 0) <= 6 ? 5 : 8;

  const rows = st.quotes.slice(0, maxRows).map(q => {
    const ch = Number(q.changePct);
    const down = Number.isFinite(ch) && ch < 0;
    const arrow = !Number.isFinite(ch) ? '' : (ch >= 0 ? '▲' : '▼');
    const chStr = Number.isFinite(ch) ? `${arrow}${Math.abs(ch).toFixed(1)}%` : '';
    const changeCell = showChange && chStr
      ? `<span class="tr-l${down ? ' face-red' : ''}" style="min-width:56px;text-align:right">${chStr}</span>` : '';
    return `<div class="cr-row" style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:3px 0">
      <span class="tr-l" style="min-width:48px">${escapeHtml(q.symbol)}</span>
      <span class="tr-v" style="font-size:18px;flex:1;text-align:right">${escapeHtml(fmtPrice(q.price))}</span>
      ${changeCell}
    </div>`;
  }).join('');

  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">DELAYED${stale}</span></div>
    <div class="tr-body" style="flex-direction:column;justify-content:center">${rows}</div>
  </div>`;
}

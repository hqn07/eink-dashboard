import { escapeHtml, placeholder, staleMark, pickTier } from './_shared.js';

// Markets — stocks, crypto and currency pairs in one tile.
//
// Replaces the stocks / crypto / fx widgets, which rendered an identical row
// (label, value, optional change) from three providers and so could never
// appear together. The server resolves each symbol to its provider and hands
// back ctx.markets = { rows:[{ label, value, change, kind }], vs, stale } in
// the order the user listed them.

export const def = {
  id: 'markets',
  label: 'Markets',
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
    symbols: ['AAPL', 'BTC', 'EUR/USD'],
    vs: 'usd',
    title: '',
  })
};

// One formatter for three asset classes. A currency pair is a rate near 1 and
// needs decimals a share price does not; a coin can be either.
function fmtValue(v, kind) {
  if (!Number.isFinite(v)) return '—';
  if (kind === 'fx') return v >= 100 ? v.toFixed(1) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const m = ctx.markets;
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'MARKETS';

  const wanted = Array.isArray(s.symbols) && s.symbols.filter(Boolean).length;
  if (!m || !Array.isArray(m.rows) || !m.rows.length) {
    return placeholder(titleLabel, wanted ? 'No quotes' : 'Add symbols', 'msg',
      { cellW, cellH }, wanted ? 'nodata' : 'setup');
  }

  const tier = pickTier(cellW || 0, cellH || 0, density);
  const stale = staleMark(m.stale);
  const showChange = tier !== 'tiny';
  const maxRows = (cellH || 0) <= 4 ? 3 : (cellH || 0) <= 6 ? 5 : 8;

  const rows = m.rows.slice(0, maxRows).map(r => {
    // Number(null) is 0, which is finite — so a currency pair, which has no
    // change to report, rendered a confident "0.0%". Absent must stay absent.
    const ch = (r.change === null || r.change === undefined) ? NaN : Number(r.change);
    const down = Number.isFinite(ch) && ch < 0;
    const arrow = !Number.isFinite(ch) ? '' : (ch >= 0 ? '▲' : '▼');
    const chStr = Number.isFinite(ch) ? `${arrow}${Math.abs(ch).toFixed(1)}%` : '';
    // Auto-red on a drop, riding the 3-colour red plane.
    const changeCell = showChange && chStr
      ? `<span class="tr-l${down ? ' face-red' : ''}" style="min-width:56px;text-align:right">${chStr}</span>`
      : '';
    return `<div class="cr-row" style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:3px 0">
      <span class="tr-l" style="min-width:48px">${escapeHtml(r.label)}</span>
      <span class="tr-v" style="font-size:18px;flex:1;text-align:right">${escapeHtml(fmtValue(r.value, r.kind))}</span>
      ${changeCell}
    </div>`;
  }).join('');

  // The quote currency is only worth naming when something is priced in it;
  // a pure currency-pair tile already says USD in every row label.
  const showsPriced = m.rows.some(r => r.kind !== 'fx');
  const meta = `${showsPriced ? escapeHtml(String(m.vs || 'usd').toUpperCase()) : ''}${stale}`;

  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${meta}</span></div>
    <div class="tr-body" style="flex-direction:column;justify-content:center">${rows}</div>
  </div>`;
}

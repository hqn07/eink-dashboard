import { escapeHtml, placeholder, staleMark, pickTier } from './_shared.js';

// Crypto — server fetches CoinGecko into ctx.crypto =
// { vs, coins:[{ symbol, price, change24h }], stale }. render() formats it.

export const def = {
  id: 'crypto',
  label: 'Crypto',
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
    coins: ['bitcoin', 'ethereum'],
    vs: 'usd',
    title: '',
  })
};

const CUR_SYMBOL = { usd: '$', eur: '€', gbp: '£', jpy: '¥', cad: '$', aud: '$' };

function fmtPrice(p, vs) {
  const sym = CUR_SYMBOL[vs] || '';
  const pre = sym || '';
  const post = sym ? '' : ` ${vs.toUpperCase()}`;
  let n;
  if (p >= 1000) n = Math.round(p).toLocaleString('en-US');
  else if (p >= 1) n = p.toFixed(2);
  else n = p.toPrecision(3);
  return `${pre}${n}${post}`;
}

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const c = ctx.crypto;
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'CRYPTO';

  if (!c || !Array.isArray(c.coins) || !c.coins.length) {
    return placeholder(titleLabel, 'Pick coins', 'msg', { cellW, cellH });
  }

  const tier = pickTier(cellW || 0, cellH || 0, density);
  const stale = staleMark(c.stale);
  const showChange = tier !== 'tiny';
  const maxRows = (cellH || 0) <= 4 ? 3 : (cellH || 0) <= 6 ? 5 : 8;

  const rows = c.coins.slice(0, maxRows).map(coin => {
    const ch = Number(coin.change24h);
    const down = Number.isFinite(ch) && ch < 0;
    const arrow = !Number.isFinite(ch) ? '' : (ch >= 0 ? '▲' : '▼');
    const chStr = Number.isFinite(ch) ? `${arrow}${Math.abs(ch).toFixed(1)}%` : '';
    // Auto-red on a 24h drop (rides the 3-colour red plane).
    const chCls = down ? ' face-red' : '';
    const changeCell = showChange && chStr
      ? `<span class="tr-l${chCls}" style="min-width:56px;text-align:right">${chStr}</span>` : '';
    return `<div class="cr-row" style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:3px 0">
      <span class="tr-l" style="min-width:48px">${escapeHtml(coin.symbol)}</span>
      <span class="tr-v" style="font-size:18px;flex:1;text-align:right">${escapeHtml(fmtPrice(coin.price, c.vs))}</span>
      ${changeCell}
    </div>`;
  }).join('');

  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${escapeHtml((c.vs || '').toUpperCase())}${stale}</span></div>
    <div class="tr-body" style="flex-direction:column;justify-content:center">${rows}</div>
  </div>`;
}

import { escapeHtml, placeholder, staleMark } from './_shared.js';
import { homeValue } from '../home.js';

// Markets — heatmap view.
//
// A grid of chips, one per symbol, where the CHIP'S TONE is the size of the
// move and RED is the direction. That is the whole encoding, and it is chosen
// for the medium: the panel has three inks, so a continuous green→red scale is
// not available, but ordered-dither tones give a legible six-step ramp and the
// red plane gives a second dimension for free.
//
// Not a treemap. Finviz sizes each rectangle by market cap, which needs a
// squarify pass and, more to the point, produces slivers — and a sliver on a
// 1-bit panel with an 11px type floor is an unreadable smudge rather than a
// small stock. Equal cells lose the weighting and keep everything else.
//
// Tone runs light→dark with the size of the move, so a quiet day is a pale
// grid and a violent one is dark. Losers use the two pink tones, which read as
// red on the B panel and as a mid grey on the mono one — the percentage is
// printed either way, so the panel never depends on colour alone.

const GAIN_TONES = [
  [0.5, 'face-tone-g15'],
  [1.0, 'face-tone-g25'],
  [2.0, 'face-tone-g37'],
  [3.0, 'face-tone-g50'],
  [5.0, 'face-tone-g62'],
  [Infinity, 'face-tone-g75']
];
const LOSS_TONES = [
  [1.0, 'face-tone-r25'],
  [Infinity, 'face-tone-r50']
];

function toneFor(pct) {
  if (!Number.isFinite(pct)) return 'mh-flat';
  const table = pct < 0 ? LOSS_TONES : GAIN_TONES;
  const mag = Math.abs(pct);
  for (const [limit, cls] of table) if (mag < limit) return cls;
  return table[table.length - 1][1];
}

// Columns come from the tile's width in grid units, not from a media query:
// the widget knows its own size, and `auto-fit` would let a chip collapse
// below the width its ticker needs.
function columnsFor(cellW, count) {
  const byWidth = cellW >= 20 ? 6 : cellW >= 16 ? 5 : cellW >= 12 ? 4 : cellW >= 9 ? 3 : 2;
  return Math.max(2, Math.min(byWidth, count));
}

export const def = {
  id: 'markets_heat',
  label: 'Heatmap',
  minSize: { w: 8, h: 4 },
  sizes: {
    M:  { w: 10, h: 5 },
    L:  { w: 14, h: 6 },
    XL: { w: 24, h: 8 }
  },
  defaultSize: 'L',
  defaults: () => ({
    symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM'],
    vs: 'usd',
    title: '',
    heatSort: 'change'
  })
};

export function render(ctx) {
  const { settings, cellW, cellH } = ctx;
  const s = settings || {};
  const m = ctx.markets;
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'MARKETS';

  const shared = homeValue(ctx && ctx.cfg, 'tickers') || [];
  const wanted = (Array.isArray(s.symbols) && s.symbols.filter(Boolean).length) || shared.length;
  if (!m || !Array.isArray(m.rows) || !m.rows.length) {
    return placeholder(titleLabel, wanted ? 'No quotes' : 'Add symbols, or a list in Setup', 'msg',
      { cellW, cellH }, wanted ? 'nodata' : 'setup');
  }

  // A symbol with no change to report (a currency pair) cannot be placed on
  // the scale, so it sorts last rather than pretending to be flat.
  const rows = m.rows.slice();
  if (s.heatSort !== 'list') {
    rows.sort((a, b) => {
      const av = Number.isFinite(a.change) ? Math.abs(a.change) : -1;
      const bv = Number.isFinite(b.change) ? Math.abs(b.change) : -1;
      return bv - av;
    });
  }

  // How many chips fit: the grid is `cols` wide, and a chip needs ~2 grid rows
  // of height (80px) to hold a ticker over a percentage at the 11px floor.
  const cols = columnsFor(cellW || 0, rows.length);
  // Rows from PIXELS, not from a fraction of the tile's grid units. A chip is
  // 42px — a 14px ticker line over a 14px percentage, 10px of padding, 4px of
  // border — plus a 3px gap, and the title band takes 30. A divisor looked
  // right at one tile size and clipped every chip at another, which is what a
  // divisor does: it approximates an arithmetic the widget can just do.
  const CHIP_PX = 42, GAP_PX = 3, TITLE_PX = 30, ROW_PX = 40;
  const avail = Math.max(0, (cellH || 4) * ROW_PX - TITLE_PX);
  const bodyRows = Math.max(1, Math.floor((avail + GAP_PX) / (CHIP_PX + GAP_PX)));
  const shown = rows.slice(0, cols * bodyRows);

  const chips = shown.map((r) => {
    const ch = (r.change === null || r.change === undefined) ? NaN : Number(r.change);
    const tone = toneFor(ch);
    const sign = !Number.isFinite(ch) ? '' : (ch < 0 ? '−' : '+');
    const pctStr = Number.isFinite(ch) ? `${sign}${Math.abs(ch).toFixed(1)}%` : '—';
    // The number goes on the red plane for a loss as well as the chip's tone.
    // Measured: the pink tones put 17% (r25) and 32% (r50) of a chip's pixels
    // on the red plane, which reads as a wash next to a dark grey neighbour
    // and can be missed at a glance. Solid red glyphs cannot — and they sit on
    // the white plate, so they stay crisp instead of competing with a dither.
    const down = Number.isFinite(ch) && ch < 0;
    return `<div class="mh-cell ${tone}">
      <span class="mh-sym">${escapeHtml(r.label)}</span>
      <span class="mh-pct${down ? ' face-red' : ''}">${pctStr}</span>
    </div>`;
  }).join('');

  const up = shown.filter(r => Number.isFinite(r.change) && r.change > 0).length;
  const down = shown.filter(r => Number.isFinite(r.change) && r.change < 0).length;
  // The count of losers is red too, so the title bar carries the day's mood
  // before the eye reaches the grid.
  const meta = `${up}▲ <span class="face-red">${down}▼</span>${staleMark(m.stale)}`;

  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${meta}</span></div>
    <div class="tr-body mh-grid" style="grid-template-columns:repeat(${cols}, 1fr)">${chips}</div>
  </div>`;
}

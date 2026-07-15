import { escapeHtml, pickTier, placeholder, staleMark } from './_shared.js';

// Chess — Lichess puzzle of the day. Server (widgets/chess.js) replays
// the game to the puzzle position and ships a plain 8×8 matrix in
// ctx.chessPuzzle; this render never needs a chess engine.
//
// Board style: newspaper diagram. Dark squares = fine dot lattice (SVG
// pattern — survives 1-bit), pieces = letter discs: white pieces are
// outlined circles with black letters, black pieces solid discs with
// white letters.

export const def = {
  id: 'chess',
  label: 'Chess Puzzle',
  requires: null,
  minSize: { w: 6, h: 6 },
  sizes: {
    M: { w: 10, h: 12 },
    L: { w: 12, h: 12 }
  },
  defaultSize: 'M',
  defaults: () => ({
    title: '',
    showMeta: true,     // rating + themes footer
    fontScale: 1,
    padding: 10
  })
};

const LETTER = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

function boardSvg(board, flip) {
  const S = 40;               // square size in viewBox units
  const size = S * 8;
  let sq = '';
  let pieces = '';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      // board[0] = rank 8. Flip when black to move so the solver's side
      // is at the bottom, like a printed puzzle.
      const br = flip ? 7 - r : r;
      const bf = flip ? 7 - f : f;
      const x = f * S, y = r * S;
      const dark = (br + bf) % 2 === 1;
      if (dark) sq += `<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="url(#chx)"/>`;
      const pc = board[br] && board[br][bf];
      if (!pc) continue;
      const white = pc[0] === 'w';
      const letter = LETTER[pc[1]] || '?';
      const cx = x + S / 2, cy = y + S / 2;
      pieces += white
        ? `<circle cx="${cx}" cy="${cy}" r="${S * 0.38}" fill="#fff" stroke="#000" stroke-width="3"/>`
          + `<text x="${cx}" y="${cy}" dy="0.36em" text-anchor="middle" font-size="${S * 0.5}" font-weight="800" fill="#000">${letter}</text>`
        : `<circle cx="${cx}" cy="${cy}" r="${S * 0.38}" fill="#000"/>`
          + `<text x="${cx}" y="${cy}" dy="0.36em" text-anchor="middle" font-size="${S * 0.5}" font-weight="800" fill="#fff">${letter}</text>`;
    }
  }
  return `<svg class="chess-board" viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs><pattern id="chx" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#fff"/><rect width="2" height="2" fill="#000"/><rect x="2" y="2" width="2" height="2" fill="#000"/></pattern></defs>
    <rect width="${size}" height="${size}" fill="#fff"/>
    ${sq}${pieces}
    <rect width="${size}" height="${size}" fill="none" stroke="#000" stroke-width="4"/>
  </svg>`;
}

export function render(ctx) {
  const { chessPuzzle, settings, cellW, cellH } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'DAILY PUZZLE';
  if (!chessPuzzle || !Array.isArray(chessPuzzle.board)) {
    return placeholder(titleLabel, 'Puzzle unavailable', 'msg', { cellW, cellH }, 'nodata');
  }
  const p = chessPuzzle;
  const toMove = p.turn === 'b' ? 'BLACK TO MOVE' : 'WHITE TO MOVE';
  const tier = pickTier(cellW || 0, cellH || 0, ctx.density);
  const meta = (s.showMeta !== false && tier !== 'tiny' && p.rating)
    ? `<div class="chess-meta">Lichess · ${p.rating}${p.themes.length ? ' · ' + escapeHtml(p.themes.join(', ')) : ''}</div>`
    : '';
  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${toMove}${staleMark(p.stale)}</span></div>
    <div class="tr-body chess-body">
      ${boardSvg(p.board, p.turn === 'b')}
      ${meta}
    </div>
  </div>`;
}

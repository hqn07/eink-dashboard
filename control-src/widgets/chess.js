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
  // Layout variants: the full newspaper diagram, a bare board for tight
  // tiles, and a coordinate-labelled board like a printed study.
  variants: {
    diagram:    { label: 'Diagram' },
    board_only: { label: 'Board only' },
    coords:     { label: 'With coords' }
  },
  defaults: () => ({
    title: '',
    variant: 'diagram',
    showMeta: true,     // rating + themes footer
    fontScale: 1,
    padding: 10
  })
};

const LETTER = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

function boardSvg(board, flip, coords) {
  const S = 40;               // square size in viewBox units
  const size = S * 8;
  const m = coords ? 20 : 0;  // label gutter on the left + bottom edges
  const ox = m;               // board x offset (ranks label the left gutter)
  let sq = '';
  let pieces = '';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      // board[0] = rank 8. Flip when black to move so the solver's side
      // is at the bottom, like a printed puzzle.
      const br = flip ? 7 - r : r;
      const bf = flip ? 7 - f : f;
      const x = ox + f * S, y = r * S;
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
  // File letters (a–h) along the bottom + rank numbers (1–8) down the left,
  // oriented to the flipped board so they always match the pieces.
  let labels = '';
  if (coords) {
    const fs = S * 0.34;
    for (let f = 0; f < 8; f++) {
      const bf = flip ? 7 - f : f;
      const ch = String.fromCharCode(97 + bf);
      labels += `<text x="${ox + f * S + S / 2}" y="${size + m * 0.72}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#000">${ch}</text>`;
    }
    for (let r = 0; r < 8; r++) {
      const br = flip ? 7 - r : r;
      const num = 8 - br;
      labels += `<text x="${m * 0.45}" y="${r * S + S / 2}" dy="0.36em" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#000">${num}</text>`;
    }
  }
  const vbw = size + m, vbh = size + m;
  return `<svg class="chess-board" viewBox="0 0 ${vbw} ${vbh}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs><pattern id="chx" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#fff"/><rect width="2" height="2" fill="#000"/><rect x="2" y="2" width="2" height="2" fill="#000"/></pattern></defs>
    <rect width="${vbw}" height="${vbh}" fill="#fff"/>
    ${sq}${pieces}${labels}
    <rect x="${ox}" y="0" width="${size}" height="${size}" fill="none" stroke="#000" stroke-width="4"/>
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
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'diagram');
  const flip = p.turn === 'b';
  const toMove = flip ? 'BLACK TO MOVE' : 'WHITE TO MOVE';
  const tier = pickTier(cellW || 0, cellH || 0, ctx.density);
  const board = boardSvg(p.board, flip, variant === 'coords');

  // Board only — bare diagram, no titlebar/footer, for tight tiles.
  if (variant === 'board_only') {
    return `<div class="tr-card chess-board-only">
      <div class="tr-body chess-body">${board}</div>
    </div>`;
  }

  const meta = (s.showMeta !== false && tier !== 'tiny' && p.rating)
    ? `<div class="chess-meta">Lichess · ${p.rating}${p.themes.length ? ' · ' + escapeHtml(p.themes.join(', ')) : ''}</div>`
    : '';
  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span><span class="tr-meta">${toMove}${staleMark(p.stale)}</span></div>
    <div class="tr-body chess-body">
      ${board}
      ${meta}
    </div>
  </div>`;
}

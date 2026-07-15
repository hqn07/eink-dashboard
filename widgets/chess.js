// Chess — Lichess daily puzzle. Fetches once per day (cache keyed on the
// puzzle id / date), replays the game PGN to the puzzle ply with chess.js,
// and hands the renderer a plain board matrix so the client mirror never
// needs the chess dep.
const { Chess } = require('chess.js');
const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 60 * 60 * 1000; // re-check hourly; lichess rotates daily
let cache = null; // { at, data }

async function fetchChessDaily() {
  if (cache && (Date.now() - cache.at) < CACHE_MS) { status.cacheHit('chess'); return cache.data; }
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout('https://lichess.org/api/puzzle/daily',
      { headers: { accept: 'application/json' } }, 6000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const moves = String(j.game && j.game.pgn || '').split(/\s+/).filter(Boolean);
    const ply = Number(j.puzzle && j.puzzle.initialPly);
    if (!moves.length || !Number.isFinite(ply)) throw new Error('bad puzzle payload');
    const c = new Chess();
    for (let i = 0; i <= ply && i < moves.length; i++) c.move(moves[i]);
    // 8×8 matrix of piece codes ('wK', 'bp', null), rank 8 first — plain
    // data, safe to serialize into the preview payload.
    const board = c.board().map(row => row.map(sq => sq ? sq.color + sq.type : null));
    const data = {
      board,
      turn: c.turn(),               // 'w' | 'b' — side to move (the solver)
      rating: Number(j.puzzle.rating) || null,
      themes: Array.isArray(j.puzzle.themes) ? j.puzzle.themes.slice(0, 3) : [],
      id: j.puzzle.id || null,
      stale: false
    };
    cache = { at: Date.now(), data };
    status.record('chess', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('chess', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    if (cache) return { ...cache.data, stale: true };
    return null;
  }
}

module.exports = { fetchChessDaily };

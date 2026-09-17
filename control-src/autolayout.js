// _sizes.js is a leaf module with no registry imports, so it does not
// compromise the rule below: this file still loads outside a bundler.
import { sizeSpec, sizeSpecFor } from './widgets/_sizes.js';

// Automatic tile placement for a fixed 24x12 panel.
//
// The editor asks a beginner to art-direct: free drag-and-resize on a grid
// where overlaps are legal and nothing snaps. `tidy()` is the floor being
// raised, not the ceiling lowered — manual placement still works, this is
// one button that makes a screen presentable.
//
// Shelf packing, in the tiles' own reading order. Order is preserved rather
// than optimised because the order is the user's editorial decision: the
// weather being first is a choice, and a packer that reshuffled by area to
// save two rows would be overruling it.

// The grid is passed in rather than imported: importing widgets.js would
// drag the whole .jsx registry into this module and make it impossible to
// exercise outside a bundler, and a packer is exactly the kind of thing that
// should be testable on its own.
const DEFAULT_GRID = { cols: 24, rows: 12 };

// Sizes to try for a tile, best first.
//
// The tile's CURRENT size always comes first, and nothing larger is ever
// offered: tidy arranges, it does not redesign. An earlier version sorted all
// declared sizes largest-first and a single weather_hero claimed its 12x12
// option, filling the panel and pushing two of four tiles off the grid.
// Shrinking happens only when something would not otherwise fit, and only
// through sizes the widget itself declares.
function candidateSizes(item, def, GRID_COLS, GRID_ROWS) {
  const clamp = (s) => ({ w: Math.min(s.w, GRID_COLS), h: Math.min(s.h, GRID_ROWS) });
  const current = (Number.isFinite(item.w) && Number.isFinite(item.h))
    ? clamp({ w: item.w, h: item.h }) : null;
  const ceiling = current ? current.w * current.h : Infinity;

  // The tile's OWN variant picks the ladder: a weather tile drawing the
  // forecast must be offered 6x8, not the hero's 8x4, or tidy would shrink it
  // into a shape that view was never laid out for.
  const spec = sizeSpecFor(def, item);
  const declared = Object.values(spec.sizes || {})
    .filter(s => s && Number.isFinite(s.w) && Number.isFinite(s.h))
    .map(clamp)
    .filter(s => s.w * s.h <= ceiling)
    .sort((a, b) => (b.w * b.h) - (a.w * a.h));

  const min = spec.minSize || { w: 4, h: 2 };
  const out = [];
  const seen = new Set();
  for (const s of [...(current ? [current] : []), ...declared, clamp(min)]) {
    const k = `${s.w}x${s.h}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// Reading order: top row first, then left to right. Tiles without a position
// (a freshly generated set) keep their array order.
function readingOrder(layout) {
  return layout
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const ay = Number.isFinite(a.item.y) ? a.item.y : 0;
      const by = Number.isFinite(b.item.y) ? b.item.y : 0;
      if (ay !== by) return ay - by;
      const ax = Number.isFinite(a.item.x) ? a.item.x : 0;
      const bx = Number.isFinite(b.item.x) ? b.item.x : 0;
      if (ax !== bx) return ax - bx;
      return a.i - b.i;
    })
    .map(e => e.item);
}

// -> { layout, placed, dropped } — `dropped` are tiles that could not fit at
// any of their declared sizes. They are returned to the caller rather than
// silently deleted: losing a tile to a tidy button would be unforgivable.
export function tidy(layout, widgetById, grid = DEFAULT_GRID) {
  const GRID_COLS = grid.cols || DEFAULT_GRID.cols;
  const GRID_ROWS = grid.rows || DEFAULT_GRID.rows;
  const items = readingOrder(Array.isArray(layout) ? layout : []);
  const placed = [];
  const dropped = [];

  let shelfY = 0;
  let shelfH = 0;
  let cursorX = 0;

  for (const item of items) {
    const def = widgetById ? widgetById(item.widgetId || item.id) : null;
    const options = candidateSizes(item, def, GRID_COLS, GRID_ROWS);
    let put = null;

    for (const size of options) {
      // Fits on the current shelf?
      if (cursorX + size.w <= GRID_COLS && shelfY + Math.max(shelfH, size.h) <= GRID_ROWS) {
        put = { x: cursorX, y: shelfY, ...size };
        break;
      }
      // Fits on a new shelf below?
      const nextY = shelfY + shelfH;
      if (size.w <= GRID_COLS && nextY + size.h <= GRID_ROWS) {
        put = { x: 0, y: nextY, ...size, _newShelf: true };
        break;
      }
    }

    if (!put) { dropped.push(item); continue; }

    if (put._newShelf) { shelfY = put.y; shelfH = put.h; cursorX = put.w; }
    else { shelfH = Math.max(shelfH, put.h); cursorX = put.x + put.w; }
    delete put._newShelf;
    placed.push({ ...item, x: put.x, y: put.y, w: put.w, h: put.h });
  }

  // Leftover height at the bottom is dead space on a panel that cannot
  // scroll, so the last shelf grows into it.
  const bottom = shelfY + shelfH;
  const slack = GRID_ROWS - bottom;
  if (slack > 0 && placed.length) {
    for (const p of placed) {
      if (p.y === shelfY) p.h += slack;
    }
  }

  return { layout: placed, placed: placed.length, dropped };
}

// Build a screen from a list of widget ids.
//
// Sizing is chosen for the SET, not per widget. Seeding each tile at its own
// default put weather_hero in at 8x12 — a full-height column — and the four
// things the user asked for after it were dropped. Everything the user picked
// has to appear; that is the whole promise of asking. So try the size ladder
// from large to small and take the first rung where nothing is left out.
const SIZE_RUNGS = ['L', 'M', 'S', 'XS'];

function sizeAt(def, key, variant) {
  const spec = sizeSpec(def, variant);
  const sizes = spec.sizes || {};
  if (sizes[key]) return sizes[key];
  // Fall back to the next smaller rung this widget actually declares, then
  // to its minimum: not every widget offers every rung.
  const order = SIZE_RUNGS.slice(SIZE_RUNGS.indexOf(key) + 1);
  for (const k of order) if (sizes[k]) return sizes[k];
  for (const k of SIZE_RUNGS) if (sizes[k]) return sizes[k];
  return spec.minSize || { w: 8, h: 4 };
}

// `ids` entries may be a bare widget id or `{ id, variant }` — a caller that
// knows which view it wants (Setup offering "forecast", not just "weather")
// gets that view's ladder and that view's settings on the seeded tile.
export function layoutFromWidgetIds(ids, widgetById, newInstanceId, grid = DEFAULT_GRID) {
  const list = (Array.isArray(ids) ? ids : []).map(
    e => (e && typeof e === 'object') ? { id: e.id, variant: e.variant || null } : { id: e, variant: null });
  let best = null;
  for (const rung of SIZE_RUNGS) {
    const seeded = list.map(({ id, variant }) => {
      const def = widgetById ? widgetById(id) : null;
      const v = (variant && def && def.variants && def.variants[variant])
        ? variant : (def && def.defaultVariant) || null;
      const size = sizeAt(def, rung, v);
      return {
        id: newInstanceId ? newInstanceId(id) : `${id}-${Math.random().toString(36).slice(2, 8)}`,
        widgetId: id,
        x: 0, y: 0, w: size.w, h: size.h,
        flush: false,
        settings: variant ? { variant } : undefined,
      };
    });
    // Reading order for a fresh set is the pick order, which readingOrder()
    // preserves because every tile is still at y=0.
    const r = tidy(seeded, widgetById, grid);
    if (!best || r.dropped.length < best.dropped.length) best = r;
    if (!r.dropped.length) return r;
  }
  // Nothing fits everything: return the arrangement that loses the least, and
  // let the caller say what was left out.
  return best || { layout: [], placed: 0, dropped: [] };
}

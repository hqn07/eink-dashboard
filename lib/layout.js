// Pure layout-geometry helpers for the SSR grid. No shared state.
const { parseHHMM } = require('./timewin');

// Resolve a widget def's pixel size for a given size key, falling back to
// its default size. Returns { w, h } cells or null.
//
// A def may hang `sizes` / `defaultSize` off an individual variant, in which
// case the tile's own variant picks the ladder. Same rule as the editor's
// control-src/widgets/_sizes.js, restated here because this module is CJS and
// loads synchronously — it is one lookup with a fallback, kept that small so
// the two cannot meaningfully drift.
function sizeFor(def, sizeKey, settings) {
  if (!def) return null;
  const name = settings && settings.variant;
  const v = (name && def.variants && def.variants[name]) ? def.variants[name]
          : (def.variants && def.variants[def.defaultVariant]) || null;
  const sizes = (v && v.sizes) || def.sizes || {};
  const fallback = (v && v.defaultSize) || def.defaultSize;
  const k = sizeKey && sizes[sizeKey] ? sizeKey : fallback;
  return sizes[k] || null;
}

// Expand a raw saved layout into concrete placed tiles, dropping disabled
// entries and unknown widget ids, and filling missing geometry from the def.
function expandLayout(rawLayout, defs) {
  const out = [];
  for (const raw of (rawLayout || [])) {
    if (raw && raw.enabled === false) continue;
    const widgetId = raw.widgetId || raw.id;
    const def = defs[widgetId];
    if (!def) continue;
    const sz = sizeFor(def, raw.size, raw.settings) || { w: 8, h: 4 };
    out.push({
      id: raw.id || widgetId,
      widgetId,
      x: Number.isFinite(raw.x) ? raw.x : 0,
      y: Number.isFinite(raw.y) ? raw.y : 0,
      w: Number.isFinite(raw.w) ? raw.w : sz.w,
      h: Number.isFinite(raw.h) ? raw.h : sz.h,
      flush: !!raw.flush,
      density: raw.density,
      visibility: raw.visibility,
      settings: raw.settings
    });
  }
  return out;
}

// Is the current minute-of-day within a tile's visibility window?
// Handles wrap-around windows (e.g. 22:00→06:00).
function withinVisibility(vis, nowM) {
  if (!vis || !vis.enabled) return true;
  const a = parseHHMM(vis.from), b = parseHHMM(vis.to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  if (a === b) return true;
  if (a < b) return nowM >= a && nowM < b;
  return nowM >= a || nowM < b;
}

module.exports = { sizeFor, expandLayout, withinVisibility };

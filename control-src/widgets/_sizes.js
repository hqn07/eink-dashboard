// The size contract, resolved.
//
// A widget def declares `sizes` / `defaultSize` / `minSize`. A def with
// `variants` may ALSO declare any of those three on an individual variant,
// which then wins for tiles drawing that variant.
//
// This exists because of the weather merge. `weather_hero` ran 8x4..24x12 —
// a tall showpiece — and `weather_forecast` 6x8..24x6 — a wide outlook. They
// are one widget by every other measure (same question, same provider, same
// location, same units), but a single ladder could only have served one of
// them: the pool card, the add-to-canvas search and the packer would all have
// seeded a forecast tile at the hero's shape. Rather than merge them badly or
// leave them split, the ladder moved to where the difference actually lives.
//
// Def-level values stay the DEFAULT variant's ladder, so every consumer that
// doesn't know a variant (the pool card, a bare widget id) gets a sensible
// answer without asking, and only the variants that genuinely differ carry an
// override.

// Which variant a tile draws — `settings.variant` when the def declares it,
// otherwise the def's default. Same rule as buildTileCtx (_chrome.js), which
// is what the renderer sees; if these two ever disagreed, a tile would be
// measured as one variant and drawn as another.
export function variantOf(def, settings) {
  const name = settings && settings.variant;
  if (name && def && def.variants && def.variants[name]) return name;
  return (def && def.defaultVariant) || null;
}

// -> { sizes, defaultSize, minSize } for a def at a given variant name.
// Pass the variant when you have one; omit it for the def's default.
export function sizeSpec(def, variant) {
  const v = (def && def.variants && def.variants[variant]) || null;
  return {
    sizes:       (v && v.sizes)       || (def && def.sizes)       || {},
    defaultSize: (v && v.defaultSize) || (def && def.defaultSize) || null,
    minSize:     (v && v.minSize)     || (def && def.minSize)     || null,
  };
}

// The spec for a layout item — resolves the item's own variant first.
export function sizeSpecFor(def, item) {
  return sizeSpec(def, variantOf(def, item && item.settings));
}

// Resolve a size key against a spec, falling back to the spec's default.
// -> { size, w, h } or null when the spec declares no sizes at all.
export function resolveSize(spec, sizeKey) {
  const sizes = (spec && spec.sizes) || {};
  const k = (sizeKey && sizes[sizeKey]) ? sizeKey : (spec && spec.defaultSize);
  const sz = k && sizes[k];
  return sz ? { size: k, w: sz.w, h: sz.h } : null;
}

// Grow a tile to its own variant's minimum, clamped to the grid, sliding it
// back inside if growing pushed it off the right or bottom edge. Returns the
// item unchanged when it already clears the minimum.
//
// This is what makes switching view safe on a merged widget: weather's
// forecast needs 6x6 where its hero needs 6x4, so a 6x4 hero told to draw the
// outlook would otherwise land two rows short of anything that view was laid
// out for. It only ever grows — a tile the user sized by hand keeps its size.
export function growToMin(item, def, grid = { cols: 24, rows: 12 }) {
  const min = sizeSpecFor(def, item).minSize;
  if (!item || !min) return item;
  const w = Math.min(grid.cols, Math.max(item.w || 0, min.w || 0));
  const h = Math.min(grid.rows, Math.max(item.h || 0, min.h || 0));
  if (w === item.w && h === item.h) return item;
  return {
    ...item,
    w, h,
    x: Math.max(0, Math.min(item.x || 0, grid.cols - w)),
    y: Math.max(0, Math.min(item.y || 0, grid.rows - h)),
  };
}

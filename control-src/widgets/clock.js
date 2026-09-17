import { def as localDef, render as renderLocal } from './_view-clock.js';
import { def as zonesDef, render as renderZones } from './_view-worldclock.js';

// Clock — the time here, or the time in several places.
//
// `clock` and `world_clock` were two palette entries for one question. Their
// ladders nearly matched (6x3 / 8x4 / 12x6 against 6x4 / 8x5 / 10x6) and the
// distinction a user actually makes is "whose time?", which is a view.
//
// Unlike the other merges, this one keeps BOTH of the zone view's variants
// rather than flattening them: `stack` and `big` are genuinely different
// layouts, and collapsing them would have lost something. So the merged
// variant list is local + the two zone layouts, and the renderers are
// untouched — this file only maps a name to a module.
export const def = {
  id: 'clock',
  label: 'Clock',
  requires: 'clock',
  minSize: { w: 4, h: 2 },
  sizes: {
    S:  { w: 6, h: 3 },
    M:  { w: 8, h: 4 },
    L:  { w: 12, h: 6 },
    XL: { w: 24, h: 6 }
  },
  defaultSize: 'M',
  variants: {
    big:       { label: 'Local — time + date' },
    zones:     { label: 'Zones — label · time rows' },
    zones_big: { label: 'Zones — one place, large' }
  },
  // `big` keeps its name so every existing local-clock tile resolves without
  // a migration; only world_clock tiles are rewritten.
  defaultVariant: 'big',
  defaults: () => ({ variant: 'big', format: '12h', showDate: true })
};

const VIEWS = {
  big:       { render: renderLocal, def: localDef, inner: 'big' },
  zones:     { render: renderZones, def: zonesDef, inner: 'stack' },
  zones_big: { render: renderZones, def: zonesDef, inner: 'big' },
};

export function render(ctx) {
  const s = (ctx && ctx.settings) || {};
  const view = VIEWS[ctx && ctx.variant] || VIEWS[s.variant] || VIEWS.big;
  // The inner renderer resolves `ctx.variant` against its own table, so it
  // gets its own name: 'zones_big' means nothing to the world-clock module.
  return view.render({ ...ctx, variant: view.inner });
}

import { def as sunDef, render as renderSun } from './_view-sun.js';
import { def as uvDef,  render as renderUv }  from './_view-uv.js';
import { def as aqiDef, render as renderAqi } from './_view-aqi.js';

// Outdoors — sunrise/sunset, UV index and air quality in one widget.
//
// The three were separate palette entries that asked the same question of the
// same place: what is it like outside right now? They shared a size ladder
// (6x4 / 8x5 / 10x6), a provider (Open-Meteo, keyless), a location (the
// dashboard's) and a shape (one reading plus a band). After the 2026-09-15
// variant cut each had exactly one variant left, so the only real choice a
// user made was which of the three to place — which is a view, not a widget.
//
// The drawing is NOT reimplemented. Each view keeps its own module and render
// function, now underscore-prefixed so the palette ignores them; this file
// only picks one. A merge that rewrote three proven renderers would be
// risking a regression to save nothing.
export const def = {
  id: 'outdoors',
  label: 'Outdoors',
  requires: [],
  // The union of the three ladders, which barely differed: aqi stopped at
  // 8 wide, sun and uv at 10.
  minSize: { w: 5, h: 3 },
  sizes: {
    S: { w: 6, h: 4 },
    M: { w: 8, h: 5 },
    L: { w: 10, h: 6 }
  },
  defaultSize: 'M',
  variants: {
    sun: { label: 'Sun — rise, set, daylight' },
    uv:  { label: 'UV — index and WHO band' },
    air: { label: 'Air — AQI and category' }
  },
  defaultVariant: 'sun',
  defaults: () => ({ variant: 'sun', title: '' })
};

const VIEWS = {
  sun: { render: renderSun, def: sunDef },
  uv:  { render: renderUv,  def: uvDef },
  air: { render: renderAqi, def: aqiDef }
};

export function render(ctx) {
  const s = (ctx && ctx.settings) || {};
  const view = VIEWS[ctx && ctx.variant] || VIEWS[s.variant] || VIEWS.sun;
  // The inner renderers resolve their own variant as `ctx.variant || …`, so
  // handing them the OUTER variant name ('air') would have them look up a
  // variant they have never heard of. Give each one its own default instead.
  return view.render({ ...ctx, variant: view.def.defaultVariant });
}

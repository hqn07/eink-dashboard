import { def as nowDef, render as renderNow } from './_view-weather-now.js';
import { def as fcDef,  render as renderForecast } from './_view-weather-forecast.js';

// Weather — what it is doing now, or what it will do next.
//
// `weather_hero` and `weather_forecast` were two palette entries asking one
// question of one place. They shared a provider, a location, a units
// override, a stale badge and half a settings form; what a user actually
// chose between them was a view.
//
// This merge was held back once, on measured grounds: the two ladders do not
// match. The hero is a tall showpiece (8x4 .. 24x12) and the outlook is wide
// and short (6x8 .. 24x6), and folding them under one `sizes` would have had
// the pool card, add-to-canvas and the packer seed every forecast tile at the
// hero's shape. The fix was to stop pretending one widget means one ladder —
// see `_sizes.js`. The ladders now hang off the variants, each still written
// in the view module that draws it.
//
// As with the other merges, no renderer was rewritten. Both views keep their
// own module; this file only picks one and hands it its own variant name.
const FORECAST_LADDER = {
  sizes:       fcDef.sizes,
  defaultSize: fcDef.defaultSize,
  minSize:     fcDef.minSize,
};

export const def = {
  id: 'weather',
  label: 'Weather',
  requires: 'weather',
  // Def-level ladder = the default variant's, so a consumer with only a
  // widget id (the pool card, a screen preset) gets the hero's shape without
  // having to ask which view it will draw.
  minSize:     nowDef.minSize,
  sizes:       nowDef.sizes,
  defaultSize: nowDef.defaultSize,
  variants: {
    now:           { label: 'Now — centred stack' },
    now_split:     { label: 'Now — icon left, readings right' },
    forecast:      { label: 'Forecast — day columns',      ...FORECAST_LADDER },
    forecast_rows: { label: 'Forecast — one day per row',  ...FORECAST_LADDER },
  },
  defaultVariant: 'now',
  // The union of both forms' defaults. One widget now seeds one settings
  // object, and the keys the current view ignores cost nothing — while a
  // missing key would cost the reset affordance on every field of the other
  // view the moment the user switches to it.
  defaults: (ctx) => ({
    ...nowDef.defaults(ctx),
    ...fcDef.defaults(ctx),
    variant: 'now',
  }),
};

const VIEWS = {
  now:           { render: renderNow,      inner: 'classic' },
  now_split:     { render: renderNow,      inner: 'split'   },
  forecast:      { render: renderForecast, inner: 'columns' },
  forecast_rows: { render: renderForecast, inner: 'rows'    },
};

export function render(ctx) {
  const s = (ctx && ctx.settings) || {};
  const view = VIEWS[ctx && ctx.variant] || VIEWS[s.variant] || VIEWS.now;
  // Each inner renderer resolves `ctx.variant` against its OWN table, so it
  // gets its own name: 'now_split' means nothing to the hero module.
  return view.render({ ...ctx, variant: view.inner });
}

// Re-exported for the merged form's stats-slot picker.
export { STAT_OPTIONS } from './_view-weather-now.js';

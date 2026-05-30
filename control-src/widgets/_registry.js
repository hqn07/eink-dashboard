// Aggregator for per-widget modules. As widgets migrate from the
// legacy widget-render.js + widgets.js + WidgetForm.jsx triumvirate
// into single-file modules under this directory, register them here.
// Anything not in MIGRATED_DEFS / MIGRATED_RENDERERS / MIGRATED_FORMS
// falls through to the legacy code path.

import * as calendar from './calendar.jsx';
import * as clock from './clock.jsx';
import * as mac_battery from './mac_battery.jsx';
import * as mac_nowplaying from './mac_nowplaying.jsx';
import * as message from './message.jsx';
import * as stocks from './stocks.jsx';
import * as weather_forecast from './weather_forecast.jsx';
import * as weather_hero from './weather_hero.jsx';

const MODULES = [
  calendar,
  clock,
  mac_battery,
  mac_nowplaying,
  message,
  stocks,
  weather_forecast,
  weather_hero
];

// Widget-id → def (registry entry shape used by widgets.js).
export const MIGRATED_DEFS = Object.fromEntries(
  MODULES.map(m => [m.def.id, m.def])
);

// Widget-id → render(data) returning HTML string. Same contract as
// the legacy switch in widget-render.js.
export const MIGRATED_RENDERERS = Object.fromEntries(
  MODULES.map(m => [m.def.id, m.render])
);

// Widget-id → Form React component. Receives shared field primitives
// via the `fields` prop so each widget doesn't have to import them.
export const MIGRATED_FORMS = Object.fromEntries(
  MODULES.filter(m => m.Form).map(m => [m.def.id, m.Form])
);

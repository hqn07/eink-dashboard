// Aggregator for per-widget modules. As widgets migrate from the
// legacy widget-render.js + widgets.js + WidgetForm.jsx triumvirate
// into single-file modules under this directory, register them here.
// Anything not in MIGRATED_DEFS / MIGRATED_RENDERERS / MIGRATED_FORMS
// falls through to the legacy code path.

import * as clock from './clock.jsx';

const MODULES = [
  clock
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

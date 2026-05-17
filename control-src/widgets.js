// Shared widget definitions. Used by both the dashboard renderer (via
// public/dashboard.html, which keeps its own mirror) and the React editor.
// Sizes are predefined presets per widget so users pick from a small set
// rather than dragging arbitrary corners.

export const GRID_COLS = 12;
export const GRID_ROWS = 6;
export const SCREENS = [1, 2];

export const WIDGET_REGISTRY = [
  {
    id: 'weather_hero',
    label: 'Weather · Current',
    requires: 'weather',
    sizes: {
      S:  { w: 4, h: 3 },
      M:  { w: 4, h: 6 },
      L:  { w: 6, h: 6 },
      XL: { w: 12, h: 6 }
    },
    defaultSize: 'M'
  },
  {
    id: 'weather_forecast',
    label: 'Weather · 3-Day Forecast',
    requires: 'weather',
    sizes: {
      S: { w: 3, h: 4 },
      M: { w: 3, h: 6 },
      L: { w: 6, h: 6 }
    },
    defaultSize: 'M'
  },
  {
    id: 'message',
    label: 'Custom Message',
    requires: 'message',
    sizes: {
      S:  { w: 4, h: 2 },
      M:  { w: 5, h: 2 },
      L:  { w: 12, h: 2 },
      XL: { w: 12, h: 3 }
    },
    defaultSize: 'M'
  },
  {
    id: 'todos',
    label: 'To-Do List',
    requires: 'todos',
    sizes: {
      S:  { w: 4, h: 3 },
      M:  { w: 5, h: 3 },
      L:  { w: 6, h: 6 },
      XL: { w: 12, h: 6 }
    },
    defaultSize: 'M'
  },
  {
    id: 'calendar',
    label: 'Calendar',
    requires: 'calendar',
    sizes: {
      S: { w: 4, h: 2 },
      M: { w: 5, h: 2 },
      L: { w: 12, h: 2 }
    },
    defaultSize: 'M'
  },
  {
    id: 'spacer',
    label: 'Black Bar',
    requires: 'spacer',
    sizes: {
      S:  { w: 12, h: 1 },
      M:  { w: 6,  h: 1 },
      L:  { w: 4,  h: 6 },
      XL: { w: 12, h: 2 }
    },
    defaultSize: 'S'
  },
  {
    id: 'quote',
    label: 'Text / Quote',
    requires: 'quote',
    sizes: {
      S:  { w: 4, h: 2 },
      M:  { w: 6, h: 3 },
      L:  { w: 12, h: 3 },
      XL: { w: 12, h: 6 }
    },
    defaultSize: 'M'
  }
];

export function widgetById(id) {
  return WIDGET_REGISTRY.find(w => w.id === id);
}

// Default positions for screen 1 (full editorial). Screen 2 = minimal hero only.
const DEFAULT_LAYOUTS = {
  1: [
    { id: 'weather_hero',     x: 0, y: 0, size: 'M', enabled: true },
    { id: 'weather_forecast', x: 4, y: 0, size: 'M', enabled: true },
    { id: 'message',          x: 7, y: 0, size: 'M', enabled: true },
    { id: 'todos',            x: 7, y: 2, size: 'M', enabled: true },
    { id: 'calendar',         x: 7, y: 4, size: 'M', enabled: false },
    { id: 'spacer',           x: 0, y: 0, size: 'S', enabled: false },
    { id: 'quote',            x: 0, y: 0, size: 'M', enabled: false }
  ],
  2: [
    { id: 'weather_hero',     x: 0, y: 0, size: 'XL', enabled: true },
    { id: 'weather_forecast', x: 0, y: 0, size: 'M',  enabled: false },
    { id: 'message',          x: 0, y: 0, size: 'M',  enabled: false },
    { id: 'todos',            x: 0, y: 0, size: 'M',  enabled: false },
    { id: 'calendar',         x: 0, y: 0, size: 'M',  enabled: false },
    { id: 'spacer',           x: 0, y: 0, size: 'S',  enabled: false },
    { id: 'quote',            x: 0, y: 0, size: 'M',  enabled: false }
  ]
};

function sizeFor(def, sizeKey) {
  const k = sizeKey && def.sizes[sizeKey] ? sizeKey : def.defaultSize;
  return { size: k, ...def.sizes[k] };
}

// Resolve a raw layout array into one with width/height filled in.
// Each item gets an instance `id` and a `widgetId` (registry key).
// Old layouts (without instance ids) are migrated: `id` from storage
// becomes both the instance id and the widget id.
export function expandLayout(rawLayout = []) {
  const items = [];
  for (const raw of rawLayout) {
    const widgetId = raw.widgetId || raw.id;
    const def = widgetById(widgetId);
    if (!def) continue;
    if (raw.enabled === false) continue; // dropped widgets simply aren't in the layout anymore
    const sz = sizeFor(def, raw.size);
    items.push({
      id: raw.id || newInstanceId(widgetId),
      widgetId,
      x: Number.isFinite(raw.x) ? raw.x : 0,
      y: Number.isFinite(raw.y) ? raw.y : 0,
      w: Number.isFinite(raw.w) ? raw.w : sz.w,
      h: Number.isFinite(raw.h) ? raw.h : sz.h,
      size: sz.size,
      flush: !!raw.flush
    });
  }
  return items;
}

// Returns the expanded layout for the requested screen, falling back to
// legacy `cfg.layout` if `cfg.layouts` isn't set.
export function getScreenLayout(cfg, screen) {
  const s = (screen === 2) ? 2 : 1;
  let source = null;
  if (cfg.layouts && Array.isArray(cfg.layouts[s]) && cfg.layouts[s].length) {
    source = cfg.layouts[s];
  } else if (s === 1 && Array.isArray(cfg.layout) && cfg.layout.length) {
    source = cfg.layout;
  } else {
    source = DEFAULT_LAYOUTS[s];
  }
  return expandLayout(source);
}

// Store layout with explicit geometry so the dashboard renderer doesn't
// need to know about size presets. `id` is the unique instance id;
// `widgetId` is the registry key (multiple instances may share it).
export function compactLayout(items) {
  return items.map(({ id, widgetId, x, y, w, h, size, enabled, flush }) => ({
    id, widgetId: widgetId || id, x, y, w, h, size, enabled, flush: !!flush
  }));
}

let _instanceCounter = 0;
export function newInstanceId(widgetId) {
  _instanceCounter += 1;
  return `${widgetId}-${Date.now().toString(36)}-${_instanceCounter}`;
}

export function defaultsForScreen(screen) {
  return expandLayout(DEFAULT_LAYOUTS[screen === 2 ? 2 : 1]);
}

// Helper for the editor: build a fresh layout item for a new instance
// of the given widget at given position/size.
export function makeInstance(widgetId, { x = 0, y = 0, w, h, sizeKey } = {}) {
  const def = widgetById(widgetId);
  if (!def) return null;
  const sz = sizeFor(def, sizeKey);
  return {
    id: newInstanceId(widgetId),
    widgetId,
    x, y,
    w: Number.isFinite(w) ? w : sz.w,
    h: Number.isFinite(h) ? h : sz.h,
    size: sz.size,
    flush: false
  };
}

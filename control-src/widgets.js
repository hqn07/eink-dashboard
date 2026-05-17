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
// Stored geometry (`w`/`h`) wins; otherwise fall back to the `size`
// preset. Adds any missing registry entries as disabled tiles so the
// editor can show every widget in the pool.
export function expandLayout(rawLayout = []) {
  const byId = new Map(rawLayout.map(l => [l.id, l]));
  return WIDGET_REGISTRY.map(def => {
    const stored = byId.get(def.id);
    const dl = (DEFAULT_LAYOUTS[1].find(d => d.id === def.id)) || { x: 0, y: 0, size: def.defaultSize, enabled: false };
    const merged = { ...dl, ...(stored || {}) };
    const sz = sizeFor(def, merged.size);
    return {
      id: def.id,
      x: Number.isFinite(merged.x) ? merged.x : 0,
      y: Number.isFinite(merged.y) ? merged.y : 0,
      w: Number.isFinite(merged.w) ? merged.w : sz.w,
      h: Number.isFinite(merged.h) ? merged.h : sz.h,
      size: sz.size,
      enabled: merged.enabled !== false,
      flush: !!merged.flush
    };
  });
}

// Returns the expanded layout for the requested screen, falling back to
// legacy `cfg.layout` if `cfg.layouts` isn't set.
export function getScreenLayout(cfg, screen) {
  const s = (screen === 2) ? 2 : 1;
  if (cfg.layouts && Array.isArray(cfg.layouts[s])) {
    return expandLayout(cfg.layouts[s]);
  }
  // Legacy: cfg.layout (single) used for screen 1; defaults for screen 2.
  if (s === 1 && Array.isArray(cfg.layout)) {
    return expandLayout(cfg.layout);
  }
  return expandLayout(DEFAULT_LAYOUTS[s]);
}

// Store layout with explicit geometry so the dashboard renderer doesn't
// need to know about size presets. Editor still uses `size` for preset
// buttons; we round-trip the key when present.
export function compactLayout(items) {
  return items.map(({ id, x, y, w, h, size, enabled, flush }) => ({
    id, x, y, w, h, size, enabled, flush: !!flush
  }));
}

export function defaultsForScreen(screen) {
  return expandLayout(DEFAULT_LAYOUTS[screen === 2 ? 2 : 1]);
}

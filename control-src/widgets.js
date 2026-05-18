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
    label: 'Weather · Forecast',
    requires: 'weather',
    sizes: {
      S: { w: 3, h: 4 },
      M: { w: 3, h: 6 },
      L: { w: 6, h: 6 },
      XL: { w: 12, h: 3 }
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
  },
  {
    id: 'clock',
    label: 'Clock',
    requires: 'clock',
    sizes: {
      S:  { w: 4, h: 2 },
      M:  { w: 6, h: 2 },
      L:  { w: 12, h: 2 },
      XL: { w: 12, h: 3 }
    },
    defaultSize: 'M'
  },
  {
    id: 'wifi_qr',
    label: 'WiFi QR Code',
    requires: 'wifi',
    sizes: {
      S: { w: 3, h: 3 },
      M: { w: 4, h: 4 },
      L: { w: 6, h: 6 }
    },
    defaultSize: 'M'
  },
  {
    id: 'countdown',
    label: 'Countdown',
    requires: 'countdowns',
    sizes: {
      S: { w: 4, h: 2 },
      M: { w: 6, h: 2 },
      L: { w: 12, h: 2 }
    },
    defaultSize: 'M'
  },
  {
    id: 'aqi',
    label: 'Air Quality',
    requires: 'aqi',
    sizes: {
      S: { w: 4, h: 2 },
      M: { w: 4, h: 3 },
      L: { w: 6, h: 3 }
    },
    defaultSize: 'M'
  },
  {
    id: 'moonsun',
    label: 'Moon & Sun',
    requires: 'moonsun',
    sizes: {
      S: { w: 4, h: 2 },
      M: { w: 4, h: 3 },
      L: { w: 6, h: 3 }
    },
    defaultSize: 'M'
  },
  {
    id: 'news',
    label: 'News Headlines',
    requires: 'news',
    sizes: {
      S: { w: 6, h: 3 },
      M: { w: 6, h: 6 },
      L: { w: 12, h: 6 }
    },
    defaultSize: 'M'
  },
  {
    id: 'stocks',
    label: 'Stocks / Crypto',
    requires: 'stocks',
    sizes: {
      S: { w: 4, h: 2 },
      M: { w: 6, h: 3 },
      L: { w: 12, h: 3 }
    },
    defaultSize: 'M'
  },
  {
    id: 'photo',
    label: 'Photo / Image',
    requires: 'photo',
    sizes: {
      S: { w: 4, h: 3 },
      M: { w: 6, h: 6 },
      L: { w: 12, h: 6 }
    },
    defaultSize: 'M'
  },
  {
    id: 'github',
    label: 'GitHub Activity',
    requires: 'github',
    sizes: {
      S: { w: 6, h: 2 },
      M: { w: 12, h: 2 },
      L: { w: 12, h: 3 }
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

// ============ SCREENS (new schema) ============
// `cfg.screens` is a flat array. Each screen owns its layout +
// schedule + per-screen settings. One screen is marked `isDefault`
// and is used whenever no scheduled screen matches the current time
// (or when no screens have schedule enabled at all).

let _screenCounter = 0;
export function newScreenId() {
  _screenCounter += 1;
  return `scr-${Date.now().toString(36)}-${_screenCounter}`;
}

export function makeDefaultScreen(template = {}) {
  return {
    id: newScreenId(),
    name: template.name || 'Screen',
    isDefault: false,
    schedule: { enabled: false, from: '07:00', to: '22:00' },
    units: template.units || 'F',
    refreshMinutes: Number.isFinite(template.refreshMinutes) ? template.refreshMinutes : 30,
    layout: template.layout ? template.layout.map(l => ({ ...l })) : []
  };
}

// Migrate old config shape (cfg.layouts + cfg.schedule + cfg.units +
// cfg.refreshMinutes) into the new cfg.screens array. Idempotent —
// once cfg.screens exists, return as-is.
export function migrateConfigToScreens(cfg) {
  if (Array.isArray(cfg.screens) && cfg.screens.length) return cfg;
  const oldLayouts = cfg.layouts || (Array.isArray(cfg.layout) ? { 1: cfg.layout } : { 1: [] });
  const sched = cfg.schedule || {};
  const sActive = sched.active || {};
  const sQuiet  = sched.quiet  || {};
  const screens = [];
  screens.push({
    id: newScreenId(),
    name: 'Day',
    isDefault: true,
    schedule: sched.enabled
      ? { enabled: true, from: sched.activeFrom || '07:00', to: sched.activeTo || '22:00' }
      : { enabled: false, from: '07:00', to: '22:00' },
    units: cfg.units || 'F',
    refreshMinutes: sActive.refreshMinutes || cfg.refreshMinutes || 30,
    layout: (oldLayouts[1] || []).map(l => ({ ...l }))
  });
  if (oldLayouts[2] && oldLayouts[2].length) {
    screens.push({
      id: newScreenId(),
      name: 'Night',
      isDefault: false,
      schedule: sched.enabled
        ? { enabled: true, from: sched.activeTo || '22:00', to: sched.activeFrom || '07:00' }
        : { enabled: false, from: '22:00', to: '07:00' },
      units: cfg.units || 'F',
      refreshMinutes: sQuiet.refreshMinutes || 120,
      layout: (oldLayouts[2] || []).map(l => ({ ...l }))
    });
  }
  return { ...cfg, screens };
}

// ============ TIME / SCHEDULE HELPERS ============

export function parseHHMM(s) {
  if (typeof s !== 'string') return NaN;
  const m = s.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Each enabled schedule becomes one or two [a,b) minute intervals
// in 24h linear space. Wrapping windows (from > to) split.
export function scheduleIntervals(sch) {
  if (!sch || !sch.enabled) return [];
  const a = parseHHMM(sch.from);
  const b = parseHHMM(sch.to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return [];
  if (a < b) return [[a, b]];
  return [[a, 1440], [0, b]];
}

// Returns array of overlap descriptions between enabled screens.
// Each entry: { screenAId, screenBId, range: [a,b] }.
export function findOverlaps(screens) {
  const intervals = [];
  for (const s of screens) {
    for (const [a, b] of scheduleIntervals(s.schedule)) {
      intervals.push({ screenId: s.id, a, b });
    }
  }
  intervals.sort((x, y) => x.a - y.a);
  const overlaps = [];
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      if (intervals[i].screenId === intervals[j].screenId) continue;
      const x = intervals[i], y = intervals[j];
      if (y.a >= x.b) break;
      overlaps.push({ screenAId: x.screenId, screenBId: y.screenId, range: [Math.max(x.a, y.a), Math.min(x.b, y.b)] });
    }
  }
  return overlaps;
}

// Pick which screen should render *now* for the given timezone.
// Returns the matching screen or, if none, the default screen.
export function pickActiveScreen(cfg, nowMinutes) {
  if (!cfg.screens || !cfg.screens.length) return null;
  for (const s of cfg.screens) {
    const ints = scheduleIntervals(s.schedule);
    for (const [a, b] of ints) {
      if (nowMinutes >= a && nowMinutes < b) return s;
    }
  }
  return cfg.screens.find(s => s.isDefault) || cfg.screens[0];
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

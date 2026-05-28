// Shared widget definitions. Used by both the dashboard renderer (via
// public/dashboard.html, which keeps its own mirror) and the React editor.
// Sizes are predefined presets per widget so users pick from a small set
// rather than dragging arbitrary corners.

export const GRID_COLS = 24;
export const GRID_ROWS = 12;
// Bump this whenever the grid resolution changes so old saved configs
// can be migrated.
// v1 = 12x6  (Apr 2026 → May 2026, rectangular cells)
// v2 = 12x12 (May 18 2026, finer h but rectangular cells)
// v3 = 24x12 (this — square cells, fine in both axes)
export const GRID_VERSION = 3;
export const SCREENS = [1, 2];

// Sizes are in 24x12 grid units. With body ≈ 800px × 392-452px, cells
// are ~33px square. h heights match the 12x12 era; only w doubled.
export const WIDGET_REGISTRY = [
  {
    id: 'weather_hero',
    label: 'Weather · Current',
    requires: 'weather',
    minSize: { w: 6, h: 4 },
    sizes: {
      XS: { w: 8, h: 4 },
      S:  { w: 8, h: 6 },
      M:  { w: 8, h: 12 },
      L:  { w: 12, h: 12 },
      XL: { w: 24, h: 12 }
    },
    defaultSize: 'M',
    // Every widget is on the self-contained-settings contract: tiles
    // always carry their own `settings` object. The factory receives a
    // one-time seed context (from the setup wizard's saved location) so
    // a freshly-dropped weather tile renders the user's home location
    // by default — the tile still owns its settings afterwards.
    defaults: (ctx) => ({
      city: (ctx && ctx.city) || '',
      lat:  (ctx && Number.isFinite(ctx.lat)) ? ctx.lat : null,
      lon:  (ctx && Number.isFinite(ctx.lon)) ? ctx.lon : null
    })
  },
  {
    id: 'weather_forecast',
    label: 'Weather · Forecast',
    requires: 'weather',
    minSize: { w: 6, h: 6 },
    sizes: {
      S:  { w: 6, h: 8 },
      M:  { w: 6, h: 12 },
      L:  { w: 12, h: 12 },
      XL: { w: 24, h: 6 }
    },
    defaultSize: 'M',
    defaults: (ctx) => ({
      city: (ctx && ctx.city) || '',
      lat:  (ctx && Number.isFinite(ctx.lat)) ? ctx.lat : null,
      lon:  (ctx && Number.isFinite(ctx.lon)) ? ctx.lon : null,
      forecastDays: null
    })
  },
  {
    id: 'message',
    label: 'Custom Message',
    requires: 'message',
    minSize: { w: 6, h: 2 },
    sizes: {
      XS: { w: 8, h: 3 },
      S:  { w: 8, h: 4 },
      M:  { w: 10, h: 4 },
      L:  { w: 24, h: 4 },
      XL: { w: 24, h: 6 }
    },
    defaultSize: 'M',
    defaults: () => ({ text: '', subtitle: '', schedule: [] })
  },
  {
    id: 'calendar',
    label: 'Calendar',
    requires: 'calendar',
    minSize: { w: 6, h: 3 },
    sizes: {
      S: { w: 8, h: 4 },
      M: { w: 10, h: 4 },
      L: { w: 24, h: 4 },
      XL: { w: 24, h: 8 }
    },
    defaultSize: 'M',
    defaults: () => ({ icalUrls: [] })
  },
  {
    id: 'stocks',
    label: 'Stocks / Crypto',
    requires: 'stocks',
    minSize: { w: 6, h: 3 },
    sizes: {
      S: { w: 8, h: 4 },
      M: { w: 12, h: 6 },
      L: { w: 24, h: 6 },
      XL: { w: 24, h: 12 }
    },
    defaultSize: 'M',
    defaults: () => ({ symbols: [] })
  },
  // Mac-only widgets — only render data when the server is running on
  // the user's Mac (LAN path). On Railway/Linux they show MAC OFFLINE.
  {
    id: 'mac_nowplaying',
    label: 'Mac · Now Playing',
    requires: 'mac_nowplaying',
    minSize: { w: 6, h: 2 },
    sizes: {
      S:  { w: 8, h: 3 },
      M:  { w: 12, h: 3 },
      L:  { w: 24, h: 3 },
      XL: { w: 24, h: 6 }
    },
    defaultSize: 'M',
    defaults: () => ({})
  },
  {
    id: 'mac_battery',
    label: 'Mac · Battery',
    requires: 'mac_battery',
    minSize: { w: 3, h: 2 },
    sizes: {
      S:  { w: 4, h: 2 },
      M:  { w: 6, h: 3 },
      L:  { w: 8, h: 3 }
    },
    defaultSize: 'S',
    defaults: () => ({})
  },
  {
    id: 'mac_focus',
    label: 'Mac · Focus',
    requires: 'mac_focus',
    minSize: { w: 3, h: 2 },
    sizes: {
      S:  { w: 4, h: 2 },
      M:  { w: 6, h: 3 }
    },
    defaultSize: 'S',
    defaults: () => ({})
  },
  {
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
    defaults: () => ({ format: '12h', showDate: true, style: 'big' })
  }
];

// Tier resolver — returns one of: tiny | compact | standard | extended | full.
// Widgets use this to pick a layout that fits the cell. Width and height
// are both considered; the lower-cap wins so a very wide but short cell
// gets the shorter tier.
export function pickTier(cellW, cellH, density) {
  const w = cellW || 0, h = cellH || 0;
  let byH = 'full';
  if (h < 4)       byH = 'tiny';
  else if (h < 6)  byH = 'compact';
  else if (h < 8)  byH = 'standard';
  else if (h < 12) byH = 'extended';
  let byW = 'full';
  if (w < 6)       byW = 'tiny';
  else if (w < 8)  byW = 'compact';
  else if (w < 12) byW = 'standard';
  else if (w < 18) byW = 'extended';
  const order = ['tiny', 'compact', 'standard', 'extended', 'full'];
  let idx = Math.min(order.indexOf(byH), order.indexOf(byW));
  // Per-tile density override — bumps the tier up or down one step
  // without changing the actual cell size.
  if (density === 'rich')   idx = Math.min(idx + 1, order.length - 1);
  if (density === 'sparse') idx = Math.max(idx - 1, 0);
  return order[idx];
}

export function widgetById(id) {
  return WIDGET_REGISTRY.find(w => w.id === id);
}

// Default positions for screen 1 (editorial). Screen 2 = minimal hero only.
// x/y-coords in 24x12 grid units.
const DEFAULT_LAYOUTS = {
  1: [
    { id: 'weather_hero',     x: 0,  y: 0, size: 'M', enabled: true },
    { id: 'weather_forecast', x: 8,  y: 0, size: 'M', enabled: true },
    { id: 'message',          x: 14, y: 0, size: 'M', enabled: true },
    { id: 'calendar',         x: 14, y: 4, size: 'M', enabled: true }
  ],
  2: [
    { id: 'weather_hero',     x: 0, y: 0, size: 'XL', enabled: true },
    { id: 'weather_forecast', x: 0, y: 0, size: 'M',  enabled: false },
    { id: 'message',          x: 0, y: 0, size: 'M',  enabled: false },
    { id: 'calendar',         x: 0, y: 0, size: 'M',  enabled: false }
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

export const DEFAULT_CHROME = {
  header: {
    enabled: true,
    left: '{city}',
    leftSub: '{date}',
    right: '{time}',
    rightSub: 'EDITION No. {edition}'
  },
  footer: {
    enabled: true,
    text: 'UPDATED {time} · REFRESH {refresh}MIN · THE DAILY {city}'
  }
};

// Curated starter layouts. User picks one when they click "+ Add Screen".
// All coords are in the live 24x12 grid.
export const SCREEN_PRESETS = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Empty canvas — start from scratch.',
    layout: []
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Newspaper feel: weather + forecast + message + calendar.',
    layout: [
      { widgetId: 'weather_hero',     x: 0,  y: 0, w: 8,  h: 12 },
      { widgetId: 'weather_forecast', x: 8,  y: 0, w: 6,  h: 12 },
      { widgetId: 'message',          x: 14, y: 0, w: 10, h: 4 },
      { widgetId: 'calendar',         x: 14, y: 4, w: 10, h: 8 }
    ]
  },
  {
    id: 'minimal_hero',
    name: 'Just Weather',
    description: 'Just the weather, full-bleed.',
    layout: [
      { widgetId: 'weather_hero', x: 0, y: 0, w: 24, h: 12 }
    ]
  }
];

// Inflate a preset's layout into real instances (each item gets its own
// instance id + a sizeKey hint based on its w/h).
export function inflatePresetLayout(preset) {
  if (!preset || !Array.isArray(preset.layout)) return [];
  return preset.layout.map(item => ({
    id: newInstanceId(item.widgetId),
    widgetId: item.widgetId,
    x: item.x, y: item.y, w: item.w, h: item.h,
    flush: false
  }));
}

export function makeDefaultScreen(template = {}) {
  return {
    id: newScreenId(),
    name: template.name || 'Screen',
    isDefault: false,
    schedule: { enabled: false, from: '07:00', to: '22:00' },
    units: template.units || 'F',
    refreshMinutes: Number.isFinite(template.refreshMinutes) ? template.refreshMinutes : 30,
    chrome: JSON.parse(JSON.stringify(DEFAULT_CHROME)),
    layout: template.layout ? template.layout.map(l => ({ ...l })) : []
  };
}

// Migrate old config shape (cfg.layouts + cfg.schedule + cfg.units +
// cfg.refreshMinutes) into the new cfg.screens array. Idempotent —
// once cfg.screens exists, return as-is.
// Migrate a v1 (12x6) layout to v2 (12x12) by doubling y + h. x and w unchanged.
function migrateLayoutV1ToV2(layout) {
  return (layout || []).map(l => ({
    ...l,
    y: (Number.isFinite(l.y) ? l.y : 0) * 2,
    h: (Number.isFinite(l.h) ? l.h : 0) * 2 || undefined
  }));
}
// Migrate a v2 (12x12) layout to v3 (24x12) by doubling x + w. y + h unchanged.
function migrateLayoutV2ToV3(layout) {
  return (layout || []).map(l => ({
    ...l,
    x: (Number.isFinite(l.x) ? l.x : 0) * 2,
    w: (Number.isFinite(l.w) ? l.w : 0) * 2 || undefined
  }));
}

export function migrateConfigToScreens(cfg) {
  if (Array.isArray(cfg.screens) && cfg.screens.length) {
    let screens = cfg.screens;
    const v = cfg.gridVersion || 1;
    if (v < 2) screens = screens.map(s => ({ ...s, layout: migrateLayoutV1ToV2(s.layout) }));
    if (v < 3) screens = screens.map(s => ({ ...s, layout: migrateLayoutV2ToV3(s.layout) }));
    screens = screens.map(s => s.chrome
      ? s
      : { ...s, chrome: JSON.parse(JSON.stringify(DEFAULT_CHROME)) });
    // If the default screen still has zero widgets (legacy empty install),
    // seed it with the Editorial preset so the user sees something.
    if (!cfg.firstRunSeeded) {
      const def = screens.find(s => s.isDefault) || screens[0];
      if (def && (!def.layout || def.layout.length === 0)) {
        const editorial = SCREEN_PRESETS.find(p => p.id === 'editorial');
        if (editorial) {
          def.layout = inflatePresetLayout(editorial);
          cfg = { ...cfg, firstRunSeeded: true };
        }
      } else {
        cfg = { ...cfg, firstRunSeeded: true };
      }
    }
    return { ...cfg, screens, gridVersion: GRID_VERSION };
  }
  const oldLayouts = cfg.layouts || (Array.isArray(cfg.layout) ? { 1: cfg.layout } : { 1: [] });
  const sched = cfg.schedule || {};
  const sActive = sched.active || {};
  const sQuiet  = sched.quiet  || {};
  // Pre-screens configs were authored against the 12x6 grid → walk both migrations.
  const migrateOld = (l) => migrateLayoutV2ToV3(migrateLayoutV1ToV2((l || []).map(it => ({ ...it }))));
  // Brand-new installs (no legacy layout, no screens) get the Editorial
  // preset so they don't land on a blank canvas.
  const editorialPreset = SCREEN_PRESETS.find(p => p.id === 'editorial');
  const seedLayout = migrateOld(oldLayouts[1]);
  const dayLayout = seedLayout.length ? seedLayout : inflatePresetLayout(editorialPreset);
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
    chrome: JSON.parse(JSON.stringify(DEFAULT_CHROME)),
    layout: dayLayout
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
      chrome: JSON.parse(JSON.stringify(DEFAULT_CHROME)),
      layout: migrateOld(oldLayouts[2])
    });
  }
  const ensured = screens.map(s => s.chrome ? s : { ...s, chrome: JSON.parse(JSON.stringify(DEFAULT_CHROME)) });
  return { ...cfg, screens: ensured, gridVersion: GRID_VERSION };
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
export function makeInstance(widgetId, { x = 0, y = 0, w, h, sizeKey } = {}, seedCtx) {
  const def = widgetById(widgetId);
  if (!def) return null;
  const sz = sizeFor(def, sizeKey);
  const inst = {
    id: newInstanceId(widgetId),
    widgetId,
    x, y,
    w: Number.isFinite(w) ? w : sz.w,
    h: Number.isFinite(h) ? h : sz.h,
    size: sz.size,
    flush: false
  };
  // Seed settings from the registry factory so the tile is self-contained
  // from the moment it's dropped. `seedCtx` (e.g. the saved setup-wizard
  // location) is a one-time hint; once on the tile, settings are owned
  // exclusively by the tile.
  if (typeof def.defaults === 'function') {
    inst.settings = def.defaults(seedCtx);
  }
  return inst;
}

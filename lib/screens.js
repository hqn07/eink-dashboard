// Per-screen schedule resolution + config/layout migrations. Operates on a
// config object passed in (loaded by config-store) and the request query for
// screen/units overrides. Pure aside from a monotonic screen-id counter.
const { localMinutesNow, scheduleIntervals } = require('./timewin');

let _screenIdSeed = 0;
function newScreenId() {
  _screenIdSeed += 1;
  return `scr-${Date.now().toString(36)}-${_screenIdSeed}`;
}

const GRID_VERSION = 4;

// Fixed-rect layout primitives. Each entry maps a layoutKind name to an
// ordered list of cell rectangles on the 24x12 grid; screens with
// `layoutKind !== 'free'` populate widgets by slot index instead of dragging
// tiles around. Mirrors TRMNL's full / half_h / half_v / quadrant set.
const LAYOUT_SLOTS = {
  full:            [{ x: 0,  y: 0, w: 24, h: 12 }],
  half_horizontal: [{ x: 0,  y: 0, w: 24, h: 6  }, { x: 0,  y: 6, w: 24, h: 6 }],
  half_vertical:   [{ x: 0,  y: 0, w: 12, h: 12 }, { x: 12, y: 0, w: 12, h: 12 }],
  quadrant:        [
    { x: 0,  y: 0, w: 12, h: 6 },
    { x: 12, y: 0, w: 12, h: 6 },
    { x: 0,  y: 6, w: 12, h: 6 },
    { x: 12, y: 6, w: 12, h: 6 }
  ]
};

// Resolve the layout array a screen should render. For `free` (the legacy
// default) return the saved freeform `layout[]`. For a primitive, generate the
// layout from `slots[]` so the renderer doesn't need to know about layoutKind.
function resolveScreenLayout(screen) {
  if (!screen) return [];
  const kind = screen.layoutKind || 'free';
  if (kind === 'free') return Array.isArray(screen.layout) ? screen.layout : [];
  const slots = LAYOUT_SLOTS[kind];
  if (!slots) return Array.isArray(screen.layout) ? screen.layout : [];
  const picks = Array.isArray(screen.slots) ? screen.slots : [];
  const out = [];
  for (let i = 0; i < slots.length; i++) {
    const widgetId = picks[i] && picks[i].widgetId ? picks[i].widgetId : picks[i];
    if (!widgetId) continue;
    out.push({
      id: `slot-${i}-${widgetId}`,
      widgetId,
      x: slots[i].x, y: slots[i].y, w: slots[i].w, h: slots[i].h,
      enabled: true,
      settings: (picks[i] && picks[i].settings) || undefined
    });
  }
  return out;
}

function migrateLayoutV1ToV2(layout) {
  return (layout || []).map(l => ({
    ...l,
    y: (Number.isFinite(l.y) ? l.y : 0) * 2,
    h: (Number.isFinite(l.h) ? l.h : 0) * 2 || undefined
  }));
}
function migrateLayoutV2ToV3(layout) {
  return (layout || []).map(l => ({
    ...l,
    x: (Number.isFinite(l.x) ? l.x : 0) * 2,
    w: (Number.isFinite(l.w) ? l.w : 0) * 2 || undefined
  }));
}

// Editorial preset layout (24x12 grid). Mirrors SCREEN_PRESETS.editorial in
// control-src/widgets.js. Server can't import that ESM module, so we inline a
// copy here for first-install seeding.
const EDITORIAL_LAYOUT = [
  { widgetId: 'weather_hero',     x: 0,  y: 0, w: 8,  h: 12 },
  { widgetId: 'weather_forecast', x: 8,  y: 0, w: 6,  h: 12 },
  { widgetId: 'text',             x: 14, y: 0, w: 10, h: 4, settings: { variant: 'card' } },
  { widgetId: 'calendar',         x: 14, y: 4, w: 10, h: 8 }
];
function seedLayoutFromEditorial() {
  return EDITORIAL_LAYOUT.map((it, i) => ({
    id: `seed-${it.widgetId}-${i}`,
    widgetId: it.widgetId,
    x: it.x, y: it.y, w: it.w, h: it.h,
    flush: false,
    ...(it.settings ? { settings: { ...it.settings } } : {})
  }));
}

// Widget-id migrations (widgets-refresh W0). Dead widgets drop out of saved
// layouts; merged/renamed widgets map forward, optionally rewriting their
// settings. Runs on every config load (idempotent). Mirrored in
// control-src/widgets.js — keep both tables in sync.
const WIDGET_ID_MIGRATIONS = {
  stocks: null,  // killed 2026-06-12
  message:  { id: 'text', settings: (s) => ({ ...s, variant: 'card' }) },
  text_bar: { id: 'text', settings: (s) => ({ ...s, variant: 'bar' }) }
};
function migrateWidgetIds(layout) {
  return (layout || []).flatMap(it => {
    const wid = it.widgetId || it.id;
    if (!(wid in WIDGET_ID_MIGRATIONS)) return [it];
    const m = WIDGET_ID_MIGRATIONS[wid];
    if (!m) return [];
    return [{ ...it, widgetId: m.id, settings: m.settings ? m.settings(it.settings || {}) : it.settings }];
  });
}

function migrateConfigToScreens(cfg) {
  if (Array.isArray(cfg.screens) && cfg.screens.length) {
    let screens = cfg.screens;
    const v = cfg.gridVersion || 1;
    if (v < 2) screens = screens.map(s => ({ ...s, layout: migrateLayoutV1ToV2(s.layout) }));
    if (v < 3) screens = screens.map(s => ({ ...s, layout: migrateLayoutV2ToV3(s.layout) }));
    screens = screens.map(s => ({ ...s, layout: migrateWidgetIds(s.layout) }));
    // v4: every screen gains a `layoutKind` field. Default `free` so existing
    // freeform grids keep working — opt-in to a primitive is a deliberate edit.
    if (v < 4) screens = screens.map(s =>
      s.layoutKind ? s : { ...s, layoutKind: 'free' });
    // Seed an empty default screen with the Editorial preset (one-time).
    if (!cfg.firstRunSeeded) {
      const def = screens.find(s => s.isDefault) || screens[0];
      if (def && (!def.layout || def.layout.length === 0)) {
        def.layout = seedLayoutFromEditorial();
      }
      cfg = { ...cfg, firstRunSeeded: true };
    }
    return { ...cfg, screens, gridVersion: GRID_VERSION };
  }
  const oldLayouts = cfg.layouts || (Array.isArray(cfg.layout) ? { 1: cfg.layout } : { 1: [] });
  const sched = cfg.schedule || {};
  const sActive = sched.active || {};
  const sQuiet  = sched.quiet  || {};
  const migrateOld = (l) => migrateWidgetIds(migrateLayoutV2ToV3(migrateLayoutV1ToV2((l || []).map(it => ({ ...it })))));
  const screens = [];
  const oldLayout = migrateOld(oldLayouts[1]);
  screens.push({
    id: newScreenId(),
    name: 'Day',
    isDefault: true,
    schedule: sched.enabled
      ? { enabled: true, from: sched.activeFrom || '07:00', to: sched.activeTo || '22:00' }
      : { enabled: false, from: '07:00', to: '22:00' },
    units: cfg.units || 'F',
    refreshMinutes: sActive.refreshMinutes || cfg.refreshMinutes || 30,
    layout: oldLayout.length ? oldLayout : seedLayoutFromEditorial()
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
      layout: migrateOld(oldLayouts[2])
    });
  }
  return { ...cfg, screens, gridVersion: GRID_VERSION, firstRunSeeded: true };
}

// Returns the active screen for the given cfg + current time. Falls back to
// the default screen when no schedule matches.
function pickActiveScreen(cfg) {
  if (!cfg.screens || !cfg.screens.length) return null;
  // Playlist mode: cycle through every enabled screen on a fixed wall-clock
  // cadence, independent of per-screen schedules. Deterministic (no in-memory
  // counter) so multiple calls in the same refresh window resolve the same.
  const playlist = cfg.playlist || {};
  if (playlist.enabled) {
    const live = cfg.screens.filter(s => s.enabled !== false);
    if (live.length) {
      const minutesPer = Math.max(1, parseInt(playlist.minutesPerScreen, 10) || 5);
      const epochMin = Math.floor(Date.now() / 60000);
      return live[Math.floor(epochMin / minutesPer) % live.length];
    }
  }
  const now = localMinutesNow(cfg.timezone || 'UTC');
  for (const s of cfg.screens) {
    const ints = scheduleIntervals(s.schedule);
    for (const [a, b] of ints) {
      if (now >= a && now < b) return s;
    }
  }
  return cfg.screens.find(s => s.isDefault) || cfg.screens[0];
}

// `?screen=id` overrides the time-based pick. Accepts a screen id or a numeric
// 1..N index for back-compat with the old URL contract.
function resolveScreen(req, cfg) {
  const raw = req.query.screen;
  if (raw) {
    const byId = cfg.screens && cfg.screens.find(s => s.id === raw);
    if (byId) return byId;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && cfg.screens && cfg.screens[n - 1]) return cfg.screens[n - 1];
  }
  return pickActiveScreen(cfg);
}

// Shape the rest of the server expects.
function resolveVariant(req, cfg) {
  const activeScreen = resolveScreen(req, cfg);
  const queryUnits = req.query.units;
  const units = (queryUnits === 'C' || queryUnits === 'F')
    ? queryUnits
    : (activeScreen && activeScreen.units === 'C' ? 'C' : 'F');
  return { units, screen: activeScreen ? activeScreen.id : null, activeScreen };
}

function resolveRefreshMinutes(cfg) {
  const s = pickActiveScreen(cfg);
  if (s && Number.isFinite(s.refreshMinutes) && s.refreshMinutes > 0) {
    return s.refreshMinutes;
  }
  return parseInt(cfg.refreshMinutes, 10) || 30;
}

module.exports = {
  resolveScreenLayout, migrateConfigToScreens, pickActiveScreen,
  resolveScreen, resolveVariant, resolveRefreshMinutes, newScreenId,
  LAYOUT_SLOTS, GRID_VERSION,
};

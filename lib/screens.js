// Per-screen schedule resolution + config/layout migrations. Operates on a
// config object passed in (loaded by config-store) and the request query for
// screen/units overrides. Pure aside from a monotonic screen-id counter.
const { localMinutesNow, scheduleIntervals } = require('./timewin');
const { homeValue } = require('./home');

let _screenIdSeed = 0;
function newScreenId() {
  _screenIdSeed += 1;
  return `scr-${Date.now().toString(36)}-${_screenIdSeed}`;
}

const GRID_VERSION = 7;

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
  // `stocks` was killed 2026-06-12, then reintroduced 2026-07-15 as the
  // keyless Yahoo-quotes widget — old tiles resurrect and show their
  // setup card until tickers are set.
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


// v5 (2026-09-15): drop settings the editor no longer offers, so a stored
// value can't keep overriding a decision the design now makes.
//
// Only cosmetic keys go. Anything that changes WHAT is shown stays, which is
// why this is a fixed list rather than a diff against defaults():
//   - settings.density is NOT here. On `art` it is grid fineness in px and on
//     `calendar` it is rich/compact/auto. The retired layout knob was
//     item.density, at the item level, which is separate and does go.
//   - theme: 'inverted' is dropped as redundant (it is the default now), but
//     theme: 'normal' is KEPT — that is the escape hatch the modal writes.
//
// A stored variant that no longer exists is also dropped, so the tile falls
// through to the widget's default rather than pinning something unreachable.
// Variants that existed when v5 ran. FROZEN on purpose: a migration has to
// give the same answer whenever it runs, so this must not become a live
// lookup against the current defs — a later variant cut gets its own version.
const V5_LIVE_VARIANTS = {
  aqi: ['gauge'],
  art: ['hitomezashi', 'truchet'],
  calendar: ['list', 'strip', 'month'],
  chess: ['diagram'],
  clock: ['big'],
  countdown: ['big'],
  eink_battery: ['gauge', 'trend'],
  headlines: ['list'],
  mac_battery: ['gauge'],
  mac_nowplaying: ['time_bookends'],
  moon: ['flow', 'disc'],
  onthisday: ['list'],
  photo: ['full', 'framed', 'caption'],
  progress: ['plain', 'dots', 'pixels'],
  qr: ['caption', 'code'],
  quote: ['serif'],
  sparkline: ['line'],
  tasks: ['list'],
  text: ['bar', 'card'],
  transit: ['board'],
  uv: ['gauge'],
  weather_forecast: ['rows', 'columns'],
  weather_hero: ['classic', 'split'],
  webhook: ['auto', 'number', 'kv', 'template'],
  wordofday: ['serif'],
  world_clock: ['stack', 'big'],
};

const DEAD_TILE_SETTINGS = [
  'fontScale', 'padding', 'barShape',
  'headerAlign', 'artPosition', 'textAlign', 'textOffsetY',
  'bold', 'italic', 'upper', 'letterSpacing', 'scaleAnchor', 'frame', 'fontFamily',
  // fontFamily rejoined this list once the one thing depending on it moved
  // into CSS: the world clock's grotesk face is now `.wclock-time` in
  // 037-world-clock.css, so every world-clock tile gets it and none has to
  // carry a font setting. Leaving the stored override in place would have
  // left exactly one tile in the system with a font key and no UI to
  // recreate it — a trap for whoever deletes and re-adds that tile.
];

function stripRetiredSettings(layout) {
  return (layout || []).map((it) => {
    const next = { ...it };
    // The retired Layout-density override lived on the item, not in settings.
    if ('density' in next) delete next.density;
    if (next.settings && typeof next.settings === 'object') {
      const s = { ...next.settings };
      for (const k of DEAD_TILE_SETTINGS) delete s[k];
      if (s.theme === 'inverted') delete s.theme;
      const known = V5_LIVE_VARIANTS[next.widgetId || next.id];
      if (s.variant && known && !known.includes(s.variant)) delete s.variant;
      next.settings = s;
    }
    return next;
  });
}

// v6 (2026-09-16): drop a tile's location when it merely restates cfg.home.
//
// SetupWizard used to write city/lat/lon at the top level and weather tiles
// copied them into their own settings, so a tile that had never been
// deliberately pointed anywhere still looked overridden — and stayed pinned
// to the old place when Setup changed. Stage 3 makes a blank tile inherit,
// which only helps if the duplicates go.
//
// Strictly equal-only: a tile pointed somewhere ELSE is a real override and
// is left alone. Since the values are identical, this cannot change what any
// tile renders — it changes what happens the NEXT time Setup moves.
const V6_LOCATION_KEYS = ['city', 'lat', 'lon'];

// Place strings come from two writers with different comma habits — the
// wizard wrote "Gainesville,Florida,US" and the tile autocomplete wrote
// "Gainesville, Florida, US" for the same spot. Compare the parts, not the
// punctuation, or the live config's one duplicate survives on a space.
function normPlace(str) {
  return String(str || '').split(',').map(p => p.trim().toLowerCase()).filter(Boolean).join(',');
}

function stripInheritedLocation(layout, home) {
  const hCity = normPlace(home.city);
  const hLat = Number.isFinite(home.lat) ? home.lat : null;
  const hLon = Number.isFinite(home.lon) ? home.lon : null;
  if (!hCity && hLat === null) return layout || [];
  return (layout || []).map((it) => {
    const s = it && it.settings;
    if (!s || typeof s !== 'object') return it;
    const hasCity = typeof s.city === 'string' && s.city.trim() !== '';
    const hasCoords = Number.isFinite(s.lat) && Number.isFinite(s.lon);
    if (!hasCity && !hasCoords) return it;
    // Coordinates decide when present: they are what the fetch actually uses,
    // and a city stored beside them is a label for that same point.
    const duplicate = hasCoords
      ? (s.lat === hLat && s.lon === hLon)
      : (!!hCity && normPlace(s.city) === hCity);
    if (!duplicate) return it;
    const next = { ...s };
    for (const k of V6_LOCATION_KEYS) delete next[k];
    return { ...it, settings: next };
  });
}

// v7 (2026-09-16): drop the tiles of the retired Mac widgets.
//
// mac_nowplaying and mac_battery were fed only by the Mac-side push agent,
// which is gone. A layout entry pointing at a widget that no longer exists
// renders nothing and occupies grid space, so the tile goes rather than
// sitting there as a hole the user has to find and delete by hand.
//
// A fixed list of ids, not "anything unknown": a widget missing because its
// module failed to load is a bug to fix, and silently deleting the user's
// tile would destroy the evidence.
const V7_DEAD_WIDGETS = new Set(['mac_nowplaying', 'mac_battery']);

function dropDeadWidgets(layout) {
  return (layout || []).filter(it => !V7_DEAD_WIDGETS.has(it && (it.widgetId || it.id)));
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
    // v5: retire the cosmetic per-tile settings (see stripRetiredSettings).
    if (v < 5) screens = screens.map(s =>
      ({ ...s, layout: stripRetiredSettings(s.layout) }));
    // v6: drop per-tile locations that only restate Setup. Reads the legacy
    // top-level keys too, because a config being migrated here is exactly the
    // one that predates cfg.home.
    if (v < 6) {
      const home = {
        city: (cfg.home && cfg.home.city) || cfg.city || '',
        lat: Number.isFinite(cfg.home && cfg.home.lat) ? cfg.home.lat : cfg.lat,
        lon: Number.isFinite(cfg.home && cfg.home.lon) ? cfg.home.lon : cfg.lon,
      };
      screens = screens.map(s => ({ ...s, layout: stripInheritedLocation(s.layout, home) }));
    }
    // v7: the Mac push agent is gone, so its two widgets are too.
    if (v < 7) screens = screens.map(s => ({ ...s, layout: dropDeadWidgets(s.layout) }));
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
  const now = localMinutesNow(homeValue(cfg, 'timezone') || 'UTC');
  for (const s of cfg.screens) {
    const ints = scheduleIntervals(s.schedule);
    for (const [a, b] of ints) {
      if (now >= a && now < b) return s;
    }
  }
  return cfg.screens.find(s => s.isDefault) || cfg.screens[0];
}

// `?screen=id` overrides the time-based pick. Accepts a screen id or a numeric
// 1..N index for back-compat with the old URL contract. An enrolled device
// with an assigned screen (devices-store `screen`, set via PATCH
// /api/device/:id) comes next — two panels on one server can show different
// content. A stale assignment (screen deleted) falls through to the scheduler.
function resolveScreen(req, cfg) {
  const raw = req.query.screen || (req.device && req.device.screen);
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

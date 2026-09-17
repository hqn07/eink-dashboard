// Shared widget definitions. Used by both the dashboard renderer (via
// public/dashboard.html, which keeps its own mirror) and the React editor.
// Sizes are predefined presets per widget so users pick from a small set
// rather than dragging arbitrary corners.
//
// Per-widget refactor (Phase A): each widget can move into a single
// module under control-src/widgets/<id>.js. The registry pulls those
// defs in via the MIGRATED_DEFS map and spreads them with the
// `...migratedDef('<id>')` shorthand below. Inlined defs still work
// for unmigrated widgets.
import { MIGRATED_DEFS } from './widgets/_registry.js';
import { sizeSpec, variantOf, resolveSize } from './widgets/_sizes.js';
function migratedDef(id) {
  return MIGRATED_DEFS[id] || (() => { throw new Error(`No migrated def for ${id}`); })();
}

export const GRID_COLS = 24;
export const GRID_ROWS = 12;
// Bump this whenever the grid resolution changes so old saved configs
// can be migrated.
// v1 = 12x6  (Apr 2026 → May 2026, rectangular cells)
// v2 = 12x12 (May 18 2026, finer h but rectangular cells)
// v3 = 24x12 (square cells, fine in both axes)
// v4 = screens gain layoutKind
//
// This drifted to 4 while the server reached 10, and that drift was not
// harmless: the editor stamps this value onto every config it saves, so
// saving from the browser wrote gridVersion:4 over an already-migrated
// config. The next server load then re-ran v5 against v9's output and
// silently deleted a world clock's `zones` variant — the tile kept its zones
// and rendered local time instead.
//
// Two things now stop that recurring: lib/config-store stamps the SERVER's
// version on every write regardless of what a client sends (the client is not
// the authority here), and the server's v5 strip is safe to re-run. This
// constant is kept in step as well, but it is no longer load-bearing.
//
// The client migrator only implements v1-v4; the server owns v5+. It does not
// need to catch up, because the server migrates whatever it is handed.
export const GRID_VERSION = 10;
export const SCREENS = [1, 2];

// Sizes are in 24x12 grid units. With body ≈ 800px × 392-452px, cells
// are ~33px square. h heights match the 12x12 era; only w doubled.
// Pool taxonomy — client-only metadata for the add-widget pool: which
// section a widget lands in and the one-line blurb shown on its card.
// Lives here (not on the def) because SSR never needs it; only the
// editor pool does. `POOL_CATEGORIES` fixes the section order.
// Section order for the add-widget pool. Must list EVERY category used in
// POOL_META below — a widget whose category is missing here used to vanish
// from the grouped pool entirely (it was still counted in the badge). The
// render now appends any stray category after these, but keep this in sync
// so the intended order holds.
export const POOL_CATEGORIES = ['Weather', 'Time', 'Calendar', 'Media', 'News', 'Money', 'Data', 'System', 'Text', 'Fun'];
// `keywords` feed the pool search alongside label/id/blurb so synonyms the
// user is likely to type ("music", "todo", "rss", "btc") find the widget
// even when they aren't in its name.
const POOL_META = {
  daily:            { category: 'Text',     blurb: 'A quote, a word, or what happened today', keywords: 'quote quotation word vocabulary definition history on this day daily card' },
  outdoors:         { category: 'Weather',  blurb: 'Sun, UV or air quality for your place', keywords: 'sun sunrise sunset daylight uv index air quality aqi pollution pm25 outdoors' },
  markets:          { category: 'Money',    blurb: 'Stocks, crypto and currency pairs in one list', keywords: 'stock ticker etf index crypto bitcoin btc eth currency fx exchange rate money price' },
  ai:               { category: 'Text',     blurb: 'Your prompt plus the dashboard data, in a few lines', keywords: 'ai llm gpt deepseek openai briefing summary prompt' },
  weather:          { category: 'Weather',  blurb: 'Conditions now, or the days ahead', keywords: 'temperature weather conditions now current forecast hourly daily rain outlook hi lo' },
  clock:            { category: 'Time',     blurb: 'Time and date here, or across zones', keywords: 'clock time date hour world zone timezone utc' },
  countdown:        { category: 'Time',     blurb: 'Days until a target date', keywords: 'countdown timer days until deadline' },
  progress:         { category: 'Time',     blurb: 'Day / week / month / year % bars', keywords: 'progress year week percent bars' },
  moon:             { category: 'Time',     blurb: 'Moon phase + illumination', keywords: 'moon phase lunar illumination' },
  calendar:         { category: 'Calendar', blurb: 'Upcoming events agenda', keywords: 'events agenda ical schedule appointments' },
  tasks:            { category: 'Calendar', blurb: 'Todoist / iCal to-do list', keywords: 'todo todoist tasks checklist reminders' },
  transit:          { category: 'Calendar', blurb: 'NYC MTA live arrivals', keywords: 'transit subway train bus mta arrivals commute' },
  photo:            { category: 'Media',    blurb: 'Your image, dithered to 1-bit', keywords: 'photo image picture dither' },
  headlines:        { category: 'News',     blurb: 'RSS or Hacker News headlines', keywords: 'news rss feed hn hacker headlines atom' },
  eink_battery:     { category: 'System',   blurb: 'This display’s battery level', keywords: 'battery power display device charge' },
  sparkline:        { category: 'Data',     blurb: 'Weather or battery trend line', keywords: 'trend graph chart line sparkline' },
  crypto:           { category: 'Data',     blurb: 'Crypto prices + 24h change (no key)', keywords: 'crypto bitcoin btc eth ethereum coin price' },
  codeactivity:     { category: 'Data',     blurb: 'GitHub contribution heatmap', keywords: 'github git commits contributions heatmap code' },
  text:             { category: 'Text',     blurb: 'Token strip or message card', keywords: 'text message token label heading note' },
  art:              { category: 'Fun',      blurb: 'Daily generative pattern — reseeds every morning', keywords: 'art generative pattern decorative random' },
  chess:            { category: 'Fun',      blurb: 'Lichess puzzle of the day', keywords: 'chess puzzle lichess board game' },
  webhook:          { category: 'Data',     blurb: 'Push any JSON, see it on the panel', keywords: 'webhook json push api custom' },
  qr:               { category: 'Text',     blurb: 'QR code + caption', keywords: 'qr code link url scan' }
};
function withPoolMeta(def) {
  const m = POOL_META[def.id] || { category: 'Text', blurb: '', keywords: '' };
  return { ...def, category: m.category, blurb: m.blurb, keywords: m.keywords || '' };
}

export const WIDGET_REGISTRY = [
  { ...migratedDef('weather') },
  { ...migratedDef('text') },
  { ...migratedDef('calendar') },
  // Mac-only widgets — only render data when the server is running on
  // the user's Mac (LAN path). On Railway/Linux they show MAC OFFLINE.
  { ...migratedDef('eink_battery') },
  { ...migratedDef('clock') },
  // No-key widgets (2026-06-16). This array is the editor palette's
  // source of truth — a widget missing here renders server-side but
  // never shows in the add-widget pool. Keep in sync with _registry.js.
  { ...migratedDef('daily') },
  { ...migratedDef('outdoors') },
  { ...migratedDef('markets') },
  { ...migratedDef('ai') },
  { ...migratedDef('art') },
  { ...migratedDef('chess') },
  { ...migratedDef('countdown') },
  { ...migratedDef('progress') },
  { ...migratedDef('moon') },
  { ...migratedDef('webhook') },
  { ...migratedDef('headlines') },
  { ...migratedDef('photo') },
  { ...migratedDef('qr') },
  { ...migratedDef('sparkline') },
  { ...migratedDef('tasks') },
  { ...migratedDef('transit') },
  { ...migratedDef('codeactivity') }
].map(withPoolMeta);

// Tier resolver lives in widgets/_shared.js (the copy every widget
// module imports). Re-exported here for back-compat — there used to be
// two hand-matched implementations of this function; never again.
export { pickTier } from './widgets/_shared.js';

export function widgetById(id) {
  return WIDGET_REGISTRY.find(w => w.id === id);
}

// Default positions for screen 1 (editorial). Screen 2 = minimal hero only.
// x/y-coords in 24x12 grid units.
const DEFAULT_LAYOUTS = {
  1: [
    { id: 'weather',  x: 0,  y: 0, size: 'M', enabled: true },
    { id: 'weather',  x: 8,  y: 0, size: 'M', enabled: true, settings: { variant: 'forecast' } },
    { id: 'text',     x: 14, y: 0, size: 'M', enabled: true, settings: { variant: 'card' } },
    { id: 'calendar', x: 14, y: 4, size: 'M', enabled: true }
  ],
  2: [
    { id: 'weather',  x: 0, y: 0, size: 'XL', enabled: true },
    { id: 'text',     x: 0, y: 0, size: 'M',  enabled: false, settings: { variant: 'card' } },
    { id: 'calendar', x: 0, y: 0, size: 'M',  enabled: false }
  ]
};

// Variant-aware: a def may hang its own `sizes` / `defaultSize` off an
// individual variant (weather's forecast views do), so the tile's settings
// decide which ladder this reads. See widgets/_sizes.js.
function sizeFor(def, sizeKey, settings) {
  const spec = sizeSpec(def, variantOf(def, settings));
  return resolveSize(spec, sizeKey) || { size: spec.defaultSize, w: 8, h: 4 };
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
    const sz = sizeFor(def, raw.size, raw.settings);
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
    description: 'Newspaper feel: weather + forecast + text card + calendar.',
    layout: [
      { widgetId: 'weather',  x: 0,  y: 0, w: 8,  h: 12 },
      { widgetId: 'weather',  x: 8,  y: 0, w: 6,  h: 12, settings: { variant: 'forecast' } },
      { widgetId: 'text',     x: 14, y: 0, w: 10, h: 4, settings: { variant: 'card' } },
      { widgetId: 'calendar', x: 14, y: 4, w: 10, h: 8 }
    ]
  },
  {
    id: 'front_page',
    name: 'Front Page',
    description: 'Morning-edition broadsheet: masthead with a weather ear, headline column, agenda, forecast, closing quote.',
    layout: [
      { widgetId: 'text', x: 0, y: 0, w: 24, h: 2,
        settings: {
          variant: 'bar', align: 'center', fontFamily: 'serif',
          text: 'The {{city|default:Home}} Times',
          subtitle: '{{date|long}} · {{weather|default:—}} · {{tempHi}}/{{tempLo}} · {{eventsToday}} on the docket'
        } },
      { widgetId: 'headlines',        x: 0,  y: 2, w: 9, h: 10,
        settings: { source: 'news', newsSource: 'bbc', count: 7, title: 'THE WIRE' } },
      { widgetId: 'calendar',         x: 9,  y: 2, w: 8, h: 6,
        settings: { variant: 'list', title: 'TODAY' } },
      { widgetId: 'daily', settings: { variant: 'onthisday' },        x: 9,  y: 8, w: 8, h: 4 },
      { widgetId: 'weather',          x: 17, y: 2, w: 7, h: 6, settings: { variant: 'forecast' } },
      { widgetId: 'daily', x: 17, y: 8, w: 7, h: 4,
        settings: { variant: 'quote' } }
    ]
  },
  {
    id: 'photo_frame',
    name: 'Photo Frame',
    description: 'Full-bleed photo, nothing else. Schedule it overnight on the timeline for a bedside frame.',
    layout: [
      { widgetId: 'photo', x: 0, y: 0, w: 24, h: 12, flush: true,
        settings: { variant: 'full', fit: 'cover', dither: 'atkinson' } }
    ]
  },
  {
    id: 'minimal_hero',
    name: 'Just Weather',
    description: 'Just the weather, full-bleed.',
    layout: [
      { widgetId: 'weather', x: 0, y: 0, w: 24, h: 12 }
    ]
  },
  {
    id: 'daily_briefing',
    name: 'Daily Briefing',
    description: 'Info-dense: header strip + weather + forecast + calendar + clock.',
    layout: [
      { widgetId: 'text',             x: 0,  y: 0,  w: 24, h: 1,
        settings: { variant: 'bar', text: '{{date|long}} · {{city}}', align: 'center', upper: true, fontFamily: 'serif' } },
      { widgetId: 'weather',          x: 0,  y: 1,  w: 8,  h: 8 },
      { widgetId: 'weather',          x: 8,  y: 1,  w: 6,  h: 8, settings: { variant: 'forecast' } },
      { widgetId: 'calendar',         x: 14, y: 1,  w: 10, h: 11 },
      { widgetId: 'clock',            x: 0,  y: 9,  w: 14, h: 3 }
    ]
  },
  {
    id: 'focus_message',
    name: 'Focus',
    description: 'Big custom message centered with a thin date header + weather strip.',
    layout: [
      { widgetId: 'text',             x: 0, y: 0,  w: 24, h: 1,
        settings: { variant: 'bar', text: '{{day}} · {{date|short}}', align: 'center', upper: true, fontFamily: 'sans' } },
      { widgetId: 'text',             x: 0, y: 2,  w: 24, h: 7, settings: { variant: 'card' } },
      { widgetId: 'weather',          x: 0, y: 10, w: 18, h: 2, settings: { variant: 'forecast' } },
      { widgetId: 'clock',            x: 18, y: 9, w: 6,  h: 3 }
    ]
  },
  {
    id: 'just_clock',
    name: 'Just Clock',
    description: 'Full-bleed clock — wall-clock mode.',
    layout: [
      { widgetId: 'clock', x: 0, y: 0, w: 24, h: 12 }
    ]
  }
];

// Inflate a preset's layout into real instances (each item gets its own
// instance id + a sizeKey hint based on its w/h). Preserves per-item
// `settings` from the preset so curated tiles (e.g. a text_bar with a
// preset token string) land already configured.
export function inflatePresetLayout(preset) {
  if (!preset || !Array.isArray(preset.layout)) return [];
  return preset.layout.map(item => ({
    id: newInstanceId(item.widgetId),
    widgetId: item.widgetId,
    x: item.x, y: item.y, w: item.w, h: item.h,
    flush: false,
    ...(item.settings ? { settings: { ...item.settings } } : {})
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

// Widget-id migrations (widgets-refresh W0). Dead widgets drop out of
// saved layouts; merged/renamed widgets map forward, optionally
// rewriting their settings. Runs on every config load (idempotent).
// Mirrored in server.js — keep both tables in sync.
const WIDGET_ID_MIGRATIONS = {
  // merged into `text` 2026-06-12
  message:  { id: 'text', settings: (s) => ({ ...s, variant: 'card' }) },
  text_bar: { id: 'text', settings: (s) => ({ ...s, variant: 'bar' }) },
  // The weather pair merged 2026-09-17 (see the v10 note in lib/screens.js
  // for why the size ladders held it up). Here rather than behind a
  // gridVersion gate because this table also runs on the pre-screens legacy
  // path, and weather_hero is old enough to appear there.
  weather_hero: {
    id: 'weather',
    settings: (s) => ({ ...s, variant: s.variant === 'split' ? 'now_split' : 'now' })
  },
  weather_forecast: {
    id: 'weather',
    settings: (s) => ({ ...s, variant: s.variant === 'rows' ? 'forecast_rows' : 'forecast' })
  },
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

export function migrateConfigToScreens(cfg) {
  if (Array.isArray(cfg.screens) && cfg.screens.length) {
    let screens = cfg.screens;
    const v = cfg.gridVersion || 1;
    if (v < 2) screens = screens.map(s => ({ ...s, layout: migrateLayoutV1ToV2(s.layout) }));
    if (v < 3) screens = screens.map(s => ({ ...s, layout: migrateLayoutV2ToV3(s.layout) }));
    // v4: every screen gains a `layoutKind` field. Default `free` so
    // existing freeform grids keep working.
    if (v < 4) screens = screens.map(s =>
      s.layoutKind ? s : { ...s, layoutKind: 'free' });
    screens = screens.map(s => ({ ...s, layout: migrateWidgetIds(s.layout) }));
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
  const migrateOld = (l) => migrateWidgetIds(migrateLayoutV2ToV3(migrateLayoutV1ToV2((l || []).map(it => ({ ...it })))));
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
      layout: migrateOld(oldLayouts[2])
    });
  }
  return { ...cfg, screens, gridVersion: GRID_VERSION };
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
export function makeInstance(widgetId, { x = 0, y = 0, w, h, sizeKey, variant } = {}, seedCtx) {
  const def = widgetById(widgetId);
  if (!def) return null;
  // Seed settings from the registry factory so the tile is self-contained
  // from the moment it's dropped. `seedCtx` (e.g. the saved setup-wizard
  // location) is a one-time hint; once on the tile, settings are owned
  // exclusively by the tile.
  let settings = (typeof def.defaults === 'function') ? def.defaults(seedCtx) : undefined;
  if (variant && def.variants && def.variants[variant]) {
    settings = { ...(settings || {}), variant };
  }
  // Settings before size, not after: the variant they carry is what selects
  // the ladder, so a tile asked for at a specific view is measured as that
  // view rather than as the widget's default one.
  const sz = sizeFor(def, sizeKey, settings);
  const inst = {
    id: newInstanceId(widgetId),
    widgetId,
    x, y,
    w: Number.isFinite(w) ? w : sz.w,
    h: Number.isFinite(h) ? h : sz.h,
    size: sz.size,
    flush: false
  };
  if (settings) inst.settings = settings;
  return inst;
}

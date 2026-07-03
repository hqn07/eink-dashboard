// server.js
// Express server that:
//  - Serves a 800x480 dashboard HTML page at /dashboard
//  - Screenshots it via Puppeteer and serves at /display.png (and /display.bin for ESP32)
//  - Serves a control panel at /control
//  - Persists config to data/config.json

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const { fetchWeather, geocodeCity } = require('./widgets/weather');
const { fetchAqi } = require('./widgets/aqi');
const { fetchCodeActivity } = require('./widgets/codeactivity');
const { fetchOnThisDay } = require('./widgets/onthisday');
const { fetchEvents } = require('./widgets/calendar');
const { fetchAlerts } = require('./widgets/alerts');
const widgetStatus = require('./widgets/_status');
const { resolveMessage, renderInlineMarkdown } = require('./widgets/message');
const { fetchMacNowPlaying } = require('./widgets/macnowplaying');
const { fetchMacBattery } = require('./widgets/macbattery');
const { buildClock } = require('./widgets/clock');
const { computeNextAlarm, normalizeAlarmList } = require('./widgets/alarms');
const { fetchPhoto } = require('./widgets/photo');
const { fetchHeadlines } = require('./widgets/headlines');
const { fetchTasks } = require('./widgets/tasks');
const { fetchTransit } = require('./widgets/transit');
const {
  preThreshold, rgbaToMono, packMonoBin,
  isRedPixel, rgbaToPlanes, planesToPng
} = require('./lib/image');
const { FW_DIR, FW_NAME_RE, parseSemver, cmpSemver, findNewestFirmware } = require('./lib/firmware');
const { parseHHMM, hmFormatter, localMinutesNow, scheduleIntervals } = require('./lib/timewin');
const { relAge, dur, batteryTrend, sparkline } = require('./lib/statusfmt');

// SSR module — per-widget render functions + chrome helpers, no React.
// Dynamically imported (ESM) at first use and cached. Lets /dashboard
// produce the full page HTML server-side instead of shipping a
// duplicate widget render block to the browser.
let _ssrPromise = null;
function loadSsr() {
  if (!_ssrPromise) _ssrPromise = import('./control-src/widgets/_ssr.js');
  return _ssrPromise;
}

// Error ring buffer moved to ./lib/errlog.js — requiring it installs the
// console.error wrapper (side effect) and hands back the shared ring the
// /status page reads.
const { errLog: _errLog } = require('./lib/errlog');

const PORT = process.env.PORT || 3000;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';
// Mutable state (config, battery, devices) lives under DATA_DIR. Set it
// to a persistent volume mount on hosts with an ephemeral filesystem
// (Railway/Fly/Render wipe the container FS on every redeploy — without
// a volume the dashboard resets to defaults each deploy). Defaults to the
// in-repo ./data for local dev.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
// A fresh volume mount is an empty directory — make sure it exists before
// the first config/battery write.
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* exists */ }
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
// Seed config lives outside DATA_DIR so a persistent volume taking over
// that directory can't hide the baked-in defaults shipped with the image.
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'data-defaults', 'config.default.json');
const BATTERY_PATH = path.join(DATA_DIR, 'battery.json');
const DEVICES_PATH = path.join(DATA_DIR, 'devices.json');

// Loud warning when no DEVICE_TOKEN is set in production: the control
// panel + config API end up wide-open. Local dev intentionally allows
// missing token so first-run friction stays low.
const IS_PROD = process.env.NODE_ENV === 'production'
  || !!process.env.RAILWAY_ENVIRONMENT
  || !!process.env.RENDER
  || !!process.env.FLY_APP_NAME;
if (!DEVICE_TOKEN) {
  const msg = '[security] DEVICE_TOKEN env var is not set — /api/* config endpoints are PUBLIC.';
  if (IS_PROD) {
    console.error(`\n${msg}\n[security] Set DEVICE_TOKEN before exposing this server to the internet.\n`);
  } else {
    console.warn('[security] DEVICE_TOKEN unset (local dev) — set it in .env for any non-localhost deploy.');
  }
}

const SCREEN_W = 800;
const SCREEN_H = 480;

// ---------- Config persistence ----------

// In-memory config cache. Invalidated by saveConfig() and skipped when
// the file's mtime advances (covers out-of-process edits to config.json).
let _configCache = null; // { mtimeMs, cfg }
async function loadConfig() {
  try {
    const st = await fsp.stat(CONFIG_PATH);
    if (_configCache && _configCache.mtimeMs === st.mtimeMs) {
      return _configCache.cfg;
    }
    const raw = await fsp.readFile(CONFIG_PATH, 'utf8');
    const cfg = migrateConfigToScreens(JSON.parse(raw));
    _configCache = { mtimeMs: st.mtimeMs, cfg };
    return cfg;
  } catch (err) {
    // Seed from defaults ONLY when the file doesn't exist yet. Any
    // other failure (corrupted JSON, transient fs error) must NOT
    // clobber the user's config with defaults — surface the error
    // instead so the bad file can be inspected/repaired.
    if (err.code !== 'ENOENT') {
      console.error('config.json unreadable (NOT overwriting):', err.message);
      throw err;
    }
    const raw = await fsp.readFile(DEFAULT_CONFIG_PATH, 'utf8');
    await atomicWriteFile(CONFIG_PATH, raw);
    const cfg = migrateConfigToScreens(JSON.parse(raw));
    const st = await fsp.stat(CONFIG_PATH).catch(() => null);
    _configCache = { mtimeMs: st ? st.mtimeMs : 0, cfg };
    return cfg;
  }
}

// Atomic write: temp file + rename. Prevents partial/truncated config
// if the process dies mid-write, and avoids two concurrent first-run
// cold reads from clobbering each other.
async function atomicWriteFile(target, data) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, target);
}

async function saveConfig(cfg) {
  await atomicWriteFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  _configCache = null;
}

// Serialize all read-merge-write transactions on config.json. Two
// concurrent POSTs (e.g. control panel saving alarms while another tab
// saves message text) would otherwise both load the same baseline,
// merge their own patches, and the second write would silently
// clobber the first. Each caller runs inside fn(); the next caller
// awaits until the previous resolves.
let _configWriteChain = Promise.resolve();
function withConfigLock(fn) {
  const run = _configWriteChain.then(fn, fn);
  _configWriteChain = run.catch(() => {}); // swallow rejections in the chain so one error doesn't permanently break the lock
  return run;
}

// Battery state from the ESP32. ESP32 POSTs once per wake; we persist to
// disk so the value survives server restart (panel only POSTs every
// ~30min so an in-memory-only value would be stale after every redeploy).
let _batteryState = null; // { v, pct, at } or null until first POST
async function loadBatteryState() {
  if (_batteryState !== null) return _batteryState;
  try {
    const raw = await fsp.readFile(BATTERY_PATH, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && Number.isFinite(obj.v) && Number.isFinite(obj.pct) && Number.isFinite(obj.at)) {
      _batteryState = obj;
    } else {
      _batteryState = null;
    }
  } catch {
    _batteryState = null;
  }
  return _batteryState;
}
async function saveBatteryState(state) {
  _batteryState = state;
  try {
    // Atomic write (tmp + rename) — same pattern as config — so a
    // crash mid-write or a concurrent reader never sees half a file.
    await atomicWriteFile(BATTERY_PATH, JSON.stringify(state));
  } catch (err) {
    console.warn('Battery persist failed:', err.message);
  }
  // Append to the rolling history (for the sparkline widget). Best-effort,
  // de-duped on `at`, capped — a failure here must never block the save.
  appendBatteryHistory(state).catch(e => console.warn('battery-history:', e.message));
}

// ---------- Battery history (rolling, for the sparkline) ----------
const BATTERY_HISTORY_PATH = path.join(DATA_DIR, 'battery-history.json');
const BATTERY_HISTORY_MAX = 96;       // ~2 days at a 30-min refresh
let _batteryHistory = null;           // [{ pct, v, at }] oldest→newest

async function loadBatteryHistory() {
  if (_batteryHistory !== null) return _batteryHistory;
  try {
    const arr = JSON.parse(await fsp.readFile(BATTERY_HISTORY_PATH, 'utf8'));
    _batteryHistory = Array.isArray(arr) ? arr : [];
  } catch { _batteryHistory = []; }
  return _batteryHistory;
}

let _batHistChain = Promise.resolve();
function appendBatteryHistory(state) {
  // Serialize so two near-simultaneous pushes can't clobber the file.
  _batHistChain = _batHistChain.then(async () => {
    if (!state || !Number.isFinite(state.pct) || !Number.isFinite(state.at)) return;
    const hist = await loadBatteryHistory();
    const last = hist[hist.length - 1];
    if (last && last.at === state.at) return;   // dedupe identical timestamp
    hist.push({ pct: state.pct, v: state.v, at: state.at });
    while (hist.length > BATTERY_HISTORY_MAX) hist.shift();
    _batteryHistory = hist;
    await atomicWriteFile(BATTERY_HISTORY_PATH, JSON.stringify(hist));
  }, () => {});
  return _batHistChain;
}

// ---------- Device registry ----------
//
// Keyed by lowercased MAC. Each record holds the long-lived api_key
// the device sends as X-API-Key, a human-friendly id for the control
// UI, and the most recent telemetry (fw_version, board, last_seen).
//
// Loaded once at startup so checkDeviceAuth can do a synchronous
// lookup; saveDevices() updates both the cache and the on-disk file.
let _devicesCache = null;
function loadDevicesSync() {
  if (_devicesCache) return _devicesCache;
  try {
    const raw = fs.readFileSync(DEVICES_PATH, 'utf8');
    const obj = JSON.parse(raw);
    _devicesCache = obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    _devicesCache = {};
  }
  return _devicesCache;
}
async function saveDevices(d) {
  _devicesCache = d;
  try {
    await atomicWriteFile(DEVICES_PATH, JSON.stringify(d, null, 2));
  } catch (err) {
    console.warn('Devices persist failed:', err.message);
  }
}
function findDeviceByKey(apiKey) {
  const all = loadDevicesSync();
  for (const mac of Object.keys(all)) {
    if (all[mac].api_key === apiKey) return all[mac];
  }
  return null;
}
function genApiKey()     { return crypto.randomBytes(24).toString('hex'); }
function genFriendlyId() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
// Seed the cache so the first auth call doesn't hit a sync read.
loadDevicesSync();

// Dashboard HTML template — read once, then cached. We refresh from disk
// on mtime change so editing public/dashboard.html in dev hot-applies.
let _htmlCache = null; // { mtimeMs, html }
const DASHBOARD_HTML_PATH = path.join(__dirname, 'public', 'dashboard.html');

// The page's `.autofit` pass = the shared source (control-src/autofit.js,
// export-stripped) + a tiny orchestrator that runs it after web fonts
// settle and flags window.__autofitDone for Puppeteer. Injected at
// <!--__AUTOFIT__-->. Same code the React editor imports, so the panel and
// the editor size text identically (they used to drift).
const AUTOFIT_SCRIPT = (() => {
  const src = fs.readFileSync(path.join(__dirname, 'control-src', 'autofit.js'), 'utf8')
    .replace(/^export\s+/gm, '');
  return `<script>(function(){\n${src}\n`
    + `var __run=function(){requestAnimationFrame(function(){runAutofit(document);window.__autofitDone=true;});};`
    + `if(document.fonts&&document.fonts.ready){document.fonts.ready.then(__run);}else{__run();}})();</script>`;
})();
async function loadDashboardHtml() {
  const st = await fsp.stat(DASHBOARD_HTML_PATH);
  if (_htmlCache && _htmlCache.mtimeMs === st.mtimeMs) return _htmlCache.html;
  const html = await fsp.readFile(DASHBOARD_HTML_PATH, 'utf8');
  _htmlCache = { mtimeMs: st.mtimeMs, html };
  return html;
}

// ---------- Puppeteer (one persistent browser, auto-relaunch if it dies) ----------

let browserPromise = null;
async function getBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      // Puppeteer marks a Browser as disconnected if the process crashed.
      if (b && b.connected) return b;
    } catch (_) {
      // Fall through to relaunch
    }
    browserPromise = null;
  }
  const launchOpts = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  browserPromise = puppeteer.launch(launchOpts).then(b => {
    b.on('disconnected', () => {
      console.warn('Puppeteer browser disconnected — will relaunch on next request');
      browserPromise = null;
    });
    return b;
  }).catch(err => {
    browserPromise = null;
    throw err;
  });
  return browserPromise;
}

async function killBrowser() {
  try {
    const b = browserPromise ? await browserPromise : null;
    if (b) await b.close();
  } catch (_) {}
  browserPromise = null;
}

// Shared page semaphore. Puppeteer pages each hold ~200-300 MB of
// Chromium memory — under request spikes (multiple devices, retry
// storms, editor scrubbing the preview) unbounded page creation would
// OOM. Dashboard renders queue; preview renders fail fast so the
// editor UI gets instant feedback instead of stacking work.
const MAX_PAGES = 2;
let _pagesInflight = 0;
const _pageWaiters = [];
function acquirePage() {
  return new Promise(resolve => {
    if (_pagesInflight < MAX_PAGES) {
      _pagesInflight++;
      resolve();
    } else {
      _pageWaiters.push(resolve);
    }
  });
}
function tryAcquirePage() {
  if (_pagesInflight < MAX_PAGES) {
    _pagesInflight++;
    return true;
  }
  return false;
}
function releasePage() {
  if (_pageWaiters.length) {
    // Hand the slot directly to a waiter — slot stays "occupied".
    const next = _pageWaiters.shift();
    next();
  } else {
    _pagesInflight--;
  }
}

async function renderDashboardPng({ units, screen }) {
  await acquirePage();
  // Everything after the acquire lives inside try/finally — if
  // getBrowser() or newPage() throws (e.g. Chromium fails to launch)
  // the slot must still be released or the semaphore leaks and all
  // future renders hang.
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    await page.setViewport({
      width: SCREEN_W,
      height: SCREEN_H,
      deviceScaleFactor: 1
    });
    const qs = new URLSearchParams();
    if (units) qs.set('units', units);
    if (screen) qs.set('screen', String(screen));
    if (DEVICE_TOKEN) qs.set('token', DEVICE_TOKEN);
    const url = `http://127.0.0.1:${PORT}/dashboard${qs.toString() ? '?' + qs : ''}`;
    // domcontentloaded fires fast; the dashboard's JS runs synchronously.
    // We then wait for web fonts to settle so the screenshot has the
    // right typography, with a hard cap so a slow CDN can't hang us.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await Promise.race([
      page.evaluate(() => document.fonts && document.fonts.ready),
      new Promise(r => setTimeout(r, 4000))
    ]);
    // Wait for the page's autofit pass to finish so clock/aqi/quote text
    // measures at final glyph metrics, not the fallback serif default.
    await page.waitForFunction(() => window.__autofitDone === true, { timeout: 4000 }).catch(() => {});
    const buf = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: SCREEN_W, height: SCREEN_H }
    });
    return buf;
  } catch (err) {
    // The browser may be in a wedged state. Close it so the next
    // request relaunches a fresh instance instead of retrying against
    // the broken one.
    console.error('Render failed, recycling browser:', err.message);
    await killBrowser();
    throw err;
  } finally {
    if (page) { try { await page.close(); } catch (_) {} }
    releasePage();
  }
}

// Contrast boost pushes near-128 anti-aliased font edges to either
// pure black or pure white before the threshold step. Without this,
// AA pixels at ~128 produce salt-and-pepper noise on the real 1-bit
// e-ink panel. linear(a, b) is per-channel: out = a*in + b.
// a=1.6, b=-77 maps 0..255 -> roughly clamp-around-128 with a steep slope.
// Pixel pipeline (preThreshold, rgbaToMono, packMonoBin, isRedPixel,
// rgbaToPlanes, planesToPng) moved to ./lib/image.js — pure buffer
// transforms, no Express/cache/Puppeteer coupling. Required at the top.

// ---------- Image cache ----------

const imageCache = new Map(); // key: "units|screen" -> { at, png, bin }
const inflightImage = new Map(); // key -> Promise so concurrent hits share work
const IMAGE_CACHE_MS = 60 * 1000; // entry is "fresh" for 60s; older = revalidate

const imageCacheKey = (variant) => `${variant.units}|${variant.screen}`;

// Render the dashboard for one variant and store it in the cache. Concurrent
// callers for the same key share one render (inflight dedup).
function renderImage(variant) {
  const key = imageCacheKey(variant);
  const pending = inflightImage.get(key);
  if (pending) return pending;
  const promise = (async () => {
    const rgba = await renderDashboardPng(variant);
    const { rawMono, info, png } = await rgbaToMono(rgba);
    const bin = packMonoBin(rawMono, info);
    // 3-color plane pair (black+red, 96000 B). Cached lazily on first
    // access so BW-only fleets don't pay the extra RGBA pass.
    // ETags (content hash) let the firmware skip the slow refresh when the
    // image is byte-identical — sent as a conditional-GET 304. Matters
    // most on the 3-color panel where a full refresh is ~15-26 s.
    let bin3c = null, etag3c = null;
    const etagOf = (b) => `"${crypto.createHash('sha1').update(b).digest('hex')}"`;
    const entry = {
      at: Date.now(), png, bin,
      etagBin: etagOf(bin),
      get3c: async () => {
        if (!bin3c) { bin3c = await rgbaToPlanes(rgba); etag3c = etagOf(bin3c); }
        return { bin: bin3c, etag: etag3c };
      }
    };
    imageCache.set(key, entry);
    return entry;
  })().finally(() => inflightImage.delete(key));
  inflightImage.set(key, promise);
  return promise;
}

// Stale-while-revalidate: once an entry exists, the device is ALWAYS served
// instantly. A stale entry is returned as-is and a refresh runs in the
// background, so the ESP32 wake never blocks on a cold Puppeteer render
// (~2-3s). Only the very first request for a key (cold cache) renders inline.
// The background warmer below keeps that first render off the device path.
async function getCurrentImage(variant) {
  const key = imageCacheKey(variant);
  const cached = imageCache.get(key);
  if (cached) {
    if ((Date.now() - cached.at) >= IMAGE_CACHE_MS && !inflightImage.has(key)) {
      renderImage(variant).catch(err =>
        console.error('Background re-render failed:', err.message));
    }
    return cached;
  }
  return renderImage(variant);
}

// Force re-render on next request (called after config save). Clearing the
// cache plus an immediate warm means the next device hit is already fresh.
function invalidateImage() {
  imageCache.clear();
  if (PRERENDER_ENABLED) warmActiveImage();
}

// ---------- Background pre-render (keeps the device cache warm) ----------
// Railway Hobby is always-on, so we proactively render the active screen on
// an interval. The device wake then hits a warm cache instead of paying for
// a cold render while the radio + e-ink display wait on it. Disable with
// PRERENDER=0; tune cadence with PRERENDER_INTERVAL_MS.
const PRERENDER_ENABLED = process.env.PRERENDER !== '0';
const PRERENDER_INTERVAL_MS = Math.max(
  60_000,
  parseInt(process.env.PRERENDER_INTERVAL_MS, 10) || 5 * 60_000
);

async function warmActiveImage() {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant({ query: {} }, cfg);
    await renderImage(variant); // force fresh so the served entry is current
  } catch (err) {
    console.error('Pre-render warm failed:', err.message);
  }
}

// parseHHMM/hmFormatter/localMinutesNow/scheduleIntervals moved to
// ./lib/timewin.js (required at the top).

// ---------- Per-screen schedule resolution ----------

let _screenIdSeed = 0;
function newScreenId() {
  _screenIdSeed += 1;
  return `scr-${Date.now().toString(36)}-${_screenIdSeed}`;
}

// Migrate legacy cfg.layouts/cfg.schedule into the new cfg.screens
// array. Idempotent — returns cfg unchanged when screens already
// exist.

const GRID_VERSION = 4;

// Fixed-rect layout primitives. Each entry maps a layoutKind name to
// an ordered list of cell rectangles on the 24x12 grid; screens with
// `layoutKind !== 'free'` populate widgets by slot index instead of
// dragging tiles around. Mirrors TRMNL's full / half_h / half_v /
// quadrant primitive set so authoring stays predictable.
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

// Resolve the layout array a screen should render. For `free` (the
// legacy default) we return the saved freeform `layout[]`. For one of
// the four primitives we generate the layout from `slots[]` (a list of
// widget ids, one per slot) so the renderer doesn't need to know about
// layoutKind.
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
      // Slot-based items pass through any per-slot settings the user saved.
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

// Editorial preset layout (24x12 grid). Mirrors SCREEN_PRESETS.editorial
// in control-src/widgets.js. Server can't import that ESM module, so
// we inline a copy here for first-install seeding.
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

// Widget-id migrations (widgets-refresh W0). Dead widgets drop out of
// saved layouts; merged/renamed widgets map forward, optionally
// rewriting their settings. Runs on every config load (idempotent).
// Mirrored in control-src/widgets.js — keep both tables in sync.
const WIDGET_ID_MIGRATIONS = {
  stocks: null,  // killed 2026-06-12
  // merged into `text` 2026-06-12
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
    // v4: every screen gains a `layoutKind` field. Default `free` so
    // existing freeform grids keep working — opt-in to a primitive
    // (full / half_horizontal / half_vertical / quadrant) is a deliberate
    // edit, not a migration side-effect.
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

// Returns the active screen for the given cfg + current time. Falls
// back to the default screen when no schedule matches.
function pickActiveScreen(cfg) {
  if (!cfg.screens || !cfg.screens.length) return null;
  // Playlist mode: cycle through every enabled screen on a fixed
  // wall-clock cadence, independent of per-screen schedules.
  // Deterministic (no in-memory counter) so multiple calls in the
  // same refresh window resolve to the same screen.
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

// `?screen=id` overrides the time-based pick. Accepts a screen id or
// a numeric 1..N index for back-compat with the old URL contract.
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

// ---------- Push-now / fast-refresh window ----------
// A deep-sleeping ESP32 can't be reached mid-sleep (no radio listening), so
// "push now" instead shortens the refresh cadence for a short window: the
// device's NEXT wake is told to poll fast for FAST_WINDOW_MS, then it returns
// to the normal interval and deep-sleeps again. Latency to enter fast mode is
// bounded by the current interval; after that, edits land within one fast tick.
const FAST_WINDOW_MS = Math.max(
  30_000, parseInt(process.env.PUSH_WINDOW_MS, 10) || 5 * 60_000
);
const FAST_INTERVAL_SECONDS = Math.max(
  10, parseInt(process.env.PUSH_INTERVAL_SECONDS, 10) || 20
);
let fastWakeUntil = 0; // epoch ms; while now < this, serve the fast interval

function pushNow() {
  fastWakeUntil = Date.now() + FAST_WINDOW_MS;
  invalidateImage(); // re-render + re-warm so the fast poll serves fresh pixels
  return fastWakeUntil;
}

// ---------- Battery-aware refresh ----------
// On low battery, stretch the sleep interval so the 2500mAh cell lasts
// longer. Firmware already honors X-Refresh-Rate, so this needs no reflash.
// We RAISE a floor rather than scale, so a config interval longer than the
// floor is never shortened. Disable with BATTERY_AWARE=0.
const BATTERY_AWARE = process.env.BATTERY_AWARE !== '0';

// Returns the minimum refresh interval (minutes) for a given battery %, or 0
// when the battery is fine / unknown (no stretch). pct === -1/null = unknown.
function batteryRefreshFloor(pct) {
  if (!BATTERY_AWARE || !Number.isFinite(pct) || pct < 0) return 0;
  if (pct < 10) return 240; // <10% → at most every 4h
  if (pct < 20) return 120; // <20% → at most every 2h
  if (pct < 35) return 60;  // <35% → at most every 1h
  return 0;
}

// ---------- Quiet hours ----------
// A nightly window where the device should barely wake. During it we tell the
// device to sleep straight through to the window's end (one wake when quiet
// ends) instead of refreshing on the normal cadence. Saves a lot of overnight
// battery. cfg.quietHours = { enabled, from:'HH:MM', to:'HH:MM' }; tz-aware.
function quietMinutesRemaining(cfg) {
  const q = cfg.quietHours;
  if (!q || !q.enabled) return 0;
  const from = parseHHMM(q.from), to = parseHHMM(q.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return 0;
  const now = localMinutesNow(cfg.timezone || 'UTC');
  const inWindow = from < to ? (now >= from && now < to)
                             : (now >= from || now < to); // wraps past midnight
  if (!inWindow) return 0;
  const mins = ((to - now) + 1440) % 1440; // minutes until the window ends
  return mins > 0 ? mins : 1440;
}

// Refresh cadence the device should use right now. Order of precedence:
//   1. push-now fast window (user-initiated, ignores everything — it's brief)
//   2. quiet hours (sleep through to the window end)
//   3. battery-aware floor (stretch interval when low)
//   4. the config/schedule interval
// Returns minutes (legacy X-Refresh-Rate, floored at 1 so current firmware
// speeds up in a fast window) and exact seconds (X-Refresh-Seconds — firmware
// can adopt for true sub-minute once reflashed). battPct defaults to the last
// reported battery so /sleep and the warmer see the same value the device does.
function effectiveRefresh(cfg, battPct) {
  if (Date.now() < fastWakeUntil) {
    return { minutes: 1, seconds: FAST_INTERVAL_SECONDS, fast: true, battSaver: false, quiet: false };
  }
  const pct = Number.isFinite(battPct) ? battPct
    : (_batteryState && Number.isFinite(_batteryState.pct) ? _batteryState.pct : -1);
  const base = resolveRefreshMinutes(cfg);
  const battFloor = batteryRefreshFloor(pct);
  const quiet = quietMinutesRemaining(cfg);
  const minutes = Math.min(1440, Math.max(base, battFloor, quiet));
  return {
    minutes, seconds: minutes * 60, fast: false,
    battSaver: battFloor > base, quiet: quiet > 0
  };
}

// ---------- Auth ----------

function checkDeviceAuth(req, res, next) {
  // Per-device API key takes precedence — once a device enrolls via
  // /api/setup it sends X-API-Key on every request. Successful lookup
  // attaches the device record to req.device for downstream handlers
  // and bumps last_seen_at so the control UI can show liveness.
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    const dev = findDeviceByKey(String(apiKey));
    if (dev) {
      req.device = dev;
      dev.last_seen_at = Date.now();
      return next();
    }
    // Unknown api-key (e.g. firmware was enrolled against a different
    // server, then pointed at this one). Fall through to the fleet
    // token check instead of rejecting outright — that path is what
    // the firmware uses pre-enrollment too, and re-enrollment
    // happens automatically via the cycle's /api/setup call. Logging
    // the stale key once helps debug "device migrated servers" cases.
    console.warn('[auth] unknown X-API-Key, falling through to fleet token');
  }
  // Legacy fleet-wide token. Keeps existing firmware working until
  // every device has enrolled via /api/setup. Also unlocks admin
  // endpoints like GET /api/devices.
  if (!DEVICE_TOKEN) return next();
  const tok = req.query.token || req.headers['x-device-token'];
  if (tok !== DEVICE_TOKEN) return res.status(401).send('Bad token');
  next();
}

// ---------- Control-panel PIN (human editor auth) ----------
// Separate from DEVICE_TOKEN: the PIN gates the browser editor, devices
// and the mac-agent keep using DEVICE_TOKEN. PIN lives hashed in
// config.auth (scrypt + per-PIN salt); a signed cookie (HMAC over an
// expiry, keyed by a random sessionSecret) is the unlocked session.
// First run (no PIN set) leaves the editor open so the user can set one.
const SESSION_DAYS = 30;
const SESSION_COOKIE = 'eink_sess';

function authBlock(cfg) { return (cfg && cfg.auth) || {}; }
function pinConfigured(cfg) { return !!authBlock(cfg).pinHash; }

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

function verifyPin(cfg, pin) {
  const a = authBlock(cfg);
  if (!a.pinHash || !a.pinSalt) return false;
  const got = hashPin(pin, a.pinSalt);
  const want = a.pinHash;
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// Persist a new PIN (and a sessionSecret if missing) under config.auth.
async function setPinInConfig(pin) {
  return withConfigLock(async () => {
    const cfg = await loadConfig();
    const salt = crypto.randomBytes(16).toString('hex');
    cfg.auth = {
      ...(cfg.auth || {}),
      pinSalt: salt,
      pinHash: hashPin(pin, salt),
      sessionSecret: (cfg.auth && cfg.auth.sessionSecret) || crypto.randomBytes(32).toString('hex')
    };
    await saveConfig(cfg);
    return cfg.auth;
  });
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Session token = base64url(exp) + '.' + HMAC-SHA256(secret, exp).
function makeSession(secret) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = Buffer.from(String(exp)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function sessionValid(req, cfg) {
  const a = authBlock(cfg);
  if (!a.sessionSecret) return false;
  const tok = parseCookies(req)[SESSION_COOKIE];
  if (!tok || tok.indexOf('.') < 0) return false;
  const [payload, mac] = tok.split('.');
  const want = crypto.createHmac('sha256', a.sessionSecret).update(payload).digest('base64url');
  if (mac.length !== want.length
    || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return false;
  const exp = Number(Buffer.from(payload, 'base64url').toString());
  return Number.isFinite(exp) && exp > Date.now();
}

function setSessionCookie(res, token) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly', 'Path=/', 'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`
  ];
  if (IS_PROD) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

// Gate the HTML editor surfaces (/control, /control-app/*). When a PIN is
// configured and the request has no valid session, bounce to the login
// page. First run (no PIN) passes through so the user can set one.
async function gateControlHtml(req, res, next) {
  try {
    const cfg = await loadConfig();
    if (sessionValid(req, cfg)) return next();
    if (pinConfigured(cfg)) return res.redirect('/control/login');
    // No PIN configured. In production, force first-run setup so a public
    // instance never serves an open editor. Locally, stay open for dev.
    if (IS_PROD) return res.redirect('/control/setup');
    return next();
  } catch (err) {
    return next(err);
  }
}

// Admin auth — DEVICE_TOKEN (mac-agent / programmatic) OR a valid PIN
// session cookie (the browser editor). Per-device api_keys are rejected:
// /api/setup hands those out unauthenticated, so a device key must NOT
// unlock config writes or the device roster. When a PIN is configured,
// the editor authenticates via cookie and sends no token.
async function checkAdminAuth(req, res, next) {
  try {
    const cfg = await loadConfig();
    if (pinConfigured(cfg) && sessionValid(req, cfg)) return next();
    if (DEVICE_TOKEN) {
      const tok = req.query.token || req.headers['x-device-token'];
      if (tok === DEVICE_TOKEN) return next();
    }
    // No PIN and no token requirement → open ONLY in local dev / first run.
    // In production we refuse admin writes until a PIN (or token) exists, so
    // a fresh public deploy can't be configured by a stranger. The first-run
    // /api/auth/set-pin path is separate and stays reachable to bootstrap.
    if (!pinConfigured(cfg) && !DEVICE_TOKEN && !IS_PROD) return next();
    return res.status(401).send('Unauthorized');
  } catch (err) {
    return next(err);
  }
}

// Generic error body so we don't leak internals (e.g. file paths,
// upstream API failure URLs) to anyone hitting the public endpoints.
// Full error stays in the server log via the caller's console.error.
function safeError(err) {
  if (IS_PROD) return { error: 'internal_error' };
  return { error: err && err.message ? err.message : String(err) };
}

// ---------- App ----------

const app = express();
// Railway / Render / Fly all front the app with a proxy that injects
// X-Forwarded-For. Without this, express-rate-limit refuses to use the
// header and crashes the process when it sees it.
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' })); // photo widget can carry a base64 image
app.use('/static', express.static(path.join(__dirname, 'public')));

// Rate limit only the proxy + write endpoints. The display.png/.bin
// fetch is intentionally uncapped so the ESP32 isn't blocked. Anything
// in /api/* gets 60 req / min / IP — well above legitimate use, low
// enough to make abuse expensive.
const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  // Raised from 60: the editor is chatty — it refetches /api/preview-data on
  // every edit, so a normal editing burst blew past 60/min and rate-limited
  // the user's own config save. 300/min still bounds real abuse.
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited' },
  // The live-preview read is admin-gated + fires on every keystroke/drag;
  // don't let it eat the budget that saves need.
  skip: (req) => req.path === '/preview-data'
});
app.use('/api/', apiLimiter);

// React control panel build output (built by Vite via `npm run build`).
const CONTROL_APP_DIR = path.join(__dirname, 'public', 'control-app');
const CONTROL_APP_INDEX = path.join(CONTROL_APP_DIR, 'index.html');
app.use('/control-app', gateControlHtml, express.static(CONTROL_APP_DIR));

// Gather all widget data needed by the dashboard. Each fetch only runs
// if at least one instance of that widget is on the active layout (or
// if the widget is non-fetched / always-on).
async function buildWidgetData(cfg, units, layout) {
  const ids = new Set((layout || []).map(it => it.widgetId || it.id));
  const wantWeather = ids.has('weather_hero') || ids.has('weather_forecast');
  const wantAqi = ids.has('aqi');
  const wantOtd = ids.has('onthisday');
  const loc = (Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon))
    ? { lat: cfg.lat, lon: cfg.lon }
    : cfg.city;

  // Merge legacy single icalUrl into icalUrls array so the calendar
  // fetcher always sees one shape.
  const icalUrls = (cfg.calendar && Array.isArray(cfg.calendar.icalUrls) && cfg.calendar.icalUrls.length)
    ? cfg.calendar.icalUrls.filter(Boolean)
    : (cfg.calendar && cfg.calendar.icalUrl ? [cfg.calendar.icalUrl] : []);

  const [
    weather, events, alerts, aqi, onThisDay
  ] = await Promise.all([
    wantWeather ? fetchWeather(loc, process.env.OPENWEATHER_API_KEY, units) : null,
    (ids.has('calendar') && icalUrls.length)
      ? Promise.all(icalUrls.map(u => fetchEvents(u))).then(lists => mergeEvents(lists.flat()))
      : [],
    (wantWeather && cfg.alerts !== false && Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon))
      ? fetchAlerts({ lat: cfg.lat, lon: cfg.lon }) : [],
    wantAqi ? fetchAqi(loc) : null,
    wantOtd ? fetchOnThisDay() : null
  ]);

  // Context for {{token}} interpolation in user-facing text widgets.
  // Loaded once here so per-tile message rendering doesn't re-read battery
  // or duplicate Date.now() per tile.
  const battery = await loadBatteryState();
  const tokenCtx = {
    now: Date.now(),
    timezone: cfg.timezone || 'UTC',
    cfg, weather, battery, units,
    lastRefresh: Date.now(),
  };

  const resolvedMessage = ids.has('text') ? resolveMessage(cfg, tokenCtx) : null;

  // Attach alerts onto weather so the renderer can show a banner without
  // a separate top-level lookup.
  if (weather && alerts && alerts.length) weather.alerts = alerts;

  // Per-instance widget data. Items with `item.settings` get fetched
  // separately and rendered with their own slot, overriding the global
  // one. Items without `settings` continue to use the global slot.
  // Widget-level caches (each fetcher keeps its own URL/symbol-keyed
  // cache with a TTL) already dedup repeated identical inputs across
  // tiles + the global fetch above, so duplicate per-instance configs
  // don't multiply API calls.
  const perItem = {};
  // Per-tile location resolver — used by weather overrides.
  const resolveLoc = (eff) => {
    if (Number.isFinite(eff.lat) && Number.isFinite(eff.lon)) {
      return { lat: eff.lat, lon: eff.lon };
    }
    if (eff.city && typeof eff.city === 'string') return eff.city;
    return null;
  };
  await Promise.all((layout || []).map(async (item) => {
    if (!item) return;
    const wid = item.widgetId || item.id;
    // Every kept widget is on the self-contained-settings contract:
    // always populate the per-item slot from `item.settings`, falling
    // back to {} so the renderer never silently inherits global cfg.
    const eff = item.settings || {};
    const slot = {};
    try {
      switch (wid) {
        // --- Data-fetched widgets ---
        case 'calendar': {
          // New contract: always set slot.events. Empty URL list resolves
          // to [] so the renderer never reaches the global cfg.calendar.
          // disabledFeeds (per-tile) filters URLs without removing them
          // from the configured list so the user can flip a feed off
          // temporarily.
          const allUrls = Array.isArray(eff.icalUrls) ? eff.icalUrls.filter(Boolean) : [];
          const disabled = new Set(Array.isArray(eff.disabledFeeds) ? eff.disabledFeeds : []);
          const urls = allUrls.filter(u => !disabled.has(u));
          if (urls.length) {
            const lists = await Promise.all(urls.map(u => fetchEvents(u)));
            slot.events = mergeEvents(lists.flat());
          } else {
            slot.events = [];
          }
          break;
        }

        // --- Location-derived widgets ---
        case 'weather_hero': {
          // New contract: always populate slot.weather. Empty location
          // resolves to a "NO DATA" stub so the renderer can't fall back
          // to global cfg.weather for this tile.
          const loc = resolveLoc(eff);
          const effUnits = (eff.unitsOverride === 'F' || eff.unitsOverride === 'C')
            ? eff.unitsOverride : units;
          slot.units = effUnits;
          slot.weather = await fetchWeather(loc, process.env.OPENWEATHER_API_KEY, effUnits);
          if (slot.weather && loc && Number.isFinite(eff.lat) && Number.isFinite(eff.lon)) {
            const alerts = await fetchAlerts({ lat: eff.lat, lon: eff.lon }).catch(() => []);
            if (alerts && alerts.length) slot.weather.alerts = alerts;
          }
          break;
        }
        case 'weather_forecast': {
          // New contract: same as weather_hero — always populate slot
          // even if the tile has no configured location.
          const loc = resolveLoc(eff);
          const effUnits = (eff.unitsOverride === 'F' || eff.unitsOverride === 'C')
            ? eff.unitsOverride : units;
          slot.units = effUnits;
          slot.weather = await fetchWeather(loc, process.env.OPENWEATHER_API_KEY, effUnits);
          if (slot.weather && loc && Number.isFinite(eff.lat) && Number.isFinite(eff.lon)) {
            const alerts = await fetchAlerts({ lat: eff.lat, lon: eff.lon }).catch(() => []);
            if (alerts && alerts.length) slot.weather.alerts = alerts;
          }
          // Per-item forecast-day override travels with the slot so the
          // renderer doesn't read cfg.weather.forecastDays for this tile.
          if (Number.isFinite(eff.forecastDays) && slot.weather) {
            slot.weather.forecastDays = eff.forecastDays;
          }
          break;
        }

        // --- Pre-resolved synthesized slots ---
        case 'text': {
          // Merged text widget. Tokens / schedule windows resolve here
          // so the SSR render fn stays a pure string template.
          if ((eff.variant || 'bar') === 'card') {
            slot.resolvedMessage = resolveMessage(
              { timezone: cfg.timezone, message: eff },
              tokenCtx
            );
          } else {
            const { renderTokens } = require('./widgets/_tokens');
            slot.resolvedText = {
              text:     renderTokens(eff.text || '',     tokenCtx),
              subtitle: renderTokens(eff.subtitle || '', tokenCtx),
            };
          }
          break;
        }

        // --- Mac-only widgets — return null off-mac, renderer shows
        // "MAC OFFLINE" placeholder. Reading happens on whichever
        // server the device hit, so these tiles light up only when
        // the Mac LAN path is active. ---
        case 'mac_nowplaying':
          slot.macNowPlaying = await fetchMacNowPlaying();
          break;
        case 'mac_battery':
          slot.macBattery = await fetchMacBattery();
          break;
        case 'clock':
          slot.clockNow = buildClock(eff, cfg.timezone);
          break;
        case 'codeactivity':
          slot.codeActivity = await fetchCodeActivity(eff.username || cfg.githubUser);
          break;
        case 'photo':
          slot.photo = await fetchPhoto(eff, item);
          break;
        case 'headlines':
          slot.headlines = await fetchHeadlines(eff);
          break;
        case 'tasks':
          slot.tasks = await fetchTasks(eff);
          break;
        case 'transit':
          slot.transit = await fetchTransit(eff);
          break;
        case 'sparkline': {
          // Battery sources use the globally-injected batteryHistory; only
          // the weather-hourly sources need a per-tile weather fetch.
          if (eff.source === 'weather_temp' || eff.source === 'weather_precip') {
            const loc = resolveLoc(eff);
            const effUnits = (eff.unitsOverride === 'F' || eff.unitsOverride === 'C')
              ? eff.unitsOverride : units;
            slot.units = effUnits;
            slot.weather = await fetchWeather(loc, process.env.OPENWEATHER_API_KEY, effUnits);
          }
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.warn(`per-item fetch failed (${wid}/${item.id}):`, err.message);
    }
    if (Object.keys(slot).length) perItem[item.id] = slot;
  }));

  return {
    weather, events, aqi, onThisDay,
    resolvedMessage,
    perItem
  };
}

// Sort + dedupe merged calendar events. Keys by title+startISO so the same
// event coming from two feeds doesn't double-render.
function mergeEvents(list) {
  const seen = new Set();
  const out = [];
  for (const e of list) {
    const k = `${e.title}|${e.startISO || e.startLabel || ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort((a, b) => {
    const ka = a.startISO || '';
    const kb = b.startISO || '';
    return ka.localeCompare(kb);
  });
}

// ============ SSR PIPELINE ============
//
// Renders the full dashboard HTML server-side from the widget render
// functions under control-src/widgets/<id>.js. The dashboard.html shell
// is now just chrome (CSS link + autofit script); the body grid is
// inlined as a static string the browser doesn't have to recompute.
// Puppeteer still loads /dashboard via headless Chrome to snap the PNG,
// but it only runs the autofit pass + font wait, not a widget loop.

const GRID_COLS = 24;
const GRID_ROWS = 12;

function sizeFor(def, sizeKey) {
  if (!def) return null;
  const sizes = def.sizes || {};
  const k = sizeKey && sizes[sizeKey] ? sizeKey : def.defaultSize;
  return sizes[k] || null;
}

// Resolve a raw layout item to one with explicit w/h. Stored geometry
// always wins; size preset is the fallback. Drops items pointing at
// unknown widget ids.
function expandLayout(rawLayout, defs) {
  const out = [];
  for (const raw of (rawLayout || [])) {
    if (raw && raw.enabled === false) continue;
    const widgetId = raw.widgetId || raw.id;
    const def = defs[widgetId];
    if (!def) continue;
    const sz = sizeFor(def, raw.size) || { w: 8, h: 4 };
    out.push({
      id: raw.id || widgetId,
      widgetId,
      x: Number.isFinite(raw.x) ? raw.x : 0,
      y: Number.isFinite(raw.y) ? raw.y : 0,
      w: Number.isFinite(raw.w) ? raw.w : sz.w,
      h: Number.isFinite(raw.h) ? raw.h : sz.h,
      flush: !!raw.flush,
      density: raw.density,
      visibility: raw.visibility,
      settings: raw.settings
    });
  }
  return out;
}

function withinVisibility(vis, nowM) {
  if (!vis || !vis.enabled) return true;
  const a = parseHHMM(vis.from), b = parseHHMM(vis.to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  if (a === b) return true;
  if (a < b) return nowM >= a && nowM < b;
  return nowM >= a || nowM < b;
}

function htmlAttr(s) {
  return String(s == null ? '' : s).replace(/"/g, '&quot;');
}

// Build the inner page HTML — body grid only (no chrome). Per-tile
// rendering pulls the per-item slot data via `perItem[item.id]` so each
// tile gets its own context (overrides global where set).
function buildPageBodyHtml({ payload, ssr, mode }) {
  const { cfg, weather, events, aqi, onThisDay, units, resolvedMessage,
          perItem, battery, batteryHistory, layout: rawLayout, devWidgetId, cardStyle } = payload;
  const bodyClass = `body body-grid${cardStyle === 'cards' ? ' body-cards' : ''}`;

  const defs = ssr.DEFS;
  const layout = expandLayout(rawLayout, defs);
  const ctxBase = {
    cfg, weather, events, aqi, onThisDay, units,
    resolvedMessage, battery, batteryHistory
  };

  // Matrix mode: every widget at every preset, stacked top-to-bottom.
  if (mode === 'matrix') {
    const PX_W = 800 / GRID_COLS, PX_H = 480 / GRID_ROWS;
    let html = '<div class="page" id="page" style="width:100%;height:auto;display:flex;flex-direction:column;gap:32px;padding:32px;background:#fff">';
    for (const id of Object.keys(defs)) {
      const def = defs[id];
      const sizes = def.sizes || {};
      // Contract v2: widgets with named variants get one matrix row per
      // variant per size so layout bugs in non-default variants surface
      // here instead of on the panel.
      const variantNames = def.variants ? Object.keys(def.variants) : [null];
      for (const key of Object.keys(sizes)) {
        const { w: cw, h: ch } = sizes[key];
        const cellWidth = cw * PX_W;
        const cellHeight = ch * PX_H;
        for (const vn of variantNames) {
          const settings = typeof def.defaults === 'function' ? def.defaults() : undefined;
          if (vn && settings) settings.variant = vn;
          // Live data where the matrix fetch produced some; frozen demo
          // data (same set the editor pool uses) for the rest, so
          // clock / batteries / now-playing show layouts, not
          // SETUP NEEDED placeholders.
          const demo = ssr.demoCtxForWidget ? ssr.demoCtxForWidget(id, cw, ch) : {};
          const live = {};
          for (const k of Object.keys(ctxBase)) {
            const val = ctxBase[k];
            if (val == null) continue;
            if (Array.isArray(val) && !val.length) continue;
            live[k] = val;
          }
          const itemCtx = {
            ...demo, ...live, cellW: cw, cellH: ch,
            // defaults first, demo data settings win over them (so
            // calendar's empty icalUrls can't clobber the demo feed),
            // then re-pin the matrix's per-row variant last.
            settings: {
              ...(settings || {}),
              ...(demo.settings || {}),
              ...(vn ? { variant: vn } : {})
            },
            variant: vn || def.defaultVariant || null
          };
          const inner = ssr.renderWidget(id, itemCtx);
          const label = vn ? `${id} · ${key} · ${vn}` : `${id} · ${key}`;
          html += `
          <div style="border:2px solid #000;background:#fff">
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#000;color:#fff;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:2px;">
              <span>${escapeHtmlServer(label)}</span>
              <span>${cw}×${ch} · ${Math.round(cellWidth)}×${Math.round(cellHeight)}px</span>
            </div>
            <div class="cell cell-${escapeHtmlServer(id)}" style="width:${cellWidth}px;height:${cellHeight}px;margin:0">${inner}</div>
          </div>`;
        }
      }
    }
    html += '</div>';
    return html;
  }

  // Dev single-widget mode: full-screen single widget, no chrome.
  if ((mode === 'dev' || mode === 'preview') && devWidgetId) {
    const item = layout[0];
    if (!item) return '<div class="page" id="page"></div>';
    const itemCtx = ssr.buildTileCtx(item, { ...ctxBase, perItem }, defs[item.widgetId]);
    const innerRaw = ssr.renderWidget(item.widgetId, itemCtx);
    const sw = ssr.scaleWrap(item.settings);
    const inner = `${sw.open}${innerRaw}${sw.close}`;
    const typo = ssr.typographyCss(item.settings);
    const extraClasses = ssr.cellClasses(item.settings).join(' ');
    // Two flavours of single-widget render:
    //
    //  • `preview` — used by the modal preview iframe / PNG render.
    //    The body grid spans only `item.w × item.h` cells, so a
    //    14×12 tile renders into the iframe's viewport exactly
    //    where it would on a real dashboard, without padding the
    //    rest of the 800×480 page around it.
    //
    //  • `dev` — used by /dev/widget/:id for designer hot-reload.
    //    Always fills the full 24×12 grid so the developer can see
    //    every render-tier and tier-conditional branch at one URL.
    const isPreview = mode === 'preview';
    const cols = isPreview ? item.w : GRID_COLS;
    const rows = isPreview ? item.h : GRID_ROWS;
    return `<div class="page" id="page" style="grid-template-rows:0px minmax(0,1fr) 0px"><div class="hdr-stub"></div><main class="body body-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},minmax(0,1fr))"><div class="cell cell-${escapeHtmlServer(item.widgetId)} ${extraClasses}" style="grid-column:1 / span ${cols};grid-row:1 / span ${rows};${typo}">${inner}</div></main><div class="ftr-stub"></div></div>`;
  }

  // Normal dashboard mode. Header/footer chrome was removed in favor of
  // the text widget (bar variant); widgets now own the full 800×480 panel.
  const nowM = localMinutesNow((cfg && cfg.timezone) || 'UTC');
  const cells = [];
  for (const item of layout) {
    if (!withinVisibility(item.visibility, nowM)) continue;
    const itemCtx = ssr.buildTileCtx(item, { ...ctxBase, perItem }, defs[item.widgetId]);
    const innerRaw = ssr.renderWidget(item.widgetId, itemCtx);
    if (!innerRaw) continue;
    const sw = ssr.scaleWrap(item.settings);
    const inner = `${sw.open}${innerRaw}${sw.close}`;
    const classes = ssr.tileCellClasses(item, GRID_COLS, GRID_ROWS);
    const styleParts = [
      `grid-column:${item.x + 1} / span ${item.w}`,
      `grid-row:${item.y + 1} / span ${item.h}`
    ];
    const typo = ssr.typographyCss(item.settings);
    if (typo) styleParts.push(typo);
    cells.push(`<div class="${classes.join(' ')}" style="${styleParts.join(';')}">${inner}</div>`);
  }
  const bodyInner = cells.length
    ? cells.join('')
    : `<div class="empty terminal-empty" style="grid-column:1 / span ${GRID_COLS};grid-row:1 / span ${GRID_ROWS}">&gt; NO_WIDGETS_ENABLED</div>`;

  return `<div class="page" id="page" style="grid-template-rows:0px minmax(0, 1fr) 0px"><div class="hdr-stub"></div><main class="${bodyClass}" style="grid-template-columns:repeat(${GRID_COLS}, minmax(0, 1fr));grid-template-rows:repeat(${GRID_ROWS}, minmax(0, 1fr))">${bodyInner}</main><div class="ftr-stub"></div></div>`;
}

function escapeHtmlServer(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function renderPage({ payload, shell, ssr, mode }) {
  const body = buildPageBodyHtml({ payload, ssr, mode });
  const screen = payload && payload.screen != null ? String(payload.screen) : '';
  const units = (payload && payload.units) || 'F';
  const accent = payload && payload.cfg && payload.cfg.accent;
  let extraStyle = accent
    ? `<style>:root{--accent:${htmlAttr(accent)}}</style>`
    : '';
  // Preview mode: collapse the html/body/.page hardcoded 800×480 down
  // to the widget's actual cell pixel size so the iframe viewport
  // matches 1:1 instead of cropping a corner of the full dashboard.
  if (mode === 'preview' && payload && Array.isArray(payload.layout) && payload.layout[0]) {
    const item = payload.layout[0];
    const PX_W = SCREEN_W / 24, PX_H = SCREEN_H / 12;
    const pw = Math.round((item.w || 8) * PX_W);
    const ph = Math.round((item.h || 4) * PX_H);
    extraStyle += `<style>html,body,.page{width:${pw}px!important;height:${ph}px!important;overflow:hidden;}body{background:#fff;}.page{display:block!important;}main.body{width:${pw}px!important;height:${ph}px!important;}</style>`;
  }
  return shell
    .replace('<!--__BODY__-->', body)
    .replace('<!--__ACCENT__-->', extraStyle)
    .replace('<!--__AUTOFIT__-->', AUTOFIT_SCRIPT)
    .replace('data-screen=""', `data-screen="${htmlAttr(screen)}"`)
    .replace('data-units=""',  `data-units="${htmlAttr(units)}"`);
}

// Dashboard HTML — built from the active screen's layout + live data.
// All widget rendering happens server-side now (see buildPageBodyHtml);
// the dashboard.html shell only carries CSS + an autofit pass.
app.get('/dashboard', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const { units, screen, activeScreen } = resolveVariant(req, cfg);
    const layout = resolveScreenLayout(activeScreen);
    const data = await buildWidgetData(cfg, units, layout);

    const [shell, ssr] = await Promise.all([loadDashboardHtml(), loadSsr()]);
    const battery = await loadBatteryState();
    const batteryHistory = await loadBatteryHistory();
    const payload = {
      cfg, units, screen, layout, battery, batteryHistory,
      cardStyle: (activeScreen && activeScreen.cardStyle) || 'grid',
      ...data,
      generatedAt: new Date().toISOString()
    };
    const html = renderPage({ payload, shell, ssr });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Dashboard render error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Reset config back to data/config.default.json. Destructive — the
// client side confirms before calling.
app.post('/api/config/reset', checkAdminAuth, async (req, res) => {
  try {
    const cfg = await withConfigLock(async () => {
      const raw = await fsp.readFile(DEFAULT_CONFIG_PATH, 'utf8');
      await atomicWriteFile(CONFIG_PATH, raw);
      _configCache = null;
      invalidateImage();
      return migrateConfigToScreens(JSON.parse(raw));
    });
    res.json(cfg);
  } catch (err) {
    res.status(500).json(safeError(err));
  }
});

// ---------- Dev tooling ----------
//
// /dev/widget/:id renders a single widget at full screen with a
// server-sent-events hot-reload script. Pair with editing widget HTML
// or CSS — the page reloads on every save.
//
// Gated to non-production so Railway doesn't expose the watcher.

const devSSEClients = new Set();
let devWatchersStarted = false;

function broadcastDevReload() {
  for (const r of devSSEClients) {
    try { r.write('event: reload\ndata: 1\n\n'); } catch (_) { /* drop */ }
  }
}

function startDevWatchers() {
  if (devWatchersStarted) return;
  devWatchersStarted = true;
  let pending = null;
  const onChange = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => { pending = null; broadcastDevReload(); }, 200);
  };
  const dirs = ['public', 'control-src', 'widgets', 'data-defaults'];
  for (const d of dirs) {
    try {
      fs.watch(path.join(__dirname, d), { recursive: true }, onChange);
    } catch (e) {
      console.warn('[dev] watch skipped', d, e.message);
    }
  }
  console.log('[dev] file watchers started');
}

app.get('/dev/events', (req, res) => {
  if (IS_PROD) return res.status(404).end();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();
  res.write(': connected\n\n');
  devSSEClients.add(res);
  startDevWatchers();
  req.on('close', () => devSSEClients.delete(res));
});

app.get('/dev/widget/:id', checkAdminAuth, async (req, res) => {
  if (IS_PROD) return res.status(404).end();
  try {
    const id = String(req.params.id);
    const sizeKey = req.query.size ? String(req.query.size) : null;

    const cfg = await loadConfig();
    const units = cfg.units || 'F';
    // Single-widget layout. dashboard.html's expandLayout resolves
    // the size preset to w/h via widgetById. Without a size, fill the
    // whole 24x12 grid.
    const item = { id: `dev-${id}`, widgetId: id, x: 0, y: 0, enabled: true };
    if (sizeKey) item.size = sizeKey;
    else { item.w = 24; item.h = 12; }
    const layout = [item];

    const data = await buildWidgetData(cfg, units, layout);
    const [shell, ssr] = await Promise.all([loadDashboardHtml(), loadSsr()]);
    const payload = {
      cfg, units, screen: 0, layout,
      ...data,
      devWidgetId: id,
      generatedAt: new Date().toISOString()
    };
    let html = renderPage({ payload, shell, ssr, mode: 'dev' });
    // EventSource auto-reload on any source file change.
    const reloadScript = `<script>
      try {
        const es = new EventSource('/dev/events');
        es.addEventListener('reload', () => location.reload());
      } catch(e) {}
    </script>`;
    html = html.replace('</body>', reloadScript + '</body>');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Dev widget render error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// ---------- Modal preview (single-widget HTML + PNG) ----------
//
// The widget settings modal needs a high-fidelity preview as the user
// edits draft settings. Two endpoints power it together:
//
//   GET  /preview/widget  → returns a tiny HTML page rendering one
//                           widget at the requested w/h with the
//                           supplied draft settings. The modal loads
//                           this in an <iframe> so the preview gets
//                           an isolated DOM that matches dashboard
//                           SSR pixel-for-pixel. Updates as the user
//                           types.
//
//   POST /api/preview-render → Puppeteer screenshots the same
//                              `/preview/widget` page and runs the
//                              dashboard's threshold pipeline so the
//                              result is bit-identical to what
//                              `/display.bin` ships to the ESP32.
//                              Modal swaps the iframe for this PNG
//                              after a debounce so the user sees the
//                              actual final 1-bit render.
//
// Both endpoints accept the same parameters: widgetId, w, h, and a
// base64-encoded JSON `settings` blob. They share the per-item
// fetcher (buildWidgetData) so live data + per-tile overrides all
// flow through normally.

function decodeSettingsParam(raw) {
  if (!raw) return null;
  try {
    const json = Buffer.from(String(raw), 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function buildPreviewPayload({ widgetId, w, h, settings, units, density }) {
  const cfg = await loadConfig();
  const effUnits = (units === 'C' || units === 'F') ? units : (cfg.units || 'F');
  const item = {
    id: `preview-${widgetId}`,
    widgetId,
    x: 0, y: 0,
    w: Math.max(1, Math.min(24, parseInt(w, 10) || 8)),
    h: Math.max(1, Math.min(12, parseInt(h, 10) || 4)),
    enabled: true,
    settings: settings || undefined,
    density: density || undefined
  };
  const layout = [item];
  const data = await buildWidgetData(cfg, effUnits, layout);
  return {
    cfg, units: effUnits, screen: 0, layout,
    ...data,
    devWidgetId: widgetId,
    generatedAt: new Date().toISOString()
  };
}

app.get('/preview/widget', checkAdminAuth, async (req, res) => {
  try {
    const widgetId = String(req.query.widget || '').trim();
    if (!widgetId) return res.status(400).send('missing widget');
    const settings = decodeSettingsParam(req.query.settings);
    const payload = await buildPreviewPayload({
      widgetId,
      w: req.query.w, h: req.query.h,
      settings,
      units: req.query.units,
      density: req.query.density
    });
    const [shell, ssr] = await Promise.all([loadDashboardHtml(), loadSsr()]);
    const html = renderPage({ payload, shell, ssr, mode: 'preview' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    // Don't long-cache — every keystroke produces a new URL via the
    // settings hash, and the user expects fresh data on reload.
    res.set('Cache-Control', 'no-store');
    res.send(html);
  } catch (err) {
    console.error('Preview render error:', err);
    res.status(500).send(safeError(err).error);
  }
});

async function renderPreviewPng({ widgetId, w, h, settings, units, density }) {
  // Non-blocking acquire: editor scrubbing a slider could fire dozens
  // of preview requests; better to "busy" them fast than to queue and
  // starve the dashboard render path (which devices depend on).
  if (!tryAcquirePage()) {
    throw new Error('preview busy');
  }
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(12000);
    page.setDefaultNavigationTimeout(12000);
    try {
      // Preview mode collapses the page chrome down to the widget's
      // pixel size, so the viewport matches 1:1 — full screenshot is
      // the widget, no cropping math.
      const PX_W = SCREEN_W / 24, PX_H = SCREEN_H / 12;
      const cellW = Math.max(1, Math.round(w * PX_W));
      const cellH = Math.max(1, Math.round(h * PX_H));
      await page.setViewport({ width: cellW, height: cellH, deviceScaleFactor: 1 });
      const qs = new URLSearchParams({
        widget: widgetId, w: String(w), h: String(h)
      });
      if (settings) {
        qs.set('settings', Buffer.from(JSON.stringify(settings)).toString('base64'));
      }
      if (units) qs.set('units', units);
      if (density) qs.set('density', density);
      if (DEVICE_TOKEN) qs.set('token', DEVICE_TOKEN);
      const url = `http://127.0.0.1:${PORT}/preview/widget?${qs}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
      await Promise.race([
        page.evaluate(() => document.fonts && document.fonts.ready),
        new Promise(r => setTimeout(r, 3500))
      ]);
      await page.waitForFunction(() => window.__autofitDone === true, { timeout: 3000 }).catch(() => {});

      const rgba = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: cellW, height: cellH }
      });

      // Run the same threshold pipeline /display.bin uses so the PNG
      // is bit-identical to what the ESP32 will draw.
      const { data, info } = await preThreshold(sharp(rgba))
        .threshold(128)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const png = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: 1 }
      }).png({ palette: true, colors: 2 }).toBuffer();
      return png;
    } finally {
      try { await page.close(); } catch (_) {}
    }
  } finally {
    releasePage();
  }
}

app.post('/api/preview-render', checkAdminAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const widgetId = String(body.widgetId || '').trim();
    if (!widgetId) return res.status(400).json({ error: 'missing widgetId' });
    const w = Math.max(1, Math.min(24, parseInt(body.w, 10) || 8));
    const h = Math.max(1, Math.min(12, parseInt(body.h, 10) || 4));
    const png = await renderPreviewPng({
      widgetId, w, h,
      settings: body.settings || null,
      units: body.units,
      density: body.density
    });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    const msg = err && err.message;
    if (msg === 'preview busy') return res.status(503).json({ error: 'busy' });
    console.error('Preview PNG error:', err);
    res.status(500).json(safeError(err));
  }
});

// Visual matrix — every widget at every preset size, top-to-bottom.
// Pure dev tooling for spotting layout bugs before they hit the panel.
app.get('/widgets-matrix', checkAdminAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const units = cfg.units || 'F';
    // `?demo=1` skips the live fetch so every tile falls back to the
    // frozen demo data (clock/weather/calendar/etc.) — deterministic
    // output for the visual-regression snapshot. Without it the matrix
    // pulls live weather + clock and no two renders match.
    const demoOnly = req.query.demo === '1' || req.query.demo === 'true';
    // Force-fetch every data widget so the matrix has real content.
    const fakeLayout = [
      { widgetId: 'weather_hero' }, { widgetId: 'weather_forecast' },
      { widgetId: 'calendar' }, { widgetId: 'text' }
    ];
    const data = demoOnly ? {} : await buildWidgetData(cfg, units, fakeLayout);
    const [shell, ssr] = await Promise.all([loadDashboardHtml(), loadSsr()]);
    const payload = {
      cfg, units, screen: 1, layout: [],
      ...data,
      generatedAt: new Date().toISOString()
    };
    const html = renderPage({ payload, shell, ssr, mode: 'matrix' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Matrix render error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Preview as PNG (for your browser)
app.get('/display.png', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    const { png } = await getCurrentImage(variant);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    console.error('PNG error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Panel-accurate 3-color preview — composites the actual black+red planes
// (what the B panel draws) into a true-color PNG. checkAdminAuth: it's a
// human/editor preview, not a device endpoint.
app.get('/display-3c.png', checkAdminAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    const { bin } = await (await getCurrentImage(variant)).get3c();
    const png = await planesToPng(bin);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    console.error('3C PNG error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Raw 1-bit packed binary for ESP32 (smaller, no decode needed)
// 800 * 480 / 8 = 48000 bytes
app.get('/display.bin', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    const { bin, etagBin } = await getCurrentImage(variant);

    // Battery telemetry over headers (firmware sends Battery-Voltage +
    // Battery-Pct on every /display.bin request). POST /api/battery
    // remains supported for backward compatibility. Parsed first so the
    // adaptive-refresh header below can stretch the interval on low battery.
    const hBattV = parseFloat(req.headers['battery-voltage']);
    const hBattPct = parseInt(req.headers['battery-pct'], 10);
    const battOk = Number.isFinite(hBattV) && hBattV >= 0 && hBattV <= 6 &&
        Number.isFinite(hBattPct) && hBattPct >= 0 && hBattPct <= 100;
    if (battOk) {
      saveBatteryState({ v: hBattV, pct: hBattPct, at: Date.now() })
        .catch(e => console.warn('battery-header save:', e.message));
    }

    // Adaptive-refresh header — tells the device how long to sleep before
    // the next wake. Replaces the older /sleep round-trip; /sleep stays alive
    // for legacy firmware. X-Refresh-Seconds carries the exact cadence (used
    // by the push-now fast window); X-Refresh-Rate stays minute-granular for
    // current firmware and is floored at 1 so it speeds up during a window.
    // Stretched on low battery via effectiveRefresh.
    const refresh = effectiveRefresh(cfg, battOk ? hBattPct : undefined);
    res.set('X-Refresh-Rate', String(refresh.minutes));
    res.set('X-Refresh-Seconds', String(refresh.seconds));

    res.set('ETag', etagBin);
    res.set('Cache-Control', 'no-store');
    // Conditional GET: unchanged image → 304 so the firmware can skip the
    // refresh and go straight back to sleep.
    if (req.headers['if-none-match'] === etagBin) {
      return res.status(304).end();
    }
    res.set('Content-Type', 'application/octet-stream');
    res.set('X-Image-Width', String(SCREEN_W));
    res.set('X-Image-Height', String(SCREEN_H));
    // res.end (not res.send) so Express keeps our strong ETag as-is.
    res.end(bin);
  } catch (err) {
    console.error('BIN error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Raw two-plane packed binary for the 3-color (B) panel.
// 96000 bytes = black plane (48000) + red plane (48000), each MSB-first.
app.get('/display-3c.bin', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    const entry = await getCurrentImage(variant);
    const { bin, etag } = await entry.get3c();

    const hBattV = parseFloat(req.headers['battery-voltage']);
    const hBattPct = parseInt(req.headers['battery-pct'], 10);
    const battOk = Number.isFinite(hBattV) && hBattV >= 0 && hBattV <= 6 &&
        Number.isFinite(hBattPct) && hBattPct >= 0 && hBattPct <= 100;
    if (battOk) {
      saveBatteryState({ v: hBattV, pct: hBattPct, at: Date.now() })
        .catch(e => console.warn('battery-header save:', e.message));
    }
    const refresh3c = effectiveRefresh(cfg, battOk ? hBattPct : undefined);
    res.set('X-Refresh-Rate', String(refresh3c.minutes));
    res.set('X-Refresh-Seconds', String(refresh3c.seconds));
    res.set('ETag', etag);
    res.set('Cache-Control', 'no-store');
    // Conditional GET: identical image → 304, firmware skips the slow
    // ~15-26 s color refresh entirely and goes back to sleep.
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.set('Content-Type', 'application/octet-stream');
    res.set('X-Image-Width', String(SCREEN_W));
    res.set('X-Image-Height', String(SCREEN_H));
    res.set('X-Image-Planes', '2');
    // res.end (not res.send) so Express doesn't replace our strong ETag
    // with its own weak one or run its freshness logic.
    res.end(bin);
  } catch (err) {
    console.error('3C BIN error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Two-zone refresh helpers for BW panels.
//
// Splitting `display.bin` into a header strip (top 60 rows) and a body
// region (next 420 rows) lets the firmware do a partial refresh of just
// the always-changing clock band, while ETag-gating the larger body so
// quiet 30-minute intervals skip the slow refresh + 42 KB transfer.
//
// Rows are stored top-to-bottom in row-major MSB-first order, so the
// split is a clean byte slice: header is bytes 0..6000, body is
// 6000..48000. No re-packing needed.
const HEADER_H_ROWS = 60;
const BODY_H_ROWS = SCREEN_H - HEADER_H_ROWS;   // 420
const HEADER_BYTES = (SCREEN_W * HEADER_H_ROWS) / 8;  // 6000
const BODY_BYTES   = (SCREEN_W * BODY_H_ROWS) / 8;    // 42000

function strongEtag(buf) {
  // Strong ETag — bytes-exact match. Quotes per RFC 7232.
  return `"${crypto.createHash('sha1').update(buf).digest('hex')}"`;
}

function sendBinSlice(req, res, slice) {
  const etag = strongEtag(slice);
  res.set('ETag', etag);
  res.set('Cache-Control', 'no-store');
  res.set('X-Image-Width', String(SCREEN_W));
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.set('Content-Type', 'application/octet-stream');
  res.send(slice);
}

app.get('/display-header.bin', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    const { bin } = await getCurrentImage(variant);
    res.set('X-Image-Height', String(HEADER_H_ROWS));
    sendBinSlice(req, res, bin.subarray(0, HEADER_BYTES));
  } catch (err) {
    console.error('BIN header error:', err);
    res.status(500).send(safeError(err).error);
  }
});

app.get('/display-body.bin', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    const { bin } = await getCurrentImage(variant);
    res.set('X-Image-Height', String(BODY_H_ROWS));
    sendBinSlice(req, res, bin.subarray(HEADER_BYTES, HEADER_BYTES + BODY_BYTES));
  } catch (err) {
    console.error('BIN body error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Tell ESP32 how long to sleep — uses the active screen's refresh
// interval (which may differ per scheduled window).
app.get('/sleep', checkDeviceAuth, async (req, res) => {
  const cfg = await loadConfig();
  const s = pickActiveScreen(cfg);
  const refresh = effectiveRefresh(cfg);
  res.json({
    minutes: refresh.minutes, seconds: refresh.seconds,
    fast: refresh.fast, battSaver: refresh.battSaver, quiet: refresh.quiet,
    screenId: s ? s.id : null, screenName: s ? s.name : null
  });
});

// Push now — opens a fast-refresh window so the device picks up the latest
// render quickly instead of waiting out its full sleep interval. The device
// still has to wake once to enter the window (deep sleep can't be interrupted
// remotely), so the response reports the worst-case latency for the UI.
app.post('/api/wake', checkAdminAuth, async (req, res) => {
  const fastUntil = pushNow();
  const cfg = await loadConfig().catch(() => ({}));
  res.json({
    ok: true,
    fastUntil,
    fastSeconds: FAST_INTERVAL_SECONDS,
    windowMs: FAST_WINDOW_MS,
    maxLatencyMinutes: resolveRefreshMinutes(cfg) // until the device next wakes
  });
});

// Control panel
app.get('/', (req, res) => res.redirect('/control'));

// ---------- Control-panel PIN auth ----------
// Login page: editorial-styled, no webfonts/JS deps, posts the PIN and
// redirects on success. Served unauthenticated (it's the unlock door).
const LOGIN_PAGE = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Unlock · E-Ink Dashboard</title>
<style>body{font-family:Georgia,serif;background:#faf8f3;color:#111;max-width:360px;margin:64px auto;padding:0 16px}
h1{font-size:24px;font-weight:400;border-bottom:3px solid #111;padding-bottom:10px}
label{display:block;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6960;margin:22px 0 6px}
input{width:100%;box-sizing:border-box;padding:11px 12px;font-size:18px;letter-spacing:4px;font-family:inherit;background:#fff;border:1.5px solid #111}
button{margin-top:18px;padding:12px;font-family:ui-monospace,monospace;font-weight:700;letter-spacing:3px;text-transform:uppercase;border:2px solid #111;background:#111;color:#fff;width:100%;cursor:pointer}
.err{font-family:ui-monospace,monospace;font-size:12px;color:#b00;margin-top:14px;min-height:16px}</style>
</head><body><h1>E-Ink Dashboard</h1>
<form id="f"><label>Enter PIN</label>
<input id="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus>
<button>Unlock</button><div class="err" id="e"></div></form>
<script>
const f=document.getElementById('f'),e=document.getElementById('e');
f.onsubmit=async(ev)=>{ev.preventDefault();e.textContent='';
const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin:document.getElementById('pin').value})});
if(r.ok){location.href='/control';}else{e.textContent='Wrong PIN';document.getElementById('pin').value='';}};
</script></body></html>`;

// First-run "create a PIN" page. Shown in production when no PIN is set yet,
// so a freshly-deployed public instance can't sit with an open editor.
const SETUP_PAGE = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Secure your dashboard · E-Ink</title>
<style>body{font-family:Georgia,serif;background:#faf8f3;color:#111;max-width:380px;margin:56px auto;padding:0 16px}
h1{font-size:24px;font-weight:400;border-bottom:3px solid #111;padding-bottom:10px}
p.lede{font-size:14px;line-height:1.5;color:#555}
label{display:block;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6960;margin:18px 0 6px}
input{width:100%;box-sizing:border-box;padding:11px 12px;font-size:18px;letter-spacing:4px;font-family:inherit;background:#fff;border:1.5px solid #111}
button{margin-top:18px;padding:12px;font-family:ui-monospace,monospace;font-weight:700;letter-spacing:3px;text-transform:uppercase;border:2px solid #111;background:#111;color:#fff;width:100%;cursor:pointer}
.err{font-family:ui-monospace,monospace;font-size:12px;color:#b00;margin-top:14px;min-height:16px}</style>
</head><body><h1>Secure your dashboard</h1>
<p class="lede">This instance has no PIN yet. Set one to lock the editor before anyone else finds it.</p>
<form id="f"><label>New PIN (4+ digits)</label>
<input id="pin" type="password" inputmode="numeric" autocomplete="new-password" autofocus>
<label>Confirm PIN</label>
<input id="pin2" type="password" inputmode="numeric" autocomplete="new-password">
<button>Set PIN &amp; continue</button><div class="err" id="e"></div></form>
<script>
const f=document.getElementById('f'),e=document.getElementById('e');
f.onsubmit=async(ev)=>{ev.preventDefault();e.textContent='';
const p=document.getElementById('pin').value,p2=document.getElementById('pin2').value;
if(p.length<4){e.textContent='PIN must be 4+ digits';return;}
if(p!==p2){e.textContent='PINs do not match';return;}
const r=await fetch('/api/auth/set-pin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin:p})});
if(r.ok){location.href='/control';}else{e.textContent='Could not set PIN';}};
</script></body></html>`;

app.get('/control/login', async (req, res) => {
  const cfg = await loadConfig().catch(() => ({}));
  if (sessionValid(req, cfg)) return res.redirect('/control');
  // No PIN yet: force setup in prod, open editor locally.
  if (!pinConfigured(cfg)) return res.redirect(IS_PROD ? '/control/setup' : '/control');
  res.type('html').send(LOGIN_PAGE);
});

// First-run PIN setup. Only meaningful when no PIN is configured; once one
// exists this bounces to login/editor so it can't be used to view a form.
app.get('/control/setup', async (req, res) => {
  const cfg = await loadConfig().catch(() => ({}));
  if (sessionValid(req, cfg)) return res.redirect('/control');
  if (pinConfigured(cfg)) return res.redirect('/control/login');
  res.type('html').send(SETUP_PAGE);
});

app.post('/api/auth/login', async (req, res) => {
  const cfg = await loadConfig();
  if (!pinConfigured(cfg)) return res.status(400).json({ error: 'no_pin_set' });
  const pin = (req.body && req.body.pin) || '';
  if (!verifyPin(cfg, pin)) return res.status(401).json({ error: 'bad_pin' });
  setSessionCookie(res, makeSession(authBlock(cfg).sessionSecret));
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/status', async (req, res) => {
  const cfg = await loadConfig().catch(() => ({}));
  res.json({ configured: pinConfigured(cfg), authed: sessionValid(req, cfg) });
});

// Set or change the PIN. First run (no PIN yet) is open so the user can
// set one from the editor. Once set, requires a valid session OR the
// current PIN — so a logged-in editor (or someone who knows the PIN) can
// rotate it, but a stranger can't.
app.post('/api/auth/set-pin', async (req, res) => {
  const cfg = await loadConfig();
  const newPin = String((req.body && req.body.pin) || '');
  if (newPin.length < 4) return res.status(400).json({ error: 'pin_too_short' });
  if (pinConfigured(cfg)) {
    const ok = sessionValid(req, cfg)
      || verifyPin(cfg, (req.body && req.body.currentPin) || '');
    if (!ok) return res.status(401).json({ error: 'unauthorized' });
  }
  const auth = await setPinInConfig(newPin);
  setSessionCookie(res, makeSession(auth.sessionSecret));
  res.json({ ok: true });
});

app.get('/control', gateControlHtml, (req, res) => {
  // Prefer the React app; fall back to the legacy vanilla page when the
  // build artifact hasn't been produced yet (e.g. local dev before
  // `npm run build`).
  if (fs.existsSync(CONTROL_APP_INDEX)) {
    res.sendFile(CONTROL_APP_INDEX);
  } else {
    res.sendFile(path.join(__dirname, 'public', 'control.html'));
  }
});
app.get('/control-classic', gateControlHtml, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'control.html'));
});

// ---------- Geocoding / weather-check (Open-Meteo, no API key) ----------
// React fetches these instead of calling Open-Meteo directly so that
// (a) we can cache responses on the server and (b) the path is stable
// if we ever switch providers.

const geocodeCache = new Map(); // key: q-lower → { at, data }
const GEO_CACHE_MS = 24 * 60 * 60 * 1000;
const GEO_CACHE_MAX = 500;

function trimGeoCache() {
  while (geocodeCache.size > GEO_CACHE_MAX) {
    // Map preserves insertion order — oldest key is first.
    const oldest = geocodeCache.keys().next().value;
    geocodeCache.delete(oldest);
  }
}

async function jsonFetch(url, opts = {}) {
  // Node fetch has no built-in timeout — a slow upstream (Open-Meteo,
  // Nominatim) would hang the request indefinitely. 10s covers normal
  // latency with generous headroom.
  const r = await fetch(url, { signal: AbortSignal.timeout(10000), ...opts });
  if (!r.ok) throw new Error(`${url.split('?')[0]} → ${r.status}`);
  return r.json();
}

app.get('/api/geocode', checkAdminAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);
  const cacheKey = q.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached && (Date.now() - cached.at) < GEO_CACHE_MS) {
    return res.json(cached.data);
  }
  try {
    const data = await jsonFetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`
    );
    const shaped = ((data && data.results) || []).map(d => ({
      name: d.name,
      state: d.admin1 || null,
      country: (d.country_code || '').toUpperCase() || null,
      lat: d.latitude,
      lon: d.longitude
    }));
    geocodeCache.set(cacheKey, { at: Date.now(), data: shaped });
    trimGeoCache();
    res.json(shaped);
  } catch (err) {
    res.status(500).json(safeError(err));
  }
});

app.get('/api/reverse-geocode', checkAdminAuth, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'bad coords' });
  }
  try {
    // Nominatim (OpenStreetMap) is the only reliable free reverse
    // geocoder. Their usage policy requires a clear User-Agent.
    const data = await jsonFetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`,
      { headers: { 'User-Agent': 'eink-dashboard/1.0 (https://github.com/hqn07/eink-dashboard)' } }
    );
    const addr = (data && data.address) || {};
    const name = addr.city || addr.town || addr.village || addr.municipality || addr.county || data.name || '';
    res.json({
      name: name,
      state: addr.state || null,
      country: (addr.country_code || '').toUpperCase() || null,
      lat: parseFloat(data.lat) || lat,
      lon: parseFloat(data.lon) || lon
    });
  } catch (err) {
    res.status(500).json(safeError(err));
  }
});

app.get('/api/weather-check', checkAdminAuth, async (req, res) => {
  const city = (req.query.city || '').trim();
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const units = req.query.units === 'C' ? 'C' : 'F';
  try {
    // Reuse the weather widget so the result matches what the
    // dashboard will actually render. fetchWeather handles the
    // geocode-then-fetch dance internally for city-only queries.
    const loc = (Number.isFinite(lat) && Number.isFinite(lon))
      ? { lat, lon }
      : city;
    const w = await fetchWeather(loc, null, units);
    if (w.stale) return res.json({ ok: false, error: 'not found' });
    res.json({
      ok: true,
      temp: w.temp,
      desc: w.desc,
      country: w.country || null
    });
  } catch (err) {
    res.json({ ok: false, ...safeError(err) });
  }
});

// Returns the full payload the dashboard would render — minus the
// HTML. The React editor uses this to render live widget tiles locally.
app.get('/api/preview-data', checkAdminAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const { units, screen, activeScreen } = resolveVariant(req, cfg);
    const layout = resolveScreenLayout(activeScreen);
    const data = await buildWidgetData(cfg, units, layout);
    const battery = await loadBatteryState();
    const batteryHistory = await loadBatteryHistory();
    res.json({
      cfg, units, screen, layout, battery, batteryHistory,
      ...data,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json(safeError(err));
  }
});

// Config API
app.get('/api/config', checkAdminAuth, async (req, res) => {
  res.json(await loadConfig());
});

app.post('/api/config', checkAdminAuth, async (req, res) => {
  try {
    // Guard: req.body must be a plain object. A JSON string/array/number
    // body would otherwise spread into the config and corrupt it (array
    // indices become keys, string chars become keys, etc.).
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ ok: false, error: 'body must be an object' });
    }
    if ('screens' in req.body && !Array.isArray(req.body.screens)) {
      return res.status(400).json({ ok: false, error: 'screens must be an array' });
    }
    const merged = await withConfigLock(async () => {
      const current = await loadConfig();
      // Top-level fields the client may send. `screens` is treated as
      // canonical — whatever the editor sends wins. Other nested
      // settings are shallow-merged so the editor can patch a single
      // section (e.g. just `message`) without clobbering siblings.
      const next = { ...current, ...req.body,
        widgets:  { ...(current.widgets  || {}), ...(req.body.widgets  || {}) },
        message:  { ...(current.message  || {}), ...(req.body.message  || {}) },
        calendar: { ...(current.calendar || {}), ...(req.body.calendar || {}) },
        weather:  { ...(current.weather  || {}), ...(req.body.weather  || {}) },
      };
      if (Array.isArray(req.body.screens)) {
        next.screens = req.body.screens;
        // Drop the legacy single-layout array when the new schema is
        // explicit; keeps config.json tidy.
        if (!('layout' in req.body))  delete next.layout;
        if (!('layouts' in req.body)) delete next.layouts;
      }
      await saveConfig(next);
      invalidateImage();
      return next;
    });
    res.json({ ok: true, config: merged });
  } catch (err) {
    res.status(500).json({ ok: false, ...safeError(err) });
  }
});

// Battery report from the ESP32. Stored to disk so it survives a server
// restart (panel only POSTs once per wake — every ~30min — so an
// in-memory-only value would frequently be missing).
app.post('/api/battery', checkDeviceAuth, async (req, res) => {
  const v = parseFloat(req.body && req.body.v);
  const pct = parseInt(req.body && req.body.pct, 10);
  if (!Number.isFinite(v) || v < 0 || v > 6) {
    return res.status(400).json({ error: 'bad voltage' });
  }
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return res.status(400).json({ error: 'bad pct' });
  }
  await saveBatteryState({ v, pct, at: Date.now() });
  invalidateImage(); // so the next render shows the fresh value
  res.json({ ok: true });
});

app.get('/api/battery', checkDeviceAuth, async (req, res) => {
  const b = await loadBatteryState();
  res.json(b || { v: null, pct: null, at: null });
});

// ---------- Mac state (pushed from the Mac-side agent) ----------
//
// `mac-agent.js` running on the user's Mac periodically POSTs the
// latest nowplaying + battery snapshot here. Cloud renderers read it
// via the shared widgets/_mac_state cache. Payload shape:
//   {
//     nowplaying: { title, artist, album, isPlaying, durationSec,
//                   elapsedSec, sourceLabel, artworkBase64 } | null,
//     battery:    { percent, state } | null,
//     trackKey:   <optional hash>
//   }
//
// The agent dedupes artwork by track key — when the trackKey matches
// what the server already has it can omit `artworkBase64` and we keep
// the previous frame's image. Keeps bandwidth bounded (~50MB/mo).
const macStateMod = require('./widgets/_mac_state');
// Serialize mac-state writes so two concurrent agent pushes can't both
// read `_lastTrackKey`, decide they're the same track, and race to
// write — which would leave the artwork stuck null even after the
// song actually changed.
let _macStateChain = Promise.resolve();
let _lastTrackKey = null;
app.post('/api/mac-state', checkAdminAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const np = body.nowplaying || null;
    const bt = body.battery || null;
    const trackKey = typeof body.trackKey === 'string' ? body.trackKey : null;

    const result = await (_macStateChain = _macStateChain.then(async () => {
      const prev = await macStateMod.read();
      let mergedNp = np;
      // Artwork-less push for an unchanged track: keep the stored art.
      // The known key comes from memory OR the persisted state file —
      // the on-disk fallback matters after a server restart, when the
      // agent (mid-song) keeps omitting artwork but `_lastTrackKey` was
      // wiped; without it the tile loses album art until the song
      // changes.
      const knownKey = _lastTrackKey || (prev && prev.trackKey) || null;
      if (np && !('artworkBase64' in np) && trackKey && trackKey === knownKey) {
        const prevArt = prev && prev.nowplaying && prev.nowplaying.artworkBase64;
        mergedNp = { ...np, artworkBase64: prevArt || null };
      }
      if (trackKey) _lastTrackKey = trackKey;
      await macStateMod.write({ nowplaying: mergedNp, battery: bt, trackKey });
      // Only force a re-render when the rendered payload actually
      // changed. Battery percent ticking 87 → 86 is a real change; an
      // identical no-op push from the agent (same song, same battery)
      // shouldn't burn a Puppeteer cycle.
      const changed = !sameMacState(prev, { nowplaying: mergedNp, battery: bt });
      if (changed) invalidateImage();
      return changed;
    }).catch(err => {
      console.error('mac-state chain error:', err);
      throw err;
    }));

    res.json({ ok: true, changed: result });
  } catch (err) {
    console.error('mac-state error:', err);
    res.status(500).json(safeError(err));
  }
});

// Compare two mac-state snapshots for render-visible equality. Artwork
// is hashed by length so the bytes themselves don't blow the comparison
// up to several KB per call.
function sameMacState(a, b) {
  const npA = (a && a.nowplaying) || null;
  const npB = (b && b.nowplaying) || null;
  if (!npA !== !npB) return false;
  if (npA && npB) {
    if (npA.title !== npB.title) return false;
    if (npA.artist !== npB.artist) return false;
    if (npA.album !== npB.album) return false;
    if (npA.isPlaying !== npB.isPlaying) return false;
    if (Math.round((npA.elapsedSec || 0) / 5) !== Math.round((npB.elapsedSec || 0) / 5)) return false;
    if ((npA.artworkBase64 || '').length !== (npB.artworkBase64 || '').length) return false;
    if (npA.sourceLabel !== npB.sourceLabel) return false;
  }
  const btA = (a && a.battery) || null;
  const btB = (b && b.battery) || null;
  if (!btA !== !btB) return false;
  if (btA && btB) {
    if (btA.percent !== btB.percent) return false;
    if (btA.state !== btB.state) return false;
  }
  return true;
}

app.get('/api/mac-state', checkAdminAuth, async (req, res) => {
  const s = await macStateMod.read();
  res.json(s || { nowplaying: null, battery: null, at: null });
});

// ---------- Alarms ----------
//
// Stored at cfg.alarms — see widgets/alarms.js for the shape. Time
// math runs in the server's local timezone; set the TZ env var on
// Railway to match your real timezone or alarms will misfire by the
// offset.

app.get('/api/alarms', checkAdminAuth, async (req, res) => {
  const cfg = await loadConfig();
  res.json({ alarms: Array.isArray(cfg.alarms) ? cfg.alarms : [] });
});

app.post('/api/alarms', checkAdminAuth, async (req, res) => {
  try {
    const alarms = await withConfigLock(async () => {
      const cfg = await loadConfig();
      cfg.alarms = normalizeAlarmList(req.body && req.body.alarms);
      await saveConfig(cfg);
      invalidateImage();
      return cfg.alarms;
    });
    res.json({ ok: true, alarms });
  } catch (err) {
    console.error('alarms POST error:', err);
    res.status(500).json({ ok: false, ...safeError(err) });
  }
});

// Device fetches this each wake to decide how long to sleep. Returns
// the soonest-firing alarm as Unix ms + label + duration-sec hint, or
// `{ next: null }` if none enabled.
app.get('/api/alarm/next', checkDeviceAuth, async (req, res) => {
  const cfg = await loadConfig();
  const next = computeNextAlarm(cfg.alarms || []);
  if (next && next.label) {
    const { renderTokens } = require('./widgets/_tokens');
    const battery = await loadBatteryState();
    const ctx = {
      now: Date.now(),
      timezone: cfg.timezone || 'UTC',
      cfg, weather: null, battery, units: cfg.units || 'F',
      lastRefresh: Date.now(),
    };
    next.label = renderTokens(next.label, ctx);
  }
  res.json({
    now: Date.now(),
    next: next || null
  });
});

// ---------- Firmware OTA ----------
//
// Layout: drop compiled `.bin` files into `public/firmware/` named
// `<board>-<semver>.bin` (e.g. `bw-1.2.0.bin`, `b-1.0.3.bin`). The device
// hits /api/firmware/manifest with its board + current version; if a
// newer binary exists, the manifest returns it and the device pulls the
// raw file from /firmware/<filename> via ESP32 httpUpdate.
// parseSemver/cmpSemver/findNewestFirmware + FW_DIR/FW_NAME_RE moved to
// ./lib/firmware.js (required at the top).

app.get('/api/firmware/manifest', checkDeviceAuth, async (req, res) => {
  const board = String(req.query.board || '').toLowerCase();
  if (!/^[a-z0-9]+$/.test(board)) {
    return res.status(400).json({ error: 'bad_board' });
  }
  const from = parseSemver(req.query.from);
  const best = await findNewestFirmware(board);
  if (!best) return res.status(204).end();
  if (from && cmpSemver(best.ver, from) <= 0) return res.status(204).end();

  let size = null;
  try {
    const st = await fsp.stat(path.join(FW_DIR, best.name));
    size = st.size;
  } catch (_) { /* ignore */ }

  const proto = (req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  let url = `${proto}://${host}/firmware/${best.name}`;
  if (DEVICE_TOKEN) url += `?token=${encodeURIComponent(DEVICE_TOKEN)}`;
  res.json({ version: best.version, board, url, size });
});

// Serve the raw .bin. Filename is strict-validated against the same regex
// the manifest uses, so a malicious `?file=../../etc/passwd` style request
// can't escape the firmware directory.
app.get('/firmware/:file', checkDeviceAuth, (req, res) => {
  const name = req.params.file;
  if (!FW_NAME_RE.test(name)) return res.status(400).send('bad name');
  const full = path.join(FW_DIR, name);
  res.sendFile(full, (err) => {
    if (err && !res.headersSent) res.status(404).send('not found');
  });
});

// ---------- Device enrollment ----------
//
// First-boot handshake: device POSTs its MAC; server returns a
// long-lived api_key + a short friendly_id ("A3F2B7") for the
// control UI. Idempotent — re-enrolling the same MAC returns the
// existing record so a re-flashed device that lost NVS can recover.
//
// No auth: this is the bootstrap path. Rate-limited at the global
// /api/* middleware to keep abuse from filling the device store.
app.post('/api/setup', async (req, res) => {
  try {
    // Gate enrollment behind DEVICE_TOKEN when one is set, so a stranger
    // can't mint a device key (and then read /display.*). Open when no
    // token is configured (local dev / first run). Firmware sends the token
    // on the enroll request via addToken().
    if (DEVICE_TOKEN) {
      const tok = req.query.token || req.headers['x-device-token'];
      if (tok !== DEVICE_TOKEN) return res.status(401).json({ error: 'unauthorized' });
    }
    const mac = String((req.body && req.body.mac) || '').toLowerCase().trim();
    if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
      return res.status(400).json({ error: 'bad_mac' });
    }
    const devices = loadDevicesSync();
    let dev = devices[mac];
    if (!dev) {
      dev = {
        mac,
        api_key:     genApiKey(),
        friendly_id: genFriendlyId(),
        first_seen_at: Date.now()
      };
    }
    dev.last_seen_at = Date.now();
    if (req.body && req.body.fw_version) dev.fw_version = String(req.body.fw_version);
    if (req.body && req.body.board)      dev.board      = String(req.body.board);
    devices[mac] = dev;
    await saveDevices(devices);
    res.json({ api_key: dev.api_key, friendly_id: dev.friendly_id });
  } catch (err) {
    console.error('setup error:', err);
    res.status(500).json({ error: 'internal' });
  }
});

// Admin: list every enrolled device + its last-seen telemetry. Auth'd
// behind the fleet-wide DEVICE_TOKEN so per-device keys don't expose
// the whole roster.
app.get('/api/devices', checkAdminAuth, (req, res) => {
  const all = loadDevicesSync();
  // Strip api_key from the response — UI doesn't need it and it's
  // sensitive. friendly_id is the per-device handle.
  const out = Object.values(all).map(d => ({
    mac: d.mac,
    friendly_id: d.friendly_id,
    fw_version:  d.fw_version || null,
    board:       d.board || null,
    first_seen_at: d.first_seen_at || null,
    last_seen_at:  d.last_seen_at || null
  }));
  res.json({ devices: out });
});

// Admin: remove a stale device record by friendly_id or MAC. The device
// re-enrolls automatically if it ever checks in again, so this just prunes
// dead/duplicate rows from the roster (e.g. pre-reflash enrollments).
app.delete('/api/device/:id', checkAdminAuth, async (req, res) => {
  const id = String(req.params.id || '').trim();
  const devices = loadDevicesSync();
  const mac = devices[id] ? id
    : Object.keys(devices).find(m =>
        (devices[m].friendly_id || '').toLowerCase() === id.toLowerCase() ||
        m.toLowerCase() === id.toLowerCase());
  if (!mac || !devices[mac]) return res.status(404).json({ error: 'not_found' });
  delete devices[mac];
  await saveDevices(devices);
  res.json({ ok: true, removed: id });
});

// Health
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------- Ops status page ----------
// Human-readable "is it working?" dashboard. checkAdminAuth (PIN/token):
// it exposes device + battery telemetry. Auto-refreshes every 60s.
const _serverStartedAt = Date.now();
// relAge/dur/batteryTrend/sparkline moved to ./lib/statusfmt.js
// (required at the top).

app.get('/status', checkAdminAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const battery = await loadBatteryState();
    const history = await loadBatteryHistory();
    const devices = Object.values(loadDevicesSync());
    // Most recent render across cached variants.
    let lastRender = 0;
    for (const e of imageCache.values()) if (e.at > lastRender) lastRender = e.at;

    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ok = (b) => b ? '<span class="ok">OK</span>' : '<span class="bad">—</span>';

    const baseMin = resolveRefreshMinutes(cfg);
    const battPct = battery && Number.isFinite(battery.pct) ? battery.pct : undefined;
    const refresh = effectiveRefresh(cfg, battPct);
    const fastActive = Date.now() < fastWakeUntil;

    let refreshNote;
    if (refresh.fast) {
      refreshNote = `<span class="warn">FAST</span> ${refresh.seconds}s · push-now window`;
    } else if (refresh.quiet) {
      refreshNote = `${refresh.minutes} min · <span class="warn">quiet hours</span> (sleeping through)`;
    } else if (refresh.battSaver) {
      refreshNote = `${refresh.minutes} min · <span class="warn">battery-saver</span> (base ${baseMin})`;
    } else {
      refreshNote = `${refresh.minutes} min`;
    }

    // Each row: [label, value-html, explanation]. The explanation drives a
    // click-to-expand "ⓘ" so a non-expert can tell good from bad at a glance.
    const rows = [];
    rows.push(['Server', `${ok(true)} up ${dur(Date.now() - _serverStartedAt)}`,
      'How long the server has been running. Resets to 0 on every deploy/restart — a small number right after you push is normal.']);
    rows.push(['Refresh now', refreshNote,
      'How often the panel updates right now. Normally your configured interval. It speeds up during a Push-now window, and slows down on low battery or during quiet hours (that is intended, not a fault).']);
    rows.push(['Pre-render', PRERENDER_ENABLED
      ? `${ok(true)} every ${Math.round(PRERENDER_INTERVAL_MS / 1000)}s`
      : '<span class="warn">off</span>',
      'The server keeps the next image ready in advance so the device never waits on a slow render. OK = on (what you want).']);
    rows.push(['Last render', lastRender ? relAge(lastRender) : 'not yet',
      'Time since the dashboard image was last drawn. Should be recent if anything is viewing it; "not yet" just means nothing has requested an image since the last restart.']);
    rows.push(['Push window', fastActive
      ? `<span class="ok">active</span> · ${dur(fastWakeUntil - Date.now())} left`
      : '<span class="muted">idle</span>',
      'Active = a Push-now fast-refresh window is currently open, so the device polls quickly. Idle is the normal resting state.']);
    rows.push(['Weather key', ok(!!process.env.OPENWEATHER_API_KEY),
      'OpenWeatherMap API key. Blank/— is usually FINE: the default weather uses Open-Meteo, which needs no key. Only set this if you add a widget that specifically needs OpenWeatherMap.']);
    rows.push(['Device token', ok(!!DEVICE_TOKEN),
      'A shared secret the device sends so strangers cannot pull your image endpoints. OK = set (recommended). Blank = anyone with the URL can fetch /display.*']);
    rows.push(['Control PIN', pinConfigured(cfg) ? '<span class="ok">SET</span>' : '<span class="warn">not set</span>',
      'Whether the editor is PIN-locked. SET = the control panel asks for a PIN. "not set" means anyone who reaches the URL can edit.']);
    if (battery) {
      rows.push(['Battery', `${battery.pct}% · ${Number(battery.v).toFixed(2)} V · ${relAge(battery.at)}`,
        'The last battery reading the device reported: charge %, voltage, and how long ago. If "ago" is large the device has not checked in recently.']);
    } else {
      rows.push(['Battery', '<span class="warn">no reading yet</span>',
        'No battery reading received yet. The device reports this on each wake, so it fills in after the next refresh on battery power.']);
    }
    const trend = batteryTrend(history);
    if (trend) {
      let t;
      if (trend.ratePerH < -0.05) {
        const eta = trend.etaH != null && trend.etaH < 1000 ? ` · ~${dur(trend.etaH * 3_600_000)} to empty` : '';
        t = `▼ ${Math.abs(trend.ratePerH).toFixed(1)}%/h${eta}`;
      } else if (trend.ratePerH > 0.05) {
        t = `<span class="ok">▲ charging ${trend.ratePerH.toFixed(1)}%/h</span>`;
      } else {
        t = 'flat';
      }
      const spark = sparkline(history.slice(-24).map(h => h.pct));
      rows.push(['Battery trend', `${t}${spark ? ` · <span class="muted">${spark}</span>` : ''}`,
        'Which way the battery is going over recent readings. ▼ = draining (with %/hour and a rough time-to-empty), ▲ = charging, flat = no change. flat is FINE — it just means steady (e.g. on USB power or few readings). The sparkline is the recent % history, left=older.']);
    }
    rows.push(['Battery history', `${history.length} point${history.length === 1 ? '' : 's'}`,
      'How many battery readings are stored. These feed the trend and sparkline above; more points = a better trend estimate.']);
    const lastErr = _errLog[_errLog.length - 1];
    rows.push(['Errors', _errLog.length === 0
      ? '<span class="ok">none</span>'
      : `<span class="warn">${_errLog.length}</span> · last ${relAge(lastErr.at)}`,
      'Server errors captured since the last restart (cleared on restart). 0 is what you want. If this climbs, expand the Recent errors list below. A few stale ones from a transient blip are usually harmless.']);

    const STALE_MS = 2 * 86400000; // 2 days without contact = prunable
    const devRows = devices.length ? devices.map(d => {
      const id = esc(d.friendly_id || d.mac);
      const stale = d.last_seen_at && (Date.now() - d.last_seen_at) > STALE_MS;
      const seen = `${relAge(d.last_seen_at)}${stale ? ' <span class="warn">stale</span>' : ''}`;
      return `<tr><td>${id}</td><td>${esc(d.board || '?')}</td>`
        + `<td>${esc(d.fw_version || '?')}</td><td>${seen}</td>`
        + `<td><button class="rm" data-id="${id}">remove</button></td></tr>`;
    }).join('') : '<tr><td colspan="5" class="muted">No devices enrolled yet.</td></tr>';

    const liveRenderHref = '/display.png' + (DEVICE_TOKEN ? `?token=${encodeURIComponent(DEVICE_TOKEN)}` : '');

    res.type('html').send(`<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>Status · E-Ink Dashboard</title>
<style>body{font-family:Georgia,serif;background:#faf8f3;color:#111;max-width:560px;margin:32px auto;padding:0 16px}
h1{font-size:26px;font-weight:400;border-bottom:3px solid #111;padding-bottom:10px}
h2{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6960;margin:26px 0 8px}
table{width:100%;border-collapse:collapse;font-family:ui-monospace,monospace;font-size:13px}
td{padding:7px 0;border-bottom:1px solid #e2ded3;vertical-align:top}
tr td:first-child{color:#6b6960;width:42%}
.ok{color:#1a7f37;font-weight:700}.bad{color:#b00}.warn{color:#b06a00}.muted{color:#999}
thead td{font-weight:700;color:#111;text-transform:uppercase;font-size:11px;letter-spacing:1px}
a{color:#111}
.info{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-left:7px;border:1px solid #b7b2a4;border-radius:50%;color:#8a857a;font-size:10px;font-style:italic;font-family:Georgia,serif;cursor:pointer;user-select:none;vertical-align:middle}
.info:hover{border-color:#111;color:#111}
.desc{display:none}
.desc.show{display:table-row}
.desc td{font-family:Georgia,serif;font-size:13px;line-height:1.5;color:#555;background:#f3f0e8;padding:10px 12px;border-bottom:1px solid #e2ded3}
button.rm{font-family:ui-monospace,monospace;font-size:11px;color:#b00;background:none;border:1px solid #e0c4c4;padding:2px 8px;cursor:pointer;border-radius:3px}
button.rm:hover{background:#b00;color:#fff;border-color:#b00}</style></head><body>
<h1>E-Ink Dashboard · Status</h1>
<p style="font-family:ui-monospace,monospace;font-size:11px;color:#8a857a;margin-top:-4px">Tap the <span class="info">i</span> on any row for what it means.</p>
<h2>System</h2>
<table>${rows.map(([k, v, desc], i) =>
  `<tr><td>${k}${desc ? `<span class="info" data-d="d${i}">i</span>` : ''}</td><td>${v}</td></tr>`
  + (desc ? `<tr class="desc" id="d${i}"><td colspan="2">${esc(desc)}</td></tr>` : '')
).join('')}</table>
<h2>Devices <span class="info" data-d="ddev">i</span></h2>
<p class="desc" id="ddev-p" style="display:none;font-family:Georgia,serif;font-size:13px;line-height:1.5;color:#555;background:#f3f0e8;padding:10px 12px;border:1px solid #e2ded3">Each ESP32 that has checked in. <b>Board</b> = panel it reported (<code>b</code> = 3-colour, <code>bw</code> = black/white). <b>Firmware</b> = its flashed version. <b>Last seen</b> = time since its last request; <b>stale</b> means &gt;2 days — usually an old enrollment from before a reflash. Removing a row just prunes the list; a live device re-adds itself automatically on its next wake.</p>
<table><thead><tr><td>ID</td><td>Board</td><td>Firmware</td><td>Last seen</td><td></td></tr></thead>
<tbody>${devRows}</tbody></table>
${_errLog.length ? `<h2>Recent errors (${_errLog.length})</h2>
<table>${_errLog.slice(-8).reverse().map(e =>
  `<tr><td style="width:auto;white-space:nowrap;vertical-align:top">${relAge(e.at)}</td>`
  + `<td style="font-size:11px;color:#a33">${esc(e.msg)}</td></tr>`).join('')}</table>` : ''}
<h2>Links</h2>
<table>
<tr><td>Control panel</td><td><a href="/control">/control</a></td></tr>
<tr><td>Live render</td><td><a href="${liveRenderHref}">/display.png</a></td></tr>
<tr><td>Health JSON</td><td><a href="/health">/health</a></td></tr>
</table>
<p style="font-family:ui-monospace,monospace;font-size:10px;color:#999;margin-top:24px">Auto-refreshes every 60s.</p>
<script>
var qtok=new URLSearchParams(location.search).get('token');
// Remember which explanations are open so the 60s auto-refresh doesn't
// collapse them mid-read.
var OPEN_KEY='eink-status-open';
function openSet(){try{return new Set(JSON.parse(sessionStorage.getItem(OPEN_KEY)||'[]'));}catch(e){return new Set();}}
function saveOpen(s){try{sessionStorage.setItem(OPEN_KEY,JSON.stringify([...s]));}catch(e){}}
function setOpen(id,on){
  var t=document.getElementById(id); if(t)t.classList.toggle('show',on);
  var p=document.getElementById(id+'-p'); if(p)p.style.display=on?'block':'none';
}
var _open=openSet();
_open.forEach(function(id){setOpen(id,true);});
document.querySelectorAll('.info[data-d]').forEach(function(b){
  b.addEventListener('click',function(){
    var id=b.dataset.d, s=openSet(), on=!s.has(id);
    on?s.add(id):s.delete(id); saveOpen(s); setOpen(id,on);
  });
});
document.querySelectorAll('button.rm').forEach(function(b){
  b.addEventListener('click',function(){
    var id=b.dataset.id;
    if(!confirm('Remove device '+id+'? It re-adds itself if it checks in again.'))return;
    fetch('/api/device/'+encodeURIComponent(id)+(qtok?'?token='+encodeURIComponent(qtok):''),{method:'DELETE'})
      .then(function(r){if(r.ok)location.reload();else alert('Remove failed ('+r.status+')');})
      .catch(function(){alert('Remove failed');});
  });
});
</script>
</body></html>`);
  } catch (err) {
    console.error('status error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// JSON dump of every data-widget's last fetch outcome.
app.get('/api/health/widgets', (req, res) => {
  res.json({ now: Date.now(), widgets: widgetStatus.snapshot() });
});

// Human-readable status dashboard. Each fetched widget gets a row:
// last call time, success rate, latency, cache state, last error.
app.get('/health/widgets', (req, res) => {
  const snap = widgetStatus.snapshot();
  const now = Date.now();
  const fmtAgo = (ms) => {
    if (!ms) return '—';
    const s = Math.round((now - ms) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  };
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const widgetNames = Object.keys(snap).sort();
  if (!widgetNames.length) {
    widgetNames.push('(no fetched widgets yet)');
  }
  const rows = widgetNames.map(name => {
    const e = snap[name];
    if (!e) {
      return `<tr><td>${name}</td><td colspan="6" class="muted">no calls yet</td></tr>`;
    }
    const okRate = e.calls > 0 ? Math.round((e.ok / e.calls) * 100) : 0;
    const statusCell = e.lastErr && e.lastAt > (e.lastOk || 0)
      ? `<span class="bad">FAIL</span>`
      : e.lastCacheHit ? `<span class="cached">CACHED</span>` : `<span class="ok">OK</span>`;
    return `<tr>
      <td>${name}</td>
      <td>${statusCell}</td>
      <td>${e.calls}</td>
      <td>${okRate}%</td>
      <td>${fmtAgo(e.lastAt)}</td>
      <td>${e.lastLatencyMs != null ? e.lastLatencyMs + 'ms' : '—'}</td>
      <td class="err">${escapeHtml(e.lastErr || '')}</td>
    </tr>`;
  }).join('');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Widget health</title>
<link rel="stylesheet" href="/static/fonts/fonts.css">
<style>
  /* Shares the control app's editorial system: newsprint bg, serif
   * masthead on an Oxford rule, mono table marked by rules not boxes. */
  body { font-family: 'JetBrains Mono', ui-monospace, monospace; background: #faf8f3; color: #111; margin: 0; padding: 24px; }
  .masthead { max-width: 980px; border-bottom: 3px solid #111; padding-bottom: 12px; margin-bottom: 4px; position: relative; }
  .masthead::after { content: ''; position: absolute; left: 0; right: 0; bottom: -6px; height: 1px; background: #111; }
  h1 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 30px; letter-spacing: -1px; margin: 0; }
  .muted { color: #6b6960; }
  table { border-collapse: collapse; width: 100%; max-width: 980px; margin-top: 20px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid rgba(17,17,17,0.18); font-size: 12px; }
  tr:last-child td { border-bottom: 2px solid #111; }
  th { border-bottom: 2px solid #111; text-transform: uppercase; letter-spacing: 2px; font-size: 11px; font-weight: 700; }
  td.err { color: #c8302a; max-width: 360px; overflow-wrap: anywhere; }
  .ok { color: #111; font-weight: 700; }
  .bad { color: #c8302a; font-weight: 700; }
  .cached { color: #b68a3c; font-weight: 700; }
  .note { font-size: 11px; color: #6b6960; margin-top: 16px; max-width: 980px; line-height: 1.5; }
  a { color: #111; text-transform: uppercase; letter-spacing: 1.5px; font-size: 11px; }
</style>
</head><body>
<div class="masthead"><h1>Widget health</h1></div>
<div class="note">Counts reset whenever the server process restarts. Cache hits don't increment call/ok/fail.</div>
<table>
  <thead><tr><th>Widget</th><th>Status</th><th>Calls</th><th>OK%</th><th>Last call</th><th>Latency</th><th>Last error</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="note">Auto-refreshes every 15s. <a href="/api/health/widgets">JSON</a></div>
<script>setTimeout(() => location.reload(), 15000);</script>
</body></html>`);
});

// Node 15+ exits on unhandled rejections by default. Log first so we
// can see what went wrong, then let the platform restart us (Railway,
// systemd, launchd). Without this hook the trace can get clipped and
// debugging a production crash means re-running it locally.
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  if (reason && reason.stack) console.error(reason.stack);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err && err.stack || err);
  // Exit so the supervisor restarts a clean process. In-memory state
  // (weather cache, in-flight Puppeteer pages) is invalid after a
  // bug-level throw — better to start fresh than limp on.
  process.exit(1);
});

// Lockout recovery: set RESET_PIN=1 (env) and restart to clear a forgotten
// control PIN. Strips the PIN hash and rotates the session secret (so old
// sessions die), leaving the editor open so a new PIN can be set. Works on
// Railway with no shell access — set the var, redeploy, then REMOVE it and
// set a fresh PIN immediately.
async function clearPinIfRequested() {
  // Only an explicit on-value triggers it; "0"/"false"/"no"/empty/unset are
  // all OFF, so RESET_PIN=0 safely disables instead of clearing.
  if (!/^(1|true|yes|on)$/i.test(process.env.RESET_PIN || '')) return;
  try {
    const cfg = await loadConfig();
    if (cfg.auth && (cfg.auth.pinHash || cfg.auth.pinSalt)) {
      delete cfg.auth.pinHash;
      delete cfg.auth.pinSalt;
      cfg.auth.sessionSecret = crypto.randomBytes(32).toString('hex');
      await saveConfig(cfg);
      invalidateImage();
      console.warn('⚠ RESET_PIN set — control PIN CLEARED. Remove the RESET_PIN env var now and set a new PIN in the editor.');
    } else {
      console.warn('RESET_PIN set — no PIN was configured; nothing to clear.');
    }
  } catch (e) {
    console.error('RESET_PIN failed:', e.message);
  }
}

// Unknown /api path → clean JSON 404 (not the default HTML page).
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

// Final backstop error handler. Per-route try/catch handles the common cases;
// this catches anything a handler throws synchronously or passes to next(err)
// so a single bad route returns a clean 500 instead of leaking a stack /
// hanging the request. Logged into the error ring surfaced on /status.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Route error:', req.method, req.originalUrl, err && (err.stack || err.message || err));
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err && err.status) ? err.status : 500;
  res.status(status).json(safeError(err));
});

app.listen(PORT, () => {
  console.log(`E-ink dashboard listening on http://localhost:${PORT}`);
  console.log(`  Control panel:  http://localhost:${PORT}/control`);
  console.log(`  Preview PNG:    http://localhost:${PORT}/display.png`);
  console.log(`  Dashboard HTML: http://localhost:${PORT}/dashboard`);

  clearPinIfRequested();

  // Pre-render the active screen so the first device wake hits a warm cache,
  // then keep it warm on an interval. Stale-while-revalidate (above) means a
  // device request never blocks on a cold render once this has run once.
  if (PRERENDER_ENABLED) {
    console.log(`  Pre-render:     every ${Math.round(PRERENDER_INTERVAL_MS / 1000)}s`);
    warmActiveImage();
    const timer = setInterval(warmActiveImage, PRERENDER_INTERVAL_MS);
    if (timer.unref) timer.unref(); // don't keep the process alive just for this
  }
});

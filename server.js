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
const { fetchEvents } = require('./widgets/calendar');
const { fetchStocks } = require('./widgets/stocks');
const { fetchAlerts } = require('./widgets/alerts');
const widgetStatus = require('./widgets/_status');
const { resolveMessage, renderInlineMarkdown } = require('./widgets/message');
const { fetchMacNowPlaying } = require('./widgets/macnowplaying');
const { fetchMacBattery } = require('./widgets/macbattery');
const { buildClock } = require('./widgets/clock');
const { computeNextAlarm, normalizeAlarmList } = require('./widgets/alarms');

// SSR module — per-widget render functions + chrome helpers, no React.
// Dynamically imported (ESM) at first use and cached. Lets /dashboard
// produce the full page HTML server-side instead of shipping a
// duplicate widget render block to the browser.
let _ssrPromise = null;
function loadSsr() {
  if (!_ssrPromise) _ssrPromise = import('./control-src/widgets/_ssr.js');
  return _ssrPromise;
}

const PORT = process.env.PORT || 3000;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';
const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');
// Seed config lives outside the `data/` directory so a persistent
// volume mount (Railway / Fly / etc.) can take over `data/` without
// hiding the baked-in defaults that shipped with the image.
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'data-defaults', 'config.default.json');
const BATTERY_PATH = path.join(__dirname, 'data', 'battery.json');
const DEVICES_PATH = path.join(__dirname, 'data', 'devices.json');

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
  } catch {
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
    const tmp = DEVICES_PATH + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(d, null, 2));
    await fsp.rename(tmp, DEVICES_PATH);
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
function genApiKey()     { return require('crypto').randomBytes(24).toString('hex'); }
function genFriendlyId() { return require('crypto').randomBytes(3).toString('hex').toUpperCase(); }
// Seed the cache so the first auth call doesn't hit a sync read.
loadDevicesSync();

// Dashboard HTML template — read once, then cached. We refresh from disk
// on mtime change so editing public/dashboard.html in dev hot-applies.
let _htmlCache = null; // { mtimeMs, html }
const DASHBOARD_HTML_PATH = path.join(__dirname, 'public', 'dashboard.html');
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

async function renderDashboardPng({ units, screen }) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(15000);
  try {
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
    try { await page.close(); } catch (_) {}
  }
}

// Contrast boost pushes near-128 anti-aliased font edges to either
// pure black or pure white before the threshold step. Without this,
// AA pixels at ~128 produce salt-and-pepper noise on the real 1-bit
// e-ink panel. linear(a, b) is per-channel: out = a*in + b.
// a=1.6, b=-77 maps 0..255 -> roughly clamp-around-128 with a steep slope.
function preThreshold(pipe) {
  return pipe.greyscale().linear(1.6, -77).normalise();
}

// Single sharp pipeline that produces (a) the raw 1-bit pixel plane and
// (b) a palette PNG. PNG + BIN derivations share this so we don't run
// the resize/contrast/threshold pipeline twice.
async function rgbaToMono(rgbaPng) {
  const { data, info } = await preThreshold(
    sharp(rgbaPng).resize(SCREEN_W, SCREEN_H, { fit: 'fill' })
  )
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const png = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 1 }
  }).png({ palette: true, colors: 2 }).toBuffer();
  return { rawMono: data, info, png };
}

// Pack 1-bit pixels into bytes, MSB-first, the way GxEPD2 expects.
// Returns SCREEN_W * SCREEN_H / 8 bytes. Works on the shared raw plane
// from rgbaToMono so threshold doesn't run twice.
function packMonoBin(rawMono, info) {
  const bytes = Buffer.alloc((info.width * info.height) / 8);
  // Process one byte (eight pixels) at a time. Threshold output is
  // already 0 or 255, so a simple `>= 128` check is equivalent to a
  // truthiness test on the high bit.
  for (let i = 0, j = 0; i < rawMono.length; i += 8, j++) {
    let b = 0;
    if (rawMono[i]     >= 128) b |= 0x80;
    if (rawMono[i + 1] >= 128) b |= 0x40;
    if (rawMono[i + 2] >= 128) b |= 0x20;
    if (rawMono[i + 3] >= 128) b |= 0x10;
    if (rawMono[i + 4] >= 128) b |= 0x08;
    if (rawMono[i + 5] >= 128) b |= 0x04;
    if (rawMono[i + 6] >= 128) b |= 0x02;
    if (rawMono[i + 7] >= 128) b |= 0x01;
    bytes[j] = b;
  }
  return bytes;
}

// ---------- Image cache ----------

const imageCache = new Map(); // key: "units|screen" -> { at, png, bin }
const inflightImage = new Map(); // key -> Promise so concurrent hits share work
const IMAGE_CACHE_MS = 60 * 1000; // re-render at most every 60s

async function getCurrentImage({ units, screen }) {
  const key = `${units}|${screen}`;
  const now = Date.now();
  const cached = imageCache.get(key);
  if (cached && (now - cached.at) < IMAGE_CACHE_MS) {
    return cached;
  }
  const pending = inflightImage.get(key);
  if (pending) return pending;
  const promise = (async () => {
    const rgba = await renderDashboardPng({ units, screen });
    const { rawMono, info, png } = await rgbaToMono(rgba);
    const bin = packMonoBin(rawMono, info);
    const entry = { at: Date.now(), png, bin };
    imageCache.set(key, entry);
    return entry;
  })().finally(() => inflightImage.delete(key));
  inflightImage.set(key, promise);
  return promise;
}

// Force re-render on next request (called after config save)
function invalidateImage() {
  imageCache.clear();
}

function parseHHMM(s) {
  if (typeof s !== 'string') return NaN;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return NaN;
  return h * 60 + mm;
}

// Intl.DateTimeFormat construction is surprisingly costly (~ms per call).
// Cache one formatter per tz string so the per-request hot path is just a
// `formatToParts(new Date())`.
const _hmFormatters = new Map();
function hmFormatter(tz) {
  let f = _hmFormatters.get(tz);
  if (f) return f;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit'
    });
  } catch {
    f = null;
  }
  _hmFormatters.set(tz, f);
  return f;
}

function localMinutesNow(tz) {
  const f = hmFormatter(tz);
  if (!f) {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
  const parts = f.formatToParts(new Date());
  let h = 0, m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
    if (p.type === 'minute') m = parseInt(p.value, 10);
  }
  return h * 60 + m;
}

// ---------- Per-screen schedule resolution ----------

// Each enabled schedule becomes one or two [a,b) minute intervals.
function scheduleIntervals(sch) {
  if (!sch || !sch.enabled) return [];
  const a = parseHHMM(sch.from);
  const b = parseHHMM(sch.to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return [];
  if (a < b) return [[a, b]];
  return [[a, 1440], [0, b]];
}

let _screenIdSeed = 0;
function newScreenId() {
  _screenIdSeed += 1;
  return `scr-${Date.now().toString(36)}-${_screenIdSeed}`;
}

// Migrate legacy cfg.layouts/cfg.schedule into the new cfg.screens
// array. Idempotent — returns cfg unchanged when screens already
// exist.
const DEFAULT_CHROME = {
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
  { widgetId: 'message',          x: 14, y: 0, w: 10, h: 4 },
  { widgetId: 'calendar',         x: 14, y: 4, w: 10, h: 8 }
];
function seedLayoutFromEditorial() {
  return EDITORIAL_LAYOUT.map((it, i) => ({
    id: `seed-${it.widgetId}-${i}`,
    widgetId: it.widgetId,
    x: it.x, y: it.y, w: it.w, h: it.h,
    flush: false
  }));
}

function migrateConfigToScreens(cfg) {
  if (Array.isArray(cfg.screens) && cfg.screens.length) {
    let screens = cfg.screens;
    const v = cfg.gridVersion || 1;
    if (v < 2) screens = screens.map(s => ({ ...s, layout: migrateLayoutV1ToV2(s.layout) }));
    if (v < 3) screens = screens.map(s => ({ ...s, layout: migrateLayoutV2ToV3(s.layout) }));
    // v4: every screen gains a `layoutKind` field. Default `free` so
    // existing freeform grids keep working — opt-in to a primitive
    // (full / half_horizontal / half_vertical / quadrant) is a deliberate
    // edit, not a migration side-effect.
    if (v < 4) screens = screens.map(s =>
      s.layoutKind ? s : { ...s, layoutKind: 'free' });
    screens = screens.map(s => s.chrome
      ? s
      : { ...s, chrome: JSON.parse(JSON.stringify(DEFAULT_CHROME)) });
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
  const migrateOld = (l) => migrateLayoutV2ToV3(migrateLayoutV1ToV2((l || []).map(it => ({ ...it }))));
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
    chrome: JSON.parse(JSON.stringify(DEFAULT_CHROME)),
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
      chrome: JSON.parse(JSON.stringify(DEFAULT_CHROME)),
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
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited' }
});
app.use('/api/', apiLimiter);

// React control panel build output (built by Vite via `npm run build`).
const CONTROL_APP_DIR = path.join(__dirname, 'public', 'control-app');
const CONTROL_APP_INDEX = path.join(CONTROL_APP_DIR, 'index.html');
app.use('/control-app', express.static(CONTROL_APP_DIR));

// Gather all widget data needed by the dashboard. Each fetch only runs
// if at least one instance of that widget is on the active layout (or
// if the widget is non-fetched / always-on).
async function buildWidgetData(cfg, units, layout) {
  const ids = new Set((layout || []).map(it => it.widgetId || it.id));
  const wantWeather = ids.has('weather_hero') || ids.has('weather_forecast');
  const loc = (Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon))
    ? { lat: cfg.lat, lon: cfg.lon }
    : cfg.city;

  // Merge legacy single icalUrl into icalUrls array so the calendar
  // fetcher always sees one shape.
  const icalUrls = (cfg.calendar && Array.isArray(cfg.calendar.icalUrls) && cfg.calendar.icalUrls.length)
    ? cfg.calendar.icalUrls.filter(Boolean)
    : (cfg.calendar && cfg.calendar.icalUrl ? [cfg.calendar.icalUrl] : []);

  const [
    weather, events, stocks, alerts
  ] = await Promise.all([
    wantWeather ? fetchWeather(loc, process.env.OPENWEATHER_API_KEY, units) : null,
    (ids.has('calendar') && icalUrls.length)
      ? Promise.all(icalUrls.map(u => fetchEvents(u))).then(lists => mergeEvents(lists.flat()))
      : [],
    (ids.has('stocks') && cfg.stocks && Array.isArray(cfg.stocks.symbols) && cfg.stocks.symbols.length)
      ? fetchStocks(cfg.stocks.symbols) : [],
    (wantWeather && cfg.alerts !== false && Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon))
      ? fetchAlerts({ lat: cfg.lat, lon: cfg.lon }) : []
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

  const resolvedMessage = ids.has('message') ? resolveMessage(cfg, tokenCtx) : null;

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
        case 'stocks':
          // New contract: always set slot.stocks so an empty-symbols
          // tile shows the renderer's "NO DATA" path instead of falling
          // back to global cfg.stocks.
          slot.stocks = (Array.isArray(eff.symbols) && eff.symbols.length)
            ? await fetchStocks(eff.symbols)
            : [];
          break;
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
        case 'message':
          // New contract: pass only the per-item message + cfg.timezone
          // (needed for schedule-window resolution). No other global cfg
          // bleeds through.
          slot.resolvedMessage = resolveMessage(
            { timezone: cfg.timezone, message: eff },
            tokenCtx
          );
          break;

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

        default:
          break;
      }
    } catch (err) {
      console.warn(`per-item fetch failed (${wid}/${item.id}):`, err.message);
    }
    if (Object.keys(slot).length) perItem[item.id] = slot;
  }));

  return {
    weather, events, stocks,
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

// Build the inner page HTML — header + body grid + footer. Per-tile
// rendering pulls the per-item slot data via `perItem[item.id]` so each
// tile gets its own context (overrides global where set).
function buildPageBodyHtml({ payload, ssr, mode }) {
  const { cfg, weather, events, units, stocks, resolvedMessage,
          perItem, chrome, battery, layout: rawLayout, devWidgetId } = payload;

  const defs = ssr.DEFS;
  const layout = expandLayout(rawLayout, defs);
  const ctxBase = {
    cfg, weather, events, units,
    stocks, resolvedMessage, chrome, battery
  };
  const data = { ...ctxBase, chrome };

  // Matrix mode: every widget at every preset, stacked top-to-bottom.
  if (mode === 'matrix') {
    const PX_W = 800 / GRID_COLS, PX_H = 480 / GRID_ROWS;
    let html = '<div class="page" id="page" style="width:100%;height:auto;display:flex;flex-direction:column;gap:32px;padding:32px;background:#fff">';
    for (const id of Object.keys(defs)) {
      const def = defs[id];
      const sizes = def.sizes || {};
      for (const key of Object.keys(sizes)) {
        const { w: cw, h: ch } = sizes[key];
        const cellWidth = cw * PX_W;
        const cellHeight = ch * PX_H;
        const itemCtx = { ...ctxBase, cellW: cw, cellH: ch, settings: typeof def.defaults === 'function' ? def.defaults() : undefined };
        const inner = ssr.renderWidget(id, itemCtx);
        html += `
          <div style="border:2px solid #000;background:#fff">
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#000;color:#fff;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:2px;">
              <span>${escapeHtmlServer(id)} · ${escapeHtmlServer(key)}</span>
              <span>${cw}×${ch} · ${Math.round(cellWidth)}×${Math.round(cellHeight)}px</span>
            </div>
            <div class="cell cell-${escapeHtmlServer(id)}" style="width:${cellWidth}px;height:${cellHeight}px;margin:0">${inner}</div>
          </div>`;
      }
    }
    html += '</div>';
    return html;
  }

  // Dev single-widget mode: full-screen single widget, no chrome.
  if ((mode === 'dev' || mode === 'preview') && devWidgetId) {
    const item = layout[0];
    if (!item) return '<div class="page" id="page"></div>';
    const itemCtx = {
      ...ctxBase,
      ...(perItem && perItem[item.id] || {}),
      cellW: item.w, cellH: item.h, density: item.density, settings: item.settings
    };
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

  // Normal dashboard mode.
  const headerOn = ssr.isHeaderOn(data);
  const footerOn = ssr.isFooterOn(data);
  const headerRow = headerOn ? '60px' : '0px';
  const footerRow = footerOn ? '28px' : '0px';
  const headerHtml = headerOn
    ? `<header class="hdr hdr-${ssr.headerVariant(data)}">${ssr.renderHeader(data)}</header>`
    : `<div class="hdr-stub"></div>`;
  const footerHtml = footerOn
    ? `<footer class="ftr ftr-${ssr.footerVariant(data)}">${ssr.renderFooter(data)}</footer>`
    : `<div class="ftr-stub"></div>`;

  const nowM = localMinutesNow((cfg && cfg.timezone) || 'UTC');
  const cells = [];
  for (const item of layout) {
    if (!withinVisibility(item.visibility, nowM)) continue;
    const itemCtx = {
      ...ctxBase,
      ...(perItem && perItem[item.id] || {}),
      cellW: item.w, cellH: item.h, density: item.density, settings: item.settings
    };
    const innerRaw = ssr.renderWidget(item.widgetId, itemCtx);
    if (!innerRaw) continue;
    const sw = ssr.scaleWrap(item.settings);
    const inner = `${sw.open}${innerRaw}${sw.close}`;
    const classes = ['cell', `cell-${item.widgetId}`];
    if (item.x + item.w >= GRID_COLS) classes.push('cell-edge-right');
    if (item.y + item.h >= GRID_ROWS) classes.push('cell-edge-bottom');
    if (item.flush) classes.push('cell-flush');
    classes.push(...ssr.cellClasses(item.settings));
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

  return `<div class="page" id="page" style="grid-template-rows:${headerRow} minmax(0, 1fr) ${footerRow}">${headerHtml}<main class="body body-grid" style="grid-template-columns:repeat(${GRID_COLS}, minmax(0, 1fr));grid-template-rows:repeat(${GRID_ROWS}, minmax(0, 1fr))">${bodyInner}</main>${footerHtml}</div>`;
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
    const chrome = (activeScreen && activeScreen.chrome) || DEFAULT_CHROME;
    const battery = await loadBatteryState();
    const payload = {
      cfg, units, screen, layout, chrome, battery,
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
app.post('/api/config/reset', checkDeviceAuth, async (req, res) => {
  try {
    const raw = await fsp.readFile(DEFAULT_CONFIG_PATH, 'utf8');
    await atomicWriteFile(CONFIG_PATH, raw);
    _configCache = null;
    invalidateImage();
    const cfg = migrateConfigToScreens(JSON.parse(raw));
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

app.get('/dev/widget/:id', checkDeviceAuth, async (req, res) => {
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
      chrome: { header: { enabled: false }, footer: { enabled: false } },
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
    chrome: { header: { enabled: false }, footer: { enabled: false } },
    ...data,
    devWidgetId: widgetId,
    generatedAt: new Date().toISOString()
  };
}

app.get('/preview/widget', checkDeviceAuth, async (req, res) => {
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

// Cap concurrent Puppeteer screenshots so a sliding-input spam can't
// stack 50 simultaneous renders.
let _previewInflight = 0;
const PREVIEW_MAX_INFLIGHT = 2;

async function renderPreviewPng({ widgetId, w, h, settings, units, density }) {
  if (_previewInflight >= PREVIEW_MAX_INFLIGHT) {
    throw new Error('preview busy');
  }
  _previewInflight++;
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
    _previewInflight--;
  }
}

app.post('/api/preview-render', checkDeviceAuth, async (req, res) => {
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
app.get('/widgets-matrix', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const units = cfg.units || 'F';
    // Force-fetch every data widget so the matrix has real content.
    const fakeLayout = [
      { widgetId: 'weather_hero' }, { widgetId: 'weather_forecast' },
      { widgetId: 'calendar' }, { widgetId: 'message' },
      { widgetId: 'stocks' }
    ];
    const data = await buildWidgetData(cfg, units, fakeLayout);
    const [shell, ssr] = await Promise.all([loadDashboardHtml(), loadSsr()]);
    const payload = {
      cfg, units, screen: 1, layout: [],
      chrome: { header: { enabled: false }, footer: { enabled: false } },
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

// Raw 1-bit packed binary for ESP32 (smaller, no decode needed)
// 800 * 480 / 8 = 48000 bytes
app.get('/display.bin', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    const { bin } = await getCurrentImage(variant);

    // Adaptive-refresh header — tells the device how many minutes to
    // sleep before the next wake. Replaces the older /sleep round-trip;
    // /sleep stays alive for legacy firmware.
    const minutes = resolveRefreshMinutes(cfg);
    res.set('X-Refresh-Rate', String(minutes));

    // Battery telemetry over headers (firmware sends Battery-Voltage +
    // Battery-Pct on every /display.bin request). POST /api/battery
    // remains supported for backward compatibility.
    const hBattV = parseFloat(req.headers['battery-voltage']);
    const hBattPct = parseInt(req.headers['battery-pct'], 10);
    if (Number.isFinite(hBattV) && hBattV >= 0 && hBattV <= 6 &&
        Number.isFinite(hBattPct) && hBattPct >= 0 && hBattPct <= 100) {
      saveBatteryState({ v: hBattV, pct: hBattPct, at: Date.now() })
        .catch(e => console.warn('battery-header save:', e.message));
    }

    res.set('Content-Type', 'application/octet-stream');
    res.set('Cache-Control', 'no-store');
    res.set('X-Image-Width', String(SCREEN_W));
    res.set('X-Image-Height', String(SCREEN_H));
    res.send(bin);
  } catch (err) {
    console.error('BIN error:', err);
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
    sendBinSlice(req, res, bin.slice(0, HEADER_BYTES));
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
    sendBinSlice(req, res, bin.slice(HEADER_BYTES, HEADER_BYTES + BODY_BYTES));
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
  const minutes = s && Number.isFinite(s.refreshMinutes) && s.refreshMinutes > 0
    ? s.refreshMinutes
    : (parseInt(cfg.refreshMinutes, 10) || 30);
  res.json({ minutes, screenId: s ? s.id : null, screenName: s ? s.name : null });
});

// Control panel
app.get('/', (req, res) => res.redirect('/control'));
app.get('/control', (req, res) => {
  // Prefer the React app; fall back to the legacy vanilla page when the
  // build artifact hasn't been produced yet (e.g. local dev before
  // `npm run build`).
  if (fs.existsSync(CONTROL_APP_INDEX)) {
    res.sendFile(CONTROL_APP_INDEX);
  } else {
    res.sendFile(path.join(__dirname, 'public', 'control.html'));
  }
});
app.get('/control-classic', (req, res) => {
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

app.get('/api/geocode', checkDeviceAuth, async (req, res) => {
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

app.get('/api/reverse-geocode', checkDeviceAuth, async (req, res) => {
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

app.get('/api/weather-check', checkDeviceAuth, async (req, res) => {
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
app.get('/api/preview-data', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const { units, screen, activeScreen } = resolveVariant(req, cfg);
    const layout = resolveScreenLayout(activeScreen);
    const data = await buildWidgetData(cfg, units, layout);
    const chrome = (activeScreen && activeScreen.chrome) || DEFAULT_CHROME;
    const battery = await loadBatteryState();
    res.json({
      cfg, units, screen, layout, chrome, battery,
      ...data,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json(safeError(err));
  }
});

// Config API
app.get('/api/config', checkDeviceAuth, async (req, res) => {
  res.json(await loadConfig());
});

app.post('/api/config', checkDeviceAuth, async (req, res) => {
  try {
    const current = await loadConfig();
    // Top-level fields the client may send. `screens` is treated as
    // canonical — whatever the editor sends wins. Other nested
    // settings are shallow-merged so the editor can patch a single
    // section (e.g. just `message`) without clobbering siblings.
    const merged = { ...current, ...req.body,
      widgets:  { ...(current.widgets  || {}), ...(req.body.widgets  || {}) },
      message:  { ...(current.message  || {}), ...(req.body.message  || {}) },
      calendar: { ...(current.calendar || {}), ...(req.body.calendar || {}) },
      stocks:   { ...(current.stocks   || {}), ...(req.body.stocks   || {}) },
      weather:  { ...(current.weather  || {}), ...(req.body.weather  || {}) },
    };
    if (Array.isArray(req.body.screens)) {
      merged.screens = req.body.screens;
      // Drop the legacy single-layout array when the new schema is
      // explicit; keeps config.json tidy.
      if (!('layout' in req.body))  delete merged.layout;
      if (!('layouts' in req.body)) delete merged.layouts;
    }
    await saveConfig(merged);
    invalidateImage();
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
app.post('/api/mac-state', checkDeviceAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const np = body.nowplaying || null;
    const bt = body.battery || null;
    const trackKey = typeof body.trackKey === 'string' ? body.trackKey : null;

    const result = await (_macStateChain = _macStateChain.then(async () => {
      let mergedNp = np;
      if (np && !('artworkBase64' in np) && trackKey && trackKey === _lastTrackKey) {
        const prev = await macStateMod.read();
        const prevArt = prev && prev.nowplaying && prev.nowplaying.artworkBase64;
        mergedNp = { ...np, artworkBase64: prevArt || null };
      }
      if (trackKey) _lastTrackKey = trackKey;
      const prev = await macStateMod.read();
      await macStateMod.write({ nowplaying: mergedNp, battery: bt });
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

app.get('/api/mac-state', checkDeviceAuth, async (req, res) => {
  const s = await macStateMod.read();
  res.json(s || { nowplaying: null, battery: null, at: null });
});

// ---------- Alarms ----------
//
// Stored at cfg.alarms — see widgets/alarms.js for the shape. Time
// math runs in the server's local timezone; set the TZ env var on
// Railway to match your real timezone or alarms will misfire by the
// offset.

app.get('/api/alarms', checkDeviceAuth, async (req, res) => {
  const cfg = await loadConfig();
  res.json({ alarms: Array.isArray(cfg.alarms) ? cfg.alarms : [] });
});

app.post('/api/alarms', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    cfg.alarms = normalizeAlarmList(req.body && req.body.alarms);
    await saveConfig(cfg);
    invalidateImage();
    res.json({ ok: true, alarms: cfg.alarms });
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
const FW_DIR = path.join(__dirname, 'public', 'firmware');
const FW_NAME_RE = /^([a-z0-9]+)-(\d+)\.(\d+)\.(\d+)\.bin$/;

function parseSemver(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(s || ''));
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}
function cmpSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

async function findNewestFirmware(board) {
  let entries;
  try {
    entries = await fsp.readdir(FW_DIR);
  } catch (_) {
    return null;
  }
  let best = null;
  for (const name of entries) {
    const m = FW_NAME_RE.exec(name);
    if (!m) continue;
    if (m[1] !== board) continue;
    const ver = [parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10)];
    if (!best || cmpSemver(ver, best.ver) > 0) {
      best = { name, ver, version: `${ver[0]}.${ver[1]}.${ver[2]}` };
    }
  }
  return best;
}

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
app.get('/api/devices', checkDeviceAuth, (req, res) => {
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

// Health
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

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
<title>Widget health</title>
<style>
  body { font-family: ui-monospace, 'JetBrains Mono', monospace; background: #faf8f3; color: #000; margin: 0; padding: 24px; }
  h1 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; letter-spacing: -1px; }
  .muted { color: #999; }
  table { border-collapse: collapse; width: 100%; max-width: 980px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1.5px solid #000; font-size: 12px; }
  th { background: #000; color: #fff; text-transform: uppercase; letter-spacing: 2px; font-size: 11px; }
  td.err { color: #c8302a; max-width: 360px; overflow-wrap: anywhere; }
  .ok { color: #000; font-weight: 700; }
  .bad { color: #c8302a; font-weight: 700; }
  .cached { color: #666; font-weight: 700; }
  .note { font-size: 11px; color: #555; margin-top: 16px; max-width: 980px; line-height: 1.5; }
</style>
</head><body>
<h1>Widget health</h1>
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

app.listen(PORT, () => {
  console.log(`E-ink dashboard listening on http://localhost:${PORT}`);
  console.log(`  Control panel:  http://localhost:${PORT}/control`);
  console.log(`  Preview PNG:    http://localhost:${PORT}/display.png`);
  console.log(`  Dashboard HTML: http://localhost:${PORT}/dashboard`);
});

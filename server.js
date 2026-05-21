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
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const { fetchWeather, geocodeCity } = require('./widgets/weather');
const { fetchEvents } = require('./widgets/calendar');
const { buildClockNow } = require('./widgets/clock');
const { buildCountdowns } = require('./widgets/countdown');
const { buildMoonSun } = require('./widgets/moonsun');
const { buildWifiQrSvg } = require('./widgets/wifi');
const { fetchAqi } = require('./widgets/aqi');
const { fetchNews } = require('./widgets/news');
const { fetchStocks } = require('./widgets/stocks');
const { fetchGithub } = require('./widgets/github');
const { fetchAlerts } = require('./widgets/alerts');
const { prepTodos } = require('./widgets/todos');
const widgetStatus = require('./widgets/_status');
const { resolveQuote } = require('./widgets/quote');
const { resolveMessage, renderInlineMarkdown } = require('./widgets/message');
const { resolvePhoto } = require('./widgets/photo');
const { buildCounters } = require('./widgets/counter');
const { buildLinkQrSvg } = require('./widgets/linkqr');
const { fetchFx } = require('./widgets/fx');
const { fetchIss } = require('./widgets/iss');
const { buildHabits } = require('./widgets/habit');
const { fetchWordOfDay } = require('./widgets/wod');
const { fetchSports } = require('./widgets/sports');
const { buildChores } = require('./widgets/chore');

const PORT = process.env.PORT || 3000;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';
const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'data', 'config.default.json');

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
    await fsp.writeFile(CONFIG_PATH, raw);
    const cfg = migrateConfigToScreens(JSON.parse(raw));
    const st = await fsp.stat(CONFIG_PATH).catch(() => null);
    _configCache = { mtimeMs: st ? st.mtimeMs : 0, cfg };
    return cfg;
  }
}

async function saveConfig(cfg) {
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  _configCache = null;
}

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

const GRID_VERSION = 3;
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
  { widgetId: 'todos',            x: 14, y: 4, w: 10, h: 8 }
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
  const wantWeather = ids.has('weather_hero') || ids.has('weather_forecast') || ids.has('moonsun');
  const loc = (Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon))
    ? { lat: cfg.lat, lon: cfg.lon }
    : cfg.city;

  // Merge legacy single icalUrl into icalUrls array so the calendar
  // fetcher always sees one shape.
  const icalUrls = (cfg.calendar && Array.isArray(cfg.calendar.icalUrls) && cfg.calendar.icalUrls.length)
    ? cfg.calendar.icalUrls.filter(Boolean)
    : (cfg.calendar && cfg.calendar.icalUrl ? [cfg.calendar.icalUrl] : []);

  const [
    weather, events, aqi, news, stocks, github, wifiQrSvg, alerts,
    fx, iss, wod, sports, linkQrSvg
  ] = await Promise.all([
    wantWeather ? fetchWeather(loc, process.env.OPENWEATHER_API_KEY, units) : null,
    (ids.has('calendar') && icalUrls.length)
      ? Promise.all(icalUrls.map(u => fetchEvents(u))).then(lists => mergeEvents(lists.flat()))
      : [],
    (ids.has('aqi') && Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon))
      ? fetchAqi({ lat: cfg.lat, lon: cfg.lon }) : null,
    (ids.has('news') && cfg.news && cfg.news.feedUrl)
      ? fetchNews(cfg.news.feedUrl, cfg.news.maxItems || 5) : [],
    (ids.has('stocks') && cfg.stocks && Array.isArray(cfg.stocks.symbols) && cfg.stocks.symbols.length)
      ? fetchStocks(cfg.stocks.symbols) : [],
    (ids.has('github') && cfg.github && cfg.github.user)
      ? fetchGithub(cfg.github.user) : null,
    ids.has('wifi_qr') ? buildWifiQrSvg(cfg.wifi || {}) : null,
    (wantWeather && cfg.alerts !== false && Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon))
      ? fetchAlerts({ lat: cfg.lat, lon: cfg.lon }) : [],
    (ids.has('fx') && cfg.fx && Array.isArray(cfg.fx.pairs) && cfg.fx.pairs.length)
      ? fetchFx(cfg.fx.pairs) : [],
    ids.has('iss') ? fetchIss() : null,
    ids.has('wod') ? fetchWordOfDay(cfg.wod && cfg.wod.feedUrl) : null,
    (ids.has('sports') && cfg.sports && cfg.sports.teamId)
      ? fetchSports(cfg.sports.teamId) : null,
    ids.has('link_qr') ? buildLinkQrSvg(cfg.linkQr || {}) : null
  ]);

  const clockNow    = ids.has('clock')     ? buildClockNow(cfg.timezone || 'UTC') : null;
  const countdowns  = ids.has('countdown') ? buildCountdowns(cfg.countdowns || [], cfg.timezone || 'UTC') : [];
  const counters    = ids.has('counter')   ? buildCounters(cfg.counters || [], cfg.timezone || 'UTC') : [];
  const habits      = ids.has('habit')     ? buildHabits(cfg.habits || [], cfg.timezone || 'UTC') : [];
  const chores      = ids.has('chore')     ? buildChores(cfg.chores || [], cfg.timezone || 'UTC') : [];
  const moonsun     = ids.has('moonsun')   ? buildMoonSun(weather) : null;
  const todos       = ids.has('todos') ? prepTodos(cfg.todos || [], cfg.timezone || 'UTC') : [];
  const resolvedQuote   = ids.has('quote')   ? await resolveQuote(cfg) : null;
  const resolvedMessage = ids.has('message') ? resolveMessage(cfg) : null;
  const resolvedPhoto   = ids.has('photo')   ? resolvePhoto(cfg) : null;

  // Attach alerts onto weather so the renderer can show a banner without
  // a separate top-level lookup.
  if (weather && alerts && alerts.length) weather.alerts = alerts;

  return {
    weather, events, aqi, news, stocks, github,
    wifiQrSvg, clockNow, countdowns, moonsun, todos,
    resolvedQuote, resolvedMessage, resolvedPhoto,
    counters, linkQrSvg, fx, iss, habits, wod, sports, chores
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

// Dashboard HTML — built from the active screen's layout + live data
app.get('/dashboard', async (req, res) => {
  try {
    const cfg = await loadConfig();
    const { units, screen, activeScreen } = resolveVariant(req, cfg);
    const layout = activeScreen ? activeScreen.layout : [];
    const data = await buildWidgetData(cfg, units, layout);

    const html = await loadDashboardHtml();
    const chrome = (activeScreen && activeScreen.chrome) || DEFAULT_CHROME;
    const payload = {
      cfg, units, screen, layout, chrome,
      ...data,
      generatedAt: new Date().toISOString()
    };
    const injected = html.replace(
      '/*__DATA__*/',
      `window.__DASHBOARD__ = ${JSON.stringify(payload)};`
    );
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(injected);
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
    await fsp.writeFile(CONFIG_PATH, raw);
    invalidateImage();
    const cfg = migrateConfigToScreens(JSON.parse(raw));
    res.json(cfg);
  } catch (err) {
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
      { widgetId: 'calendar' }, { widgetId: 'todos' }, { widgetId: 'message' },
      { widgetId: 'quote' }, { widgetId: 'clock' }, { widgetId: 'wifi_qr' },
      { widgetId: 'countdown' }, { widgetId: 'aqi' }, { widgetId: 'moonsun' },
      { widgetId: 'news' }, { widgetId: 'stocks' }, { widgetId: 'photo' },
      { widgetId: 'github' }, { widgetId: 'spacer' },
      { widgetId: 'counter' }, { widgetId: 'link_qr' }, { widgetId: 'fx' },
      { widgetId: 'iss' }, { widgetId: 'habit' }, { widgetId: 'wod' },
      { widgetId: 'sports' }, { widgetId: 'chore' }
    ];
    const data = await buildWidgetData(cfg, units, fakeLayout);
    const html = await loadDashboardHtml();
    const payload = {
      cfg, units, screen: 1, layout: [],
      chrome: { header: { enabled: false }, footer: { enabled: false } },
      ...data,
      mode: 'matrix',
      generatedAt: new Date().toISOString()
    };
    const injected = html.replace(
      '/*__DATA__*/',
      `window.__DASHBOARD__ = ${JSON.stringify(payload)};`
    );
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(injected);
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

async function jsonFetch(url, opts = {}) {
  const r = await fetch(url, opts);
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
    const layout = activeScreen ? activeScreen.layout : [];
    const data = await buildWidgetData(cfg, units, layout);
    const chrome = (activeScreen && activeScreen.chrome) || DEFAULT_CHROME;
    res.json({
      cfg, units, screen, layout, chrome,
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
      spacer:   { ...(current.spacer   || {}), ...(req.body.spacer   || {}) },
      quote:    { ...(current.quote    || {}), ...(req.body.quote    || {}) },
      clock:    { ...(current.clock    || {}), ...(req.body.clock    || {}) },
      wifi:     { ...(current.wifi     || {}), ...(req.body.wifi     || {}) },
      news:     { ...(current.news     || {}), ...(req.body.news     || {}) },
      stocks:   { ...(current.stocks   || {}), ...(req.body.stocks   || {}) },
      github:   { ...(current.github   || {}), ...(req.body.github   || {}) },
      photo:    { ...(current.photo    || {}), ...(req.body.photo    || {}) },
      aqi:      { ...(current.aqi      || {}), ...(req.body.aqi      || {}) },
      weather:  { ...(current.weather  || {}), ...(req.body.weather  || {}) },
      linkQr:   { ...(current.linkQr   || {}), ...(req.body.linkQr   || {}) },
      fx:       { ...(current.fx       || {}), ...(req.body.fx       || {}) },
      iss:      { ...(current.iss      || {}), ...(req.body.iss      || {}) },
      wod:      { ...(current.wod      || {}), ...(req.body.wod      || {}) },
      sports:   { ...(current.sports   || {}), ...(req.body.sports   || {}) },
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

// Todos quick endpoints
app.post('/api/todos', checkDeviceAuth, async (req, res) => {
  const cfg = await loadConfig();
  cfg.todos = req.body.todos || [];
  await saveConfig(cfg);
  invalidateImage();
  res.json({ ok: true });
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
  const widgetNames = ['weather','calendar','aqi','alerts','news','stocks','github','quote'];
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

app.listen(PORT, () => {
  console.log(`E-ink dashboard listening on http://localhost:${PORT}`);
  console.log(`  Control panel:  http://localhost:${PORT}/control`);
  console.log(`  Preview PNG:    http://localhost:${PORT}/display.png`);
  console.log(`  Dashboard HTML: http://localhost:${PORT}/dashboard`);
});

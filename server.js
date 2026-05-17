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

const { fetchWeather } = require('./widgets/weather');
const { fetchEvents } = require('./widgets/calendar');

const PORT = process.env.PORT || 3000;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';
const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'data', 'config.default.json');

const SCREEN_W = 800;
const SCREEN_H = 480;

// ---------- Config persistence ----------

async function loadConfig() {
  let raw;
  try {
    raw = await fsp.readFile(CONFIG_PATH, 'utf8');
  } catch {
    raw = await fsp.readFile(DEFAULT_CONFIG_PATH, 'utf8');
    await fsp.writeFile(CONFIG_PATH, raw);
  }
  let cfg = JSON.parse(raw);
  // Lazy-migrate to the screens schema. We don't immediately rewrite
  // the file here — saveConfig() will persist the new shape next time
  // the user saves through the control panel.
  cfg = migrateConfigToScreens(cfg);
  return cfg;
}

async function saveConfig(cfg) {
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
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

// Convert RGBA PNG to 1-bit black/white PNG
async function toMonoPng(rgbaPng) {
  const { data, info } = await sharp(rgbaPng)
    .resize(SCREEN_W, SCREEN_H, { fit: 'fill' })
    .greyscale()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 1 }
  }).png({ palette: true, colors: 2 }).toBuffer();
}

// Pack 1-bit pixels into bytes, MSB-first, the way GxEPD2 expects.
// Returns SCREEN_W * SCREEN_H / 8 bytes.
async function toMonoBin(rgbaPng) {
  const { data, info } = await sharp(rgbaPng)
    .resize(SCREEN_W, SCREEN_H, { fit: 'fill' })
    .greyscale()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bytes = Buffer.alloc((info.width * info.height) / 8);
  for (let i = 0; i < data.length; i++) {
    // threshold output: 0 = black, 255 = white
    // e-paper convention: 0 bit = black, 1 bit = white
    const bit = data[i] >= 128 ? 1 : 0;
    const byteIdx = i >> 3;
    const bitPos = 7 - (i & 7);
    if (bit) bytes[byteIdx] |= (1 << bitPos);
  }
  return bytes;
}

// ---------- Image cache ----------

const imageCache = new Map(); // key: "units|screen" -> { at, png, bin }
const IMAGE_CACHE_MS = 60 * 1000; // re-render at most every 60s

async function getCurrentImage({ units, screen }) {
  const key = `${units}|${screen}`;
  const now = Date.now();
  const cached = imageCache.get(key);
  if (cached && (now - cached.at) < IMAGE_CACHE_MS) {
    return cached;
  }
  const rgba = await renderDashboardPng({ units, screen });
  const png = await toMonoPng(rgba);
  const bin = await toMonoBin(rgba);
  const entry = { at: now, png, bin };
  imageCache.set(key, entry);
  return entry;
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

function localMinutesNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    let h = 0, m = 0;
    for (const p of parts) {
      if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
      if (p.type === 'minute') m = parseInt(p.value, 10);
    }
    return h * 60 + m;
  } catch {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
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
function migrateConfigToScreens(cfg) {
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

// ---------- App ----------

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/static', express.static(path.join(__dirname, 'public')));

// React control panel build output (built by Vite via `npm run build`).
const CONTROL_APP_DIR = path.join(__dirname, 'public', 'control-app');
const CONTROL_APP_INDEX = path.join(CONTROL_APP_DIR, 'index.html');
app.use('/control-app', express.static(CONTROL_APP_DIR));

// Dashboard HTML — built from the active screen's layout + live data
app.get('/dashboard', async (req, res) => {
  try {
    const cfg = await loadConfig();
    const { units, screen, activeScreen } = resolveVariant(req, cfg);
    const wantWeather = !cfg.widgets || cfg.widgets.weather !== false;
    const weather = wantWeather
      ? await fetchWeather(cfg.city, process.env.OPENWEATHER_API_KEY, units)
      : null;
    const events = cfg.calendar && cfg.calendar.icalUrl
      ? await fetchEvents(cfg.calendar.icalUrl)
      : [];

    const html = await fsp.readFile(path.join(__dirname, 'public', 'dashboard.html'), 'utf8');
    // The dashboard renderer reads `layout` directly from the payload.
    const layout = activeScreen ? activeScreen.layout : [];
    const payload = { cfg, weather, events, units, screen, layout, generatedAt: new Date().toISOString() };
    const injected = html.replace(
      '/*__DATA__*/',
      `window.__DASHBOARD__ = ${JSON.stringify(payload)};`
    );
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(injected);
  } catch (err) {
    console.error('Dashboard render error:', err);
    res.status(500).send(err.message);
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
    res.status(500).send(err.message);
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
    res.status(500).send(err.message);
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

// Returns the full payload the dashboard would render — minus the
// HTML. The React editor uses this to render live widget tiles locally.
app.get('/api/preview-data', async (req, res) => {
  try {
    const cfg = await loadConfig();
    const { units, screen, activeScreen } = resolveVariant(req, cfg);
    const weather = await fetchWeather(cfg.city, process.env.OPENWEATHER_API_KEY, units);
    const events = cfg.calendar && cfg.calendar.icalUrl
      ? await fetchEvents(cfg.calendar.icalUrl)
      : [];
    res.json({
      cfg,
      weather,
      events,
      units,
      screen,
      layout: activeScreen ? activeScreen.layout : [],
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Config API
app.get('/api/config', async (req, res) => {
  res.json(await loadConfig());
});

app.post('/api/config', async (req, res) => {
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Todos quick endpoints
app.post('/api/todos', async (req, res) => {
  const cfg = await loadConfig();
  cfg.todos = req.body.todos || [];
  await saveConfig(cfg);
  invalidateImage();
  res.json({ ok: true });
});

// Health
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, () => {
  console.log(`E-ink dashboard listening on http://localhost:${PORT}`);
  console.log(`  Control panel:  http://localhost:${PORT}/control`);
  console.log(`  Preview PNG:    http://localhost:${PORT}/display.png`);
  console.log(`  Dashboard HTML: http://localhost:${PORT}/dashboard`);
});

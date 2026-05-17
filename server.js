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
  try {
    const txt = await fsp.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(txt);
  } catch {
    const def = await fsp.readFile(DEFAULT_CONFIG_PATH, 'utf8');
    await fsp.writeFile(CONFIG_PATH, def);
    return JSON.parse(def);
  }
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

// Returns 'active' | 'quiet' | null. null = schedule disabled.
function pickScheduleMode(cfg, now = Date.now()) {
  const s = cfg.schedule;
  if (!s || !s.enabled) return null;
  const from = parseHHMM(s.activeFrom);
  const to = parseHHMM(s.activeTo);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const cur = localMinutesNow(cfg.timezone || 'UTC');
  let inActive;
  if (from === to) inActive = false;
  else if (from < to) inActive = cur >= from && cur < to;
  else inActive = cur >= from || cur < to; // wraps midnight
  return inActive ? 'active' : 'quiet';
}

function resolveVariant(req, cfg) {
  const units = (req.query.units === 'C' || req.query.units === 'F')
    ? req.query.units
    : (cfg.units === 'C' ? 'C' : 'F');

  const screenRaw = parseInt(req.query.screen, 10);
  let screen;
  if (Number.isFinite(screenRaw) && screenRaw > 0) {
    screen = screenRaw;
  } else {
    const mode = pickScheduleMode(cfg);
    if (mode && cfg.schedule[mode] && cfg.schedule[mode].screen) {
      screen = parseInt(cfg.schedule[mode].screen, 10) || 1;
    } else {
      screen = parseInt(cfg.screen, 10) || 1;
    }
  }
  return { units, screen };
}

function resolveRefreshMinutes(cfg) {
  const mode = pickScheduleMode(cfg);
  if (mode && cfg.schedule[mode] && cfg.schedule[mode].refreshMinutes) {
    const m = parseInt(cfg.schedule[mode].refreshMinutes, 10);
    if (Number.isFinite(m) && m > 0) return m;
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

// Dashboard HTML — built from the current config + live data
app.get('/dashboard', async (req, res) => {
  try {
    const cfg = await loadConfig();
    const { units, screen } = resolveVariant(req, cfg);
    const weather = cfg.widgets.weather
      ? await fetchWeather(cfg.city, process.env.OPENWEATHER_API_KEY, units)
      : null;
    const events = cfg.widgets.calendar
      ? await fetchEvents(cfg.calendar.icalUrl)
      : [];

    const html = await fsp.readFile(path.join(__dirname, 'public', 'dashboard.html'), 'utf8');
    const payload = { cfg, weather, events, units, screen, generatedAt: new Date().toISOString() };
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

// Tell ESP32 how long to sleep (honors schedule if enabled)
app.get('/sleep', checkDeviceAuth, async (req, res) => {
  const cfg = await loadConfig();
  const minutes = resolveRefreshMinutes(cfg);
  const mode = pickScheduleMode(cfg);
  res.json({ minutes, mode });
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

// Config API
app.get('/api/config', async (req, res) => {
  res.json(await loadConfig());
});

app.post('/api/config', async (req, res) => {
  try {
    const current = await loadConfig();
    const bodySched = req.body.schedule || {};
    const curSched = current.schedule || {};
    const merged = { ...current, ...req.body,
      widgets: { ...current.widgets, ...(req.body.widgets || {}) },
      message: { ...current.message, ...(req.body.message || {}) },
      calendar: { ...current.calendar, ...(req.body.calendar || {}) },
      schedule: { ...curSched, ...bodySched,
        active: { ...(curSched.active || {}), ...(bodySched.active || {}) },
        quiet:  { ...(curSched.quiet  || {}), ...(bodySched.quiet  || {}) }
      }
    };
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

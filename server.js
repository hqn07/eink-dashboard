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

// ---------- Puppeteer (one persistent browser) ----------

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
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
    browserPromise = puppeteer.launch(launchOpts);
  }
  return browserPromise;
}

async function renderDashboardPng() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({
      width: SCREEN_W,
      height: SCREEN_H,
      deviceScaleFactor: 1
    });
    const url = `http://127.0.0.1:${PORT}/dashboard`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
    const buf = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: SCREEN_W, height: SCREEN_H }
    });
    return buf;
  } finally {
    await page.close();
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

let imageCache = { at: 0, png: null, bin: null };
const IMAGE_CACHE_MS = 60 * 1000; // re-render at most every 60s

async function getCurrentImage() {
  const now = Date.now();
  if (imageCache.png && (now - imageCache.at) < IMAGE_CACHE_MS) {
    return imageCache;
  }
  const rgba = await renderDashboardPng();
  const png = await toMonoPng(rgba);
  const bin = await toMonoBin(rgba);
  imageCache = { at: now, png, bin };
  return imageCache;
}

// Force re-render on next request (called after config save)
function invalidateImage() {
  imageCache = { at: 0, png: null, bin: null };
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
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

// Dashboard HTML — built from the current config + live data
app.get('/dashboard', async (req, res) => {
  try {
    const cfg = await loadConfig();
    const weather = cfg.widgets.weather
      ? await fetchWeather(cfg.city, process.env.OPENWEATHER_API_KEY)
      : null;
    const events = cfg.widgets.calendar
      ? await fetchEvents(cfg.calendar.icalUrl)
      : [];

    const html = await fsp.readFile(path.join(__dirname, 'public', 'dashboard.html'), 'utf8');
    const payload = { cfg, weather, events, generatedAt: new Date().toISOString() };
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
    const { png } = await getCurrentImage();
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
    const { bin } = await getCurrentImage();
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

// Tell ESP32 how long to sleep
app.get('/sleep', checkDeviceAuth, async (req, res) => {
  const cfg = await loadConfig();
  res.json({ minutes: cfg.refreshMinutes || 30 });
});

// Control panel
app.get('/', (req, res) => res.redirect('/control'));
app.get('/control', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'control.html'));
});

// Config API
app.get('/api/config', async (req, res) => {
  res.json(await loadConfig());
});

app.post('/api/config', async (req, res) => {
  try {
    const current = await loadConfig();
    const merged = { ...current, ...req.body,
      widgets: { ...current.widgets, ...(req.body.widgets || {}) },
      message: { ...current.message, ...(req.body.message || {}) },
      calendar: { ...current.calendar, ...(req.body.calendar || {}) }
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

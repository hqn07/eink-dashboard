// server.js
// Express server that:
//  - Serves a 800x480 dashboard HTML page at /dashboard
//  - Screenshots it via Puppeteer and serves at /display.png (and /display.bin for ESP32)
//  - Serves a control panel at /control
//  - Persists config to data/config.json

require('dotenv').config();
const express = require('express');
const compression = require('compression');
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
const { htmlAttr, escapeHtmlServer, strongEtag, decodeSettingsParam } = require('./lib/htmlutil');
const { sizeFor, expandLayout, withinVisibility } = require('./lib/layout');
const { jsonFetch } = require('./lib/geo');

// SSR module — per-widget render functions + chrome helpers, no React.
// Dynamically imported (ESM) at first use and cached. Lets /dashboard
// produce the full page HTML server-side instead of shipping a
// duplicate widget render block to the browser.
const { loadSsr, loadDashboardHtml } = require('./lib/ssr-shell');

// Error ring buffer moved to ./lib/errlog.js — requiring it installs the
// console.error wrapper (side effect) and hands back the shared ring the
// /status page reads.
const { errLog: _errLog } = require('./lib/errlog');

const PORT = process.env.PORT || 3000;
const { DEVICE_TOKEN, IS_PROD } = require('./lib/env');
// On-disk state paths + atomic write live in lib/store.js (single source of
// truth for DATA_DIR). The reset route still needs a couple of them.
const { CONFIG_PATH, DEFAULT_CONFIG_PATH, atomicWriteFile } = require('./lib/store');

// Loud warning when no DEVICE_TOKEN is set in production: the control
// panel + config API end up wide-open. Local dev intentionally allows
// missing token so first-run friction stays low.
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

// Persistence stores (each owns its own cache/lock state; see lib/*-store.js).
// config-store's loadConfig runs the migrator wired below, once it's defined.
const {
  loadConfig, saveConfig, withConfigLock, invalidateConfigCache,
  setMigrator: _setConfigMigrator,
} = require('./lib/config-store');
const {
  loadBatteryState, saveBatteryState, currentBatteryState,
  loadBatteryHistory, appendBatteryHistory,
} = require('./lib/battery-store');
const {
  loadDevicesSync, saveDevices, findDeviceByKey, genApiKey, genFriendlyId,
} = require('./lib/devices-store');
const { buildWidgetData } = require('./lib/widget-data');
const { renderPage } = require('./lib/ssr');
const {
  resolveScreenLayout, migrateConfigToScreens, pickActiveScreen,
  resolveVariant, resolveRefreshMinutes,
} = require('./lib/screens');
const {
  getBrowser, tryAcquirePage, releasePage,
  getCurrentImage, invalidateImage, warmActiveImage, imageCache,
  PRERENDER_ENABLED, PRERENDER_INTERVAL_MS,
} = require('./lib/render');
const {
  pushNow, effectiveRefresh, getFastWakeUntil,
  FAST_WINDOW_MS, FAST_INTERVAL_SECONDS,
} = require('./lib/refresh');
// Wire the config-store to migrate loaded configs to the current screen
// schema. Injected (not imported by config-store) to avoid a require cycle.
_setConfigMigrator(migrateConfigToScreens);

// loadDashboardHtml + loadSsr (the SSR shell + compiled widget bundle) live in
// ./lib/ssr-shell.js — imported at the top.

// parseHHMM/hmFormatter/localMinutesNow/scheduleIntervals moved to
// ./lib/timewin.js (required at the top).

// ---------- Auth ----------

// Auth (device token + api-key, control-panel PIN, sessions, gates) lives in
// lib/auth.js. It reads config via config-store and devices via devices-store.
const {
  checkDeviceAuth, gateControlHtml, checkAdminAuth,
  authBlock, pinConfigured, verifyPin, setPinInConfig,
  makeSession, sessionValid, setSessionCookie, clearSessionCookie,
} = require('./lib/auth');

const { safeError } = require('./lib/http');

// ---------- App ----------

const app = express();
// Railway / Render / Fly all front the app with a proxy that injects
// X-Forwarded-For. Without this, express-rate-limit refuses to use the
// header and crashes the process when it sees it.
app.set('trust proxy', 1);
// Baseline security headers. Deliberately no CSP: the control app relies on
// inline styles / React-injected style tags, and the SSR face uses inline
// accent styles, so a strict policy would break rendering with no real gain
// on a PIN-gated single-tenant tool. These four are safe and free.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
});
// gzip text responses (the ~380KB control bundle, SSR HTML, JSON APIs).
// Skip the raw device image endpoints: the ESP32's HTTP client fetches the
// exact 48000-byte body and does not negotiate/decode gzip.
app.use(compression({
  filter(req, res) {
    if (req.path === '/display.bin' || req.path.endsWith('.bin')) return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: '10mb' })); // photo widget can carry a base64 image
// Cache policy for /static: fonts + icons have stable names and rarely
// change, so let the browser hold them for a week (dashboard.css is busted
// via ?v= query, fonts via filename churn on the rare occasion they change).
// HTML must never be held — it references versioned assets and is edited live.
app.use('/static', express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (/\.(woff2?|ttf|otf|png|svg|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
    } else if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

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
// Vite emits content-hashed filenames under /assets, so those are safe to
// cache forever (immutable). index.html references them and must stay fresh
// on every deploy, so it is explicitly never cached.
app.use('/control-app', gateControlHtml, express.static(CONTROL_APP_DIR, {
  setHeaders(res, filePath) {
    if (/[\\/]assets[\\/].+\.(js|css|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ============ SSR PIPELINE ============
//
// Renders the full dashboard HTML server-side from the widget render
// functions under control-src/widgets/<id>.js. The dashboard.html shell
// is now just chrome (CSS link + autofit script); the body grid is
// inlined as a static string the browser doesn't have to recompute.
// Puppeteer still loads /dashboard via headless Chrome to snap the PNG,
// but it only runs the autofit pass + font wait, not a widget loop.



// Resolve a raw layout item to one with explicit w/h. Stored geometry
// always wins; size preset is the fallback. Drops items pointing at
// unknown widget ids.



// Build the inner page HTML — body grid only (no chrome). Per-tile
// rendering pulls the per-item slot data via `perItem[item.id]` so each
// tile gets its own context (overrides global where set).
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
      invalidateConfigCache();
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

const dev = require('./lib/dev');

app.get('/dev/events', (req, res) => {
  if (IS_PROD) return res.status(404).end();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();
  res.write(': connected\n\n');
  dev.addClient(res);
  dev.startDevWatchers();
  req.on('close', () => dev.removeClient(res));
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
    const fastActive = Date.now() < getFastWakeUntil();

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
      ? `<span class="ok">active</span> · ${dur(getFastWakeUntil() - Date.now())} left`
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

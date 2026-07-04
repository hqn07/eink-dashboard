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



// SSR dashboard + dev/preview/matrix render surfaces.
app.use(require('./routes/render-pages'));

// Config CRUD + editor preview-data.
app.use(require('./routes/config'));

// Device-facing render + sleep/wake endpoints.
app.use(require('./routes/display'));

// Control panel
app.get('/', (req, res) => res.redirect('/control'));

// ---------- Control-panel PIN auth ----------
// Login page: editorial-styled, no webfonts/JS deps, posts the PIN and
// redirects on success. Served unauthenticated (it's the unlock door).
// Control-panel PIN auth pages + API + /control SPA entry.
app.use(require('./routes/auth'));

// ---------- Geocoding / weather-check (Open-Meteo, no API key) ----------
// React fetches these instead of calling Open-Meteo directly so that
// (a) we can cache responses on the server and (b) the path is stable
// if we ever switch providers.

// Geocode / reverse-geocode / weather-check (setup UI helpers).
app.use(require('./routes/geocode'));

// Returns the full payload the dashboard would render — minus the
// HTML. The React editor uses this to render live widget tiles locally.

// Battery report/read (ESP32).
app.use(require('./routes/battery'));

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
// Mac-agent push endpoints (now-playing + battery).
app.use(require('./routes/mac-state'));

// ---------- Alarms ----------
//
// Stored at cfg.alarms — see widgets/alarms.js for the shape. Time
// math runs in the server's local timezone; set the TZ env var on
// Railway to match your real timezone or alarms will misfire by the
// offset.

// Alarm CRUD + device next-alarm lookup.
app.use(require('./routes/alarms'));

// ---------- Firmware OTA ----------
//
// Layout: drop compiled `.bin` files into `public/firmware/` named
// `<board>-<semver>.bin` (e.g. `bw-1.2.0.bin`, `b-1.0.3.bin`). The device
// hits /api/firmware/manifest with its board + current version; if a
// newer binary exists, the manifest returns it and the device pulls the
// raw file from /firmware/<filename> via ESP32 httpUpdate.
// parseSemver/cmpSemver/findNewestFirmware + FW_DIR/FW_NAME_RE moved to
// ./lib/firmware.js (required at the top).

// Firmware OTA manifest + raw .bin serving.
app.use(require('./routes/firmware'));

// ---------- Device enrollment ----------
//
// First-boot handshake: device POSTs its MAC; server returns a
// long-lived api_key + a short friendly_id ("A3F2B7") for the
// control UI. Idempotent — re-enrolling the same MAC returns the
// existing record so a re-flashed device that lost NVS can recover.
//
// No auth: this is the bootstrap path. Rate-limited at the global
// /api/* middleware to keep abuse from filling the device store.
// Device enrollment + roster.
app.use(require('./routes/devices'));

// Ops status page + health probes.
app.use(require('./routes/status'));

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

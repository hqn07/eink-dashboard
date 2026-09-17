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
const crypto = require('crypto');

// Requiring errlog installs a console.error wrapper (side effect) that feeds
// the ring buffer the /status page reads. Required early so startup errors
// are captured.
require('./lib/errlog');

const PORT = process.env.PORT || 3000;
const { DEVICE_TOKEN, IS_PROD } = require('./lib/env');
const { scriptSrc } = require('./lib/csp');

// server.js is the composition root: it wires middleware + mounts the routers
// under routes/. Nearly all logic lives in lib/ modules; the only pieces used
// directly here are the startup warmer, the PIN-reset recovery, the config
// migrator wiring, and a couple of middleware deps.
const { loadConfig, saveConfig, setMigrator: _setConfigMigrator } = require('./lib/config-store');
const { migrateConfigToScreens } = require('./lib/screens');
const {
  invalidateImage, warmActiveImage, PRERENDER_ENABLED, PRERENDER_INTERVAL_MS,
  BROWSER_IDLE_MS,
} = require('./lib/render');
const { gateControlHtml } = require('./lib/auth');
const { safeError } = require('./lib/http');

// Loud warning when no DEVICE_TOKEN is set in production: the control panel +
// config API end up wide-open. Local dev intentionally allows a missing token
// so first-run friction stays low.
if (!DEVICE_TOKEN) {
  const msg = '[security] DEVICE_TOKEN env var is not set — /api/* config endpoints are PUBLIC.';
  if (IS_PROD) {
    console.error(`\n${msg}\n[security] Set DEVICE_TOKEN before exposing this server to the internet.\n`);
  } else {
    console.warn('[security] DEVICE_TOKEN unset (local dev) — set it in .env for any non-localhost deploy.');
  }
}

// Wire the config-store to migrate loaded configs to the current screen schema.
// Injected (not imported by config-store) to avoid a require cycle.
_setConfigMigrator(migrateConfigToScreens);

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
  // HSTS: Railway terminates TLS, so this costs one header and forecloses a
  // downgrade. Production only — sending it from localhost would pin http://
  // localhost to https:// in the developer's browser and be a nuisance to undo.
  if (IS_PROD) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // CSP as defence in depth, not as a fix for a live hole: the widget HTML
  // that reaches dangerouslySetInnerHTML IS escaped (every user string goes
  // through escapeHtml, audited 2026-09-17). Widget markup carries inline
  // style= everywhere and the face CSS is generated, so 'unsafe-inline' for
  // styles is unavoidable; script-src stays strict, which is the part that
  // matters. data: covers the dithered photo/QR data URIs.
  // script-src carries a sha256 per inline block the server emits (lib/csp.js).
  // `script-src 'self'` alone silently blocked the autofit pass and moved the
  // rendered panel by 0.347% — caught only by check:visual.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    `script-src ${scriptSrc()}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; '));
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

// The login endpoint needs its OWN limit, and this is why: the 300 above was
// raised from 60 because the EDITOR is chatty, and /api/auth/login silently
// inherited a number tuned for a completely unrelated problem. At 300/min a
// 4-digit PIN (the enforced minimum) falls in ~33 minutes.
//
// 10 per 15 min per IP. An IP limit alone is cheap to evade with a botnet, so
// routes/auth.js also keeps a per-install failure counter with backoff — this
// is the cheap first line, not the whole defence.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited' },
  // Only failures should count against the budget, so a legitimate user who
  // logs in, logs out and logs back in is never locked out by their own use.
  skipSuccessfulRequests: true,
});
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/set-pin', loginLimiter);

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

// ---------- Routers ----------
// Each group lives in routes/*.js and pulls its own deps from lib/. See the
// header comment in each router for what it owns.
app.use(require('./routes/render-pages')); // /dashboard SSR + /dev + /preview + /widgets-matrix
app.use(require('./routes/config'));       // /api/config* + /api/preview-data
app.use(require('./routes/connections')); // /api/connections (provider keys, never exported)
app.use(require('./routes/display'));      // /display.* + /sleep + /api/wake (device-facing)
app.get('/', (req, res) => res.redirect('/control'));
app.use(require('./routes/auth'));         // /control* + /api/auth* (PIN login/setup)
app.use(require('./routes/geocode'));      // /api/geocode + /api/reverse-geocode
app.use(require('./routes/battery'));      // /api/battery report/read
app.use(require('./routes/firmware'));     // /api/firmware/manifest + /firmware/:file
app.use(require('./routes/devices'));      // /api/setup + /api/devices + /api/device/:id + /api/log(s)
app.use(require('./routes/webhook'));      // /api/webhook/:key (push JSON -> webhook widget)
app.use(require('./routes/beam'));         // /api/beam (send-to-display takeover message)
app.use(require('./routes/status'));       // /status + /health + /health/widgets

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
  } else {
    console.log('  Pre-render:     off (on-demand; set PRERENDER=1 to warm)');
  }
  console.log(`  Browser idle:   ${BROWSER_IDLE_MS ? `close after ${Math.round(BROWSER_IDLE_MS / 1000)}s` : 'stay resident'}`);

  // Loud, because it replaces the dashboard with a test pattern on glass:
  // whoever finds the panel showing a ruler should be able to confirm why
  // from the logs, and nobody should leave it on by accident.
  const calib = (process.env.CALIB_3C || '').trim().toLowerCase();
  if (calib === 'raw' || calib === 'shifted' || calib === '1') {
    console.log(`  ** CALIBRATION MODE: /display-3c.bin serves the alignment target (CALIB_3C=${calib}) **`);
    console.log('     Unset CALIB_3C to go back to the dashboard.');
  }
});

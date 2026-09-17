// Authentication for the two audiences that hit this server:
//
//  - Devices / programmatic clients: a fleet-wide DEVICE_TOKEN and/or a
//    per-device X-API-Key (checkDeviceAuth).
//  - The human browser editor: a PIN (scrypt-hashed in config.auth) exchanged
//    for a signed session cookie (HMAC over an expiry). gateControlHtml guards
//    the HTML surfaces; checkAdminAuth guards config writes.
//
// PIN state lives in config.auth via the config-store; device records via the
// devices-store. No auth state is held in this module.
const crypto = require('crypto');
const { DEVICE_TOKEN, IS_PROD } = require('./env');
const { loadConfig, saveConfig, withConfigLock } = require('./config-store');
const { findDeviceByKey, touchDevice } = require('./devices-store');

const SESSION_DAYS = 30;
const SESSION_COOKIE = 'eink_sess';

// ---------- Device auth ----------
function checkDeviceAuth(req, res, next) {
  // Per-device API key takes precedence — once a device enrolls via
  // /api/setup it sends X-API-Key on every request. Successful lookup
  // attaches the device record to req.device and bumps last_seen_at.
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    const dev = findDeviceByKey(String(apiKey));
    if (dev) {
      req.device = dev;
      // Telemetry rides on the /display-3c.bin request every cycle; other
      // endpoints simply pass nothing and leave the stored values alone.
      touchDevice(dev, {          // in-memory now, flushed to disk on a debounce
        fw_version: req.headers['fw-version'],
        board:      req.headers['fw-board'],
      });
      return next();
    }
    // Unknown api-key (e.g. firmware enrolled against a different server /
    // the roster was lost). Fall through to the fleet token check rather
    // than rejecting — but flag the staleness so the firmware (≥1.20.1 b /
    // ≥1.14.1 bw) clears its NVS key and re-enrolls on the next cycle.
    // Without this the device authenticates via the fleet token forever and
    // never reappears in the roster (real incident: empty /api/devices with
    // a live panel — per-device screens and log attribution silently dead).
    console.warn('[auth] unknown X-API-Key, falling through to fleet token');
    res.set('X-Enroll-Stale', '1');
  }
  // Legacy fleet-wide token. Keeps existing firmware working until every
  // device has enrolled via /api/setup. Also unlocks admin endpoints.
  if (!DEVICE_TOKEN) return next();
  const tok = req.query.token || req.headers['x-device-token'];
  if (!safeEqual(tok, DEVICE_TOKEN)) return res.status(401).send('Bad token');
  next();
}

// Constant-time string compare that tolerates undefined/length mismatch.
// The PIN path already used timingSafeEqual; the device token was on `!==`,
// and the inconsistency was the real complaint — remote timing attacks across
// WAN jitter are not practical, but there is no reason to have both.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ---------- Control-panel PIN (human editor auth) ----------
// Separate from DEVICE_TOKEN: the PIN gates the browser editor; devices and
// programmatic clients keep using DEVICE_TOKEN. PIN lives hashed in config.auth
// (scrypt + per-PIN salt); a signed cookie (HMAC over an expiry, keyed by a
// random sessionSecret) is the unlocked session. First run (no PIN) leaves
// the editor open so the user can set one.
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

// Persist a new PIN under config.auth, and ROTATE the session secret with it.
//
// The secret used to be preserved across a PIN change, which meant changing
// your PIN evicted nobody: sessions are a 30-day HMAC keyed by that secret, so
// every cookie issued under the old PIN stayed valid for up to a month. The
// reason anyone changes a PIN is that they think someone else has it, and the
// one thing that action has to do is exactly what it did not do.
//
// Rotating invalidates every existing session including the caller's, so both
// callers re-issue a cookie from the returned secret immediately.
async function setPinInConfig(pin) {
  return withConfigLock(async () => {
    const cfg = await loadConfig();
    const salt = crypto.randomBytes(16).toString('hex');
    cfg.auth = {
      ...(cfg.auth || {}),
      pinSalt: salt,
      pinHash: hashPin(pin, salt),
      sessionSecret: crypto.randomBytes(32).toString('hex'),
      // A new PIN clears the lockout — the credential the attempts were
      // against no longer exists.
      failCount: 0,
      lockedUntil: 0,
    };
    await saveConfig(cfg);
    return cfg.auth;
  });
}

// ---------- Login failure backoff ----------
// The per-IP limiter in server.js is the cheap first line; it is also trivially
// evaded from several addresses. This counter is per-install and survives
// restarts, so a distributed guess still has to wait.
//
// Doubling from 2s at the 4th failure, capped at 15 min: invisible to someone
// who fat-fingered their PIN once, and it turns a 4-digit exhaustive search
// from ~33 minutes into something measured in months.
const FAIL_GRACE = 3;
const FAIL_BASE_MS = 2000;
const FAIL_MAX_MS = 15 * 60 * 1000;

function lockoutRemainingMs(cfg) {
  const until = Number(authBlock(cfg).lockedUntil) || 0;
  return Math.max(0, until - Date.now());
}

async function recordLoginFailure() {
  return withConfigLock(async () => {
    const cfg = await loadConfig();
    const a = { ...(cfg.auth || {}) };
    a.failCount = (Number(a.failCount) || 0) + 1;
    // `>= 0`, not `> 0`: FAIL_GRACE is the number of free failures, so the
    // attempt AFTER the third one is the first to be refused. Locking on the
    // fourth failure instead would give four free guesses, not three.
    const over = a.failCount - FAIL_GRACE;
    a.lockedUntil = over >= 0
      ? Date.now() + Math.min(FAIL_BASE_MS * (2 ** over), FAIL_MAX_MS)
      : 0;
    cfg.auth = a;
    await saveConfig(cfg);
    return a;
  });
}

async function clearLoginFailures() {
  return withConfigLock(async () => {
    const cfg = await loadConfig();
    if (!cfg.auth || (!cfg.auth.failCount && !cfg.auth.lockedUntil)) return;
    cfg.auth = { ...cfg.auth, failCount: 0, lockedUntil: 0 };
    await saveConfig(cfg);
  });
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    // decodeURIComponent throws on malformed escapes ("%ZZ"), and a junk
    // Cookie header turned into a 500 instead of "no session".
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
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
// configured and the request has no valid session, bounce to login. First run
// (no PIN) passes through so the user can set one — except in production,
// where a public instance must never serve an open editor.
async function gateControlHtml(req, res, next) {
  try {
    const cfg = await loadConfig();
    if (sessionValid(req, cfg)) return next();
    if (pinConfigured(cfg)) return res.redirect('/control/login');
    if (IS_PROD) return res.redirect('/control/setup');
    return next();
  } catch (err) {
    return next(err);
  }
}

// Admin auth — DEVICE_TOKEN (programmatic clients) OR a valid PIN session
// cookie (the browser editor). Per-device api_keys are rejected: /api/setup
// hands those out unauthenticated, so a device key must NOT unlock config
// writes or the device roster.
async function checkAdminAuth(req, res, next) {
  try {
    const cfg = await loadConfig();
    if (pinConfigured(cfg) && sessionValid(req, cfg)) return next();
    if (DEVICE_TOKEN) {
      const tok = req.query.token || req.headers['x-device-token'];
      if (tok === DEVICE_TOKEN) return next();
    }
    // No PIN and no token requirement → open ONLY in local dev / first run.
    // In production we refuse admin writes until a PIN (or token) exists, so a
    // fresh public deploy can't be configured by a stranger. First-run
    // /api/auth/set-pin is separate and stays reachable to bootstrap.
    if (!pinConfigured(cfg) && !DEVICE_TOKEN && !IS_PROD) return next();
    return res.status(401).send('Unauthorized');
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  checkDeviceAuth, gateControlHtml, checkAdminAuth,
  authBlock, pinConfigured, verifyPin, setPinInConfig,
  makeSession, sessionValid, setSessionCookie, clearSessionCookie,
  lockoutRemainingMs, recordLoginFailure, clearLoginFailures, safeEqual,
};

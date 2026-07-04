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
const { findDeviceByKey } = require('./devices-store');

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
      dev.last_seen_at = Date.now();
      return next();
    }
    // Unknown api-key (e.g. firmware enrolled against a different server,
    // then pointed here). Fall through to the fleet token check rather than
    // rejecting — that path is what firmware uses pre-enrollment too, and
    // re-enrollment happens automatically via the cycle's /api/setup call.
    console.warn('[auth] unknown X-API-Key, falling through to fleet token');
  }
  // Legacy fleet-wide token. Keeps existing firmware working until every
  // device has enrolled via /api/setup. Also unlocks admin endpoints.
  if (!DEVICE_TOKEN) return next();
  const tok = req.query.token || req.headers['x-device-token'];
  if (tok !== DEVICE_TOKEN) return res.status(401).send('Bad token');
  next();
}

// ---------- Control-panel PIN (human editor auth) ----------
// Separate from DEVICE_TOKEN: the PIN gates the browser editor; devices and
// the mac-agent keep using DEVICE_TOKEN. PIN lives hashed in config.auth
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

// Admin auth — DEVICE_TOKEN (mac-agent / programmatic) OR a valid PIN session
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
};

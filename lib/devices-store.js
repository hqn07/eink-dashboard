// Device registry, keyed by lowercased MAC. Each record holds the long-lived
// api_key the device sends as X-API-Key, a human-friendly id for the control
// UI, and the most recent telemetry (fw_version, board, last_seen).
//
// Loaded once at require time (below) so checkDeviceAuth can do a synchronous
// lookup; saveDevices() updates both the cache and the on-disk file.
const fs = require('fs');
const crypto = require('crypto');
const { DEVICES_PATH, atomicWriteFile } = require('./store');

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
    await atomicWriteFile(DEVICES_PATH, JSON.stringify(d, null, 2));
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

// Persist last_seen_at, debounced.
//
// checkDeviceAuth bumps dev.last_seen_at on every request but only in memory,
// so the roster's "last seen" was a lie the moment the process restarted — a
// live panel could show a last_seen from before the previous deploy. That
// misled a real debugging session during the 2026-09-17 token rotation, where
// a stale timestamp was read as evidence the device was not authenticating
// with its api_key.
//
// Debounced because the alternative is an fsync per device request and this is
// telemetry, not state anything depends on: losing up to 60s of it on an
// unclean exit costs nothing.
const TOUCH_DEBOUNCE_MS = 60 * 1000;
let _touchTimer = null;
let _touchPending = false;

// Short, printable-ASCII only, capped. The values come from request headers
// on an api-key-authenticated request, so they are device-supplied; there is
// no reason for either to be long or exotic, and the roster is rendered in the
// editor and echoed into the log feed.
function cleanTelemetry(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 32) return null;
  return /^[\x20-\x7e]+$/.test(t) ? t : null;
}

// `meta` carries per-request telemetry (fw_version, board) to refresh on the
// stored record.
//
// fw_version used to be written ONLY by /api/setup at enrollment — and
// enrollDevice() is a no-op once the device holds an api key, so it never ran
// again. The roster therefore reported the version a device FIRST enrolled
// with, forever, and every entry in the log feed inherited it
// (routes/devices.js reads dev.fw_version first). A unit that OTA'd 1.20.1 ->
// 1.22.0 still read 1.20.1 two months later, which is worse than showing
// nothing: it made a working OTA look like a broken one.
function touchDevice(dev, meta) {
  if (!dev) return;
  dev.last_seen_at = Date.now();
  if (meta) {
    const fw = cleanTelemetry(meta.fw_version);
    const bd = cleanTelemetry(meta.board);
    if (fw && fw !== dev.fw_version) dev.fw_version = fw;
    if (bd && bd !== dev.board)      dev.board      = bd;
  }
  _touchPending = true;
  if (_touchTimer) return;
  _touchTimer = setTimeout(() => {
    _touchTimer = null;
    if (!_touchPending) return;
    _touchPending = false;
    saveDevices(loadDevicesSync()).catch(() => { /* saveDevices already warns */ });
  }, TOUCH_DEBOUNCE_MS);
  // Never hold the process open for a telemetry write.
  if (_touchTimer.unref) _touchTimer.unref();
}

function genApiKey()     { return crypto.randomBytes(24).toString('hex'); }
function genFriendlyId() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }

// Seed the cache so the first auth call doesn't hit a sync read.
loadDevicesSync();

module.exports = {
  loadDevicesSync, saveDevices, findDeviceByKey, touchDevice,
  genApiKey, genFriendlyId,
};

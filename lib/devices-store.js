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

function touchDevice(dev) {
  if (!dev) return;
  dev.last_seen_at = Date.now();
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

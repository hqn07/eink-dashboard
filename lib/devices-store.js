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

function genApiKey()     { return crypto.randomBytes(24).toString('hex'); }
function genFriendlyId() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }

// Seed the cache so the first auth call doesn't hit a sync read.
loadDevicesSync();

module.exports = {
  loadDevicesSync, saveDevices, findDeviceByKey, genApiKey, genFriendlyId,
};

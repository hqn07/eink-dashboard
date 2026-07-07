// Device event log — a capped ring of firmware-reported events (fail
// reasons, recoveries, boot notes) so hardware quirks are debuggable from
// the server without a serial cable or panel photos. Follows the
// battery-store pattern: JSON file in DATA_DIR, atomic write, newest last
// on disk; readers reverse for newest-first.
const fsp = require('fs/promises');
const { DEVICE_LOGS_PATH, atomicWriteFile } = require('./store');

// Enough to cover weeks of a flapping device at one entry per failed
// cycle without growing unbounded on the Railway volume.
const MAX_ENTRIES = 300;

async function loadDeviceLogs() {
  try {
    const raw = await fsp.readFile(DEVICE_LOGS_PATH, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

// Serialized appends: concurrent POSTs (multi-device fleet) chain onto one
// promise so a read-modify-write can't drop entries.
let _appendChain = Promise.resolve();

function appendDeviceLog(entry) {
  _appendChain = _appendChain.then(async () => {
    const logs = await loadDeviceLogs();
    logs.push(entry);
    const trimmed = logs.length > MAX_ENTRIES ? logs.slice(-MAX_ENTRIES) : logs;
    await atomicWriteFile(DEVICE_LOGS_PATH, JSON.stringify(trimmed));
  }).catch(err => console.warn('device-log append failed:', err.message));
  return _appendChain;
}

module.exports = { loadDeviceLogs, appendDeviceLog, MAX_ENTRIES };

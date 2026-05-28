// widgets/macbattery.js
// Parses Mac's `pmset -g batt` for battery percent + charging state.
// Returns null off macOS.
const { exec } = require('child_process');
const { promisify } = require('util');
const status = require('./_status');
const execP = promisify(exec);
const CACHE_MS = 60 * 1000;
let cached = null;

async function fetchMacBattery() {
  if (process.platform !== 'darwin') return null;
  if (cached && (Date.now() - cached.at) < CACHE_MS) {
    status.cacheHit('mac_battery');
    return cached.data;
  }
  const t0 = Date.now();
  try {
    const { stdout } = await execP('pmset -g batt', { timeout: 2000 });
    // Format: "-InternalBattery-0 (id=...)\t87%; charging; 1:32 remaining"
    // Or "Now drawing from 'AC Power'" + battery line.
    const m = stdout.match(/(\d+)%;\s*([^;]+)(?:;|$)/);
    if (!m) {
      cached = { at: Date.now(), data: null };
      status.record('mac_battery', { ok: true, ms: Date.now() - t0 });
      return null;
    }
    const data = {
      percent: parseInt(m[1], 10),
      state: m[2].trim()  // "charging" / "discharging" / "AC attached" / "charged"
    };
    cached = { at: Date.now(), data };
    status.record('mac_battery', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('mac_battery', { ok: false, ms: Date.now() - t0, err: err.message });
    return null;
  }
}

module.exports = { fetchMacBattery };

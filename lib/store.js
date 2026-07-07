// Shared low-level for on-disk mutable state. Single source of truth for
// DATA_DIR + the file paths, and the atomic write primitive. The per-domain
// stores (config-store, battery-store, devices-store) all build on this.
//
// DATA_DIR should point at a persistent volume on hosts with an ephemeral
// filesystem (Railway/Fly/Render wipe the container FS on redeploy). Defaults
// to the in-repo ./data for local dev. Read at require time — server.js runs
// dotenv.config() before requiring anything, so .env values are already live.
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
// A fresh volume mount is an empty directory — ensure it exists before the
// first write.
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* exists */ }

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
// Seed config lives outside DATA_DIR so a persistent volume taking over that
// directory can't hide the baked-in defaults shipped with the image.
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'data-defaults', 'config.default.json');
const BATTERY_PATH = path.join(DATA_DIR, 'battery.json');
const DEVICES_PATH = path.join(DATA_DIR, 'devices.json');
const BATTERY_HISTORY_PATH = path.join(DATA_DIR, 'battery-history.json');
const DEVICE_LOGS_PATH = path.join(DATA_DIR, 'device-logs.json');
const WEBHOOKS_PATH = path.join(DATA_DIR, 'webhooks.json');

// Write via a temp file + rename so a crash mid-write can't leave a truncated
// or partially-written JSON file on disk.
async function atomicWriteFile(target, data) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, target);
}

module.exports = {
  DATA_DIR, CONFIG_PATH, DEFAULT_CONFIG_PATH,
  BATTERY_PATH, DEVICES_PATH, BATTERY_HISTORY_PATH,
  DEVICE_LOGS_PATH, WEBHOOKS_PATH,
  atomicWriteFile,
};

// Shared on-disk cache for Mac-originated widget state (now playing +
// battery). Lets the cloud server render mac widgets without spawning
// macOS-only binaries: a Mac-side agent (mac-agent.js) pushes its
// local state via POST /api/mac-state, the server writes it here, and
// the macnowplaying / macbattery fetchers read it on non-darwin
// platforms (or when explicitly forced via MAC_FROM_CACHE=1).
//
// Format: { nowplaying: {...}|null, battery: {...}|null, at: <ms> }.
// Atomic-write so a partial write can't corrupt the file mid-read.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'data', 'mac-state.json');
const STALE_MS = 5 * 60 * 1000; // 5 min — older than this = treat as offline.

let mem = null; // last-known state (in-process cache to skip a disk read per request)

function loadSync() {
  // Clean up an orphaned `.tmp` if a previous process crashed between
  // writeFile and rename. Quietly ignore — best effort, the real file
  // still wins.
  try { fs.unlinkSync(STATE_PATH + '.tmp'); } catch { /* not there */ }
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    mem = JSON.parse(raw);
  } catch {
    mem = null;
  }
  return mem;
}

async function read() {
  if (!mem) loadSync();
  return mem;
}

async function write(payload) {
  const merged = {
    nowplaying: payload && 'nowplaying' in payload
      ? payload.nowplaying
      : (mem && mem.nowplaying) || null,
    battery: payload && 'battery' in payload
      ? payload.battery
      : (mem && mem.battery) || null,
    // Persisted so the artwork-dedup contract survives a server
    // restart: the agent keeps skipping the artwork payload while the
    // track is unchanged, and a freshly-booted server needs the last
    // track key to know its stored artwork still applies.
    trackKey: payload && 'trackKey' in payload
      ? payload.trackKey
      : (mem && mem.trackKey) || null,
    at: Date.now()
  };
  mem = merged;
  const tmp = STATE_PATH + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(merged));
  await fsp.rename(tmp, STATE_PATH);
  return merged;
}

function fresh(at) {
  return Number.isFinite(at) && (Date.now() - at) < STALE_MS;
}

module.exports = { read, write, loadSync, fresh, STALE_MS };

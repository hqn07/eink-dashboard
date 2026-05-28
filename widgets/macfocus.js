// widgets/macfocus.js
// Reads the current macOS Focus mode state from the DoNotDisturb
// DB JSON. Returns `{ active, modeId }` or null if off macOS / file
// unreadable.
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const status = require('./_status');
const CACHE_MS = 30 * 1000;
let cached = null;

async function fetchMacFocus() {
  if (process.platform !== 'darwin') return null;
  if (cached && (Date.now() - cached.at) < CACHE_MS) {
    status.cacheHit('mac_focus');
    return cached.data;
  }
  const t0 = Date.now();
  try {
    const p = path.join(os.homedir(),
      'Library/DoNotDisturb/DB/Assertions.json');
    const raw = await fs.readFile(p, 'utf8');
    const data = JSON.parse(raw);
    const records = data && data.data && data.data[0]
      && data.data[0].storeAssertionRecords;
    if (!Array.isArray(records) || records.length === 0) {
      const out = { active: false, modeId: null };
      cached = { at: Date.now(), data: out };
      status.record('mac_focus', { ok: true, ms: Date.now() - t0 });
      return out;
    }
    const first = records[0];
    const modeId = (first.assertionDetails
      && first.assertionDetails.assertionDetailsModeIdentifier) || 'Focus';
    const out = { active: true, modeId };
    cached = { at: Date.now(), data: out };
    status.record('mac_focus', { ok: true, ms: Date.now() - t0 });
    return out;
  } catch (err) {
    status.record('mac_focus', { ok: false, ms: Date.now() - t0, err: err.message });
    return null;
  }
}

module.exports = { fetchMacFocus };

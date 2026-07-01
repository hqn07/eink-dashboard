// Firmware OTA helpers. The device hits /api/firmware/manifest with its
// board + current version; if a newer <board>-<major>.<minor>.<patch>.bin
// exists in public/firmware, the manifest points it at /firmware/<file>.
// Pure filesystem/semver logic — the Express routes stay in server.js.

const path = require('path');
const fsp = require('fs/promises');

const FW_DIR = path.join(__dirname, '..', 'public', 'firmware');
const FW_NAME_RE = /^([a-z0-9]+)-(\d+)\.(\d+)\.(\d+)\.bin$/;

function parseSemver(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(s || ''));
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}
function cmpSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

async function findNewestFirmware(board) {
  let entries;
  try {
    entries = await fsp.readdir(FW_DIR);
  } catch (_) {
    return null;
  }
  let best = null;
  for (const name of entries) {
    const m = FW_NAME_RE.exec(name);
    if (!m) continue;
    if (m[1] !== board) continue;
    const ver = [parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10)];
    if (!best || cmpSemver(ver, best.ver) > 0) {
      best = { name, ver, version: `${ver[0]}.${ver[1]}.${ver[2]}` };
    }
  }
  return best;
}

module.exports = { FW_DIR, FW_NAME_RE, parseSemver, cmpSemver, findNewestFirmware };

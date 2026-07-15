// "Beam to display" — a short-lived message that takes over the whole
// panel. POST /api/beam stores it here; the SSR path renders it instead
// of the widget grid until it expires, and the fast-wake window makes
// the device pick it up on its next wake instead of a full sleep cycle.
const fsp = require('fs/promises');
const path = require('path');
const { DATA_DIR, atomicWriteFile } = require('./store');

const BEAM_PATH = path.join(DATA_DIR, 'beam.json');
const MAX_TEXT = 500;
const MAX_MINUTES = 240;

let _cache; // undefined = not loaded; null = none

async function loadBeam() {
  if (_cache !== undefined) return _cache;
  try {
    _cache = JSON.parse(await fsp.readFile(BEAM_PATH, 'utf8'));
  } catch {
    _cache = null;
  }
  return _cache;
}

// Active beam or null. Expiry is checked here so callers never render a
// stale one; the file is left in place (harmless) until the next set/clear.
async function getActiveBeam() {
  const b = await loadBeam();
  if (!b || typeof b.text !== 'string' || !b.text.trim()) return null;
  if (!Number.isFinite(b.until) || Date.now() >= b.until) return null;
  return b;
}

async function setBeam({ text, minutes }) {
  const t = String(text || '').trim().slice(0, MAX_TEXT);
  if (!t) return null;
  const mins = Math.min(MAX_MINUTES, Math.max(1, Number(minutes) || 10));
  const beam = { text: t, at: Date.now(), until: Date.now() + mins * 60000, minutes: mins };
  _cache = beam;
  await atomicWriteFile(BEAM_PATH, JSON.stringify(beam));
  return beam;
}

async function clearBeam() {
  _cache = null;
  await atomicWriteFile(BEAM_PATH, 'null');
}

module.exports = { getActiveBeam, setBeam, clearBeam, MAX_TEXT, MAX_MINUTES };

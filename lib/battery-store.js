// Battery telemetry persistence. The ESP32 POSTs once per wake; we persist to
// disk so the value survives a server restart (the panel only reports every
// ~30 min, so an in-memory-only value would be stale after every redeploy).
// Also maintains a rolling history for the sparkline widget. Owns its state.
const fsp = require('fs/promises');
const { BATTERY_PATH, BATTERY_HISTORY_PATH, atomicWriteFile } = require('./store');

let _batteryState = null; // { v, pct, at } or null until first POST

async function loadBatteryState() {
  if (_batteryState !== null) return _batteryState;
  try {
    const raw = await fsp.readFile(BATTERY_PATH, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && Number.isFinite(obj.v) && Number.isFinite(obj.pct) && Number.isFinite(obj.at)) {
      _batteryState = obj;
    } else {
      _batteryState = null;
    }
  } catch {
    _batteryState = null;
  }
  return _batteryState;
}

async function saveBatteryState(state) {
  _batteryState = state;
  try {
    await atomicWriteFile(BATTERY_PATH, JSON.stringify(state));
  } catch (err) {
    console.warn('Battery persist failed:', err.message);
  }
  // Append to the rolling history (sparkline). Best-effort, de-duped on `at`,
  // capped — a failure here must never block the save.
  appendBatteryHistory(state).catch(e => console.warn('battery-history:', e.message));
}

// Synchronous accessor for the cached value (used by the refresh calc, which
// runs in a hot request path and can't await).
function currentBatteryState() { return _batteryState; }

const BATTERY_HISTORY_MAX = 96;   // ~2 days at a 30-min refresh
let _batteryHistory = null;       // [{ pct, v, at }] oldest→newest

async function loadBatteryHistory() {
  if (_batteryHistory !== null) return _batteryHistory;
  try {
    const arr = JSON.parse(await fsp.readFile(BATTERY_HISTORY_PATH, 'utf8'));
    _batteryHistory = Array.isArray(arr) ? arr : [];
  } catch { _batteryHistory = []; }
  return _batteryHistory;
}

let _batHistChain = Promise.resolve();
function appendBatteryHistory(state) {
  // Serialize so two near-simultaneous pushes can't clobber the file.
  _batHistChain = _batHistChain.then(async () => {
    if (!state || !Number.isFinite(state.pct) || !Number.isFinite(state.at)) return;
    const hist = await loadBatteryHistory();
    const last = hist[hist.length - 1];
    if (last && last.at === state.at) return;   // dedupe identical timestamp
    hist.push({ pct: state.pct, v: state.v, at: state.at });
    while (hist.length > BATTERY_HISTORY_MAX) hist.shift();
    _batteryHistory = hist;
    await atomicWriteFile(BATTERY_HISTORY_PATH, JSON.stringify(hist));
  }, () => {});
  return _batHistChain;
}

module.exports = {
  loadBatteryState, saveBatteryState, currentBatteryState,
  loadBatteryHistory, appendBatteryHistory,
};

// Refresh-cadence policy: what sleep interval the device should use right now,
// plus the push-now fast-refresh window. Precedence in effectiveRefresh:
//   1. push-now fast window (user-initiated, brief, ignores everything)
//   2. quiet hours (sleep through to the window end)
//   3. battery-aware floor (stretch interval when low)
//   4. the config/schedule interval
// Owns the fast-window timestamp; everything else is derived from config +
// the last battery report.
const { parseHHMM, localMinutesNow } = require('./timewin');
const { invalidateImage } = require('./render');
const { currentBatteryState } = require('./battery-store');
const { resolveRefreshMinutes } = require('./screens');
const { homeValue, homeCoords } = require('./home');
const { currentNight } = require('./sun');

// ---------- Push-now / fast-refresh window ----------
// A deep-sleeping ESP32 can't be reached mid-sleep, so "push now" instead
// shortens the refresh cadence for a short window: the device's NEXT wake is
// told to poll fast for FAST_WINDOW_MS, then returns to the normal interval.
const FAST_WINDOW_MS = Math.max(
  30_000, parseInt(process.env.PUSH_WINDOW_MS, 10) || 5 * 60_000
);
const FAST_INTERVAL_SECONDS = Math.max(
  10, parseInt(process.env.PUSH_INTERVAL_SECONDS, 10) || 20
);
let fastWakeUntil = 0; // epoch ms; while now < this, serve the fast interval
function getFastWakeUntil() { return fastWakeUntil; }

function pushNow() {
  fastWakeUntil = Date.now() + FAST_WINDOW_MS;
  invalidateImage(); // re-render + re-warm so the fast poll serves fresh pixels
  return fastWakeUntil;
}

// ---------- Battery-aware refresh ----------
// On low battery, stretch the sleep interval so the cell lasts longer. We RAISE
// a floor rather than scale, so a config interval longer than the floor is
// never shortened. Disable with BATTERY_AWARE=0.
const BATTERY_AWARE = process.env.BATTERY_AWARE !== '0';

// Minimum refresh interval (minutes) for a given battery %, or 0 when the
// battery is fine / unknown (no stretch). pct === -1/null = unknown.
function batteryRefreshFloor(pct) {
  if (!BATTERY_AWARE || !Number.isFinite(pct) || pct < 0) return 0;
  if (pct < 10) return 240; // <10% → at most every 4h
  if (pct < 20) return 120; // <20% → at most every 2h
  if (pct < 35) return 60;  // <35% → at most every 1h
  return 0;
}

// ---------- Quiet hours ----------
// A nightly window where the device should barely wake. During it we tell the
// device to sleep straight through to the window's end instead of refreshing
// on the normal cadence.
//
//   cfg.quietHours = {
//     enabled, mode: 'fixed' | 'sun',
//     from, to,                            // fixed: local clock times, tz-aware
//     afterSunsetMin, beforeSunriseMin,    // sun: offsets around the real night
//   }
//
// `sun` mode exists because the useful window is not a clock time — it is
// "while the panel is unreadable", which moves by hours across the year. On a
// fixed 01:00-06:00 window a December evening still burns wakes from 17:00,
// and a June morning sleeps through an hour of daylight.

// No single quiet sleep may exceed this, in EITHER mode.
//
// The device cannot be reached while it sleeps, so a bad window — a wrong
// timezone, a clock skew, an arithmetic slip in the sun maths — silently takes
// the panel off the air for as long as the number it was handed. Capping means
// the worst case is that it wakes, re-evaluates, and sleeps again: one or two
// extra wakes a night against a bounded blast radius. Cheap insurance for a
// decision made hours before its consequence shows up.
const QUIET_MAX_SLEEP_MIN = Math.max(
  15, parseInt(process.env.QUIET_MAX_SLEEP_MIN, 10) || 240
);

function clampQuiet(mins) {
  return mins > 0 ? Math.min(mins, QUIET_MAX_SLEEP_MIN) : 0;
}

// Fixed clock window, in the panel's timezone.
function fixedQuietMinutes(q, cfg) {
  const from = parseHHMM(q.from), to = parseHHMM(q.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return 0;
  const now = localMinutesNow(homeValue(cfg, 'timezone') || 'UTC');
  const inWindow = from < to ? (now >= from && now < to)
                             : (now >= from || now < to); // wraps past midnight
  if (!inWindow) return 0;
  const mins = ((to - now) + 1440) % 1440; // minutes until the window ends
  return mins > 0 ? mins : 1440;
}

// Sun-driven window: sunset + afterSunsetMin  ->  sunrise - beforeSunriseMin.
//
// Works entirely in epoch ms, which sidesteps timezone arithmetic completely —
// lib/sun.js returns absolute instants, so there is no local-midnight wrap to
// get wrong and no dependence on cfg.timezone being right.
function sunQuietMinutes(q, cfg) {
  const coords = homeCoords(cfg);
  if (!coords) return 0;            // no location -> behave as if disabled
  const now = Date.now();
  const night = currentNight(now, coords.lat, coords.lon);
  if (!night) return 0;             // daytime, or polar day/night: no window

  const after  = clampOffset(q.afterSunsetMin,   DEFAULT_SUNSET_OFFSET_MIN);
  const before = clampOffset(q.beforeSunriseMin, DEFAULT_SUNRISE_OFFSET_MIN);
  const start = night.start + after * 60000;
  const end   = night.end   - before * 60000;
  // Offsets can be big enough to swallow a short summer night entirely.
  if (!(end > start) || now < start || now >= end) return 0;
  return Math.ceil((end - now) / 60000);
}

const DEFAULT_SUNSET_OFFSET_MIN = 60;
const DEFAULT_SUNRISE_OFFSET_MIN = 60;
function clampOffset(v, fallback) {
  const n = parseInt(v, 10);
  // 0-180 min. Negative would start the window before sunset, i.e. while the
  // panel is still readable, which is never what this setting means.
  return Number.isFinite(n) ? Math.max(0, Math.min(180, n)) : fallback;
}

function quietMinutesRemaining(cfg) {
  const q = cfg && cfg.quietHours;
  if (!q || !q.enabled) return 0;
  const mins = q.mode === 'sun' ? sunQuietMinutes(q, cfg) : fixedQuietMinutes(q, cfg);
  return clampQuiet(mins);
}

// Refresh cadence the device should use right now. Returns minutes (legacy
// X-Refresh-Rate, floored at 1) and exact seconds (X-Refresh-Seconds). battPct
// defaults to the last reported battery so /sleep and the warmer agree.
function effectiveRefresh(cfg, battPct) {
  if (Date.now() < fastWakeUntil) {
    return { minutes: 1, seconds: FAST_INTERVAL_SECONDS, fast: true, battSaver: false, quiet: false };
  }
  const batt = currentBatteryState();
  const pct = Number.isFinite(battPct) ? battPct
    : (batt && Number.isFinite(batt.pct) ? batt.pct : -1);
  const base = resolveRefreshMinutes(cfg);
  const battFloor = batteryRefreshFloor(pct);
  const quiet = quietMinutesRemaining(cfg);
  const minutes = Math.min(1440, Math.max(base, battFloor, quiet));
  return {
    minutes, seconds: minutes * 60, fast: false,
    battSaver: battFloor > base, quiet: quiet > 0
  };
}

module.exports = {
  pushNow, effectiveRefresh, batteryRefreshFloor, quietMinutesRemaining,
  getFastWakeUntil, FAST_WINDOW_MS, FAST_INTERVAL_SECONDS,
  QUIET_MAX_SLEEP_MIN,
};

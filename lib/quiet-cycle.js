// Temporary "make the wake cycle as short as possible" switch.
//
// WHY THIS EXISTS. The firmware's staged button-hold (open the WiFi portal,
// which ends in ESP.restart()) starts its 2-second timer only AFTER runCycle
// returns — see the comment in loop(). runCycle is normally ~35 s, because the
// tri-colour panel takes ~26 s to draw, so the real-world hold is ~37 s, and
// more while a device is also re-downloading an OTA it cannot apply. That is a
// miserable thing to ask someone to do with a button.
//
// Both costs are server-side decisions, so the server can remove them:
//   - answer 304 to any conditional image request, so the device skips the
//     colour refresh entirely
//   - stop offering firmware, so it skips the download
// The cycle collapses to a WiFi connect plus three tiny requests, a few
// seconds, and the hold window opens almost immediately.
//
// Suppressing the OTA offer loses nothing: an already-downloaded image is
// written to the inactive slot and the boot partition is already pointed at it
// by Update.end(). The pending update survives in flash; we are only declining
// to send it again.
//
// ALWAYS deadline-bound. While this is on the panel is deliberately frozen, so
// it must expire on its own — a flag that could be left set would be exactly
// the "confidently stale display" failure the staleness marker exists to
// catch.
const MAX_MINUTES = 30;
const DEFAULT_MINUTES = 15;

let until = 0;
let reason = '';
// Freeze the panel (304 every image request) but KEEP offering firmware.
//
// This is the interesting combination. downloadImage() allocates the 96000-byte
// frame buffer up front and only frees it after pushImage(); a 304 returns
// before any of that, so the cycle never allocates the big buffer and never
// draws. checkForUpdate then runs on a heap that has not been churned — which
// is the one thing that differs between the OTA writes that used to succeed
// (before the call moved after the draw) and the ones failing now.
//
// `suppressFirmware` is the opposite switch and stays off for this: we WANT
// the download to happen, just under better conditions.
let freezeImage = false;
let suppressFirmware = false;

function startQuietCycle(minutes, why, opts = {}) {
  const m = Math.min(MAX_MINUTES, Math.max(1, parseInt(minutes, 10) || DEFAULT_MINUTES));
  until = Date.now() + m * 60 * 1000;
  reason = String(why || '').slice(0, 120);
  freezeImage = opts.freeze !== false;              // default on
  suppressFirmware = opts.suppressFirmware === true; // default OFF
  return quietCycleStatus();
}

function quietFreezesImage() { return quietCycleActive() && freezeImage; }
function quietSuppressesFirmware() { return quietCycleActive() && suppressFirmware; }

function stopQuietCycle() {
  until = 0;
  reason = '';
  freezeImage = false;
  suppressFirmware = false;
  return quietCycleStatus();
}

function quietCycleActive() {
  return Date.now() < until;
}

function quietCycleStatus() {
  const active = quietCycleActive();
  return {
    active,
    secondsRemaining: active ? Math.round((until - Date.now()) / 1000) : 0,
    reason: active ? reason : null,
    freezeImage: active && freezeImage,
    suppressFirmware: active && suppressFirmware,
    maxMinutes: MAX_MINUTES,
  };
}

module.exports = {
  startQuietCycle, stopQuietCycle, quietCycleActive, quietCycleStatus,
  quietFreezesImage, quietSuppressesFirmware,
  QUIET_MAX_MINUTES: MAX_MINUTES,
};

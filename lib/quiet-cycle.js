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

function startQuietCycle(minutes, why) {
  const m = Math.min(MAX_MINUTES, Math.max(1, parseInt(minutes, 10) || DEFAULT_MINUTES));
  until = Date.now() + m * 60 * 1000;
  reason = String(why || '').slice(0, 120);
  return quietCycleStatus();
}

function stopQuietCycle() {
  until = 0;
  reason = '';
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
    maxMinutes: MAX_MINUTES,
  };
}

module.exports = {
  startQuietCycle, stopQuietCycle, quietCycleActive, quietCycleStatus,
  QUIET_MAX_MINUTES: MAX_MINUTES,
};

// One answer to "is the panel alive, and when will it next pick anything up?"
//
// Three surfaces need it — the header chip, the Device status card, and the
// needs-attention strip — and before this each one worked it out for itself.
// That is the same hand-rebuilt-at-a-call-site shape that made the preview
// lie in `193b74b`, so the rule here matches the rest of the codebase: derive
// once, let the surfaces add only their own presentation.
//
// The honest part of this module is `nextWakeAt`. A deep-sleeping ESP32
// cannot be woken remotely — "Push now" only opens a window the device
// enters when it next wakes on its own — so the question a user actually has
// is "when will the panel show this?", and the answer is the device's last
// check-in plus its refresh interval. Showing that turns a dashboard that
// looks broken into one that is visibly just asleep.

export const DEFAULT_REFRESH_MIN = 30;

// Relative time, coarse on purpose: nobody needs seconds on a panel that
// wakes twice an hour.
export function ago(at, now) {
  if (!Number.isFinite(at) || at <= 0) return null;
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Forward-looking counterpart. Past due reads as "due now" rather than a
// negative number — the device is late, not travelling backwards.
export function until(at, now) {
  if (!Number.isFinite(at) || at <= 0) return null;
  const s = Math.floor((at - now) / 1000);
  if (s <= 0) return 'due now';
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  return `in ${h}h`;
}

// { devices, battery, refreshMinutes, now } -> presence facts.
//
// Freshest signal wins: an enrolled device's check-in, or a battery push
// (which covers pre-enrollment firmware that only ever POSTs battery).
export function presenceFrom({ devices, battery, refreshMinutes, now }) {
  const seenAts = [
    ...(devices || []).map(d => Date.parse((d && d.last_seen_at) || '') || 0),
    (battery && Number.isFinite(battery.at)) ? battery.at : 0,
  ];
  const lastSeen = Math.max(...seenAts, 0);
  const cadenceMin = Number.isFinite(refreshMinutes) && refreshMinutes > 0
    ? refreshMinutes : DEFAULT_REFRESH_MIN;

  // Stale = missed ~3 wake cycles. Battery-saver stretches the cadence, so
  // leave slack before calling a healthy panel offline.
  const staleAfterMs = (cadenceMin * 3 + 5) * 60000;
  const everSeen = lastSeen > 0;
  const nextWakeAt = everSeen ? lastSeen + cadenceMin * 60000 : 0;

  return {
    everSeen,
    lastSeen,
    cadenceMin,
    nextWakeAt,
    stale: everSeen ? (now - lastSeen) > staleAfterMs : true,
    overdue: everSeen && now > nextWakeAt,
    lastSeenLabel: everSeen ? ago(lastSeen, now) : 'never',
    nextWakeLabel: everSeen ? until(nextWakeAt, now) : null,
  };
}

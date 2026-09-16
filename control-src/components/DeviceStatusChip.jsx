// Header chip: is the panel alive? Battery %, last-seen freshness, fw
// version — the telemetry that otherwise hides on /status. Clicking
// opens the full status page. Renders nothing until the first poll
// lands so a fresh install's header stays clean.

import React from 'react';
import { statusPageUrl } from '../api.js';
import { presenceFrom } from '../device-presence.js';

export default function DeviceStatusChip({ refreshMinutes, telemetry }) {
  const { battery, devices, now } = telemetry;

  const { lastSeen, stale, lastSeenLabel: seenLabel } =
    presenceFrom({ devices, battery, refreshMinutes, now });
  const fw = devices.map(d => d.fw_version).filter(Boolean).sort().pop() || null;
  const pct = battery && Number.isFinite(battery.pct) ? Math.round(battery.pct) : null;

  // Never reported → nothing to show (fresh install).
  if (!lastSeen && pct == null) return null;

  return (
    <a
      className={`device-chip ${stale ? 'device-chip-stale' : ''}`}
      href={statusPageUrl()}
      target="_blank"
      rel="noopener"
      title={`Panel ${stale ? 'has not checked in recently' : 'checking in normally'} — open /status`}
    >
      <span className="sync-dot" aria-hidden="true" />
      <span className="device-chip-label">{stale ? 'PANEL OFFLINE?' : 'PANEL'}</span>
      {pct != null && <span className="device-chip-part">{pct}%</span>}
      <span className="device-chip-part">{seenLabel}</span>
      {fw && <span className="device-chip-part device-chip-fw">fw {fw}</span>}
    </a>
  );
}

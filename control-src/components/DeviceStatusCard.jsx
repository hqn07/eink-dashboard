// Compact device-status readout — the telemetry that otherwise hides on the
// admin-only /status page: battery, when the panel last checked in, and when
// it is next expected to.
//
// "Next wake" is the row that matters. A deep-sleeping ESP32 cannot be woken
// remotely, so a saved change does not appear on the glass until the device
// comes looking for it. Without this row a working dashboard looks broken for
// up to a full refresh interval; with it, the wait is visible and expected.

import React from 'react';
import { presenceFrom } from '../device-presence.js';

export default function DeviceStatusCard({ refreshMinutes, telemetry }) {
  const { battery, devices, now } = telemetry;
  const p = presenceFrom({ devices, battery, refreshMinutes, now });
  const hasBattery = battery && Number.isFinite(battery.pct);

  const rows = [
    {
      k: 'E-ink battery',
      v: hasBattery
        ? `${battery.pct}%${Number.isFinite(battery.v) ? ` · ${battery.v.toFixed(2)}V` : ''}`
        : 'no data',
      sub: null
    },
    {
      k: 'Last seen',
      v: p.lastSeenLabel,
      sub: p.stale && p.everSeen ? 'looks offline' : null
    },
    {
      k: 'Next wake',
      // Overdue is not an error: battery-saver and quiet hours both stretch
      // the interval, so say it is late rather than implying it is lost.
      v: !p.everSeen ? '—' : (p.overdue ? 'due now' : p.nextWakeLabel),
      sub: p.everSeen ? `every ${p.cadenceMin}m` : null
    }
  ];

  return (
    <div className="device-status-card">
      <div className="device-status-title">Device status</div>
      {rows.map(r => (
        <div className="device-status-row" key={r.k}>
          <span className="device-status-key">{r.k}</span>
          <span className="device-status-val">
            {r.v}
            {r.sub && <span className="device-status-sub"> · {r.sub}</span>}
          </span>
        </div>
      ))}
      <div className="device-status-note">
        Saved changes appear at the next wake — the panel sleeps and cannot be
        woken remotely.
      </div>
    </div>
  );
}

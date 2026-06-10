// Compact device-status readout under the Live Preview pane — surfaces
// the telemetry that otherwise hides in header pills: ESP32 battery
// (last push), the screen's refresh cadence, and mac-agent freshness.

import React, { useEffect, useState } from 'react';
import { fetchBattery, fetchMacState } from '../api.js';

const POLL_MS = 30000;

function ago(at, now) {
  if (!Number.isFinite(at)) return '—';
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function DeviceStatusCard({ refreshMinutes }) {
  const [battery, setBattery] = useState(null);   // { v, pct, at } | null
  const [macAt, setMacAt] = useState(null);       // timestamp | null
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      const [b, m] = await Promise.allSettled([fetchBattery(), fetchMacState()]);
      if (cancelled) return;
      if (b.status === 'fulfilled') setBattery(b.value);
      if (m.status === 'fulfilled') setMacAt(m.value && m.value.at);
      setNow(Date.now());
    };
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Advance the "ago" labels between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);

  const hasBattery = battery && Number.isFinite(battery.pct);
  const rows = [
    {
      k: 'E-INK BATTERY',
      v: hasBattery
        ? `${battery.pct}%${Number.isFinite(battery.v) ? ` · ${battery.v.toFixed(2)}V` : ''}`
        : 'no data',
      sub: hasBattery ? ago(battery.at, now) : null
    },
    {
      k: 'REFRESH',
      v: Number.isFinite(refreshMinutes) ? `every ${refreshMinutes}m` : '—',
      sub: null
    },
    {
      k: 'MAC AGENT',
      v: macAt ? ago(macAt, now) : 'never',
      sub: null
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
    </div>
  );
}

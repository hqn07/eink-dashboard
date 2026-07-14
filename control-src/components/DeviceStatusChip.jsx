// Header chip: is the panel alive? Battery %, last-seen freshness, fw
// version — the telemetry that otherwise hides on /status. Clicking
// opens the full status page. Renders nothing until the first poll
// lands so a fresh install's header stays clean.

import React, { useEffect, useState } from 'react';
import { fetchBattery, fetchDevices, statusPageUrl } from '../api.js';

const POLL_MS = 60000;

function ago(at, now) {
  if (!Number.isFinite(at)) return null;
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function DeviceStatusChip({ refreshMinutes }) {
  const [battery, setBattery] = useState(null);  // { v, pct, at } | null
  const [devices, setDevices] = useState([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      const [b, d] = await Promise.allSettled([fetchBattery(), fetchDevices()]);
      if (cancelled) return;
      if (b.status === 'fulfilled') setBattery(b.value);
      if (d.status === 'fulfilled') setDevices((d.value && d.value.devices) || []);
      setNow(Date.now());
    };
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  // Freshest signal wins: enrolled-device check-in or a battery push
  // (covers pre-enrollment firmware that only POSTs battery).
  const seenAts = [
    ...devices.map(d => Date.parse(d.last_seen_at || '') || 0),
    (battery && Number.isFinite(battery.at)) ? battery.at : 0,
  ];
  const lastSeen = Math.max(...seenAts, 0);
  const fw = devices.map(d => d.fw_version).filter(Boolean).sort().pop() || null;
  const pct = battery && Number.isFinite(battery.pct) ? Math.round(battery.pct) : null;

  // Never reported → nothing to show (fresh install).
  if (!lastSeen && pct == null) return null;

  // Stale = missed ~3 wake cycles (battery-saver stretches the cadence,
  // so leave slack before shouting OFFLINE).
  const cadenceMin = Number.isFinite(refreshMinutes) ? refreshMinutes : 30;
  const stale = lastSeen ? (now - lastSeen) > (cadenceMin * 3 + 5) * 60000 : true;
  const seenLabel = lastSeen ? ago(lastSeen, now) : 'never';

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

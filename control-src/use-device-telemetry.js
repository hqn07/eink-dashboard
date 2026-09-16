// One poll of the device's telemetry, shared by everything that displays it.
//
// The header chip polled every 60s and the Device status card every 30s, each
// fetching the same two endpoints and each deriving freshness its own way.
// Adding the needs-attention strip would have made three. This hook is the
// single fetch; `presenceFrom()` in device-presence.js is the single
// derivation; the components are left with only their own presentation.

import { useEffect, useState } from 'react';
import { fetchBattery, fetchDevices } from './api.js';

const POLL_MS = 30000;
// Relative labels ("4m ago", "in 12m") have to move between polls or a
// countdown sits still and reads as broken.
const TICK_MS = 10000;

export function useDeviceTelemetry() {
  const [battery, setBattery] = useState(null);   // { v, pct, at } | null
  const [devices, setDevices] = useState([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      // allSettled: a failing /api/devices must not also blank the battery.
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
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return { battery, devices, now };
}

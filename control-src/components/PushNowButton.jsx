import React, { useState } from 'react';
import { Lightning } from '@phosphor-icons/react';

// "Push now" — opens a server-side fast-refresh window so the device picks
// up the latest render quickly instead of waiting out its full sleep
// interval. A deep-sleeping ESP32 can't be woken remotely, so the device
// still has to wake once to enter the window; we surface that worst-case
// latency in the confirmation text.
export default function PushNowButton({ block = false }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const push = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch('/api/wake', { method: 'POST' });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error();
      const mins = d.maxLatencyMinutes || 0;
      setMsg(mins > 1
        ? `Queued — updates within ~${mins} min, then fast`
        : 'Queued — device will refresh shortly');
    } catch {
      setMsg('Failed — try again');
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(''), 6000);
    }
  };

  return (
    <>
      <button
        type="button"
        className={block ? 'settings-row' : 'app-header-shortcut-btn'}
        onClick={push}
        disabled={busy}
        title="Open a fast-refresh window so the device updates soon"
      >
        <Lightning size={14} weight="bold" /> {busy ? 'Pushing…' : 'Push now'}
      </button>
      {msg && <div className="settings-row-note">{msg}</div>}
    </>
  );
}

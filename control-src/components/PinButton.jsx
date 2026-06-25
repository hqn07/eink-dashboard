import React, { useEffect, useRef, useState } from 'react';

// Control-panel PIN: set/change/lock from the header. Talks to the
// server's /api/auth/* endpoints. When no PIN is set the button reads
// "Set PIN"; once set it becomes a lock (logout) with a "change" option.
export default function PinButton() {
  const [status, setStatus] = useState(null); // { configured, authed }
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(null);

  const refresh = () =>
    fetch('/api/auth/status').then(r => r.json()).then(setStatus).catch(() => {});

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!status) return null;

  const savePin = async () => {
    setErr('');
    if (pin.length < 4) { setErr('Min 4 digits'); return; }
    setBusy(true);
    const r = await fetch('/api/auth/set-pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    setBusy(false);
    if (r.ok) { setPin(''); setOpen(false); refresh(); }
    else setErr('Could not set PIN');
  };

  const lock = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/control/login';
  };

  const label = status.configured ? '🔒 Lock' : 'Set PIN';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="app-header-shortcut-btn"
        onClick={() => (status.configured ? lock() : setOpen(o => !o))}
        title={status.configured ? 'Lock the control panel' : 'Set a PIN to protect the editor'}
        style={{ width: 'auto', padding: '0 10px' }}
      >
        {label}
      </button>
      {open && !status.configured && (
        <div
          style={{
            position: 'absolute', right: 0, top: '110%', zIndex: 50,
            background: '#fff', border: '1.5px solid #111', padding: 12,
            width: 200, display: 'flex', flexDirection: 'column', gap: 8,
            boxShadow: '4px 4px 0 rgba(0,0,0,0.15)'
          }}
        >
          <label style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
            New PIN (4+ digits)
          </label>
          <input
            type="password" inputMode="numeric" autoFocus value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && savePin()}
            style={{ padding: 8, fontSize: 16, letterSpacing: 3, border: '1.5px solid #111' }}
          />
          {err && <div style={{ color: '#b00', fontSize: 11 }}>{err}</div>}
          <button type="button" onClick={savePin} disabled={busy}
            style={{ padding: 8, background: '#111', color: '#fff', border: 0, cursor: 'pointer' }}>
            {busy ? 'Saving…' : 'Save PIN'}
          </button>
        </div>
      )}
    </div>
  );
}

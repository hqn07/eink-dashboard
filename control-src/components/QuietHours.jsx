import React from 'react';
import { Moon } from '@phosphor-icons/react';

// Quiet hours: a nightly window where the device sleeps straight through to
// the window's end instead of refreshing on the normal cadence — saves
// overnight battery. Global (not per-screen). Edits cfg.quietHours.
export default function QuietHours({ value, onChange }) {
  const q = value || { enabled: false, from: '01:00', to: '06:00' };
  const set = (patch) => onChange({ ...q, ...patch });

  return (
    <div className="quiet-hours">
      <label className="quiet-hours-toggle">
        <input
          type="checkbox"
          checked={!!q.enabled}
          onChange={e => set({ enabled: e.target.checked })}
        />
        <Moon size={14} weight="bold" />
        <span>Quiet hours</span>
      </label>
      <div className={`quiet-hours-times ${q.enabled ? '' : 'is-disabled'}`}>
        <input
          type="time"
          value={q.from || '01:00'}
          disabled={!q.enabled}
          onChange={e => set({ from: e.target.value })}
          aria-label="Quiet hours start"
        />
        <span className="quiet-hours-dash">→</span>
        <input
          type="time"
          value={q.to || '06:00'}
          disabled={!q.enabled}
          onChange={e => set({ to: e.target.value })}
          aria-label="Quiet hours end"
        />
        <span className="quiet-hours-note">device sleeps through</span>
      </div>
    </div>
  );
}

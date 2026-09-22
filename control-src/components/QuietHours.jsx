import React from 'react';
import { Moon, Sun, Clock } from '@phosphor-icons/react';

// Quiet hours: a nightly window where the device sleeps straight through to
// the window's end instead of refreshing on the normal cadence — saves
// overnight battery. Global (not per-screen). Edits cfg.quietHours.
//
// Two modes. `sun` is the useful one: the window you actually want is "while
// the panel is unreadable", and that moves by hours across the year, so a fixed
// 01:00–06:00 still burns wakes through a dark December evening and sleeps
// through an hour of June daylight. `fixed` stays for people who want the panel
// quiet on a schedule rather than on the light.
export default function QuietHours({ value, onChange, hasLocation }) {
  const q = value || {};
  const mode = q.mode === 'sun' ? 'sun' : 'fixed';
  const set = (patch) => onChange({ ...q, ...patch });
  const num = (v, fallback) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : fallback);

  return (
    <div className="quiet-hours">
      <label className="quiet-hours-toggle">
        <input
          type="checkbox"
          checked={!!q.enabled}
          onChange={e => set({ enabled: e.target.checked })}
        />
        <Moon size={14} weight="bold" />
        {/* The settings row above already names the feature; this is only
            the on/off switch for it. */}
        <span>Enabled</span>
      </label>

      <div className={`quiet-hours-body ${q.enabled ? '' : 'is-disabled'}`}>
        <div className="quiet-hours-modes" role="radiogroup" aria-label="Quiet hours mode">
          <button
            type="button" role="radio" aria-checked={mode === 'sun'}
            className={`quiet-mode ${mode === 'sun' ? 'is-active' : ''}`}
            disabled={!q.enabled}
            onClick={() => set({ mode: 'sun' })}
          >
            <Sun size={13} weight="bold" /> Follow the sun
          </button>
          <button
            type="button" role="radio" aria-checked={mode === 'fixed'}
            className={`quiet-mode ${mode === 'fixed' ? 'is-active' : ''}`}
            disabled={!q.enabled}
            onClick={() => set({ mode: 'fixed' })}
          >
            <Clock size={13} weight="bold" /> Fixed times
          </button>
        </div>

        {mode === 'sun' ? (
          <>
            <div className="quiet-hours-times">
              <input
                type="number" min="0" max="180" step="15"
                value={num(q.afterSunsetMin, 60)}
                disabled={!q.enabled}
                onChange={e => set({ afterSunsetMin: num(e.target.value, 60) })}
                aria-label="Minutes after sunset"
              />
              <span className="quiet-hours-note">min after sunset →</span>
              <input
                type="number" min="0" max="180" step="15"
                value={num(q.beforeSunriseMin, 60)}
                disabled={!q.enabled}
                onChange={e => set({ beforeSunriseMin: num(e.target.value, 60) })}
                aria-label="Minutes before sunrise"
              />
              <span className="quiet-hours-note">min before sunrise</span>
            </div>
            {!hasLocation && (
              <div className="quiet-hours-warn">
                Needs your location — set it in Tools → You &amp; your place.
                Until then the panel keeps its normal cadence.
              </div>
            )}
          </>
        ) : (
          <div className="quiet-hours-times">
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
        )}
      </div>
    </div>
  );
}

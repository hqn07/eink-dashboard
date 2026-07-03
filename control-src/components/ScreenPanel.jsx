import React from 'react';

// Merged Display + Refresh + Schedule for one screen. Sits at the top
// of the settings panel (above shared widget config like message,
// todos, calendar). The DELETE action lives in the preview header
// next to CLEAR/GRID so it's adjacent to the canvas it acts on.
export default function ScreenPanel({ screen, isOverlap, onUpdate, onOpenTimeline }) {
  const sch = screen.schedule || { enabled: false, from: '07:00', to: '22:00' };
  const setSch = (patch) => onUpdate({ schedule: { ...sch, ...patch } });

  return (
    <section className={`card screen-panel ${isOverlap ? 'invalid' : ''}`}>
      <div className="section-title">
        <span>Screen Settings</span>
      </div>

      <label className="field">
        <span className="label">Name</span>
        <input
          type="text"
          value={screen.name || ''}
          onChange={e => onUpdate({ name: e.target.value })}
        />
      </label>

      <div className="toggle-row">
        <span className="toggle-label">Units</span>
        <div className="btn-row" style={{ marginTop: 0 }}>
          {['F', 'C'].map(u => (
            <button
              key={u}
              className={`btn ${(screen.units || 'F') === u ? 'btn-primary' : ''}`}
              onClick={() => onUpdate({ units: u })}
            >°{u}</button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="label">Refresh interval (minutes)</span>
        <input
          type="text"
          value={screen.refreshMinutes ?? 30}
          onChange={e => {
            const n = parseInt(e.target.value, 10);
            onUpdate({ refreshMinutes: Number.isFinite(n) && n > 0 ? n : 30 });
          }}
        />
      </label>

      {/* Schedule is edited on the 24-hour timeline (single source of truth);
          here we show a compact read-only summary + a jump to it. */}
      <div className="field">
        <span className="label">Schedule</span>
        <div className="screen-sched-summary">
          <span className="screen-sched-state">
            {sch.enabled
              ? (sch.from && sch.to && sch.from > sch.to
                  ? `${sch.from}→24:00 · 00:00→${sch.to}`
                  : `${sch.from} → ${sch.to}`)
              : 'Always on (default fallback)'}
          </span>
          <div className="btn-row" style={{ marginTop: 0, gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-compact"
              onClick={() => onOpenTimeline && onOpenTimeline()}>
              Edit on timeline
            </button>
            {sch.enabled && (
              <button type="button" className="btn btn-ghost btn-compact"
                title="Unschedule — this screen falls back to the default"
                onClick={() => setSch({ enabled: false })}>
                Clear
              </button>
            )}
          </div>
        </div>
        {isOverlap && (
          <div className="terminal-line invalid" style={{ marginTop: 4, color: 'var(--accent)' }}>
            &gt; OVERLAPS ANOTHER SCREEN — RESOLVE BEFORE SAVE
          </div>
        )}
      </div>

    </section>
  );
}

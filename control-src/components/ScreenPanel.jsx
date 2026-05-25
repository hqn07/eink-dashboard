import React from 'react';

// Merged Display + Refresh + Schedule for one screen. Sits at the top
// of the settings panel (above shared widget config like message,
// todos, calendar).
export default function ScreenPanel({ screen, isOverlap, onUpdate, onDelete, canDelete }) {
  const sch = screen.schedule || { enabled: false, from: '07:00', to: '22:00' };
  const setSch = (patch) => onUpdate({ schedule: { ...sch, ...patch } });

  return (
    <section className={`card screen-panel ${isOverlap ? 'invalid' : ''}`}>
      <div className="section-title">
        <span>Screen Settings</span>
        <div className="btn-row" style={{ marginTop: 0, gap: 6 }}>
          {canDelete && (
            <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 11 }} onClick={onDelete}>
              DELETE
            </button>
          )}
        </div>
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

      <div className="toggle-row">
        <span className="toggle-label">Schedule this screen</span>
        <div className={`toggle ${sch.enabled ? 'on' : ''}`} onClick={() => setSch({ enabled: !sch.enabled })} />
      </div>

      <div className={`sched-group ${sch.enabled ? '' : 'disabled'}`}>
        <label className="field">
          <span className="label">Active window (24h HH:MM)</span>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <input
              type="text"
              value={sch.from || '07:00'}
              onChange={e => setSch({ from: e.target.value })}
              style={{ flex: 1 }}
              placeholder="07:00"
            />
            <span style={{ alignSelf: 'center', color: 'var(--mute)' }}>→</span>
            <input
              type="text"
              value={sch.to || '22:00'}
              onChange={e => setSch({ to: e.target.value })}
              style={{ flex: 1 }}
              placeholder="22:00"
            />
          </div>
        </label>
        <div className="terminal-line" style={{ fontSize: 10, marginTop: 4 }}>
          {sch.enabled
            ? (sch.from && sch.to && sch.from > sch.to
                ? `> WRAPS_MIDNIGHT — ACTIVE ${sch.from} → 24:00 + 00:00 → ${sch.to}`
                : `> ACTIVE ${sch.from} → ${sch.to}`)
            : '> SCHEDULE_DISABLED'}
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

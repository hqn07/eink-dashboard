import React from 'react';
import { motion } from 'framer-motion';
import { WIDGET_REGISTRY } from '../widgets.js';

function Toggle({ on, onClick }) {
  return <div className={`toggle ${on ? 'on' : ''}`} onClick={onClick} />;
}

export default function Settings({ cfg, layout, onPatch, onPatchNested, onToggleWidget }) {
  const sched = cfg.schedule || {};
  const schedActive = sched.active || { refreshMinutes: 30, screen: 1 };
  const schedQuiet  = sched.quiet  || { refreshMinutes: 120, screen: 2 };

  // Widget config sections only appear when the related widget is on the
  // canvas. Layout is the source of truth; legacy `cfg.widgets` booleans
  // act as a fallback when no layout is set yet.
  const isOn = (id) => {
    // Any instance of this widget type on the canvas counts as "on"
    // for the purpose of showing its config section.
    if (layout.some(l => (l.widgetId || l.id) === id)) return true;
    const def = WIDGET_REGISTRY.find(w => w.id === id);
    if (!def) return false;
    return !!(cfg.widgets && cfg.widgets[def.requires]);
  };
  const showMessage  = isOn('message');
  const showTodos    = isOn('todos');
  const showCalendar = isOn('calendar');
  const showSpacer   = isOn('spacer');
  const showQuote    = isOn('quote');

  const setSchedActive = (patch) => onPatchNested('schedule', {
    ...sched, active: { ...schedActive, ...patch }
  });
  const setSchedQuiet = (patch) => onPatchNested('schedule', {
    ...sched, quiet: { ...schedQuiet, ...patch }
  });

  const ScreenButtons = ({ value, onChange }) => (
    <div className="btn-row" style={{ marginTop: 0 }}>
      {[1, 2].map(s => (
        <button
          key={s}
          className={`btn ${value === s ? 'btn-primary' : ''}`}
          onClick={() => onChange(s)}
        >
          SCR {s}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <section className="card">
        <div className="section-title">Display</div>
        <div className="toggle-row">
          <span className="toggle-label">Units</span>
          <div className="btn-row" style={{ marginTop: 0 }}>
            {['F', 'C'].map(u => (
              <button
                key={u}
                className={`btn ${(cfg.units || 'F') === u ? 'btn-primary' : ''}`}
                onClick={() => onPatch({ units: u })}
              >°{u}</button>
            ))}
          </div>
        </div>
        <div className="toggle-row">
          <span className="toggle-label">Screen</span>
          <ScreenButtons
            value={parseInt(cfg.screen, 10) || 1}
            onChange={s => onPatch({ screen: s })}
          />
        </div>
      </section>

      {showMessage && (
        <section className="card">
          <div className="section-title">Message Widget</div>
          <label className="field">
            <span className="label">Headline</span>
            <input
              type="text"
              value={cfg.message?.text || ''}
              onChange={e => onPatchNested('message', { text: e.target.value })}
              placeholder="Welcome home."
            />
          </label>
          <label className="field">
            <span className="label">Subtitle</span>
            <input
              type="text"
              value={cfg.message?.subtitle || ''}
              onChange={e => onPatchNested('message', { subtitle: e.target.value })}
              placeholder="Optional small text"
            />
          </label>
        </section>
      )}

      {showTodos && (
        <section className="card">
          <div className="section-title">To-Do List</div>
          {(cfg.todos || []).map((t, idx) => (
            <div key={idx} className="todo-row">
              <div
                className={`todo-check ${t.done ? 'done' : ''}`}
                onClick={() => {
                  const todos = [...(cfg.todos || [])];
                  todos[idx] = { ...todos[idx], done: !todos[idx].done };
                  onPatch({ todos });
                }}
              >{t.done ? '✓' : ''}</div>
              <input
                type="text"
                value={t.text}
                onChange={e => {
                  const todos = [...(cfg.todos || [])];
                  todos[idx] = { ...todos[idx], text: e.target.value };
                  onPatch({ todos });
                }}
              />
              <button
                className="btn btn-danger"
                style={{ padding: '6px 10px' }}
                onClick={() => {
                  const todos = (cfg.todos || []).filter((_, i) => i !== idx);
                  onPatch({ todos });
                }}
              >×</button>
            </div>
          ))}
          <div className="btn-row">
            <button className="btn" onClick={() => onPatch({
              todos: [...(cfg.todos || []), { text: '', done: false }]
            })}>+ Add item</button>
          </div>
        </section>
      )}

      {showCalendar && (
        <section className="card">
          <div className="section-title">Calendar</div>
          <label className="field">
            <span className="label">iCal URL</span>
            <input
              type="url"
              value={cfg.calendar?.icalUrl || ''}
              onChange={e => onPatchNested('calendar', { icalUrl: e.target.value })}
              placeholder="https://calendar.google.com/calendar/ical/..."
            />
          </label>
        </section>
      )}

      {showSpacer && (
        <section className="card">
          <div className="section-title">Black Bar</div>
          <label className="field">
            <span className="label">Label (optional)</span>
            <input
              type="text"
              value={cfg.spacer?.text || ''}
              onChange={e => onPatchNested('spacer', { text: e.target.value })}
              placeholder="e.g. GOOD MORNING"
            />
          </label>
          <div className="toggle-row">
            <span className="toggle-label">Invert (white bar, black text)</span>
            <Toggle
              on={!!cfg.spacer?.invert}
              onClick={() => onPatchNested('spacer', { invert: !cfg.spacer?.invert })}
            />
          </div>
        </section>
      )}

      {showQuote && (
        <section className="card">
          <div className="section-title">Text / Quote</div>
          <label className="field">
            <span className="label">Body</span>
            <textarea
              value={cfg.quote?.text || ''}
              onChange={e => onPatchNested('quote', { text: e.target.value })}
              placeholder="Make each day your masterpiece."
            />
          </label>
          <label className="field">
            <span className="label">Attribution (optional)</span>
            <input
              type="text"
              value={cfg.quote?.attribution || ''}
              onChange={e => onPatchNested('quote', { attribution: e.target.value })}
              placeholder="John Wooden"
            />
          </label>
          <div className="toggle-row">
            <span className="toggle-label">Alignment</span>
            <div className="btn-row" style={{ marginTop: 0 }}>
              {['left', 'center', 'right'].map(a => (
                <button
                  key={a}
                  className={`btn ${(cfg.quote?.align || 'center') === a ? 'btn-primary' : ''}`}
                  onClick={() => onPatchNested('quote', { align: a })}
                >{a.toUpperCase()}</button>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="section-title">Location &amp; Refresh</div>
        <label className="field">
          <span className="label">City (for weather)</span>
          <input
            type="text"
            value={cfg.city || ''}
            onChange={e => onPatch({ city: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">City label (shown on display)</span>
          <input
            type="text"
            value={cfg.cityLabel || ''}
            onChange={e => onPatch({ cityLabel: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">Timezone (IANA)</span>
          <input
            type="text"
            value={cfg.timezone || 'America/New_York'}
            onChange={e => onPatch({ timezone: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">Refresh min (when schedule OFF)</span>
          <input
            type="text"
            value={cfg.refreshMinutes ?? 30}
            onChange={e => onPatch({ refreshMinutes: parseInt(e.target.value, 10) || 30 })}
          />
        </label>
      </section>

      <section className="card">
        <div className="section-title">Schedule</div>
        <div className="toggle-row">
          <span className="toggle-label">Enable schedule</span>
          <Toggle
            on={!!sched.enabled}
            onClick={() => onPatchNested('schedule', { ...sched, enabled: !sched.enabled })}
          />
        </div>
        <motion.div
          className={`sched-group ${sched.enabled ? '' : 'disabled'}`}
          animate={{ opacity: sched.enabled ? 1 : 0.4 }}
        >
          <label className="field">
            <span className="label">Active window — from / to</span>
            <div className="btn-row" style={{ marginTop: 0 }}>
              <input
                type="text"
                value={sched.activeFrom || '07:00'}
                onChange={e => onPatchNested('schedule', { ...sched, activeFrom: e.target.value })}
                style={{ flex: 1 }}
              />
              <input
                type="text"
                value={sched.activeTo || '22:00'}
                onChange={e => onPatchNested('schedule', { ...sched, activeTo: e.target.value })}
                style={{ flex: 1 }}
              />
            </div>
          </label>
          <div className="toggle-row" style={{ borderTop: '1px solid #ccc', paddingTop: 12 }}>
            <span className="toggle-label">During active</span>
            <span style={{ fontSize: 11, color: 'var(--mute)' }}>refresh min · screen</span>
          </div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <input
              type="text"
              value={schedActive.refreshMinutes ?? 30}
              onChange={e => setSchedActive({ refreshMinutes: parseInt(e.target.value, 10) || 30 })}
              style={{ flex: 1, minWidth: 80 }}
            />
            <ScreenButtons value={schedActive.screen || 1} onChange={s => setSchedActive({ screen: s })} />
          </div>
          <div className="toggle-row" style={{ borderTop: '1px solid #ccc', paddingTop: 12 }}>
            <span className="toggle-label">During quiet</span>
            <span style={{ fontSize: 11, color: 'var(--mute)' }}>refresh min · screen</span>
          </div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <input
              type="text"
              value={schedQuiet.refreshMinutes ?? 120}
              onChange={e => setSchedQuiet({ refreshMinutes: parseInt(e.target.value, 10) || 120 })}
              style={{ flex: 1, minWidth: 80 }}
            />
            <ScreenButtons value={schedQuiet.screen || 2} onChange={s => setSchedQuiet({ screen: s })} />
          </div>
        </motion.div>
      </section>
    </div>
  );
}

import React from 'react';
import { WIDGET_REGISTRY } from '../widgets.js';
import LocationPanel from './LocationPanel.jsx';

function Toggle({ on, onClick }) {
  return <div className={`toggle ${on ? 'on' : ''}`} onClick={onClick} />;
}

// Settings panel below the screen card. Holds GLOBAL settings shared
// across all screens (location, timezone, calendar URL, etc.) plus the
// per-widget content sections. Each content section appears only when
// at least one instance of that widget is on the active screen.
export default function Settings({ cfg, layout, onPatch, onPatchNested }) {
  const isOn = (id) => {
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

  return (
    <div>
      <LocationPanel cfg={cfg} onPatch={onPatch} />

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
    </div>
  );
}

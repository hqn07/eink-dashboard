import React, { useEffect, useRef, useState } from 'react';
import { WIDGET_REGISTRY } from '../widgets.js';
import LocationPanel from './LocationPanel.jsx';

function Toggle({ on, onClick }) {
  return <div className={`toggle ${on ? 'on' : ''}`} onClick={onClick} />;
}

// Settings panel below the screen card. Holds GLOBAL settings shared
// across all screens (location, timezone, calendar URL, etc.) plus the
// per-widget content sections. Each content section appears only when
// at least one instance of that widget is on the active screen.
export default function Settings({ cfg, layout, onPatch, onPatchNested, focusedWidgetId, onFocusHandled }) {
  const refs = useRef({});
  const [flashId, setFlashId] = useState(null);

  useEffect(() => {
    if (!focusedWidgetId) return;
    const el = refs.current[focusedWidgetId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setFlashId(focusedWidgetId);
      const t = setTimeout(() => {
        setFlashId(null);
        onFocusHandled && onFocusHandled();
      }, 1400);
      return () => clearTimeout(t);
    } else {
      onFocusHandled && onFocusHandled();
    }
  }, [focusedWidgetId]);

  const sectionProps = (id) => ({
    ref: (el) => { refs.current[id] = el; },
    className: `card ${flashId === id ? 'card-flash' : ''}`
  });
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

  // Weather widgets share LocationPanel — flash + scroll the same target.
  const locWrap = (
    <div
      ref={(el) => { refs.current['weather_hero'] = el; refs.current['weather_forecast'] = el; }}
      className={(flashId === 'weather_hero' || flashId === 'weather_forecast') ? 'card-flash-wrap' : ''}
    >
      <LocationPanel cfg={cfg} onPatch={onPatch} />
    </div>
  );

  return (
    <div>
      {locWrap}

      {showMessage && (
        <section {...sectionProps('message')}>
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
        <section {...sectionProps('todos')}>
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
        <section {...sectionProps('calendar')}>
          <div className="section-title">Calendar</div>
          <label className="field">
            <span className="label">
              iCal URL ·{' '}
              <a
                href="https://support.google.com/calendar/answer/37648?hl=en#zippy=%2Cget-your-calendar-view-only"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--mute)', textDecoration: 'underline' }}
              >Where do I get this? →</a>
            </span>
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
        <section {...sectionProps('spacer')}>
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
        <section {...sectionProps('quote')}>
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

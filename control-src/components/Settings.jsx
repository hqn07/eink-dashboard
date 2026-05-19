import React, { useEffect, useRef, useState } from 'react';
import { WIDGET_REGISTRY } from '../widgets.js';
import { resetConfig } from '../api.js';
import LocationPanel from './LocationPanel.jsx';

function Toggle({ on, onClick }) {
  return <div className={`toggle ${on ? 'on' : ''}`} onClick={onClick} />;
}

function StockSymbolsInput({ symbols, onCommit }) {
  const joined = (symbols || []).join(', ');
  const [raw, setRaw] = useState(joined);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setRaw(joined);
  }, [joined, focused]);
  const commit = () => {
    const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
    setRaw(arr.join(', '));
    onCommit(arr);
  };
  return (
    <input type="text"
      value={raw}
      onChange={e => setRaw(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      placeholder="AAPL, BTC-USD, ETH-USD" />
  );
}

// Settings panel below the screen card. Holds GLOBAL settings shared
// across all screens (location, timezone, calendar URL, etc.) plus the
// per-widget content sections. Each content section appears only when
// at least one instance of that widget is on the active screen.
export default function Settings({ cfg, layout, onPatch, onPatchNested, focusedWidgetId, onFocusHandled, onReplaceConfig }) {
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
  // A settings section only appears when at least one instance of that
  // widget sits on the active screen's layout. The legacy cfg.widgets[]
  // toggles are ignored here — they were a leftover from the pre-screens
  // shape and would surface sections for widgets that aren't placed.
  const isOn = (id) => layout.some(l => (l.widgetId || l.id) === id);

  const showMessage   = isOn('message');
  const showTodos     = isOn('todos');
  const showCalendar  = isOn('calendar');
  const showSpacer    = isOn('spacer');
  const showQuote     = isOn('quote');
  const showClock     = isOn('clock');
  const showWifi      = isOn('wifi_qr');
  const showCountdown = isOn('countdown');
  const showNews      = isOn('news');
  const showStocks    = isOn('stocks');
  const showGithub    = isOn('github');
  const showPhoto     = isOn('photo');
  const showForecast  = isOn('weather_forecast');

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

      {showForecast && (
        <section {...sectionProps('weather_forecast')}>
          <div className="section-title">Weather Forecast</div>
          <label className="field">
            <span className="label">Days to show (1–7 · blank = auto by tile height)</span>
            <input type="number" min={1} max={7}
              value={cfg.weather?.forecastDays ?? ''}
              onChange={e => {
                const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
                onPatchNested('weather', {
                  forecastDays: Number.isFinite(v) ? Math.max(1, Math.min(7, v)) : null
                });
              }}
              placeholder="auto" />
          </label>
          <div className="terminal-line" style={{ fontSize: 10, marginTop: 4 }}>
            &gt; OPEN-METEO RETURNS UP TO 7 DAYS · LARGER TILES FIT MORE
          </div>
        </section>
      )}

      {showMessage && (
        <section {...sectionProps('message')}>
          <div className="section-title">Message Widget</div>
          <label className="field">
            <span className="label">Default headline (markdown: **bold**, *italic*)</span>
            <input
              type="text"
              value={cfg.message?.text || ''}
              onChange={e => onPatchNested('message', { text: e.target.value })}
              placeholder="Welcome home."
            />
          </label>
          <label className="field">
            <span className="label">Default subtitle</span>
            <input
              type="text"
              value={cfg.message?.subtitle || ''}
              onChange={e => onPatchNested('message', { subtitle: e.target.value })}
              placeholder="Optional small text"
            />
          </label>
          <div className="section-title" style={{ marginTop: 12 }}>Scheduled overrides</div>
          <div className="terminal-line" style={{ fontSize: 10, marginBottom: 6 }}>
            &gt; FIRST MATCHING WINDOW WINS · DEFAULTS USED OUTSIDE WINDOWS
          </div>
          {((cfg.message?.schedule) || []).map((slot, idx) => (
            <div key={idx} className="todo-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <input type="time" value={slot.from || ''}
                onChange={e => {
                  const next = [...(cfg.message?.schedule || [])];
                  next[idx] = { ...next[idx], from: e.target.value };
                  onPatchNested('message', { schedule: next });
                }} style={{ maxWidth: 100 }} />
              <input type="time" value={slot.to || ''}
                onChange={e => {
                  const next = [...(cfg.message?.schedule || [])];
                  next[idx] = { ...next[idx], to: e.target.value };
                  onPatchNested('message', { schedule: next });
                }} style={{ maxWidth: 100 }} />
              <input type="text" value={slot.text || ''}
                placeholder="Headline"
                onChange={e => {
                  const next = [...(cfg.message?.schedule || [])];
                  next[idx] = { ...next[idx], text: e.target.value };
                  onPatchNested('message', { schedule: next });
                }} style={{ flex: '1 1 200px' }} />
              <input type="text" value={slot.subtitle || ''}
                placeholder="Subtitle"
                onChange={e => {
                  const next = [...(cfg.message?.schedule || [])];
                  next[idx] = { ...next[idx], subtitle: e.target.value };
                  onPatchNested('message', { schedule: next });
                }} style={{ flex: '1 1 200px' }} />
              <button className="btn btn-danger" style={{ padding: '6px 10px' }}
                onClick={() => onPatchNested('message', {
                  schedule: (cfg.message?.schedule || []).filter((_, i) => i !== idx)
                })}>×</button>
            </div>
          ))}
          <div className="btn-row">
            <button className="btn" onClick={() => onPatchNested('message', {
              schedule: [...(cfg.message?.schedule || []), { from: '06:00', to: '12:00', text: '', subtitle: '' }]
            })}>+ Add scheduled message</button>
          </div>
        </section>
      )}

      {showTodos && (
        <section {...sectionProps('todos')}>
          <div className="section-title">To-Do List</div>
          {(cfg.todos || []).map((t, idx) => (
            <div
              key={idx}
              className="todo-row"
              draggable
              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                if (Number.isNaN(from) || from === idx) return;
                const todos = [...(cfg.todos || [])];
                const [moved] = todos.splice(from, 1);
                todos.splice(idx, 0, moved);
                onPatch({ todos });
              }}
            >
              <span className="todo-grip" title="Drag to reorder">⋮⋮</span>
              <div
                className={`todo-check ${t.done ? 'done' : ''}`}
                onClick={() => {
                  const todos = [...(cfg.todos || [])];
                  const done = !todos[idx].done;
                  todos[idx] = {
                    ...todos[idx],
                    done,
                    completedAt: done ? new Date().toISOString() : null
                  };
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
              <input
                type="date"
                value={t.dueDate || ''}
                onChange={e => {
                  const todos = [...(cfg.todos || [])];
                  todos[idx] = { ...todos[idx], dueDate: e.target.value || null };
                  onPatch({ todos });
                }}
                title="Due date (optional)"
                style={{ maxWidth: 140 }}
              />
              <button
                className={`btn ${t.recurring === 'daily' ? 'btn-primary' : ''}`}
                style={{ padding: '6px 8px' }}
                title="Recurring daily — auto-resets at midnight"
                onClick={() => {
                  const todos = [...(cfg.todos || [])];
                  todos[idx] = { ...todos[idx], recurring: t.recurring === 'daily' ? null : 'daily' };
                  onPatch({ todos });
                }}
              >↻</button>
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
          <div className="terminal-line" style={{ fontSize: 10, marginTop: 4 }}>
            &gt; DRAG ⋮⋮ TO REORDER · DONE ITEMS AUTO-HIDE AFTER 4HR · ↻ = DAILY RESET
          </div>
        </section>
      )}

      {showCalendar && (
        <section {...sectionProps('calendar')}>
          <div className="section-title">Calendar</div>
          {/* Migrate legacy single icalUrl into icalUrls array on first edit. */}
          {(() => {
            const urls = Array.isArray(cfg.calendar?.icalUrls) && cfg.calendar.icalUrls.length
              ? cfg.calendar.icalUrls
              : (cfg.calendar?.icalUrl ? [cfg.calendar.icalUrl] : ['']);
            const setUrls = (next) => onPatchNested('calendar', { icalUrls: next, icalUrl: next[0] || '' });
            return (
              <>
                <div className="terminal-line" style={{ fontSize: 10, marginBottom: 6 }}>
                  &gt; ADD MULTIPLE iCAL FEEDS · EVENTS MERGE + DEDUPE ·{' '}
                  <a
                    href="https://support.google.com/calendar/answer/37648?hl=en#zippy=%2Cget-your-calendar-view-only"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--mute)', textDecoration: 'underline' }}
                  >Where do I get this? →</a>
                </div>
                {urls.map((u, idx) => (
                  <div key={idx} className="todo-row" style={{ marginBottom: 6 }}>
                    <input
                      type="url"
                      value={u}
                      onChange={e => {
                        const next = [...urls];
                        next[idx] = e.target.value;
                        setUrls(next);
                      }}
                      placeholder="https://calendar.google.com/calendar/ical/..."
                    />
                    <button
                      className="btn btn-danger"
                      style={{ padding: '6px 10px' }}
                      onClick={() => setUrls(urls.filter((_, i) => i !== idx))}
                    >×</button>
                  </div>
                ))}
                <div className="btn-row">
                  <button className="btn" onClick={() => setUrls([...urls, ''])}>+ Add feed</button>
                </div>
              </>
            );
          })()}
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
            <span className="label">Source</span>
            <select value={cfg.quote?.source || 'static'}
              onChange={e => onPatchNested('quote', { source: e.target.value })}>
              <option value="static">Static (one quote)</option>
              <option value="list">List (rotates daily)</option>
              <option value="api">Zenquotes.io (auto, refreshes 6h)</option>
            </select>
          </label>
          {(cfg.quote?.source || 'static') === 'static' && (
            <>
              <label className="field">
                <span className="label">Body (markdown supported)</span>
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
            </>
          )}
          {(cfg.quote?.source) === 'list' && (
            <>
              <div className="terminal-line" style={{ fontSize: 10, marginBottom: 4 }}>
                &gt; ROTATES BY DAY-OF-YEAR · ALL VIEWERS SEE THE SAME ONE
              </div>
              {((cfg.quote?.list) || []).map((q, idx) => (
                <div key={idx} className="todo-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <input type="text" value={q.text || ''} placeholder="Quote body"
                    onChange={e => {
                      const next = [...(cfg.quote?.list || [])];
                      next[idx] = { ...next[idx], text: e.target.value };
                      onPatchNested('quote', { list: next });
                    }} style={{ flex: '2 1 200px' }} />
                  <input type="text" value={q.attribution || ''} placeholder="Author"
                    onChange={e => {
                      const next = [...(cfg.quote?.list || [])];
                      next[idx] = { ...next[idx], attribution: e.target.value };
                      onPatchNested('quote', { list: next });
                    }} style={{ flex: '1 1 120px' }} />
                  <button className="btn btn-danger" style={{ padding: '6px 10px' }}
                    onClick={() => onPatchNested('quote', {
                      list: (cfg.quote?.list || []).filter((_, i) => i !== idx)
                    })}>×</button>
                </div>
              ))}
              <div className="btn-row">
                <button className="btn" onClick={() => onPatchNested('quote', {
                  list: [...(cfg.quote?.list || []), { text: '', attribution: '' }]
                })}>+ Add quote</button>
              </div>
            </>
          )}
          {(cfg.quote?.source) === 'api' && (
            <div className="terminal-line" style={{ fontSize: 10 }}>
              &gt; PULLS DAILY QUOTE FROM ZENQUOTES.IO · NO CONFIG NEEDED
            </div>
          )}
          <div className="toggle-row" style={{ marginTop: 10 }}>
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

      {showClock && (
        <section {...sectionProps('clock')}>
          <div className="section-title">Clock</div>
          <div className="terminal-line" style={{ fontSize: 10, marginBottom: 8 }}>
            &gt; E-INK REFRESH = MINUTES · SECONDS WOULD ALWAYS BE STALE
          </div>
          <div className="toggle-row">
            <span className="toggle-label">12-hour format</span>
            <Toggle
              on={(cfg.clock?.format || 12) === 12}
              onClick={() => onPatchNested('clock', { format: (cfg.clock?.format || 12) === 12 ? 24 : 12 })}
            />
          </div>
          <div className="toggle-row">
            <span className="toggle-label">Show date</span>
            <Toggle on={cfg.clock?.showDate !== false} onClick={() => onPatchNested('clock', { showDate: cfg.clock?.showDate === false })} />
          </div>
        </section>
      )}

      {showWifi && (
        <section {...sectionProps('wifi_qr')}>
          <div className="section-title">WiFi QR</div>
          <label className="field">
            <span className="label">SSID</span>
            <input type="text" value={cfg.wifi?.ssid || ''}
              onChange={e => onPatchNested('wifi', { ssid: e.target.value })}
              placeholder="My-WiFi" />
          </label>
          <label className="field">
            <span className="label">Password</span>
            <input type="text" value={cfg.wifi?.password || ''}
              onChange={e => onPatchNested('wifi', { password: e.target.value })}
              placeholder="(WPA password)" />
          </label>
          <label className="field">
            <span className="label">Security</span>
            <select value={cfg.wifi?.security || 'WPA'}
              onChange={e => onPatchNested('wifi', { security: e.target.value })}>
              <option value="WPA">WPA/WPA2</option>
              <option value="WEP">WEP</option>
              <option value="nopass">Open (no password)</option>
            </select>
          </label>
          <div className="toggle-row">
            <span className="toggle-label">Hidden network</span>
            <Toggle on={!!cfg.wifi?.hidden} onClick={() => onPatchNested('wifi', { hidden: !cfg.wifi?.hidden })} />
          </div>
        </section>
      )}

      {showCountdown && (
        <section {...sectionProps('countdown')}>
          <div className="section-title">Countdowns</div>
          {(cfg.countdowns || []).map((c, idx) => (
            <div key={idx} className="todo-row">
              <input type="text" placeholder="Label"
                value={c.label || ''}
                onChange={e => {
                  const next = [...(cfg.countdowns || [])];
                  next[idx] = { ...next[idx], label: e.target.value };
                  onPatch({ countdowns: next });
                }} />
              <input type="date" value={c.date || ''}
                onChange={e => {
                  const next = [...(cfg.countdowns || [])];
                  next[idx] = { ...next[idx], date: e.target.value };
                  onPatch({ countdowns: next });
                }} />
              <button className="btn btn-danger" style={{ padding: '6px 10px' }}
                onClick={() => onPatch({ countdowns: (cfg.countdowns || []).filter((_, i) => i !== idx) })}>×</button>
            </div>
          ))}
          <div className="btn-row">
            <button className="btn" onClick={() => onPatch({
              countdowns: [...(cfg.countdowns || []), { label: '', date: '' }]
            })}>+ Add countdown</button>
          </div>
        </section>
      )}

      {showNews && (
        <section {...sectionProps('news')}>
          <div className="section-title">News Headlines</div>
          <label className="field">
            <span className="label">RSS or Atom feed URL</span>
            <input type="url" value={cfg.news?.feedUrl || ''}
              onChange={e => onPatchNested('news', { feedUrl: e.target.value })}
              placeholder="https://feeds.bbci.co.uk/news/rss.xml" />
          </label>
          <label className="field">
            <span className="label">Max headlines</span>
            <input type="number" min={1} max={10} value={cfg.news?.maxItems || 5}
              onChange={e => onPatchNested('news', { maxItems: parseInt(e.target.value, 10) || 5 })} />
          </label>
        </section>
      )}

      {showStocks && (
        <section {...sectionProps('stocks')}>
          <div className="section-title">Stocks / Crypto</div>
          <label className="field">
            <span className="label">Symbols (comma-separated · Yahoo Finance format)</span>
            <StockSymbolsInput
              symbols={cfg.stocks?.symbols || []}
              onCommit={(arr) => onPatchNested('stocks', { symbols: arr })}
            />
          </label>
          <div className="terminal-line" style={{ fontSize: 10, marginTop: 4 }}>
            &gt; CRYPTO USE -USD SUFFIX (BTC-USD, ETH-USD) · STOCKS USE TICKER ONLY
          </div>
        </section>
      )}

      {showGithub && (
        <section {...sectionProps('github')}>
          <div className="section-title">GitHub Activity</div>
          <label className="field">
            <span className="label">Username</span>
            <input type="text" value={cfg.github?.user || ''}
              onChange={e => onPatchNested('github', { user: e.target.value })}
              placeholder="torvalds" />
          </label>
          <div className="terminal-line" style={{ fontSize: 10, marginTop: 4 }}>
            &gt; PUBLIC PROFILE ONLY · NO AUTH REQUIRED
          </div>
        </section>
      )}

      {showPhoto && (() => {
        const photo = cfg.photo || {};
        const slides = Array.isArray(photo.slides) && photo.slides.length
          ? photo.slides
          : (photo.dataUrl ? [{ dataUrl: photo.dataUrl }] : []);
        const setSlides = (next) => onPatchNested('photo', {
          slides: next,
          // Keep dataUrl synced to the first slide for the legacy path.
          dataUrl: next[0]?.dataUrl || ''
        });
        return (
          <section {...sectionProps('photo')}>
            <div className="section-title">Photo / Slideshow</div>
            <div className="terminal-line" style={{ fontSize: 10, marginBottom: 8 }}>
              &gt; UPLOAD MULTIPLE IMAGES · ROTATES BY INTERVAL
            </div>
            <label className="field">
              <span className="label">Add image</span>
              <input type="file" accept="image/png,image/jpeg,image/svg+xml" multiple
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (!files.length) return;
                  const reads = await Promise.all(files.map(f => new Promise(res => {
                    const r = new FileReader();
                    r.onload = () => res({ dataUrl: r.result });
                    r.readAsDataURL(f);
                  })));
                  setSlides([...slides, ...reads]);
                  e.target.value = '';
                }} />
            </label>
            {slides.length > 0 && (
              <div className="photo-slides">
                {slides.map((s, idx) => (
                  <div key={idx} className="photo-slide-row">
                    <img className="photo-slide-thumb" src={s.dataUrl} alt="" />
                    <input type="text" placeholder="Caption (optional)"
                      value={s.caption || ''}
                      onChange={e => {
                        const next = [...slides];
                        next[idx] = { ...next[idx], caption: e.target.value };
                        setSlides(next);
                      }} />
                    <button className="btn btn-danger" style={{ padding: '4px 8px' }}
                      onClick={() => setSlides(slides.filter((_, i) => i !== idx))}>×</button>
                  </div>
                ))}
              </div>
            )}
            <label className="field">
              <span className="label">Rotate every (minutes · 0 = no rotate)</span>
              <input type="number" min={0} max={1440}
                value={photo.rotateMinutes ?? 0}
                onChange={e => onPatchNested('photo', { rotateMinutes: parseInt(e.target.value, 10) || 0 })} />
            </label>
            <div className="toggle-row">
              <span className="toggle-label">Fit</span>
              <div className="btn-row" style={{ marginTop: 0 }}>
                {['contain', 'cover'].map(f => (
                  <button key={f}
                    className={`btn ${(photo.fit || 'contain') === f ? 'btn-primary' : ''}`}
                    onClick={() => onPatchNested('photo', { fit: f })}>{f.toUpperCase()}</button>
                ))}
              </div>
            </div>
          </section>
        );
      })()}

      <section {...sectionProps('backup')}>
        <div className="section-title">Backup & Reset</div>
        <div className="terminal-line" style={{ fontSize: 10, marginBottom: 8 }}>
          &gt; EXPORT A JSON SNAPSHOT · IMPORT TO RESTORE · RESET WIPES BACK TO DEFAULTS
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => {
            const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `eink-config-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }}>↓ EXPORT</button>

          <label className="btn" style={{ cursor: 'pointer' }}>
            ↑ IMPORT
            <input type="file" accept="application/json" style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const next = JSON.parse(reader.result);
                    if (!next || typeof next !== 'object') throw new Error('not an object');
                    if (!window.confirm('Replace current config with imported file? Unsaved changes will be lost.')) return;
                    onReplaceConfig && onReplaceConfig(next);
                  } catch (err) {
                    window.alert('Import failed: ' + err.message);
                  }
                };
                reader.readAsText(file);
                e.target.value = '';
              }} />
          </label>

          <button className="btn btn-danger" onClick={async () => {
            if (!window.confirm('Reset all settings to factory defaults? This cannot be undone.')) return;
            try {
              const fresh = await resetConfig();
              onReplaceConfig && onReplaceConfig(fresh);
            } catch (err) {
              window.alert('Reset failed: ' + err.message);
            }
          }}>↺ RESET TO DEFAULTS</button>
        </div>
      </section>

    </div>
  );
}

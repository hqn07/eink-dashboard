import React, { useEffect, useState } from 'react';

// Per-instance widget-data forms. Each form reads/writes a flat
// `values` object that matches the same shape the global cfg.<widget>
// section already uses, so snapshots from global drop in unchanged.
//
// Contract: { widgetId, values, onChange }.
//  - `values` is the per-instance settings object.
//  - `onChange(next)` replaces values with `next`. List-shape settings
//    nest items under `values.items` so the settings type stays an
//    object (snapshot/save/diff stays uniform).

// Widgets that currently have a bespoke form in this file.
const PER_INSTANCE_SUPPORTED = new Set([
  'news', 'stocks', 'github', 'fx', 'sports', 'message', 'wod',
  'todos', 'calendar', 'countdown', 'counter', 'habit', 'chore',
  'photo', 'quote', 'clock', 'link_qr', 'wifi_qr', 'spacer',
  'weather_hero', 'weather_forecast', 'aqi', 'moonsun'
]);

export function supportsPerInstance(widgetId) {
  return PER_INSTANCE_SUPPORTED.has(widgetId);
}

// Snapshot the relevant subset of global cfg for this widget id.
// Flat-shape widgets get a copy of cfg.<key>. List-shape widgets wrap
// the array under `items` so the modal can edit a single object.
// Weather-derived widgets snapshot the global location.
export function snapshotGlobalForWidget(widgetId, cfg) {
  if (!cfg) return {};
  const loc = () => ({
    lat: Number.isFinite(cfg.lat) ? cfg.lat : null,
    lon: Number.isFinite(cfg.lon) ? cfg.lon : null,
    city: cfg.city || ''
  });
  switch (widgetId) {
    case 'news':    return { ...(cfg.news    || {}) };
    case 'stocks':  return { ...(cfg.stocks  || {}) };
    case 'github':  return { ...(cfg.github  || {}) };
    case 'fx':      return { ...(cfg.fx      || {}) };
    case 'sports':  return { ...(cfg.sports  || {}) };
    case 'message': return { ...(cfg.message || {}) };
    case 'wod':     return { ...(cfg.wod     || {}) };
    case 'photo':   return { ...(cfg.photo   || {}) };
    case 'quote':   return { ...(cfg.quote   || {}) };
    case 'clock':   return { ...(cfg.clock   || {}), timezone: cfg.timezone || '' };
    case 'link_qr': return { ...(cfg.linkQr  || {}) };
    case 'wifi_qr': return { ...(cfg.wifi    || {}) };
    case 'spacer':  return { ...(cfg.spacer  || {}) };
    case 'calendar': {
      const urls = Array.isArray(cfg.calendar?.icalUrls) && cfg.calendar.icalUrls.length
        ? cfg.calendar.icalUrls.slice()
        : (cfg.calendar?.icalUrl ? [cfg.calendar.icalUrl] : []);
      return { icalUrls: urls };
    }
    case 'todos':     return { items: [...(cfg.todos      || [])] };
    case 'countdown': return { items: [...(cfg.countdowns || [])] };
    case 'counter':   return { items: [...(cfg.counters   || [])] };
    case 'habit':     return { items: [...(cfg.habits     || [])] };
    case 'chore':     return { items: [...(cfg.chores     || [])] };
    case 'weather_hero':
    case 'weather_forecast':
    case 'aqi':
    case 'moonsun':
      return loc();
    default:
      return {};
  }
}

// =================== FIELD COMPONENTS ===================

function TextField({ label, value, onChange, placeholder, type = 'text', help }) {
  return (
    <label className="wsm-field">
      <span className="wsm-field-label">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(type === 'number'
          ? (e.target.value === '' ? null : Number(e.target.value))
          : e.target.value)}
        placeholder={placeholder || ''}
      />
      {help && <span className="wsm-field-help">{help}</span>}
    </label>
  );
}

function TextAreaField({ label, value, onChange, placeholder, help }) {
  return (
    <label className="wsm-field">
      <span className="wsm-field-label">{label}</span>
      <textarea
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ''}
        rows={3}
      />
      {help && <span className="wsm-field-help">{help}</span>}
    </label>
  );
}

function SelectField({ label, value, options, onChange, help }) {
  return (
    <label className="wsm-field">
      <span className="wsm-field-label">{label}</span>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <span className="wsm-field-help">{help}</span>}
    </label>
  );
}

function ToggleField({ label, checked, onChange, help }) {
  return (
    <label className="wsm-row wsm-row-check">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>
        {label}
        {help && <span className="wsm-field-help" style={{ display: 'block' }}>{help}</span>}
      </span>
    </label>
  );
}

function CsvField({ label, value, onCommit, placeholder, help }) {
  const joined = (value || []).join(', ');
  const [raw, setRaw] = useState(joined);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setRaw(joined); }, [joined, focused]);
  const commit = () => {
    const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
    setRaw(arr.join(', '));
    onCommit(arr);
  };
  return (
    <label className="wsm-field">
      <span className="wsm-field-label">{label}</span>
      <input
        type="text"
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        placeholder={placeholder || ''}
      />
      {help && <span className="wsm-field-help">{help}</span>}
    </label>
  );
}

// Reusable list editor. `renderRow(item, patch, remove)` lays out
// the per-row controls; `blank` is the shape of a freshly-added item.
function ListEditor({ label, items, onChange, blank, renderRow, addLabel, help }) {
  const rows = items || [];
  const patch = (idx, p) => {
    const next = rows.slice();
    next[idx] = { ...next[idx], ...p };
    onChange(next);
  };
  const remove = (idx) => onChange(rows.filter((_, i) => i !== idx));
  const add = () => onChange([...rows, { ...blank }]);
  return (
    <div className="wsm-field">
      <span className="wsm-field-label">{label}</span>
      <div className="wsm-list">
        {rows.map((it, idx) => (
          <div key={idx} className="wsm-list-row">
            {renderRow(it, (p) => patch(idx, p))}
            <button type="button" className="btn btn-danger wsm-list-remove"
              onClick={() => remove(idx)}>×</button>
          </div>
        ))}
        {!rows.length && <div className="wsm-field-help">No items yet.</div>}
      </div>
      <button type="button" className="btn wsm-list-add" onClick={add}>
        + {addLabel || 'Add item'}
      </button>
      {help && <span className="wsm-field-help">{help}</span>}
    </div>
  );
}

// Simple location picker (city OR lat/lon). Per-instance location for
// weather/aqi-derived widgets. Lat/lon take precedence if both set.
function LocationFields({ values, onChange }) {
  const v = values || {};
  return (
    <>
      <div className="wsm-field-help" style={{ marginBottom: 6 }}>
        Lat/lon precise — overrides city. Leave both blank to fall back to global location.
      </div>
      <TextField
        label="City"
        value={v.city}
        onChange={(x) => onChange({ ...v, city: x })}
        placeholder="Tokyo,JP"
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <TextField
            label="Latitude"
            type="number"
            value={v.lat}
            onChange={(x) => onChange({ ...v, lat: x })}
            placeholder="35.6762"
          />
        </div>
        <div style={{ flex: 1 }}>
          <TextField
            label="Longitude"
            type="number"
            value={v.lon}
            onChange={(x) => onChange({ ...v, lon: x })}
            placeholder="139.6503"
          />
        </div>
      </div>
    </>
  );
}

// =================== WIDGET FORMS ===================

export default function WidgetForm({ widgetId, values, onChange }) {
  const v = values || {};
  const patch = (p) => onChange({ ...v, ...p });

  switch (widgetId) {
    // ----- Simple flat-shape widgets (Stage 2) -----
    case 'news':
      return (
        <>
          <TextField
            label="RSS / Atom feed URL"
            value={v.feedUrl}
            onChange={(x) => patch({ feedUrl: x })}
            placeholder="https://feeds.bbci.co.uk/news/world/rss.xml"
            help="Headlines refresh every ~15 min."
          />
          <TextField
            label="Max headlines"
            type="number"
            value={v.maxItems ?? 5}
            onChange={(x) => patch({ maxItems: Math.max(1, Math.min(20, x || 5)) })}
            help="Tile may show fewer based on size + density."
          />
        </>
      );

    case 'stocks':
      return (
        <CsvField
          label="Symbols (comma separated)"
          value={v.symbols}
          onCommit={(arr) => patch({ symbols: arr })}
          placeholder="AAPL, BTC-USD, ETH-USD"
          help="Yahoo Finance tickers. Crypto: e.g. BTC-USD."
        />
      );

    case 'github':
      return (
        <TextField
          label="GitHub username"
          value={v.user}
          onChange={(x) => patch({ user: x })}
          placeholder="torvalds"
        />
      );

    case 'fx':
      return (
        <CsvField
          label="Currency pairs"
          value={v.pairs}
          onCommit={(arr) => patch({ pairs: arr })}
          placeholder="USD/EUR, USD/JPY, EUR/GBP"
          help="Format BASE/QUOTE. ECB reference rates."
        />
      );

    case 'sports':
      return (
        <TextField
          label="ESPN team ID"
          value={v.teamId}
          onChange={(x) => patch({ teamId: x })}
          placeholder="bos"
          help="Three-letter team abbreviation."
        />
      );

    case 'wod':
      return (
        <TextField
          label="RSS feed URL (blank = Wiktionary default)"
          value={v.feedUrl}
          onChange={(x) => patch({ feedUrl: x })}
          placeholder=""
        />
      );

    case 'message':
      return (
        <>
          <TextField
            label="Headline"
            value={v.text}
            onChange={(x) => patch({ text: x })}
            placeholder="Today's message…"
            help="Markdown supported: **bold**, *italic*."
          />
          <TextField
            label="Subtitle"
            value={v.subtitle}
            onChange={(x) => patch({ subtitle: x })}
            placeholder="Optional second line"
          />
        </>
      );

    // ----- List-shape widgets -----
    case 'todos':
      return (
        <ListEditor
          label="To-do items"
          items={v.items}
          onChange={(items) => patch({ items })}
          blank={{ text: '', done: false }}
          addLabel="Add item"
          renderRow={(it, set) => (
            <>
              <input type="checkbox" checked={!!it.done}
                onChange={e => set({ done: e.target.checked })} />
              <input type="text" value={it.text || ''} placeholder="Task"
                onChange={e => set({ text: e.target.value })} style={{ flex: 1 }} />
              <input type="date" value={it.dueDate || ''} title="Due"
                onChange={e => set({ dueDate: e.target.value || null })}
                style={{ maxWidth: 130 }} />
              <button type="button"
                className={`btn ${it.recurring === 'daily' ? 'btn-primary' : ''}`}
                title="Recurring daily" onClick={() => set({
                  recurring: it.recurring === 'daily' ? null : 'daily'
                })}>↻</button>
            </>
          )}
        />
      );

    case 'calendar':
      return (
        <ListEditor
          label="iCal feed URLs"
          items={v.icalUrls}
          onChange={(items) => patch({ icalUrls: items })}
          blank={''}
          addLabel="Add feed"
          help="Events merge + dedupe across feeds."
          renderRow={(it, set) => (
            <input type="url"
              value={typeof it === 'string' ? it : ''}
              placeholder="https://calendar.google.com/calendar/ical/..."
              onChange={e => set(e.target.value)}
              style={{ flex: 1 }} />
          )}
        />
      );

    case 'countdown':
      return (
        <ListEditor
          label="Countdowns"
          items={v.items}
          onChange={(items) => patch({ items })}
          blank={{ label: '', date: '' }}
          addLabel="Add countdown"
          renderRow={(it, set) => (
            <>
              <input type="text" value={it.label || ''} placeholder="Label"
                onChange={e => set({ label: e.target.value })} style={{ flex: 1 }} />
              <input type="date" value={it.date || ''}
                onChange={e => set({ date: e.target.value })} />
            </>
          )}
        />
      );

    case 'counter':
      return (
        <ListEditor
          label="Counters"
          items={v.items}
          onChange={(items) => patch({ items })}
          blank={{ label: '', since: '', unit: 'DAYS' }}
          addLabel="Add counter"
          renderRow={(it, set) => (
            <>
              <input type="text" value={it.label || ''} placeholder="Label"
                onChange={e => set({ label: e.target.value })} style={{ flex: 1 }} />
              <input type="date" value={it.since || ''}
                onChange={e => set({ since: e.target.value })} />
              <input type="text" value={it.unit || 'DAYS'} placeholder="Unit"
                onChange={e => set({ unit: e.target.value })}
                style={{ maxWidth: 80 }} />
            </>
          )}
        />
      );

    case 'habit':
      return (
        <ListEditor
          label="Habits"
          items={v.items}
          onChange={(items) => patch({ items })}
          blank={{ label: '', doneDates: [] }}
          addLabel="Add habit"
          help="Mark done in the global panel — per-instance toggle isn't wired."
          renderRow={(it, set) => (
            <input type="text" value={it.label || ''} placeholder="Habit"
              onChange={e => set({ label: e.target.value })} style={{ flex: 1 }} />
          )}
        />
      );

    case 'chore':
      return (
        <ListEditor
          label="Chores"
          items={v.items}
          onChange={(items) => patch({ items })}
          blank={{ label: '', weekday: 0, time: '20:00' }}
          addLabel="Add chore"
          renderRow={(it, set) => (
            <>
              <input type="text" value={it.label || ''} placeholder="Chore"
                onChange={e => set({ label: e.target.value })} style={{ flex: 1 }} />
              <select value={it.weekday ?? 0}
                onChange={e => set({ weekday: parseInt(e.target.value, 10) })}>
                {['SUN','MON','TUE','WED','THU','FRI','SAT'].map((d, i) => (
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
              <input type="time" value={it.time || ''}
                onChange={e => set({ time: e.target.value })} />
            </>
          )}
        />
      );

    // ----- Compound forms -----
    case 'quote': {
      const source = v.source || 'static';
      return (
        <>
          <SelectField
            label="Source"
            value={source}
            options={[
              { value: 'static', label: 'Static (one quote)' },
              { value: 'list',   label: 'List (rotates daily)' },
              { value: 'api',    label: 'Zenquotes.io (auto, 6h)' }
            ]}
            onChange={(x) => patch({ source: x })}
          />
          {source === 'static' && (
            <>
              <TextAreaField
                label="Body (markdown supported)"
                value={v.text}
                onChange={(x) => patch({ text: x })}
                placeholder="Make each day your masterpiece."
              />
              <TextField
                label="Attribution"
                value={v.attribution}
                onChange={(x) => patch({ attribution: x })}
                placeholder="John Wooden"
              />
            </>
          )}
          {source === 'list' && (
            <ListEditor
              label="Quote list"
              items={v.list}
              onChange={(list) => patch({ list })}
              blank={{ text: '', attribution: '' }}
              addLabel="Add quote"
              renderRow={(it, set) => (
                <>
                  <input type="text" value={it.text || ''} placeholder="Body"
                    onChange={e => set({ text: e.target.value })} style={{ flex: 2 }} />
                  <input type="text" value={it.attribution || ''} placeholder="Author"
                    onChange={e => set({ attribution: e.target.value })} style={{ flex: 1 }} />
                </>
              )}
            />
          )}
          {source === 'api' && (
            <div className="wsm-field-help">
              Pulls the daily quote from zenquotes.io · no config needed.
            </div>
          )}
          <SelectField
            label="Alignment"
            value={v.align || 'center'}
            options={[
              { value: 'left',   label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'right',  label: 'Right' }
            ]}
            onChange={(x) => patch({ align: x })}
          />
        </>
      );
    }

    case 'clock':
      return (
        <>
          <TextField
            label="Timezone (IANA, e.g. America/New_York)"
            value={v.timezone}
            onChange={(x) => patch({ timezone: x })}
            placeholder="America/New_York"
            help="Blank = use global timezone."
          />
          <SelectField
            label="Hour format"
            value={String(v.format || 12)}
            options={[
              { value: '12', label: '12-hour' },
              { value: '24', label: '24-hour' }
            ]}
            onChange={(x) => patch({ format: parseInt(x, 10) })}
          />
          <ToggleField
            label="Show date"
            checked={v.showDate !== false}
            onChange={(x) => patch({ showDate: x })}
          />
        </>
      );

    case 'link_qr':
      return (
        <>
          <TextField
            label="URL"
            value={v.url}
            onChange={(x) => patch({ url: x })}
            placeholder="https://example.com"
          />
          <TextField
            label="Label"
            value={v.label}
            onChange={(x) => patch({ label: x })}
            placeholder="SCAN"
          />
        </>
      );

    case 'wifi_qr':
      return (
        <>
          <TextField
            label="SSID"
            value={v.ssid}
            onChange={(x) => patch({ ssid: x })}
            placeholder="My-WiFi"
          />
          <TextField
            label="Password"
            value={v.password}
            onChange={(x) => patch({ password: x })}
            placeholder="(WPA password)"
          />
          <SelectField
            label="Security"
            value={v.security || 'WPA'}
            options={[
              { value: 'WPA',    label: 'WPA/WPA2' },
              { value: 'WEP',    label: 'WEP' },
              { value: 'nopass', label: 'Open (no password)' }
            ]}
            onChange={(x) => patch({ security: x })}
          />
          <ToggleField
            label="Hidden network"
            checked={!!v.hidden}
            onChange={(x) => patch({ hidden: x })}
          />
        </>
      );

    case 'spacer':
      return (
        <>
          <TextField
            label="Label (optional)"
            value={v.text}
            onChange={(x) => patch({ text: x })}
            placeholder="e.g. GOOD MORNING"
          />
          <ToggleField
            label="Invert (white bar, black text)"
            checked={!!v.invert}
            onChange={(x) => patch({ invert: x })}
          />
        </>
      );

    case 'photo': {
      const slides = Array.isArray(v.slides) ? v.slides
        : (v.dataUrl ? [{ dataUrl: v.dataUrl }] : []);
      const setSlides = (next) => patch({
        slides: next,
        dataUrl: next[0]?.dataUrl || ''
      });
      return (
        <>
          <label className="wsm-field">
            <span className="wsm-field-label">Add image(s)</span>
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
            <div className="wsm-list">
              {slides.map((s, idx) => (
                <div key={idx} className="wsm-list-row">
                  <img src={s.dataUrl} alt=""
                    style={{ width: 48, height: 36, objectFit: 'cover', border: '1px solid #000' }} />
                  <input type="text" placeholder="Caption"
                    value={s.caption || ''}
                    onChange={e => {
                      const next = slides.slice();
                      next[idx] = { ...next[idx], caption: e.target.value };
                      setSlides(next);
                    }} style={{ flex: 1 }} />
                  <button type="button" className="btn btn-danger wsm-list-remove"
                    onClick={() => setSlides(slides.filter((_, i) => i !== idx))}>×</button>
                </div>
              ))}
            </div>
          )}
          <TextField
            label="Rotate every (minutes · 0 = no rotate)"
            type="number"
            value={v.rotateMinutes ?? 0}
            onChange={(x) => patch({ rotateMinutes: Math.max(0, x || 0) })}
          />
          <SelectField
            label="Fit"
            value={v.fit || 'contain'}
            options={[
              { value: 'contain', label: 'Contain (letterbox)' },
              { value: 'cover',   label: 'Cover (crop)' }
            ]}
            onChange={(x) => patch({ fit: x })}
          />
        </>
      );
    }

    // ----- Location-derived widgets -----
    case 'weather_hero':
    case 'weather_forecast':
    case 'aqi':
    case 'moonsun':
      return (
        <LocationFields
          values={v}
          onChange={(loc) => onChange(loc)}
        />
      );

    default:
      return (
        <div className="wsm-placeholder">
          <p className="wsm-note">
            Per-instance settings for <strong>{widgetId}</strong> aren't
            wired yet. This tile uses the shared global settings.
          </p>
        </div>
      );
  }
}

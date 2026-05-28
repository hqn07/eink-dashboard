import React, { useEffect, useRef, useState } from 'react';
import { CaretUp, CaretDown } from '@phosphor-icons/react';
import { geocode } from '../api.js';

// Per-tile widget-data forms. Each form reads/writes a flat `values`
// object that lives at `layoutItem.settings` — the canonical (and
// only) source of truth for that tile's config.
//
// Contract: { widgetId, values, onChange }.
//  - `values` is the per-tile settings object (always present; seeded
//    by the registry `defaults()` at tile creation).
//  - `onChange(next)` replaces values with `next`. List-shape settings
//    nest items under `values.items` so the settings type stays an
//    object (snapshot/save/diff stays uniform).

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

// Reusable list editor. `renderRow(item, patch)` lays out the per-row
// controls. `blank` is the shape of a freshly-added item. Optional
// `reorder` adds up/down buttons that move the row in the list.
// Optional `replaceRow` lets callers swap the whole item (used when the
// row holds a bare string, not an object).
function ListEditor({ label, items, onChange, blank, renderRow, addLabel, help, reorder = true, replaceRow = false }) {
  const rows = items || [];
  const patch = (idx, p) => {
    const next = rows.slice();
    next[idx] = replaceRow ? p : { ...next[idx], ...p };
    onChange(next);
  };
  const remove = (idx) => onChange(rows.filter((_, i) => i !== idx));
  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };
  const add = () => onChange([...rows, typeof blank === 'object' && blank !== null ? { ...blank } : blank]);
  return (
    <div className="wsm-field">
      <span className="wsm-field-label">{label}</span>
      <div className="wsm-list">
        {rows.map((it, idx) => (
          <div key={idx} className="wsm-list-row">
            {reorder && rows.length > 1 && (
              <div className="wsm-list-reorder">
                <button type="button" className="wsm-list-arrow" title="Move up"
                  disabled={idx === 0} onClick={() => move(idx, -1)}>
                  <CaretUp size={10} weight="bold" />
                </button>
                <button type="button" className="wsm-list-arrow" title="Move down"
                  disabled={idx === rows.length - 1} onClick={() => move(idx, 1)}>
                  <CaretDown size={10} weight="bold" />
                </button>
              </div>
            )}
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

// City autocomplete backed by Open-Meteo geocoding (proxied through the
// server's /api/geocode). Replaces the plain-text city field on weather
// widgets so users don't have to guess country codes.
function LocationAutocomplete({ value, onPick }) {
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const tRef = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  function search(q) {
    clearTimeout(tRef.current);
    tRef.current = setTimeout(async () => {
      const r = await geocode(q);
      setResults(r);
      setOpen(true);
    }, 250);
  }

  return (
    <label className="wsm-field wsm-field-autocomplete">
      <span className="wsm-field-label">City (search)</span>
      <input
        type="text"
        value={query}
        placeholder="Tokyo, JP"
        onChange={e => { setQuery(e.target.value); search(e.target.value); }}
        onFocus={() => { if (results.length) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <ul className="wsm-autocomplete-menu">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                className="wsm-autocomplete-item"
                onMouseDown={(e) => { e.preventDefault(); onPick(r); setQuery(`${r.name}${r.state ? ', ' + r.state : ''}${r.country ? ', ' + r.country : ''}`); setOpen(false); }}
              >
                <span>{r.name}{r.state ? `, ${r.state}` : ''}</span>
                <span className="wsm-autocomplete-hint">{r.country || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

// Per-instance location picker for weather-derived widgets.
// City autocomplete fills lat/lon when picked; manual lat/lon override
// still possible. Lat/lon take precedence over city at fetch time.
function LocationFields({ values, onChange }) {
  const v = values || {};
  return (
    <>
      <div className="wsm-field-help" style={{ marginBottom: 6 }}>
        Pick from search to set lat/lon. Manual lat/lon overrides city. Leave blank to inherit global.
      </div>
      <LocationAutocomplete
        value={v.city}
        onPick={(r) => onChange({ ...v, city: `${r.name}${r.state ? ', ' + r.state : ''}${r.country ? ', ' + r.country : ''}`, lat: r.lat, lon: r.lon })}
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
    case 'mac_nowplaying':
    case 'mac_battery':
    case 'mac_focus':
      return (
        <div className="wsm-placeholder">
          <p className="wsm-note">
            Reads from the host Mac when the dashboard server is
            running on macOS. On Railway / cloud it shows "MAC OFFLINE".
            No per-tile settings.
          </p>
        </div>
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

    case 'message':
      return (
        <>
          <TextField
            label="Default headline"
            value={v.text}
            onChange={(x) => patch({ text: x })}
            placeholder="Today's message…"
            help="Markdown supported: **bold**, *italic*."
          />
          <TextField
            label="Default subtitle"
            value={v.subtitle}
            onChange={(x) => patch({ subtitle: x })}
            placeholder="Optional second line"
          />
          <ListEditor
            label="Scheduled messages (override default in their window)"
            items={v.schedule}
            onChange={(schedule) => patch({ schedule })}
            blank={{ from: '06:00', to: '12:00', text: '', subtitle: '' }}
            addLabel="Add scheduled message"
            help="First match wins. Windows wrap midnight if `to` < `from`."
            renderRow={(it, set) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="time" value={it.from || ''} onChange={e => set({ from: e.target.value })}
                    style={{ width: 110 }} />
                  <span style={{ fontSize: 11 }}>→</span>
                  <input type="time" value={it.to || ''} onChange={e => set({ to: e.target.value })}
                    style={{ width: 110 }} />
                </div>
                <input type="text" value={it.text || ''} placeholder="Headline (this slot)"
                  onChange={e => set({ text: e.target.value })} />
                <input type="text" value={it.subtitle || ''} placeholder="Subtitle (optional)"
                  onChange={e => set({ subtitle: e.target.value })} />
              </div>
            )}
          />
        </>
      );

    case 'calendar':
      return (
        <>
          <ListEditor
            label="iCal feed URLs"
            items={v.icalUrls}
            onChange={(items) => patch({ icalUrls: items })}
            blank=""
            replaceRow
            addLabel="Add feed"
            help={
              <>
                Events merge + dedupe.{' '}
                <a href="https://support.google.com/calendar/answer/37648?hl=en#zippy=%2Cget-your-calendar-view-only"
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: 'var(--mute)', textDecoration: 'underline' }}>
                  Where do I get this? →
                </a>
              </>
            }
            renderRow={(it, set) => (
              <input type="url"
                value={typeof it === 'string' ? it : ''}
                placeholder="https://calendar.google.com/calendar/ical/..."
                onChange={e => set(e.target.value)}
                style={{ flex: 1 }} />
            )}
          />
        </>
      );

    // ----- Location-derived widgets -----
    case 'weather_hero':
      return (
        <LocationFields
          values={v}
          onChange={(loc) => onChange(loc)}
        />
      );
    case 'weather_forecast':
      return (
        <>
          <LocationFields
            values={v}
            onChange={(loc) => onChange({ ...v, ...loc })}
          />
          <TextField
            label="Days to show (1–7 · blank = auto by tile height)"
            type="number"
            value={v.forecastDays ?? ''}
            onChange={(x) => patch({
              forecastDays: Number.isFinite(x) ? Math.max(1, Math.min(7, x)) : null
            })}
            help="Open-Meteo returns up to 7 days; larger tiles fit more."
          />
        </>
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

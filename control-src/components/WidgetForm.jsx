import React, { useEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Switch from '@radix-ui/react-switch';
import { CaretUp, CaretDown } from '@phosphor-icons/react';
import { geocode } from '../api.js';
import { MIGRATED_FORMS, MIGRATED_DEFS } from '../widgets/_registry.js';

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

// Cheap value compare for the reset-button visibility check. Strings,
// numbers, booleans, and small arrays all flatten through JSON without
// false positives. Returns true when `a` and `b` are equivalent.
function sameFieldValue(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
}

// Hover-revealed reset icon next to the label. Renders when the caller
// passed a `defaultValue` AND the current value differs from it. Click
// reverts that one field to its widget-registry default. Storybook /
// Figma pattern — single-field reset without nuking the whole form.
function ResetButton({ onReset }) {
  return (
    <button
      type="button"
      className="wsm-reset-btn"
      aria-label="Reset to default"
      title="Reset to default"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onReset(); }}
    >
      ↻
    </button>
  );
}

function FieldLabel({ label, suffix, value, defaultValue, onReset }) {
  const dirty = defaultValue !== undefined && !sameFieldValue(value, defaultValue);
  return (
    <span className="wsm-field-label">
      <span className="wsm-field-label-text">{label}</span>
      {suffix ? <span className="wsm-field-help" style={{ marginLeft: 6 }}>{suffix}</span> : null}
      {dirty && <ResetButton onReset={onReset} />}
    </span>
  );
}

function TextField({ label, value, onChange, placeholder, type = 'text', help, defaultValue }) {
  return (
    <label className="wsm-field">
      <FieldLabel label={label} value={value} defaultValue={defaultValue}
        onReset={() => onChange(defaultValue)} />
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

function SelectField({ label, value, options, onChange, help, defaultValue }) {
  return (
    <label className="wsm-field">
      <FieldLabel label={label} value={value} defaultValue={defaultValue}
        onReset={() => onChange(defaultValue)} />
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {help && <span className="wsm-field-help">{help}</span>}
    </label>
  );
}

let __toggleIdSeed = 0;
function ToggleField({ label, value, onChange, help, defaultValue }) {
  const idRef = useRef(null);
  if (idRef.current == null) idRef.current = `wsm-sw-${++__toggleIdSeed}`;
  const dirty = defaultValue !== undefined && !sameFieldValue(!!value, !!defaultValue);
  return (
    <div className="wsm-row wsm-row-switch">
      <Switch.Root
        id={idRef.current}
        className="wsm-switch"
        checked={!!value}
        onCheckedChange={onChange}
      >
        <Switch.Thumb className="wsm-switch-thumb" />
      </Switch.Root>
      <label htmlFor={idRef.current} className="wsm-switch-label">{label}</label>
      {dirty && <ResetButton onReset={() => onChange(!!defaultValue)} />}
      {help && <span className="wsm-field-help" style={{ marginLeft: 6 }}>{help}</span>}
    </div>
  );
}

// Numeric slider with a live readout. `step`, `min`, `max` are passed
// straight to the input; `format` lets a widget print a unit suffix
// (e.g. px, ×) without changing the underlying number.
function SliderField({ label, value, min, max, step = 1, onChange, format, help, defaultValue }) {
  const display = format ? format(value) : value;
  return (
    <label className="wsm-field">
      <FieldLabel label={label} suffix={display} value={value} defaultValue={defaultValue}
        onReset={() => onChange(defaultValue)} />
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
      {help && <span className="wsm-field-help">{help}</span>}
    </label>
  );
}

// Reusable typography block — font family + scale + padding. Used by
// widgets that opt into the Phase 2 typography settings. Values land
// at `values.fontFamily`, `values.fontScale`, `values.padding`.
//
// Family list is intentionally short: only fonts already loaded via
// public/fonts/fonts.css survive Sharp's threshold render. Adding an
// arbitrary family here would just fall back to a system font on the
// device.
const FONT_FAMILIES = [
  { value: 'serif',  label: 'DM Serif Display (editorial)' },
  { value: 'sans',   label: 'Oswald (condensed sans)' },
  { value: 'mono',   label: 'JetBrains Mono' },
  { value: 'system', label: 'System default' }
];

// Defaults are shared across every widget that opts into the typography
// block, so they're baked in here instead of being threaded from each
// widget's def.defaults(). Single source of truth makes the reset icon
// always know what "factory" means for these knobs.
const TYPO_DEFAULTS = {
  fontFamily: 'serif',
  fontScale:  1,
  scaleAnchor: 'top_left',
  padding:    14,
  theme:      'normal'
};

function TypographyFields({ values, onChange }) {
  const v = values || {};
  const patch = (p) => onChange({ ...v, ...p });
  const family = v.fontFamily || 'serif';
  const scale  = Number.isFinite(v.fontScale) ? v.fontScale : 1;
  const padding = Number.isFinite(v.padding)   ? v.padding   : 14;
  const theme  = v.theme === 'inverted' ? 'inverted' : 'normal';
  return (
    <>
      <SelectField
        label="Font family"
        value={family}
        defaultValue={TYPO_DEFAULTS.fontFamily}
        options={FONT_FAMILIES}
        onChange={(x) => patch({ fontFamily: x })}
      />
      <SliderField
        label="Content scale"
        min={0.7} max={1.4} step={0.05}
        value={scale}
        defaultValue={TYPO_DEFAULTS.fontScale}
        onChange={(x) => patch({ fontScale: x })}
        format={(x) => `${Math.round(x * 100)}%`}
      />
      <SelectField
        label="Scale anchor"
        value={v.scaleAnchor || 'top_left'}
        defaultValue={TYPO_DEFAULTS.scaleAnchor}
        options={[
          { value: 'top_left',     label: 'Top-left (default)' },
          { value: 'top',          label: 'Top-center' },
          { value: 'top_right',    label: 'Top-right' },
          { value: 'left',         label: 'Left-center' },
          { value: 'center',       label: 'Center' },
          { value: 'right',        label: 'Right-center' },
          { value: 'bottom_left',  label: 'Bottom-left' },
          { value: 'bottom',       label: 'Bottom-center' },
          { value: 'bottom_right', label: 'Bottom-right' }
        ]}
        onChange={(x) => patch({ scaleAnchor: x })}
        help="Where the scale transform anchors when Content scale ≠ 100 %."
      />
      <SliderField
        label="Inner padding"
        min={0} max={30} step={1}
        value={padding}
        defaultValue={TYPO_DEFAULTS.padding}
        onChange={(x) => patch({ padding: x })}
        format={(x) => `${x}px`}
      />
      <SelectField
        label="Theme"
        value={theme}
        defaultValue={TYPO_DEFAULTS.theme}
        options={[
          { value: 'normal',   label: 'Normal (black on white)' },
          { value: 'inverted', label: 'Inverted (white on black)' }
        ]}
        onChange={(x) => patch({ theme: x })}
      />
    </>
  );
}

function CsvField({ label, value, onCommit, placeholder, help, defaultValue }) {
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
      <FieldLabel label={label} value={value || []} defaultValue={defaultValue}
        onReset={() => { setRaw(((defaultValue || []).join(', '))); onCommit(defaultValue || []); }} />
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

// Sectioned form layout. Each widget Form groups its fields into one
// or more <FormSection> blocks (Data / Content / Layout / Style) so
// users don't see a flat 30-field column. Mirrors the
// TRMNL plugin editor + mushroom-card grouping pattern.
//
// The actual layout — stacked sections vs Radix tabs — is decided
// by `TabbedForm` below. FormSection itself just renders a titled
// block; TabbedForm walks the rendered tree, splits the sections
// into tabs, and re-uses the original DOM structure inside each
// Tabs.Content.
function FormSection({ title, children }) {
  return (
    <div className="wsm-subsection" data-section-title={title}>
      <div className="wsm-subsection-title">{title}</div>
      <div className="wsm-subsection-body">{children}</div>
    </div>
  );
}

// Collapsible <details> group for low-traffic fields. Per NN/g, hides
// the bottom-20% of settings behind a one-click reveal so the primary
// fields aren't drowned out. Editorial styling matches the rest of the
// modal (mono summary, hairline rule).
function AdvancedGroup({ title = 'Advanced', children, defaultOpen = false }) {
  return (
    <details className="wsm-advanced" open={defaultOpen}>
      <summary className="wsm-advanced-summary">{title}</summary>
      <div className="wsm-advanced-body">{children}</div>
    </details>
  );
}

// Segmented control — replaces a SelectField when the choice is small
// (2-4 options) and the value is naturally spatial (alignment,
// position, side). One row instead of a dropdown; mirrors Figma's
// alignment widget.
function SegmentedField({ label, value, options, onChange, help, defaultValue }) {
  return (
    <div className="wsm-field">
      {label && (
        <FieldLabel
          label={label}
          value={value}
          defaultValue={defaultValue}
          onReset={() => onChange(defaultValue)}
        />
      )}
      <div className="wsm-segmented" role="radiogroup" aria-label={label}>
        {options.map(o => {
          const active = String(o.value) === String(value);
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              className={`wsm-seg-btn ${active ? 'is-active' : ''}`}
              onClick={() => onChange(o.value)}
              title={o.title || o.label}
            >
              {o.icon ? <span className="wsm-seg-icon">{o.icon}</span> : null}
              {o.short || o.label}
            </button>
          );
        })}
      </div>
      {help && <span className="wsm-field-help">{help}</span>}
    </div>
  );
}

// Render the migrated widget Form and split its FormSection children
// into a Radix Tabs surface. Every migrated Form is a pure render
// function (no hooks, no state, no side effects), so calling it
// directly to introspect its children is safe — the constraint is
// documented at the top of each `<id>.form.jsx`.
function TabbedForm({ MigratedForm, formProps }) {
  // Pure-component call. Equivalent to JSX `<MigratedForm {...props} />`
  // but without going through React's renderer, so we can walk the
  // resulting element tree before mounting.
  const tree = MigratedForm(formProps);
  const flat = React.Children.toArray(
    React.isValidElement(tree) && tree.type === React.Fragment
      ? tree.props.children
      : tree
  );
  const sections = flat.filter(c => React.isValidElement(c) && c.type === FormSection);
  const extras   = flat.filter(c => !React.isValidElement(c) || c.type !== FormSection);

  const titles = sections.map(s => s.props.title);
  const [active, setActive] = useState(titles[0] || '');

  // Snap active back to the first valid tab if the form's section
  // list changes (e.g. preset adds a new section). Avoids leaving
  // the user on a tab that no longer exists.
  if (titles.length && !titles.includes(active)) {
    setActive(titles[0]);
    return null; // re-render with the corrected active
  }

  if (!sections.length) {
    return <>{tree}</>;
  }

  return (
    <>
      {extras}
      <Tabs.Root value={active} onValueChange={setActive} className="wsm-tabs">
        <Tabs.List className="wsm-tabs-list" aria-label="Widget settings sections">
          {sections.map(s => (
            <Tabs.Trigger
              key={s.props.title}
              value={s.props.title}
              className="wsm-tabs-trigger"
            >
              {s.props.title}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {sections.map(s => (
          <Tabs.Content
            key={s.props.title}
            value={s.props.title}
            className="wsm-tabs-content"
          >
            {s.props.children}
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </>
  );
}

// Preset picker. Each preset is `{ id, label, values }`. Picking one
// merges `values` into the current draft via the provided onApply.
// The picker stays unselected ("Custom") so users can tweak after
// applying without the dropdown lying about which preset is active.
function PresetField({ presets, onApply }) {
  if (!Array.isArray(presets) || !presets.length) return null;
  return (
    <div className="wsm-row">
      <label className="wsm-field-label">Preset</label>
      <select
        className="wsm-field-input"
        value=""
        onChange={(e) => {
          const id = e.target.value;
          const hit = presets.find(p => p.id === id);
          if (hit) onApply(hit.values);
          e.target.value = '';
        }}
      >
        <option value="" disabled>Pick a preset…</option>
        {presets.map(p => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
    </div>
  );
}

// Field primitives passed into migrated per-widget Form modules so
// each module doesn't have to re-import them. Add new ones here as
// they appear in widget forms.
const FIELD_PRIMITIVES = {
  TextField, SelectField, ToggleField, SliderField, CsvField,
  SegmentedField,
  ListEditor, LocationFields, TypographyFields,
  FormSection, AdvancedGroup, PresetField
};

export default function WidgetForm({ widgetId, values, onChange }) {
  const v = values || {};
  const patch = (p) => onChange({ ...v, ...p });

  // Phase A migrations: per-widget modules under control-src/widgets/
  // export a Form component. Dispatch to it before falling through to
  // the legacy switch below.
  const MigratedForm = MIGRATED_FORMS[widgetId];
  if (MigratedForm) {
    // Compute per-widget factory defaults once so the form module can
    // pass `defaultValue={defaults.X}` to any primitive that should
    // surface a per-field reset icon.
    const def = MIGRATED_DEFS[widgetId];
    const defaults = (def && typeof def.defaults === 'function')
      ? def.defaults() : {};
    return (
      <TabbedForm
        MigratedForm={MigratedForm}
        formProps={{
          values: v, patch, onChange,
          fields: { ...FIELD_PRIMITIVES, defaults }
        }}
      />
    );
  }

  switch (widgetId) {
    // mac_nowplaying — migrated to control-src/widgets/mac_nowplaying.jsx

    // mac_battery — migrated to control-src/widgets/mac_battery.jsx

    // clock — migrated to control-src/widgets/clock.js

    // stocks — migrated to control-src/widgets/stocks.jsx

    // message — migrated to control-src/widgets/message.jsx
    case '__message_legacy_removed':
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
          <TypographyFields values={v} onChange={onChange} />
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

    // calendar — migrated to control-src/widgets/calendar.jsx

    // ----- Location-derived widgets -----
    // weather_hero — migrated to control-src/widgets/weather_hero.jsx
    // weather_forecast — migrated to control-src/widgets/weather_forecast.jsx

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

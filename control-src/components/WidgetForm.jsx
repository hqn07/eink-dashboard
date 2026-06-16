import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { CaretUp, CaretDown, DotsSixVertical } from '@phosphor-icons/react';
import { geocode } from '../api.js';
import { MIGRATED_FORMS, MIGRATED_DEFS } from '../widgets/_registry.js';
import {
  renderWidget, typographyCss, cellClasses, scaleWrap
} from '../widget-render.js';
import { demoCtxForWidget } from '../widgets/_pool_demo.js';

// Context the modal uses to seed PresetCards thumbnails with the same
// dashboard payload the live preview is rendering from. Lets each card
// render a faithful miniature of what the preset will produce on the
// real tile rather than a generic placeholder.
const PresetContext = React.createContext({ widgetId: null, item: null, previewData: null, onHoverPreset: null });

// Canonical tab taxonomy — every <id>.form.jsx should use these four
// section titles in this order. Tabs without applicable fields are
// just omitted by the widget; nothing else is allowed.
//
//   Data    — sources of info (feeds, location, API symbols).
//   Content — what gets shown (heading text, content toggles,
//             user-typed strings, schedules).
//   Layout  — physical arrangement (view mode, density, alignment,
//             positioning, layout variants).
//   Style   — appearance (typography, theme, padding, scale).
//
// Single-tab list = preferred default when the persisted active tab is
// missing or invalid. First match wins → Data is the most common
// landing tab; Content is the fallback for widgets without a Data tab.
const DEFAULT_OPEN_SECTIONS = ['Data', 'Content', 'Layout', 'Style'];
const SECTION_STORAGE_PREFIX = 'wsm-accordion-open:';

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
      {dirty && (
        <button
          type="button"
          className="wsm-edited-pill"
          title="Reset to default"
          aria-label="Reset to default"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onReset(); }}
        >
          <span className="wsm-edited-dot" aria-hidden="true" />
          <span className="wsm-edited-text">Edited</span>
          <span className="wsm-edited-revert" aria-hidden="true">↻</span>
        </button>
      )}
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
// (e.g. px, ×) without changing the underlying number. A bubble sits
// above the thumb showing the formatted value as the user drags, so
// they don't have to glance up at the label suffix.
function SliderField({ label, value, min, max, step = 1, onChange, format, help, defaultValue }) {
  const display = format ? format(value) : value;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className="wsm-field">
      <FieldLabel label={label} suffix={display} value={value} defaultValue={defaultValue}
        onReset={() => onChange(defaultValue)} />
      <div className="wsm-slider-wrap">
        <input
          type="range"
          min={min} max={max} step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="wsm-slider-input"
        />
        <span
          className="wsm-slider-bubble"
          style={{ left: `${pct}%` }}
          aria-hidden="true"
        >
          {display}
        </span>
      </div>
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
// `reorder` enables HTML5 drag-to-reorder via a left-side grip handle
// (with keyboard up/down buttons retained for accessibility).
// Optional `replaceRow` lets callers swap the whole item (used when the
// row holds a bare string, not an object).
function ListEditor({ label, items, onChange, blank, renderRow, addLabel, help, reorder = true, replaceRow = false }) {
  const rows = items || [];
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
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
  const reorderTo = (from, to) => {
    if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return;
    const next = rows.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };
  const add = () => onChange([...rows, typeof blank === 'object' && blank !== null ? { ...blank } : blank]);
  return (
    <div className="wsm-field">
      <span className="wsm-field-label">{label}</span>
      <div className="wsm-list">
        {rows.map((it, idx) => {
          const isDragging = dragIdx === idx;
          const isOver = overIdx === idx && dragIdx !== null && dragIdx !== idx;
          return (
            <div
              key={idx}
              className={`wsm-list-row ${isDragging ? 'is-dragging' : ''} ${isOver ? 'is-over' : ''}`}
              onDragOver={(e) => { if (dragIdx !== null) { e.preventDefault(); setOverIdx(idx); } }}
              onDrop={(e) => {
                if (dragIdx === null) return;
                e.preventDefault();
                reorderTo(dragIdx, idx);
                setDragIdx(null);
                setOverIdx(null);
              }}
            >
              {reorder && rows.length > 1 && (
                <div
                  className="wsm-list-grip"
                  draggable
                  onDragStart={(e) => {
                    setDragIdx(idx);
                    e.dataTransfer.effectAllowed = 'move';
                    // Some browsers require data to be set or the drag
                    // event never starts. Empty string is fine.
                    try { e.dataTransfer.setData('text/plain', String(idx)); } catch {}
                  }}
                  onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                  title="Drag to reorder"
                >
                  <DotsSixVertical size={14} weight="bold" />
                </div>
              )}
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
          );
        })}
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
// The actual layout — stacked sections vs pill tabs — is decided
// by `TabbedForm` below. FormSection itself just renders a titled
// block; TabbedForm walks the rendered tree, splits the sections out,
// and renders only the active tab's children at any one time.
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
// into a horizontal pill-tab surface. Every migrated Form is a pure
// render function (no hooks, no state, no side effects), so calling
// it directly to introspect its children is safe — the constraint is
// documented at the top of each `<id>.form.jsx`.
//
// Pill tabs (vs the previous Accordion) keep the modal compact —
// only one section's body is mounted at a time, so the right-hand
// column doesn't grow tall when every section is expanded. Active
// tab persists per-widget in localStorage so reopening the modal
// lands you back where you left off.
function TabbedForm({ widgetId, MigratedForm, formProps }) {
  const tree = MigratedForm(formProps);
  const flat = React.Children.toArray(
    React.isValidElement(tree) && tree.type === React.Fragment
      ? tree.props.children
      : tree
  );
  const sections = flat.filter(c => React.isValidElement(c) && c.type === FormSection);
  const extras   = flat.filter(c => !React.isValidElement(c) || c.type !== FormSection);

  const titles = sections.map(s => s.props.title);
  const storageKey = `${SECTION_STORAGE_PREFIX}${widgetId}`;

  // Active tab: persisted preference if present and still valid, else
  // first available section title.
  const [active, setActive] = useState(() => {
    try {
      const raw = typeof localStorage !== 'undefined' && localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Back-compat: legacy schema was an array of open titles. Treat
        // the first valid entry as the new single active tab.
        if (Array.isArray(parsed)) {
          const m = parsed.find(t => titles.includes(t));
          if (m) return m;
        } else if (typeof parsed === 'string' && titles.includes(parsed)) {
          return parsed;
        }
      }
    } catch { /* ignore */ }
    return titles[0] || '';
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(active)); }
    catch { /* ignore */ }
  }, [active, storageKey]);

  if (!sections.length) {
    return <>{tree}</>;
  }

  const activeSection = sections.find(s => s.props.title === active) || sections[0];

  return (
    <>
      {extras}
      <div className="wsm-tabs" role="tablist">
        {sections.map(s => {
          const t = s.props.title;
          const isActive = t === activeSection.props.title;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`wsm-tab ${isActive ? 'wsm-tab-active' : ''}`}
              onClick={() => setActive(t)}
            >
              {t}
            </button>
          );
        })}
      </div>
      <div className="wsm-tab-panel" role="tabpanel">
        {activeSection.props.children}
      </div>
    </>
  );
}

// Show/hide wrapper used by sub-sections inside the tab panel — preset
// card grid, advanced positioning, etc. Defaults to open; the state
// persists per (widgetId · title) in localStorage so a collapsed
// section stays collapsed when the modal reopens.
//
// Matches the widget pool toggle (▾ HIDE / ▸ SHOW) so the editor reads
// consistently across surfaces.
function Collapsible({ title, storageScope, defaultOpen = true, children }) {
  const key = `wsm-collapse:${storageScope || title}`;
  const [open, setOpen] = useState(() => {
    try {
      if (typeof localStorage === 'undefined') return defaultOpen;
      const v = localStorage.getItem(key);
      return v === null ? defaultOpen : v === '1';
    } catch { return defaultOpen; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, open ? '1' : '0'); } catch { /* ignore */ }
  }, [open, key]);
  return (
    <div className={`wsm-collapsible ${open ? 'is-open' : 'is-closed'}`}>
      <button
        type="button"
        className="wsm-collapsible-trigger"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="wsm-collapsible-caret">{open ? '▾' : '▸'}</span>
        <span className="wsm-collapsible-title">{title}</span>
      </button>
      {open && <div className="wsm-collapsible-body">{children}</div>}
    </div>
  );
}

// Preset picker. Each preset is `{ id, label, values }`. Picking one
// merges `values` into the current draft via the provided onApply.
//
// Renders as a row of visual cards — each card runs the widget's own
// `render(...)` with the preset values + the modal's real preview
// payload, then scales the resulting HTML down into a thumbnail. So
// users see "what does Editorial vs Minimal actually look like on
// MY data" instead of having to read preset names.
//
// TRMNL plugin editor + WordPress Block Styles use the same idiom.
function PresetField({ presets, onApply, currentValues, title = 'Preset', thumbSize = null }) {
  if (!Array.isArray(presets) || !presets.length) return null;
  const ctx = useContext(PresetContext);
  // Migrated forms currently call <PresetField presets onApply /> without
  // passing currentValues; fall through to the context-provided draft
  // so active-preset detection still works without touching every form.
  const effectiveValues = currentValues || ctx.values || null;

  // Detect which preset (if any) the current draft already matches so
  // we can mark it selected. Match = every key the preset sets equals
  // the current draft value (preset is a partial; the draft may have
  // user-edited fields beyond it).
  const activeId = useMemo(() => {
    if (!effectiveValues) return null;
    for (const p of presets) {
      const vals = p.values || {};
      let hit = true;
      for (const k of Object.keys(vals)) {
        if (!sameFieldValue(effectiveValues[k], vals[k])) { hit = false; break; }
      }
      if (hit) return p.id;
    }
    return null;
  }, [presets, effectiveValues]);

  return (
    <div className="wsm-field wsm-preset-cards-wrap">
      <Collapsible title={title} storageScope={`preset:${title}:${ctx.widgetId || 'na'}`} defaultOpen>
        <div className="wsm-preset-cards" role="radiogroup" aria-label={title}>
          {presets.map(p => (
            <PresetCard
              key={p.id}
              preset={p}
              isActive={p.id === activeId}
              ctx={ctx}
              currentValues={effectiveValues}
              thumbSize={thumbSize}
              onPick={() => onApply(p.values)}
            />
          ))}
        </div>
      </Collapsible>
    </div>
  );
}

// Single preset card. Renders the widget HTML at the real cell
// dimensions, then CSS-scales the result down into a small thumbnail
// so the user sees what each preset produces on their own data.
function PresetCard({ preset, isActive, ctx, currentValues, onPick, thumbSize }) {
  const { widgetId, item, previewData } = ctx;
  const THUMB_W = 160;
  const THUMB_H = 90;
  // thumbSize (from def.variantThumb) overrides the live tile size when
  // a widget's variants only manifest at a specific tier — otherwise
  // every thumbnail would render the same small-tile layout.
  const cellW = (thumbSize && thumbSize.w) || (item && item.w) || 8;
  const cellH = (thumbSize && thumbSize.h) || (item && item.h) || 4;
  // Approx pixel size matching the dashboard body — 24 cols × ~33px,
  // 12 rows × ~33px. Close enough that the preset's tier resolves the
  // same way it will on the actual tile.
  const cellPxW = cellW * 33;
  const cellPxH = cellH * 33;

  const html = useMemo(() => {
    if (!widgetId) return '';
    try {
      const merged = { ...(currentValues || {}), ...(preset.values || {}) };
      const itemSlot = (previewData && previewData.perItem && item && previewData.perItem[item.id]) || {};
      // Seed frozen demo data (same set the pool uses) so the thumbnail
      // always has content to lay out — without it a widget whose live
      // data is missing (e.g. mac now-playing with no agent) renders
      // every variant as the same OFFLINE placeholder. Live previewData
      // + perItem slot win over demo where present.
      const demo = demoCtxForWidget(widgetId, cellW, cellH) || {};
      const inner = renderWidget(widgetId, {
        ...demo,
        ...(previewData || {}),
        ...itemSlot,
        cellW, cellH,
        density: item && item.density,
        settings: { ...(demo.settings || {}), ...merged }
      }) || '';
      const sw = scaleWrap(merged);
      const classes = ['cell', `cell-${widgetId}`];
      classes.push(...cellClasses(merged));
      const typoStyle = typographyCss(merged);
      return `<div class="${classes.join(' ')}" style="width:${cellPxW}px;height:${cellPxH}px;${typoStyle}">${sw.open}${inner}${sw.close}</div>`;
    } catch {
      return '';
    }
  }, [widgetId, item, previewData, preset, currentValues, cellPxW, cellPxH, cellW, cellH]);

  const scale = Math.min(THUMB_W / cellPxW, THUMB_H / cellPxH);

  // Hover broadcasts this preset's values to the modal so the main
  // preview switches as the user moves between cards — no click needed
  // to "see what this preset would do". onMouseLeave resets to null
  // so the preview falls back to the user's actual draft.
  const onEnter = () => { if (ctx && typeof ctx.onHoverPreset === 'function') ctx.onHoverPreset(preset.values); };
  const onLeave = () => { if (ctx && typeof ctx.onHoverPreset === 'function') ctx.onHoverPreset(null); };

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      className={`wsm-preset-card ${isActive ? 'is-active' : ''}`}
      onClick={onPick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      title={preset.label}
    >
      <div className="wsm-preset-card-thumb" style={{ width: THUMB_W, height: THUMB_H }}>
        <div
          className="wsm-preset-card-scale"
          style={{
            width: cellPxW,
            height: cellPxH,
            transform: `scale(${scale})`,
            transformOrigin: 'top left'
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      <span className="wsm-preset-card-label">{preset.label}</span>
    </button>
  );
}

// Field primitives passed into migrated per-widget Form modules so
// each module doesn't have to re-import them. Add new ones here as
// they appear in widget forms.
const FIELD_PRIMITIVES = {
  TextField, SelectField, ToggleField, SliderField, CsvField,
  SegmentedField,
  ListEditor, LocationFields, TypographyFields,
  FormSection, AdvancedGroup, PresetField, Collapsible
};

export default function WidgetForm({ widgetId, values, onChange, item, previewData, onHoverPreset }) {
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
    // Contract v2: widgets that declare def.variants get an automatic
    // visual variant picker above their form — same live-thumbnail
    // card UI as presets, applying { variant: <name> }.
    const variantPresets = (def && def.variants)
      ? Object.entries(def.variants).map(([id, val]) => ({
          id, label: (val && val.label) || id, values: { variant: id }
        }))
      : null;
    return (
      <PresetContext.Provider value={{ widgetId, item, previewData, values: v, onHoverPreset }}>
        {variantPresets && (
          <PresetField
            presets={variantPresets}
            onApply={patch}
            title="Variant"
            thumbSize={def.variantThumb || null}
          />
        )}
        <TabbedForm
          widgetId={widgetId}
          MigratedForm={MigratedForm}
          formProps={{
            values: v, patch, onChange,
            fields: { ...FIELD_PRIMITIVES, defaults }
          }}
        />
      </PresetContext.Provider>
    );
  }

  switch (widgetId) {
    // mac_nowplaying — migrated to control-src/widgets/mac_nowplaying.jsx

    // mac_battery — migrated to control-src/widgets/mac_battery.jsx

    // clock — migrated to control-src/widgets/clock.js


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

import React, { useState } from 'react';
import { ICAL_PRESETS } from './_ical_presets.js';

// Presets cover the three view modes so the thumbnails actually differ
// from each other. Each preset commits a full look (view + density +
// show toggles) so a single click switches everything in one go.
const PRESETS = [
  { id: 'agenda', label: 'Agenda — list with sections',
    values: { viewMode: 'list',  density: 'rich',     showDayLabel: true,  showTime: true } },
  { id: 'today',  label: 'Today — compact list',
    values: { viewMode: 'list',  density: 'compact',  showDayLabel: false, showTime: true } },
  { id: 'strip',  label: 'Strip — 7-day horizontal',
    values: { viewMode: 'strip', density: 'auto',     showDayLabel: true,  showTime: true } },
  { id: 'month',  label: 'Month — full grid',
    values: { viewMode: 'month', density: 'auto',     showDayLabel: true,  showTime: true } }
];

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, ListEditor, SelectField, ToggleField, TypographyFields, FormSection, PresetField, defaults = {} } = fields;
  const urls = Array.isArray(v.icalUrls) ? v.icalUrls.filter(Boolean) : [];
  const disabled = Array.isArray(v.disabledFeeds) ? v.disabledFeeds : [];
  const [presetPick, setPresetPick] = useState('');
  const toggleFeed = (url, on) => {
    const next = on
      ? disabled.filter(u => u !== url)
      : disabled.includes(url) ? disabled : [...disabled, url];
    patch({ disabledFeeds: next });
  };
  const addPreset = (url) => {
    if (!url) return;
    const existing = Array.isArray(v.icalUrls) ? v.icalUrls : [];
    if (existing.includes(url)) {
      setPresetPick('');
      return;
    }
    patch({ icalUrls: [...existing, url] });
    setPresetPick('');
  };
  return (
    <>
      <FormSection title="Data">
        <div style={{ marginBottom: 10 }}>
          <div className="wsm-field-label">Add from preset</div>
          <div className="wsm-field-help" style={{ marginBottom: 4 }}>
            Public iCal feeds — pick one to append to the list below.
          </div>
          <select
            value={presetPick}
            onChange={e => { setPresetPick(e.target.value); addPreset(e.target.value); }}
            style={{ width: '100%' }}
          >
            <option value="">— Pick a preset —</option>
            {ICAL_PRESETS.map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map(p => (
                  <option key={p.url} value={p.url}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
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
        {urls.length > 1 && (
          <div style={{ marginTop: 8 }}>
            <div className="wsm-field-label">Active feeds</div>
            <div className="wsm-field-help" style={{ marginBottom: 6 }}>
              Switch a feed off to skip it without removing the URL.
            </div>
            {urls.map((url, i) => (
              <ToggleField
                key={`${url}-${i}`}
                label={url.length > 48 ? `${url.slice(0, 44)}…` : url}
                value={!disabled.includes(url)}
                onChange={(on) => toggleFeed(url, on)}
              />
            ))}
          </div>
        )}
      </FormSection>
      <FormSection title="Content">
        <PresetField presets={PRESETS} onApply={(vals) => onChange({ ...v, ...vals })} />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })}
          placeholder="UPCOMING"
          help="Leave blank to keep the default heading."
        />
        <ToggleField label="Day label (column with date)"
          value={v.showDayLabel !== false} defaultValue={defaults.showDayLabel}
          onChange={(x) => patch({ showDayLabel: x })} />
        <ToggleField label="Event time"
          value={v.showTime     !== false} defaultValue={defaults.showTime}
          onChange={(x) => patch({ showTime:     x })} />
      </FormSection>
      <FormSection title="Layout">
        <SelectField
          label="View"
          value={v.viewMode || 'list'}
          defaultValue={defaults.viewMode}
          options={[
            { value: 'list',  label: 'List — agenda (works at any size)' },
            { value: 'strip', label: 'Strip — 7-day horizontal (needs ≥14 wide)' },
            { value: 'month', label: 'Month — full grid (needs ≥12×6)' }
          ]}
          onChange={(x) => patch({ viewMode: x })}
        />
        <SelectField
          label="Density (list view only)"
          value={v.density || 'auto'}
          defaultValue={defaults.density}
          options={[
            { value: 'auto',     label: 'Auto — by tile size' },
            { value: 'compact',  label: 'Compact — fewer events' },
            { value: 'standard', label: 'Standard' },
            { value: 'rich',     label: 'Rich — more events + sections' }
          ]}
          onChange={(x) => patch({ density: x })}
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}

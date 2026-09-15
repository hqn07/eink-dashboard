import React, { useState } from 'react';
import { ICAL_PRESETS } from './_ical_presets.js';
import SearchableSelect from '../components/SearchableSelect.jsx';
import QuickEventsEditor from '../components/QuickEventsEditor.jsx';
import UrlBadge from '../components/UrlBadge.jsx';
import SaveFeedButton from '../components/SaveFeedButton.jsx';
import SavedFeedsManager from '../components/SavedFeedsManager.jsx';
import { useSavedFeeds } from '../components/saved-feeds-context.js';

// Presets cover the three view modes so the thumbnails actually differ
// from each other. Each preset commits a full look (view + density +
// show toggles) so a single click switches everything in one go.
const PRESETS = [
  { id: 'agenda', label: 'Agenda — list with sections',
    values: { variant: 'list',  density: 'rich',     showDayLabel: true,  showTime: true } },
  { id: 'today',  label: 'Today — compact list',
    values: { variant: 'list',  density: 'compact',  showDayLabel: false, showTime: true } },
  { id: 'strip',  label: 'Strip — 7-day horizontal',
    values: { variant: 'strip', density: 'auto',     showDayLabel: true,  showTime: true } },
  { id: 'month',  label: 'Month — full grid',
    values: { variant: 'month', density: 'auto',     showDayLabel: true,  showTime: true } }
];

// Preset picker (hooks live here, not in the pure Form — see the photo/
// TabbedForm note: Form is called directly to introspect its sections, so
// it must not call hooks).
function PresetAdder({ v, patch }) {
  const [presetPick, setPresetPick] = useState('');
  const { feeds } = useSavedFeeds();
  const addPreset = (url) => {
    if (!url) { setPresetPick(''); return; }
    const existing = Array.isArray(v.icalUrls) ? v.icalUrls : [];
    if (!existing.includes(url)) patch({ icalUrls: [...existing, url] });
    setPresetPick('');
  };
  // "My feeds" leads the list so the user's own saved webcal/ics URLs are
  // one pick away on every new screen — the whole point of the library.
  const myGroup = feeds.length ? [{
    label: 'My feeds',
    items: feeds.map(f => ({ value: f.url, label: f.name, hint: 'Saved' }))
  }] : [];
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="wsm-field-label">Add from library</div>
      <div className="wsm-field-help" style={{ marginBottom: 4 }}>
        Your saved feeds + public presets — search or pick one to append below.
      </div>
      <SearchableSelect
        value={presetPick}
        onChange={addPreset}
        groups={[...myGroup, ...ICAL_PRESETS.map(g => ({
          label: g.group,
          items: g.items.map(it => ({ value: it.url, label: it.name, hint: g.group }))
        }))]}
        placeholder="— Pick a feed —"
        ariaLabel="Add iCal feed"
      />
    </div>
  );
}

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, ListEditor, SelectField, ToggleField, FormSection, PresetField, defaults = {} } = fields;
  const urls = Array.isArray(v.icalUrls) ? v.icalUrls.filter(Boolean) : [];
  const disabled = Array.isArray(v.disabledFeeds) ? v.disabledFeeds : [];
  const toggleFeed = (url, on) => {
    const next = on
      ? disabled.filter(u => u !== url)
      : disabled.includes(url) ? disabled : [...disabled, url];
    patch({ disabledFeeds: next });
  };
  return (
    <>
      <FormSection title="Data">
        <PresetAdder v={v} patch={patch} />
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
            <>
              <input type="url"
                value={typeof it === 'string' ? it : ''}
                placeholder="https://calendar.google.com/calendar/ical/..."
                onChange={e => set(e.target.value)}
                style={{ flex: 1 }} />
              <UrlBadge url={typeof it === 'string' ? it : ''} />
              <SaveFeedButton url={typeof it === 'string' ? it : ''} />
            </>
          )}
        />
        <SavedFeedsManager />
        <div className="wsm-field-label" style={{ marginTop: 10 }}>Quick events (no calendar app needed)</div>
        <QuickEventsEditor
          value={v.localEvents || []}
          onChange={(items) => patch({ localEvents: items })}
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
          onChange={(x) => patch({ title: x })} tokens
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
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          Pick the view with the variant cards above. Strip needs a tile
          ≥7 wide, month ≥7×4 — smaller tiles fall back to the list.
        </div>
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
    </>
  );
}

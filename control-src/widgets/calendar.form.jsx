import React, { useState } from 'react';
import { buildForm } from './_schema.jsx';
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

// The feed list rows carry a badge and a save button beside the URL, and the
// active-feeds switches are one toggle per URL the user has entered — both are
// shapes the generic field types cannot describe, so they stay components.
function FeedList({ ctx }) {
  const { ListEditor } = ctx.fields;
  return (
    <ListEditor
      label="iCal feed URLs"
      items={ctx.values.icalUrls}
      onChange={(items) => ctx.patch({ icalUrls: items })}
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
  );
}

// Muting a feed keeps the URL but skips the fetch, so the switch list is
// generated from whatever the user has entered — not from a fixed option set.
function ActiveFeeds({ ctx }) {
  const { ToggleField } = ctx.fields;
  const urls = Array.isArray(ctx.values.icalUrls) ? ctx.values.icalUrls.filter(Boolean) : [];
  const disabled = Array.isArray(ctx.values.disabledFeeds) ? ctx.values.disabledFeeds : [];
  if (urls.length < 2) return null;
  const toggleFeed = (url, on) => ctx.patch({
    disabledFeeds: on
      ? disabled.filter(u => u !== url)
      : disabled.includes(url) ? disabled : [...disabled, url]
  });
  return (
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
  );
}

export const FIELDS = [
  {
    type: 'custom', section: 'Data', owns: ['icalUrls', 'disabledFeeds', 'localEvents'],
    render: (ctx) => (
      <>
        <PresetAdder v={ctx.values} patch={ctx.patch} />
        <FeedList ctx={ctx} />
        <SavedFeedsManager />
        <div className="wsm-field-label" style={{ marginTop: 10 }}>
          Quick events (no calendar app needed)
        </div>
        <QuickEventsEditor
          value={ctx.values.localEvents || []}
          onChange={(items) => ctx.patch({ localEvents: items })}
        />
        <ActiveFeeds ctx={ctx} />
      </>
    )
  },
  { type: 'presets', section: 'Content', presets: PRESETS },
  {
    key: 'title', type: 'text', label: 'Tile heading', section: 'Content', tokens: true,
    placeholder: 'UPCOMING',
    help: 'Leave blank to keep the default heading.'
  },
  { key: 'showDayLabel', type: 'toggle', label: 'Day label (column with date)', section: 'Content' },
  { key: 'showTime', type: 'toggle', label: 'Event time', section: 'Content' },
  {
    type: 'note', section: 'Layout',
    text: 'Pick the view with the variant cards above. Strip needs a tile ≥7 wide, '
      + 'month ≥7×4 — smaller tiles fall back to the list.'
  },
  {
    key: 'density', type: 'select', label: 'Density (list view only)', section: 'Layout',
    options: [
      { value: 'auto',     label: 'Auto — by tile size' },
      { value: 'compact',  label: 'Compact — fewer events' },
      { value: 'standard', label: 'Standard' },
      { value: 'rich',     label: 'Rich — more events + sections' }
    ]
  }
];

export const Form = buildForm(FIELDS);

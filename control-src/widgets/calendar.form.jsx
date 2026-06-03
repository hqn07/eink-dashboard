import React from 'react';

const PRESETS = [
  { id: 'today',   label: 'Today — compact, today only',
    values: { density: 'compact',  showDayLabel: false, showTime: true  } },
  { id: 'week',    label: 'Week — rich list with sections',
    values: { density: 'rich',     showDayLabel: true,  showTime: true  } },
  { id: 'minimal', label: 'Minimal — titles only',
    values: { density: 'standard', showDayLabel: false, showTime: false } }
];

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, ListEditor, SelectField, ToggleField, TypographyFields, FormSection, PresetField } = fields;
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
      <FormSection title="Layout">
        <PresetField presets={PRESETS} onApply={(vals) => onChange({ ...v, ...vals })} />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          onChange={(x) => patch({ title: x })}
          placeholder="UPCOMING"
          help="Leave blank to keep the default heading."
        />
        <SelectField
          label="Density"
          value={v.density || 'auto'}
          options={[
            { value: 'auto',     label: 'Auto — by tile size' },
            { value: 'compact',  label: 'Compact — fewer events' },
            { value: 'standard', label: 'Standard' },
            { value: 'rich',     label: 'Rich — more events + sections' }
          ]}
          onChange={(x) => patch({ density: x })}
        />
      </FormSection>
      <FormSection title="Show">
        <ToggleField label="Day label (column with date)"
          value={v.showDayLabel !== false} onChange={(x) => patch({ showDayLabel: x })} />
        <ToggleField label="Event time"
          value={v.showTime     !== false} onChange={(x) => patch({ showTime:     x })} />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}

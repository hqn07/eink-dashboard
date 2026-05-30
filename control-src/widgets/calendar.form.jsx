import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { ListEditor, SelectField, TypographyFields } = fields;
  return (
    <>
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
      <TypographyFields values={v} onChange={onChange} />
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
}

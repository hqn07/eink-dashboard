import React from 'react';

const SPANS = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['year', 'Year']
];

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, SelectField, FormSection, defaults = {} } = fields;
  const spans = Array.isArray(v.spans) ? v.spans : ['day', 'year'];

  const toggle = (key) => {
    const next = spans.includes(key)
      ? spans.filter(k => k !== key)
      : [...spans, key];
    patch({ spans: next.length ? next : ['day'] }); // never empty
  };

  return (
    <>
      <FormSection title="Spans">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {SPANS.map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={spans.includes(key)}
                onChange={() => toggle(key)}
              />
              {label}
            </label>
          ))}
        </div>
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="PROGRESS"
          help="Leave blank to keep the default heading."
        />
      </FormSection>
    </>
  );
}

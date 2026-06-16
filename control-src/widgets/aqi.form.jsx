import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, ToggleField, TypographyFields, FormSection, defaults = {} } = fields;
  return (
    <>
      <FormSection title="Content">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          Air quality (US AQI) for your dashboard location — set it in
          the main location picker. No API key needed.
        </div>
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })}
          placeholder="AIR QUALITY"
          help="Leave blank to keep the default heading."
        />
        <ToggleField
          label="Pollutant line (PM2.5 · PM10)"
          value={v.showPollutants !== false}
          defaultValue={defaults.showPollutants}
          onChange={(x) => patch({ showPollutants: x })}
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}

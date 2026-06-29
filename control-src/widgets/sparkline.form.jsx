import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, SelectField, TypographyFields, FormSection, defaults = {} } = fields;
  return (
    <>
      <FormSection title="Data">
        <SelectField
          label="Source"
          value={v.source || 'battery_pct'}
          defaultValue={defaults.source}
          options={[
            { value: 'battery_pct', label: 'E-ink battery %' },
            { value: 'battery_v',   label: 'E-ink battery voltage' }
          ]}
          onChange={(x) => patch({ source: x })}
          help="Trend is built from the readings the device pushes each refresh."
        />
      </FormSection>
      <FormSection title="Content">
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })}
          placeholder="BATTERY"
          help="Leave blank to use the source name."
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}

import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, ToggleField, TypographyFields, FormSection, defaults = {} } = fields;
  return (
    <>
      <FormSection title="Content">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          Sunrise / sunset for your dashboard location — set it in the
          main location picker. No API key needed.
        </div>
        <ToggleField
          label="24-hour clock"
          value={v.hour24 === true}
          defaultValue={defaults.hour24}
          onChange={(x) => patch({ hour24: x })}
        />
        <ToggleField
          label="Show daylight length"
          value={v.showDaylight !== false}
          defaultValue={defaults.showDaylight}
          onChange={(x) => patch({ showDaylight: x })}
        />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })}
          placeholder="SUN"
          help="Leave blank to keep the default heading."
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}

import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, TypographyFields, FormSection } = fields;
  return (
    <>
      <FormSection title="Content">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          Current moon phase + illumination, computed from the date. No
          location or API key needed.
        </div>
        <TextField
          label="Tile heading"
          value={v.title || ''}
          onChange={(x) => patch({ title: x })}
          placeholder="MOON"
          help="Leave blank to keep the default heading."
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}

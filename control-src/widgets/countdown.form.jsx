import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, TypographyFields, FormSection, defaults = {} } = fields;
  return (
    <>
      <FormSection title="Content">
        <TextField
          label="Target date"
          value={v.target || ''}
          defaultValue={defaults.target}
          onChange={(x) => patch({ target: x })}
          placeholder="2026-12-25"
          help="YYYY-MM-DD (or YYYY-MM-DDTHH:MM for a specific time)."
        />
        <TextField
          label="Label"
          value={v.label || ''}
          defaultValue={defaults.label}
          onChange={(x) => patch({ label: x })}
          placeholder="until launch"
          help="Shown under the number. Optional."
        />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })}
          placeholder="COUNTDOWN"
          help="Leave blank to keep the default heading."
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}

import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, SelectField, TypographyFields, FormSection, defaults = {} } = fields;
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
        <SelectField
          label="Repeats"
          value={v.repeat || 'none'}
          defaultValue={defaults.repeat}
          options={[
            { value: 'none',    label: 'Never — one-shot date' },
            { value: 'weekly',  label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
            { value: 'yearly',  label: 'Yearly (birthdays)' }
          ]}
          onChange={(x) => patch({ repeat: x })}
          help="After the date passes, count to the next occurrence instead of going negative."
        />
        <TextField
          label="Label"
          value={v.label || ''}
          defaultValue={defaults.label}
          onChange={(x) => patch({ label: x })} tokens
          placeholder="until launch"
          help="Shown under the number. Optional."
        />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
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

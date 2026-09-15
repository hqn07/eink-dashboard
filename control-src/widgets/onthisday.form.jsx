import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, FormSection } = fields;
  return (
    <>
      <FormSection title="Content">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          Historical events for today's date, from Wikipedia. No API key
          needed; updates once a day.
        </div>
        <TextField
          label="Tile heading"
          value={v.title || ''}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="ON THIS DAY · JUNE 16"
          help="Leave blank for the auto heading with today's date."
        />
      </FormSection>
    </>
  );
}

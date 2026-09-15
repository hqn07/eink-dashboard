import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, ToggleField, FormSection, defaults = {} } = fields;
  return (
    <>
      <FormSection title="Content">
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="DAILY PUZZLE"
        />
        <ToggleField
          label="Rating + themes footer"
          value={v.showMeta !== false}
          defaultValue={defaults.showMeta}
          onChange={(x) => patch({ showMeta: x })}
        />
      </FormSection>
    </>
  );
}

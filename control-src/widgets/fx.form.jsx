import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, FormSection, defaults = {} } = fields;
  const targetsStr = Array.isArray(v.targets) ? v.targets.join(', ') : '';

  return (
    <>
      <FormSection title="Rates">
        <TextField
          label="Base currency"
          value={v.base || ''}
          defaultValue={defaults.base}
          onChange={(x) => patch({ base: x.trim().toUpperCase() })}
          placeholder="USD"
          help="ISO code, e.g. USD, EUR, GBP, JPY."
        />
        <TextField
          label="Show rates for"
          value={targetsStr}
          onChange={(x) => patch({
            targets: x.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
          })}
          placeholder="EUR, GBP, JPY"
          help="Comma-separated ISO codes. Fiat only (ECB data)."
        />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="CURRENCY"
          help="Leave blank to keep the default heading."
        />
      </FormSection>
    </>
  );
}

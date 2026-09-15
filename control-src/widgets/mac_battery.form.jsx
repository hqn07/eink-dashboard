import React from 'react';

export function Form({ values, onChange, fields }) {
  const v = values || {};
  const patch = (p) => onChange({ ...v, ...p });
  const { TextField, ToggleField, SelectField, FormSection, defaults = {} } = fields;
    return (
    <>
      <FormSection title="Content">
        <TextField
          label="Tile heading"
          value={v.title || ''}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="MAC BATTERY"
          help="Leave blank to keep the default heading."
        />
        <ToggleField
          label='State line (CHARGING / DISCHARGING)'
          value={v.showState !== false}
          defaultValue={defaults.showState}
          onChange={(x) => patch({ showState: x })}
        />
      </FormSection>
      <FormSection title="Style">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          Reads battery from the host Mac. On Railway / cloud it shows
          "MAC OFFLINE" until the mac-agent pushes a fresh reading.
        </div>
      </FormSection>
    </>
  );
}

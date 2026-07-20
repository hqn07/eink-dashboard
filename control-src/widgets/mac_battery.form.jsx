import React from 'react';

export function Form({ values, onChange, fields }) {
  const v = values || {};
  const patch = (p) => onChange({ ...v, ...p });
  const { TextField, ToggleField, SelectField, TypographyFields, FormSection, defaults = {} } = fields;
  const BAR_SHAPE_OPTS = [
    { value: 'rectangular', label: 'Rectangular (default)' },
    { value: 'pill',        label: 'Pill — rounded ends' },
    { value: 'battery',     label: 'Battery — rounded + tip' },
    { value: 'segmented',   label: 'Segmented — 10 cells' },
    { value: 'notched',     label: 'Notched — cells + tip' },
    { value: 'ticked',      label: 'Ticked — 25/50/75 marks' }
  ];
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
        <SelectField
          label="Bar shape"
          value={v.barShape || 'rectangular'}
          defaultValue={defaults.barShape || 'rectangular'}
          options={BAR_SHAPE_OPTS}
          onChange={(x) => patch({ barShape: x })}
          help="Battery / notched read most like a battery icon."
        />
      </FormSection>
      <FormSection title="Style">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          Reads battery from the host Mac. On Railway / cloud it shows
          "MAC OFFLINE" until the mac-agent pushes a fresh reading.
        </div>
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}

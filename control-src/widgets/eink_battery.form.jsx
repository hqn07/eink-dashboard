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
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="E-INK BATTERY"
          help="Leave blank to keep the default heading."
        />
        <ToggleField
          label="Voltage readout (e.g. 4.03 V)"
          value={v.showVoltage !== false}
          defaultValue={defaults.showVoltage}
          onChange={(x) => patch({ showVoltage: x })}
        />
        <ToggleField
          label="Battery bar (visual fill)"
          value={v.showBar !== false}
          defaultValue={defaults.showBar}
          onChange={(x) => patch({ showBar: x })}
        />
        {v.showBar !== false && (
          <SelectField
            label="Bar shape"
            value={v.barShape || 'rectangular'}
            defaultValue={defaults.barShape || 'rectangular'}
            options={BAR_SHAPE_OPTS}
            onChange={(x) => patch({ barShape: x })}
            help="Battery / notched read most like a battery icon."
          />
        )}
        <ToggleField
          label='"Updated N ago" timestamp'
          value={v.showAge !== false}
          defaultValue={defaults.showAge}
          onChange={(x) => patch({ showAge: x })}
        />
      </FormSection>
      <FormSection title="Style">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          Reads from the panel's last POST to /api/battery (server
          stores it in data/battery.json). Updates every refresh
          cycle.
        </div>
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}

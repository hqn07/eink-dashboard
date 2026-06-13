import React from 'react';

// Layout (big / thin / banner) lives in the auto-rendered variant
// picker (contract v2) — no hand-rolled style field here.
const PRESETS = [
  { id: 'big',  label: 'Big chunky with date',
    values: { variant: 'big',  showDate: true,  format: '12h' } },
  { id: 'thin', label: 'Thin clean with date',
    values: { variant: 'thin', showDate: true,  format: '12h' } },
  { id: 'time_only', label: 'Time only (no date)',
    values: { variant: 'big',  showDate: false, format: '12h' } },
  { id: '24h', label: '24-hour minimal',
    values: { variant: 'thin', showDate: true,  format: '24h' } }
];

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { SegmentedField, ToggleField, TypographyFields, FormSection, PresetField, defaults = {} } = fields;
  const fmt = v.format === '24h' ? '24h' : '12h';
  const showDate = v.showDate !== false;
  return (
    <>
      <FormSection title="Content">
        <PresetField presets={PRESETS} onApply={(vals) => onChange({ ...v, ...vals })} />
        <SegmentedField
          label="Format"
          value={fmt}
          defaultValue={defaults.format}
          options={[
            { value: '12h', short: '12h', label: '12-hour (3:34 PM)' },
            { value: '24h', short: '24h', label: '24-hour (15:34)' }
          ]}
          onChange={(x) => patch({ format: x })}
        />
        <ToggleField
          label="Show date below time"
          value={showDate}
          defaultValue={defaults.showDate}
          onChange={(x) => patch({ showDate: x })}
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}

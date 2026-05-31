import React from 'react';

const PRESETS = [
  { id: 'big',  label: 'Big chunky with date',
    values: { style: 'big',  showDate: true,  format: '12h' } },
  { id: 'thin', label: 'Thin clean with date',
    values: { style: 'thin', showDate: true,  format: '12h' } },
  { id: 'time_only', label: 'Time only (no date)',
    values: { style: 'big',  showDate: false, format: '12h' } },
  { id: '24h', label: '24-hour minimal',
    values: { style: 'thin', showDate: true,  format: '24h' } }
];

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { SelectField, ToggleField, TypographyFields, FormSection, PresetField } = fields;
  const fmt = v.format === '24h' ? '24h' : '12h';
  const style = v.style === 'thin' ? 'thin' : 'big';
  const showDate = v.showDate !== false;
  return (
    <>
      <FormSection title="Layout">
        <PresetField presets={PRESETS} onApply={(vals) => onChange({ ...v, ...vals })} />
        <SelectField
          label="Format"
          value={fmt}
          options={[
            { value: '12h', label: '12-hour (3:34 PM)' },
            { value: '24h', label: '24-hour (15:34)' }
          ]}
          onChange={(x) => patch({ format: x })}
        />
        <SelectField
          label="Style"
          value={style}
          options={[
            { value: 'big',  label: 'Big chunky' },
            { value: 'thin', label: 'Thin' }
          ]}
          onChange={(x) => patch({ style: x })}
        />
        <ToggleField
          label="Show date below time"
          value={showDate}
          onChange={(x) => patch({ showDate: x })}
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}

import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { SelectField, ToggleField, TypographyFields } = fields;
  const fmt = v.format === '24h' ? '24h' : '12h';
  const style = v.style === 'thin' ? 'thin' : 'big';
  const showDate = v.showDate !== false;
  return (
    <>
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
      <TypographyFields values={v} onChange={onChange} />
    </>
  );
}

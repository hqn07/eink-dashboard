import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { LocationFields, TextField, TypographyFields } = fields;
  return (
    <>
      <LocationFields
        values={v}
        onChange={(loc) => onChange({ ...v, ...loc })}
      />
      <TextField
        label="Days to show (1–7 · blank = auto by tile height)"
        type="number"
        value={v.forecastDays ?? ''}
        onChange={(x) => patch({
          forecastDays: Number.isFinite(x) ? Math.max(1, Math.min(7, x)) : null
        })}
        help="Open-Meteo returns up to 7 days; larger tiles fit more."
      />
      <TypographyFields values={v} onChange={onChange} />
    </>
  );
}

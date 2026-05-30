import React from 'react';

export function Form({ values, onChange, fields }) {
  const v = values || {};
  const { LocationFields, TypographyFields } = fields;
  return (
    <>
      <LocationFields
        values={v}
        onChange={(loc) => onChange({ ...v, ...loc })}
      />
      <TypographyFields values={v} onChange={onChange} />
    </>
  );
}

import React from 'react';

export function Form({ values, onChange, fields }) {
  const { TypographyFields } = fields;
  return (
    <>
      <div className="wsm-field-help" style={{ marginBottom: 6 }}>
        Reads battery from the host Mac. On Railway / cloud it shows
        "MAC OFFLINE".
      </div>
      <TypographyFields values={values || {}} onChange={onChange} />
    </>
  );
}

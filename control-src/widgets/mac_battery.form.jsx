import React from 'react';

export function Form({ values, onChange, fields }) {
  const { TypographyFields, FormSection } = fields;
  return (
    <FormSection title="Style">
      <div className="wsm-field-help" style={{ marginBottom: 6 }}>
        Reads battery from the host Mac. On Railway / cloud it shows
        "MAC OFFLINE" until the mac-agent pushes a fresh reading.
      </div>
      <TypographyFields values={values || {}} onChange={onChange} />
    </FormSection>
  );
}

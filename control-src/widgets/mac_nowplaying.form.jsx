import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { SelectField, TypographyFields } = fields;
  const variant = v.variant || 'time_bookends';
  return (
    <>
      <div className="wsm-field-help" style={{ marginBottom: 6 }}>
        Variants apply on tiles big enough to stack the art above the
        title (extended/full tiers). Smaller tiles fall back to the
        standard inline layout.
      </div>
      <SelectField
        label="Side-space variant"
        value={variant}
        options={[
          { value: 'time_bookends', label: 'Time bookends (elapsed · remaining)' },
          { value: 'centered',      label: 'Centered (no bookends)' }
        ]}
        onChange={(x) => patch({ variant: x })}
      />
      <TypographyFields values={v} onChange={onChange} />
    </>
  );
}

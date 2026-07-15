import React from 'react';

// Art widget settings. Pattern family comes from the shared variant
// picker (def.variants); this form owns the knobs under it.
export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { ToggleField, SliderField, TypographyFields, FormSection, defaults = {} } = fields;
  return (
    <>
      <FormSection title="Pattern">
        <SliderField
          label="Cell size"
          min={12} max={48} step={2}
          value={Number.isFinite(v.density) ? v.density : 22}
          defaultValue={defaults.density}
          onChange={(x) => patch({ density: x })}
          format={(x) => `${x}px`}
          help="Smaller cells = finer weave."
        />
        <SliderField
          label="Seed offset"
          min={0} max={9} step={1}
          value={Number.isFinite(v.seed) ? v.seed : 0}
          defaultValue={defaults.seed}
          onChange={(x) => patch({ seed: x })}
          help="The pattern reseeds daily; bump this so two tiles differ on the same day."
        />
        <ToggleField
          label="Date stamp"
          value={!!v.showDate}
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
